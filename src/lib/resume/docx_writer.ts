// Generates a fresh .docx from a TailoredResume. Port of job-agent's
// docx_writer.py. This is the fallback path used by generate_output_docx.ts
// whenever true in-place editing (docx_inplace.ts, which edits the user's
// actual original .docx bytes and so preserves their real fonts/margins/
// letterhead) isn't possible or safe for a given resume - always used
// outright for PDF-sourced resumes, since there's no original .docx to
// edit in place. This module has no access to the original file at all, so
// the output doesn't try to match it - it's styled directly here instead
// (name/contact header, colored bordered section headings, bold anchor
// lines) so it still reads as an actual designed resume, not a bare
// default Word document.
//
// Bullets are deliberately rendered with UNIFORM styling - no per-bullet
// bold/color for "highlighted" (strong-match) items. An earlier version
// bolded+colored every highlighted bullet, but since rule-based tailoring
// commonly highlights most bullets in a short job entry, that produced a
// visual "clump of bolded words" rather than a clean resume - real
// feedback, not a hypothetical. The relevance signal that actually survives
// into the exported document is reordering (handled upstream in
// rewriter_rule_based.ts / rewriter_ollama.ts, already applied to `tailored`
// by the time this runs) - the same practice a human resume writer uses:
// put the most relevant achievement first, not bolded differently from the
// rest.
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { ResumeDocument } from "./models.ts";
import { bulletsBySection, type TailoredBullet, type TailoredResume } from "./rewriter_base.ts";

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
    children: [new TextRun({ text, bold: true, size: 23, font: FONT, color: COLOR_HEADING })], // 11.5pt
    spacing: { before: 160, after: 40 },
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 90 },
    children: [new TextRun({ text, size: 21, font: FONT })], // 10.5pt, normal weight - see file header comment
  });
}

function plainParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 90 },
    children: [new TextRun({ text, size: 21, font: FONT })], // same as bulletParagraph, just no bullet glyph
  });
}

// isListItem:false ("anchor") originally meant "Job Title, Company" -
// short single lines meant to read as a sub-heading. But any non-bulleted
// line in the source resume also gets isListItem:false, including a long
// prose paragraph, or - critically for PDF sources - an arbitrary
// mid-sentence fragment left over from an imperfect line-wrap
// reconstruction (parse_pdf.ts's mergeWrappedLines/pdf_line_reconstruct.ts
// do their best, but PDFs genuinely have no paragraph boundaries, so a
// stray fragment is always possible). Guessing "is this really an anchor"
// from the fragment's text length/shape doesn't work: on a real
// user-reported PDF, a plain mid-sentence fragment ("media) mining to
// extract valuable insights... predictive and diagnostic analysis") was
// short purely by coincidence of where its line happened to wrap, and got
// bolded as if it were a title - there is no length or shape rule that
// reliably tells a real short title apart from a short fragment, because
// nothing about being short makes a piece of text a title.
//
// The only reliable signal is the ORIGINAL document's own formatting:
// Bullet.isEmphasized (set in parse_docx.ts from whether mammoth shows the
// whole paragraph wrapped in <strong>) records whether the user themselves
// bolded that exact line in Word - ground truth, not a guess. PDF sources
// have no equivalent signal (isEmphasized stays undefined), and rather
// than keep tuning a shape-based guess that has now misfired in multiple
// different ways, PDF-sourced non-list lines are rendered as plain text
// uniformly - this trades away bold styling on genuine PDF anchor lines,
// but a resume that's honestly plain everywhere reads better than one with
// bold text scattered onto random sentence fragments.
function looksLikeAnchorLine(tb: TailoredBullet): boolean {
  return tb.original.isEmphasized === true;
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
        children.push(bulletParagraph(tb.newText));
      } else if (looksLikeAnchorLine(tb)) {
        children.push(anchorParagraph(tb.newText));
      } else {
        children.push(plainParagraph(tb.newText));
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
