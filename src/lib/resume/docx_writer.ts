// Generates a fresh .docx from a TailoredResume. Port of job-agent's
// docx_writer.py, but with a real capability gap versus the Python version:
// neither `mammoth` (read-only) nor `docx` (generate-only, no
// edit-existing-file API) can do in-place OOXML editing the way Python's
// python-docx + lxml did. So this ALWAYS regenerates a fresh document from
// the tailored data - the same code path the Python version used only for
// PDF-sourced resumes - for both DOCX- and PDF-sourced resumes. This means
// DOCX-sourced resumes lose their original fonts/margins/letterhead in the
// output. That's a disclosed, deliberate v1 trade-off, not an oversight -
// see the project README.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ResumeDocument } from "./models.ts";
import { bulletsBySection, type TailoredResume } from "./rewriter_base.ts";

export async function generateTailoredDocx(resume: ResumeDocument, tailored: TailoredResume): Promise<Blob> {
  const children: Paragraph[] = [];

  children.push(new Paragraph({ text: "Contact", heading: HeadingLevel.HEADING_1 }));
  for (const line of resume.contactBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) children.push(new Paragraph({ children: [new TextRun(trimmed)] }));
  }

  if (tailored.summary.trim()) {
    children.push(new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ children: [new TextRun(tailored.summary.trim())] }));
  }

  for (const [sectionName, bullets] of bulletsBySection(tailored)) {
    children.push(new Paragraph({ text: sectionName, heading: HeadingLevel.HEADING_1 }));
    for (const tb of bullets) {
      if (tb.original.isListItem) {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: tb.newText, bold: tb.highlight })],
        }));
      } else {
        children.push(new Paragraph({ children: [new TextRun(tb.newText)] }));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

export function tailoredDocxFileName(company: string, title: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_") || "job";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safe(company)}_${safe(title)}_${ts}.docx`;
}
