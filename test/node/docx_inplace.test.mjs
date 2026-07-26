// End-to-end in-place editing: real docx fixtures, real reorder/replace
// mutations, real reparse via the existing mammoth-based parser as the
// sanity gate. Polyfills DOMParser/XMLSerializer like the other docx_*
// tests.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { tryGenerateInPlaceDocx } from "../../src/lib/resume/docx_inplace.ts";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";
import { tailorRuleBased } from "../../src/lib/resume/rewriter_rule_based.ts";

const JOB = {
  title: "Senior Backend Engineer",
  company: "TestCo",
  description: "We need a Kubernetes and AWS expert with PostgreSQL experience.",
};

async function buildFixtureBytes(paragraphSpecs) {
  const doc = new DocxDocument({
    sections: [{
      children: paragraphSpecs.map((spec) =>
        new Paragraph({
          bullet: spec.bullet ? { level: 0 } : undefined,
          children: [new TextRun({ text: spec.text, bold: spec.bold, italics: spec.italics })],
        })),
    }],
  });
  const blob = await Packer.toBlob(doc);
  return blob.arrayBuffer();
}

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

test("tryGenerateInPlaceDocx reorders bullets in place and preserves an untouched run's bold formatting", async () => {
  const resume = buildResume();
  const originalBytes = await buildFixtureBytes([
    { text: "Experience" },
    { text: "Senior Software Engineer, Acme Corp (2021-Present)", bold: true },
    { text: "Organized team events.", bullet: true },
    { text: "Led migration to Kubernetes and AWS with PostgreSQL.", bullet: true },
  ]);
  const tailored = tailorRuleBased(resume, JOB);
  // The Kubernetes/AWS bullet should now rank ahead of "Organized team
  // events." given the job description - same relevance signal
  // docx_writer.test.mjs already relies on for the regenerate-from-scratch
  // path.
  const kubernetesBullet = tailored.bullets.find((tb) => tb.original.text.includes("Kubernetes"));
  const eventsBullet = tailored.bullets.find((tb) => tb.original.text.includes("team events"));
  assert.ok(kubernetesBullet.newOrder < eventsBullet.newOrder, "fixture assumption: Kubernetes bullet should rank first");

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.ok(result.blob, `expected a successful in-place edit, got fallback reason: ${result.reason}`);

  const reopened = await parseDocx(await result.blob.arrayBuffer(), "resume.docx");
  const experience = reopened.sections.find((s) => s.name === "Experience");
  const listItems = experience.bullets.filter((b) => b.isListItem);
  assert.match(listItems[0].text, /Kubernetes/, "the more relevant bullet must now come first in the physically reordered document");
  assert.match(listItems[1].text, /team events/);

  // Confirm the untouched anchor's bold run survived - reordering must not
  // have recreated or stripped its <w:rPr>.
  const mammoth = (await import("mammoth")).default;
  const arrayBuffer = await result.blob.arrayBuffer();
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.match(html, /<strong>[^<]*Senior Software Engineer/);
});

test("tryGenerateInPlaceDocx rewrites text for a changed bullet while preserving other runs' rPr and removing extra runs", async () => {
  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Anchor line", section: "Experience", order: 1, isListItem: false },
        { text: "Original bullet text.", section: "Experience", order: 2, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const originalBytes = await buildFixtureBytes([
    { text: "Experience" },
    { text: "Anchor line", italics: true },
    { text: "Original bullet text.", bullet: true },
  ]);
  const tailored = {
    backendName: "ollama",
    bullets: [
      { original: resume.sections[0].bullets[0], newText: "Anchor line", changed: false, highlight: false, newOrder: 1 },
      { original: resume.sections[0].bullets[1], newText: "Rewritten bullet text with new wording.", changed: true, highlight: false, newOrder: 2 },
    ],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.ok(result.blob, `expected success, got fallback reason: ${result.reason}`);

  const reopened = await parseDocx(await result.blob.arrayBuffer(), "resume.docx");
  const experience = reopened.sections.find((s) => s.name === "Experience");
  assert.ok(experience.bullets.some((b) => b.text === "Rewritten bullet text with new wording."));
  assert.ok(!experience.bullets.some((b) => b.text === "Original bullet text."));

  // The untouched anchor's italics (its own <w:rPr>) must survive - proves
  // text replacement in the OTHER paragraph didn't disturb it.
  const mammoth = (await import("mammoth")).default;
  const arrayBuffer = await result.blob.arrayBuffer();
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.match(html, /<em>[^<]*Anchor line/);
});

test("tryGenerateInPlaceDocx succeeds (not a forced fallback) for a tab-separated anchor line like 'University of London<TAB>Singapore'", async () => {
  // Real regression: before extractText() was fixed to preserve <w:tab/>,
  // a tab-separated line like this would fail matching entirely (its
  // extracted paragraph text lacked the tab that mammoth's Bullet.text
  // had), aborting the WHOLE in-place attempt for the whole document and
  // silently falling back to a regenerated file that lost the original
  // (possibly custom-positioned) tab stop. Built via a hand-crafted <w:p>
  // with a genuine <w:tab/> element - real Word documents represent a
  // user-pressed Tab key this way (a dedicated element between runs), NOT
  // as a literal tab character inside <w:t> (which is what the `docx` npm
  // generator package does instead, confirmed by direct testing - using
  // that here would fail to exercise the actual code path being fixed).
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      "<w:p><w:r><w:t>Education</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>University of London</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Singapore</w:t></w:r></w:p>" +
      "</w:body></w:document>",
  );
  const originalBytes = await zip.generateAsync({ type: "arraybuffer" });

  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Education",
      bullets: [{ text: "University of London\tSingapore", section: "Education", order: 1, isListItem: false }],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const tailored = {
    backendName: "rule_based",
    bullets: [{ original: resume.sections[0].bullets[0], newText: "University of London\tSingapore", changed: false, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.ok(result.blob, `expected a successful in-place edit (tab preserved via untouched original run), got fallback reason: ${result.reason}`);

  const zipOut = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const xml = await zipOut.file("word/document.xml").async("text");
  assert.ok(/<w:tab\s*\/>/.test(xml), "the original <w:tab/> element must survive untouched, preserving whatever custom tab stop the original paragraph defined");
});

test("tryGenerateInPlaceDocx sets xml:space=preserve when new text has leading/trailing whitespace", async () => {
  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{ name: "Experience", bullets: [{ text: "Bullet text.", section: "Experience", order: 1, isListItem: true }] }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const originalBytes = await buildFixtureBytes([{ text: "Bullet text.", bullet: true }]);
  const tailored = {
    backendName: "ollama",
    bullets: [{ original: resume.sections[0].bullets[0], newText: "  Padded text.  ", changed: true, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.ok(result.blob, `expected success, got fallback reason: ${result.reason}`);

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("text");
  assert.match(xml, /xml:space="preserve"/, "xml:space=preserve must be set for a run with significant whitespace");
});

test("tryGenerateInPlaceDocx falls back cleanly (blob:null) when the edited output would fail the reparse-validation gate", async () => {
  // A single-paragraph fixture whose only bullet is rewritten to an empty
  // string - the resulting document has zero extractable text blocks, so
  // the mandatory reparse-via-parseDocx() gate inside tryGenerateInPlaceDocx
  // itself throws, which must be caught and turned into a clean null
  // rather than propagating or returning a bad blob.
  const resume = {
    contactBlock: "",
    summary: "",
    sections: [{ name: "Experience", bullets: [{ text: "Only bullet.", section: "Experience", order: 1, isListItem: true }] }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const originalBytes = await buildFixtureBytes([{ text: "Only bullet.", bullet: true }]);
  const tailored = {
    backendName: "ollama",
    bullets: [{ original: resume.sections[0].bullets[0], newText: "", changed: true, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.equal(result.blob, null, "the reparse-validation gate must reject an edit that empties out all content, not return a bad blob");
  assert.ok(result.reason, "a fallback reason must be provided");
});
