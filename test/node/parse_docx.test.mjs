// Builds a real .docx on disk with the `docx` package, parses it back with
// parse_docx.ts, and checks the extracted structure - same pattern as the
// Python project's tests/smoke_resume_parse.py.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";

async function buildSampleDocx() {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun("Jane Doe")] }),
        new Paragraph({ children: [new TextRun("jane.doe@example.com | (555) 123-4567")] }),
        new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("Backend engineer with 6 years of experience.")] }),
        new Paragraph({ text: "Experience", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun("Senior Software Engineer, Acme Corp (2021-Present)")] }),
        new Paragraph({ text: "Led migration of payments service to Kubernetes.", bullet: { level: 0 } }),
        new Paragraph({ text: "Mentored 3 junior engineers.", bullet: { level: 0 } }),
        new Paragraph({ text: "Skills", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "Python, Go, Kubernetes, AWS", bullet: { level: 0 } }),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  const dir = await mkdtemp(path.join(os.tmpdir(), "job-tailor-test-"));
  const filePath = path.join(dir, "sample.docx");
  await (await import("node:fs/promises")).writeFile(filePath, buffer);
  return filePath;
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("parseDocx extracts contact block, summary, and section bullets", async () => {
  const filePath = await buildSampleDocx();
  const arrayBuffer = toArrayBuffer(await readFile(filePath));

  const resume = await parseDocx(arrayBuffer, "sample.docx");

  assert.match(resume.contactBlock, /Jane Doe/);
  assert.match(resume.contactBlock, /jane\.doe@example\.com/);
  assert.match(resume.summary, /distributed|experience/i);

  const experience = resume.sections.find((s) => s.name === "Experience");
  assert.ok(experience, "Experience section should be detected");
  assert.equal(experience.bullets.length, 3, "job title line + 2 real bullets");

  const [titleLine, bullet1, bullet2] = experience.bullets;
  assert.equal(titleLine.isListItem, false, "job title line must not be a list item");
  assert.equal(bullet1.isListItem, true);
  assert.equal(bullet2.isListItem, true);
  assert.match(bullet1.text, /Kubernetes/);

  const skills = resume.sections.find((s) => s.name === "Skills");
  assert.ok(skills);
  assert.equal(skills.bullets[0].isListItem, true);
});
