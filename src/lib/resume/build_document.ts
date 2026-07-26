// Shared line-to-ResumeDocument assembly, used by both the DOCX and PDF
// parsers once each has normalized its source into a flat line sequence.
// Port of job-agent/resume/parser.py's _lines_to_document.
import type { Bullet, ResumeDocument, Section, SourceFormat } from "./models.ts";
import { isSummaryLikeSection, looksLikeSectionHeader } from "./section_detect.ts";

export interface NormalizedLine {
  text: string;
  kind: "heading" | "list_item" | "plain";
  // See Bullet.isEmphasized in models.ts - undefined when the source
  // format has no way to tell (e.g. PDF).
  emphasized?: boolean;
}

export function buildResumeDocument(
  lines: NormalizedLine[],
  sourceFormat: SourceFormat,
  sourceFileName: string,
): ResumeDocument {
  const contactLines: string[] = [];
  const summaryLines: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  let order = 0;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    // A line is a section header if the source explicitly marked it as one
    // (mammoth <h1-h6>), OR it reads like one even without that markup -
    // mirrors the Python DOCX path checking style-heading OR text heuristic.
    const headerName = line.kind === "heading" ? text : looksLikeSectionHeader(text);
    if (headerName) {
      current = { name: headerName, bullets: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      contactLines.push(text);
      continue;
    }

    if (isSummaryLikeSection(current.name)) {
      summaryLines.push(text);
      continue;
    }

    order += 1;
    const bullet: Bullet = {
      text,
      section: current.name,
      order,
      isListItem: line.kind === "list_item",
      isEmphasized: line.emphasized,
    };
    current.bullets.push(bullet);
  }

  return {
    contactBlock: contactLines.join("\n"),
    summary: summaryLines.join("\n"),
    sections: sections.filter((s) => s.bullets.length > 0 || isSummaryLikeSection(s.name)),
    sourceFormat,
    sourceFileName,
  };
}
