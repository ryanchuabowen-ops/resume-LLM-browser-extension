// Detects and, with a local LLM's judgment, merges resume section headings
// that were probably meant to be a sub-heading within the previous section
// rather than a genuinely separate top-level section. Needed because the
// parser (section_detect.ts's looksLikeSectionHeader) has no reliable
// signal to tell these apart on its own: a document that uses plain
// bold/all-caps text for BOTH a real section header and an in-section
// sub-heading (rather than Word's actual heading-level styles) looks
// identical either way. Real user-reported case: "SKILLS, ACTIVITIES &
// INTERESTS" followed immediately by just one bullet, then "TECHNICAL
// SKILLS" - clearly meant as a sub-topic of the first, not its own section.
//
// Pure except for an injected `generate` callback, same pattern as
// rewriter_ollama.ts - the network call happens in background/ollama_client.ts.
// No rule-based variant: judging whether two headings are topically related
// needs real language understanding, not something a keyword heuristic can
// reliably do - and getting it wrong risks visibly mangling someone's
// resume structure. So this only ever runs when Ollama is reachable; any
// failure just leaves the document exactly as originally parsed - never
// blocking the user, never guessing without the LLM's judgment call.
import type { Bullet, ResumeDocument, Section } from "./models.ts";

// Only a section with very few bullets before the NEXT heading interrupts
// it is a plausible "this was meant to be an umbrella heading" candidate -
// bounds how many (slow, one-at-a-time local-LLM) calls happen per resume,
// and avoids ever asking about two substantial, clearly-separate sections.
const SPARSE_BULLET_THRESHOLD = 2;
const MAX_CANDIDATES = 6;

export interface MergeCandidate {
  sparseIndex: number; // index of the section suspected to be an umbrella heading
  nextIndex: number; // index of the section suspected to actually be its sub-heading
}

export function findMergeCandidates(sections: Section[]): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const bulletCount = sections[i]!.bullets.length;
    if (bulletCount > 0 && bulletCount <= SPARSE_BULLET_THRESHOLD) {
      candidates.push({ sparseIndex: i, nextIndex: i + 1 });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }
  return candidates;
}

export function buildMergeJudgePrompt(sectionAName: string, sectionBName: string): string {
  return `A resume was split into sections by looking for bold/all-caps heading-like lines. Two candidate section headings appeared close together:

Section A: "${sectionAName}"
Section B: "${sectionBName}"

Section A has very few lines before Section B appears. This can happen either because Section B is a genuinely separate resume section, OR because Section B is actually a sub-heading/sub-topic that belongs INSIDE Section A (for example, "TECHNICAL SKILLS" appearing right after "SKILLS, ACTIVITIES & INTERESTS" is a sub-topic of it, not a separate section).

Are Section A and Section B closely enough related in topic that Section B should be merged into Section A as a sub-heading, rather than kept as its own separate top-level section?

Answer with ONLY a JSON object of this exact shape, no other text:
{"merge": true or false}`;
}

export function parseMergeJudgeResponse(rawText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Ollama returned unparseable output: ${err instanceof Error ? err.message : String(err)}`);
  }
  const merge = (parsed as { merge?: unknown } | null)?.merge;
  if (typeof merge !== "boolean") {
    throw new Error("Ollama response missing a boolean 'merge' field");
  }
  return merge;
}

export type GenerateFn = (prompt: string) => Promise<string>;

export interface MergeSectionsResult {
  document: ResumeDocument;
  warnings: string[];
}

export async function mergeSectionsWithOllama(
  document: ResumeDocument,
  generate: GenerateFn,
): Promise<MergeSectionsResult> {
  const candidates = findMergeCandidates(document.sections);
  if (candidates.length === 0) return { document, warnings: [] };

  const warnings: string[] = [];
  const mergeIntoPrevious = new Set<number>(); // nextIndex values judged mergeable

  for (const candidate of candidates) {
    const sparse = document.sections[candidate.sparseIndex]!;
    const next = document.sections[candidate.nextIndex]!;
    try {
      const rawText = await generate(buildMergeJudgePrompt(sparse.name, next.name));
      if (parseMergeJudgeResponse(rawText)) {
        mergeIntoPrevious.add(candidate.nextIndex);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(
        `Could not check whether some sections should be merged (${message}); resume sections left as originally detected.`,
      );
      // Ollama is very likely unreachable/misbehaving for every candidate,
      // not just this one - stop rather than repeat the same failure N
      // times in a row.
      break;
    }
  }

  if (mergeIntoPrevious.size === 0) return { document, warnings };

  const mergedSections: Section[] = [];
  for (let i = 0; i < document.sections.length; i++) {
    const section = document.sections[i]!;
    if (mergeIntoPrevious.has(i)) {
      const previous = mergedSections[mergedSections.length - 1];
      if (!previous) {
        // Defensive only - candidates always have nextIndex >= 1, so a
        // preceding, kept section always exists by this point.
        mergedSections.push({ ...section, bullets: [...section.bullets] });
        continue;
      }
      const subHeadingBullet: Bullet = { text: section.name, section: previous.name, order: 0, isListItem: false };
      previous.bullets.push(subHeadingBullet, ...section.bullets.map((b) => ({ ...b, section: previous.name })));
      continue;
    }
    mergedSections.push({ ...section, bullets: [...section.bullets] });
  }

  return {
    document: { ...document, sections: renumberOrder(mergedSections) },
    warnings,
  };
}

// Bullet.order is a single monotonic counter across the whole document
// (see build_document.ts) - everything downstream (segmentListRuns,
// docx_match.ts's order-anchored matching) depends on that invariant, so
// merging sections must re-establish it in the new final order rather than
// leaving gaps or duplicates behind.
function renumberOrder(sections: Section[]): Section[] {
  let order = 0;
  return sections.map((s) => ({
    ...s,
    bullets: s.bullets.map((b) => ({ ...b, order: ++order })),
  }));
}
