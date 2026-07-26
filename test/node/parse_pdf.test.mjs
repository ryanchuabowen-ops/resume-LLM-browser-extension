// Builds a real .pdf on disk with pdfkit, parses it back with parse_pdf.ts,
// and checks the extracted structure.
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import PDFDocument from "pdfkit";
import { parsePdf } from "../../src/lib/resume/parse_pdf.ts";

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
