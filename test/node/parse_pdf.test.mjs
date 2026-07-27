// Builds a real .pdf on disk with pdfkit, parses it back with parse_pdf.ts,
// and checks the extracted structure.
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import PDFDocument from "pdfkit";
import { classifyLine, looksLikeLabeledEntry, mergeWrappedLines, parsePdf } from "../../src/lib/resume/parse_pdf.ts";

async function buildSamplePdf() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "job-tailor-test-"));
  const filePath = path.join(dir, "sample.pdf");
  const doc = new PDFDocument();
  const stream = doc.pipe(createWriteStream(filePath));
  doc.text("Jane Doe");
  doc.text("jane.doe@example.com");
  doc.text("EXPERIENCE");
  doc.text("Senior Software Engineer, Acme Corp (2021-Present)");
  doc.text("- Led migration of payments service to Kubernetes.");
  doc.text("- Mentored 3 junior engineers.");
  doc.text("SKILLS");
  doc.text("- Python, Go, Kubernetes, AWS");
  doc.end();
  await new Promise((resolve) => stream.on("finish", resolve));
  return filePath;
}

test("parsePdf extracts contact block and section bullets using the bullet-glyph heuristic", async () => {
  const filePath = await buildSamplePdf();
  const data = new Uint8Array(await readFile(filePath));

  const resume = await parsePdf(data, "sample.pdf");

  assert.match(resume.contactBlock, /Jane Doe/);
  assert.match(resume.contactBlock, /jane\.doe@example\.com/);

  const experience = resume.sections.find((s) => s.name === "Experience");
  assert.ok(experience, "Experience section should be detected from the ALL CAPS heuristic");
  assert.equal(experience.bullets.length, 3);

  const [titleLine, bullet1, bullet2] = experience.bullets;
  assert.equal(titleLine.isListItem, false, "job title line has no bullet glyph, must not be a list item");
  assert.equal(bullet1.isListItem, true, "dash-prefixed line must be detected as a list item");
  assert.match(bullet1.text, /Kubernetes/);
  assert.equal(bullet1.text.startsWith("-"), false, "bullet glyph prefix should be stripped from text");
  assert.equal(bullet2.isListItem, true);

  const skills = resume.sections.find((s) => s.name === "Skills");
  assert.ok(skills);
  assert.equal(skills.bullets[0].isListItem, true);
});

test("classifyLine detects a Wingdings/Symbol-font PUA bullet glyph, not just standard Unicode bullets", () => {
  // Real regression: a user's actual resume PDF used the Private-Use-Area
  // codepoint 0xF0B7 (a Wingdings "bullet" character, common in
  // Word-to-PDF exports) for every single bullet in the document -
  // confirmed directly via pdfjs against that real file. The old bullet
  // set (standard Unicode glyphs only) matched none of them, so not a
  // single bullet in that entire resume was detected as a list item.
  const puaBullet = String.fromCharCode(0xf0b7);
  const line = classifyLine(`${puaBullet} Led migration of payments service to Kubernetes.`);
  assert.equal(line.kind, "list_item");
  assert.equal(line.text, "Led migration of payments service to Kubernetes.");
});

test("classifyLine still detects the standard Unicode bullet glyphs (no regression)", () => {
  assert.equal(classifyLine("• Mentored 3 junior engineers.").kind, "list_item");
  assert.equal(classifyLine("- Mentored 3 junior engineers.").kind, "list_item");
  assert.equal(classifyLine("Senior Engineer, Acme Corp").kind, "plain");
});

test("mergeWrappedLines merges a hanging-indented continuation into the previous row, across 3+ wrapped lines", () => {
  // PDFs have no paragraph concept - a bullet/anchor line that wraps
  // becomes a totally separate row with no inherent link back to the row
  // it continues. The common, recoverable signal: wrapped continuation
  // text is hanging-indented further right than the line that started the
  // current bullet, while a genuinely new bullet/anchor resets back to the
  // left margin - confirmed directly against a real resume PDF.
  const rows = [
    { text: "Senior Engineer, Acme Corp (2021-Present)", x: 54 },
    { text: "Built and led a cross-functional platform migration spanning", x: 54 },
    { text: "multiple teams and significantly reducing infrastructure costs", x: 72 }, // continuation
    { text: "across the whole organization over an 18 month period.", x: 72 }, // 3rd line, SAME indent as the 2nd - must still merge
    { text: "Mentored 3 junior engineers.", x: 54 }, // back to the margin - a genuinely new bullet
  ];
  const merged = mergeWrappedLines(rows);
  assert.deepEqual(merged, [
    "Senior Engineer, Acme Corp (2021-Present)",
    "Built and led a cross-functional platform migration spanning multiple teams and significantly reducing infrastructure costs across the whole organization over an 18 month period.",
    "Mentored 3 junior engineers.",
  ]);
});

test("looksLikeLabeledEntry recognizes real 'Label:' resume lines and rejects real continuation fragments", () => {
  // Confirmed directly against a real resume's "Technical Skills" section:
  // every new entry followed this "Label: description" convention, and no
  // continuation fragment did - a far more reliable signal than an LLM's
  // judgment turned out to be for exactly this transition.
  assert.equal(looksLikeLabeledEntry("Python language: Highly proficient at using Python for entire data analysis pipeline"), true);
  assert.equal(looksLikeLabeledEntry("MySQL and SQLite Database: Familiar with Relational Database Management system (RDBMS),"), true);
  assert.equal(looksLikeLabeledEntry("Certificates: Tableau Essential Training, Excel Essential Training"), true);
  assert.equal(looksLikeLabeledEntry("media) mining to extract valuable insights (e.g. Sentiment analysis) and conducting inferential,"), false);
  assert.equal(looksLikeLabeledEntry("predictive and diagnostic analysis"), false);
  assert.equal(looksLikeLabeledEntry("to machine learning to exploratory data analysis"), false);
});

test("mergeWrappedLines does not merge into a labeled new entry even if it happens to be indented", () => {
  const rows = [
    { text: "Some bullet spanning", x: 54 },
    { text: "Certificates: this happens to be indented but is still a new entry", x: 72 },
  ];
  assert.deepEqual(mergeWrappedLines(rows), rows.map((r) => r.text));
});

test("mergeWrappedLines does not merge a row that returns to the same or a lower x than the current entry's start", () => {
  const rows = [
    { text: "EDUCATION", x: 54 },
    { text: "University of London, Singapore", x: 54 },
    { text: "Bachelor of Science in Data Science", x: 54 },
  ];
  assert.deepEqual(mergeWrappedLines(rows), rows.map((r) => r.text));
});

test("parsePdf merges a bullet that wraps across multiple physical lines into one, using real pdfjs-extracted coordinates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "job-tailor-test-"));
  const filePath = path.join(dir, "wrapped.pdf");
  const doc = new PDFDocument();
  const stream = doc.pipe(createWriteStream(filePath));
  let y = 50;
  const lineHeight = 16;
  const nextY = () => { const current = y; y += lineHeight; return current; };
  doc.text("Jane Doe", 50, nextY());
  doc.text("EXPERIENCE", 50, nextY());
  doc.text("Senior Engineer, Acme Corp (2021-Present)", 50, nextY());
  doc.text("- Built and led a cross-functional platform migration spanning", 50, nextY());
  doc.text("multiple teams and reducing infrastructure costs significantly.", 75, nextY()); // indented continuation
  doc.text("- Mentored 3 junior engineers.", 50, nextY());
  doc.end();
  await new Promise((resolve) => stream.on("finish", resolve));

  const data = new Uint8Array(await readFile(filePath));
  const resume = await parsePdf(data, "wrapped.pdf");

  const experience = resume.sections.find((s) => s.name === "Experience");
  assert.ok(experience);
  assert.equal(experience.bullets.length, 3, "title anchor + 2 real bullets, wrapped continuation merged in, not a 4th fragment");
  const [title, bullet1, bullet2] = experience.bullets;
  assert.equal(title.isListItem, false);
  assert.equal(bullet1.isListItem, true);
  assert.match(bullet1.text, /cross-functional platform migration spanning multiple teams and reducing infrastructure costs significantly\./);
  assert.equal(bullet2.isListItem, true);
  assert.match(bullet2.text, /Mentored 3 junior engineers/);
});
