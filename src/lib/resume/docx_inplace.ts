// Orchestrator and the single "always fall back safely" boundary for
// in-place .docx editing. tryGenerateInPlaceDocx never throws - any doubt
// at any point (parse failure, ambiguous/missing match, a structurally
// complex paragraph, a reordering error, or the edited output failing the
// mandatory reparse-validation gate) resolves to `{ blob: null, reason }`,
// which callers treat as "use the existing safe regeneration path instead."
import type { ResumeDocument } from "./models.ts";
import { bulletsBySection, type TailoredResume } from "./rewriter_base.ts";
import { loadDocxXml, rezipDocx, serializeDocxXml } from "./docx_xml.ts";
import { extractParagraphs } from "./docx_paragraphs.ts";
import { matchBulletsToParagraphs, matchSummaryParagraph } from "./docx_match.ts";
import { replaceParagraphText, reorderSectionParagraphs } from "./docx_inplace_edit.ts";
import { parseDocx } from "./parse_docx.ts";

export type InPlaceDocxResult = { blob: Blob } | { blob: null; reason: string };

export async function tryGenerateInPlaceDocx(
  originalBytes: ArrayBuffer,
  resume: ResumeDocument,
  tailored: TailoredResume,
): Promise<InPlaceDocxResult> {
  try {
    const { zip, doc, xmlDeclaration } = await loadDocxXml(originalBytes);
    const paragraphs = extractParagraphs(doc);

    // Summary is matched independently, before bullets, so a changed
    // summary never collides with bullet matching - see docx_match.ts.
    let summaryElement: Element | null = null;
    if (tailored.summaryChanged) {
      const summaryMatch = matchSummaryParagraph(paragraphs, resume.summary);
      if (!summaryMatch.ok) return { blob: null, reason: `Summary: ${summaryMatch.reason}` };
      const summaryParagraph = paragraphs.find((p) => p.element === summaryMatch.element);
      if (!summaryParagraph?.isSimpleEditable) {
        return { blob: null, reason: "Summary paragraph is structurally too complex to safely rewrite in place" };
      }
      summaryElement = summaryMatch.element;
    }
    const consumedBySummary = summaryElement ? new Set([summaryElement]) : new Set<Element>();

    const originalBullets = tailored.bullets.map((tb) => tb.original);
    const matchResult = matchBulletsToParagraphs(paragraphs, originalBullets, consumedBySummary);
    if (!matchResult.ok) return { blob: null, reason: matchResult.reason };

    // Text replacement - only bullets the tailoring actually reworded
    // (tb.changed), which in practice only ever happens via the Ollama
    // backend; the default rule-based backend never sets changed:true, so
    // for it this whole feature is reorder-only.
    for (const tb of tailored.bullets) {
      if (!tb.changed) continue;
      const element = matchResult.matches.get(tb.original)!;
      const paragraph = paragraphs.find((p) => p.element === element);
      if (!paragraph?.isSimpleEditable) {
        return {
          blob: null,
          reason: `Cannot safely rewrite text of a structurally complex paragraph: "${tb.original.text.slice(0, 60)}"`,
        };
      }
      replaceParagraphText(element, tb.newText);
    }
    if (summaryElement) {
      replaceParagraphText(summaryElement, tailored.summary);
    }

    // Reordering, per section - trusts TailoredBullet.newOrder (already
    // anchor-boundary-safe, computed upstream), never re-derives it.
    for (const [, sectionBullets] of bulletsBySection(tailored)) {
      const orderedElements = sectionBullets.map((tb) => matchResult.matches.get(tb.original)!);
      reorderSectionParagraphs(orderedElements);
    }

    const newXml = serializeDocxXml(doc, xmlDeclaration);
    const blob = await rezipDocx(zip, newXml);

    // Mandatory sanity gate: never return an edited file as a success
    // without first confirming the existing, proven mammoth-based parser
    // can still open it. Necessary, not sufficient (mammoth is lenient),
    // but the strongest automated check available in this environment.
    await parseDocx(await blob.arrayBuffer(), resume.sourceFileName);

    return { blob };
  } catch (err) {
    return { blob: null, reason: err instanceof Error ? err.message : String(err) };
  }
}
