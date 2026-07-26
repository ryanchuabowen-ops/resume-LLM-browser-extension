// Full round trip: tailor a resume, generate a fresh .docx Blob, reparse it
// with the real mammoth-based parser, and confirm the tailored content and
// highlight formatting survived.
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTailoredDocx } from "../../src/lib/resume/docx_writer.ts";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";
import { tailorRuleBased } from "../../src/lib/resume/rewriter_rule_based.ts";

const JOB = {
  title: "Senior Backend Engineer",
  company: "TestCo",
  description: "We need a Kubernetes and AWS expert with PostgreSQL experience.",
};

function buildResume() {
  return {
    contactBlock: "Jane Doe\njane.doe@example.com",
    summary: "Backend engineer with 6 years of experience.",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Senior Software Engineer, Acme Corp (2021-Present)", section: "Experience", order: 1, isListItem: false },
        { text: "Organized team events.", section: "Experience", order: 2, isListItem: true },
        { text: "Led migration to Kubernetes and AWS with PostgreSQL.", section: "Experience", order: 3, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("generateTailoredDocx produces a real, reparseable docx with highlighted top bullet", async () => {
  const resume = buildResume();
  const tailored = tailorRuleBased(resume, JOB);

  const blob = await generateTailoredDocx(resume, tailored);
  assert.ok(blob.size > 0, "generated docx should not be empty");

  const arrayBuffer = await blob.arrayBuffer();
  const reopened = await parseDocx(arrayBuffer, "tailored.docx");

  // The name/contact-subtitle header is now plain (non-heading) text at the
  // top of the document, so on reparse it lands in contactBlock (text before
  // the first section heading) - matching the source resume's own shape.
  assert.match(reopened.contactBlock, /Jane Doe/);
  assert.match(reopened.contactBlock, /jane\.doe@example\.com/);
  assert.match(reopened.summary, /experience/);

  const experience = reopened.sections.find((s) => s.name === "Experience");
  assert.ok(experience);
  const kubernetesBullet = experience.bullets.find((b) => b.text.includes("Kubernetes"));
  assert.ok(kubernetesBullet, "the relevant bullet should be present in the output");

  // Highlighted bullets should render bold in the output. parseDocx() itself
  // strips inline formatting tags (it only needs plain text + list/heading
  // structure for ResumeDocument), so check mammoth's raw HTML directly here
  // instead - full color fidelity is still manual-only (see docx_writer.ts).
  // mammoth's Node build reads options.buffer, not options.arrayBuffer (see
  // parse_docx.ts for the same distinction) - pass both like it does.
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  const highlighted = tailored.bullets.find((tb) => tb.highlight);
  assert.ok(highlighted, "expected at least one highlighted bullet from tailoring");
  assert.match(html, new RegExp(`<strong>[^<]*${highlighted.newText.slice(0, 15)}`));
});

test("tailoredDocxFileName produces a safe, unique-ish filename", async () => {
  const { tailoredDocxFileName } = await import("../../src/lib/resume/docx_writer.ts");
  const name = tailoredDocxFileName("Acme Corp / Inc.", "Senior Engineer!");
  assert.match(name, /^Acme_Corp_Inc_Senior_Engineer.*\.docx$/);
});
