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
//
// This does not, however, mean the output has to look like a bare default
// Word document - it's styled directly here (name/contact header, colored
// bordered section headings, bold anchor lines, accented highlighted
// bullets) so it reads as an actual designed resume.
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { ResumeDocument } from "./models.ts";
import { bulletsBySection, type TailoredResume } from "./rewriter_base.ts";

const FONT = "Calibri";
const COLOR_HEADING = "1F4E79"; // dark blue, matches the section-heading accent
const COLOR_MUTED = "595959"; // gray, for the contact subtitle line

function nameParagraph(name: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: name, bold: true, size: 52, font: FONT })], // 26pt
    spacing: { after: 40 },
  });
}

function contactSubtitleParagraph(lines: string[]): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: lines.join("  |  "), size: 20, font: FONT, color: COLOR_MUTED })], // 10pt
    spacing: { after: 240 },
  });
}

function sectionHeadingParagraph(name: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: name.toUpperCase(), bold: true, size: 26, font: FONT, color: COLOR_HEADING })], // 13pt
    spacing: { before: 240, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_HEADING, space: 2 },
    },
  });
}

function summaryParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, size: 22, font: FONT })], // 11pt
    spacing: { after: 120 },
  });
}

function anchorParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 23, font: FONT })], // 11.5pt
    spacing: { before: 120, after: 40 },
  });
}

function bulletParagraph(text: string, highlight: boolean): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [
      new TextRun({
        text,
        bold: highlight,
        color: highlight ? COLOR_HEADING : undefined,
        size: 21, // 10.5pt
        font: FONT,
      }),
    ],
  });
}

export async function generateTailoredDocx(resume: ResumeDocument, tailored: TailoredResume): Promise<Blob> {
  const children: Paragraph[] = [];

  const contactLines = resume.contactBlock.split("\n").map((l) => l.trim()).filter(Boolean);
  const [name, ...rest] = contactLines;
  if (name) children.push(nameParagraph(name));
  if (rest.length > 0) children.push(contactSubtitleParagraph(rest));

  if (tailored.summary.trim()) {
    children.push(sectionHeadingParagraph("Summary"));
    children.push(summaryParagraph(tailored.summary.trim()));
  }

  for (const [sectionName, bullets] of bulletsBySection(tailored)) {
    children.push(sectionHeadingParagraph(sectionName));
    for (const tb of bullets) {
      if (tb.original.isListItem) {
        children.push(bulletParagraph(tb.newText, tb.highlight));
      } else {
        children.push(anchorParagraph(tb.newText));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } }, // 0.5in / 0.625in in twips
      },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

export function tailoredDocxFileName(company: string, title: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_") || "job";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safe(company)}_${safe(title)}_${ts}.docx`;
}
