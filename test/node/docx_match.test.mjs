// Paragraph extraction + order-anchored bullet/summary matching, against
// real docx-package-generated fixtures. Polyfills DOMParser/XMLSerializer
// the same way docx_xml.test.mjs does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

import {
  Document as DocxDocument,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { loadDocxXml } from "../../src/lib/resume/docx_xml.ts";
import { extractParagraphs } from "../../src/lib/resume/docx_paragraphs.ts";
import { matchBulletsToParagraphs, matchSummaryParagraph } from "../../src/lib/resume/docx_match.ts";

async function loadParagraphs(children) {
  const doc = new DocxDocument({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const bytes = await blob.arrayBuffer();
  const { doc: xmlDoc } = await loadDocxXml(bytes);
  return extractParagraphs(xmlDoc);
}

function bullet(text, section, order) {
  return { text, section, order, isListItem: true };
}

test("extractParagraphs walks <w:p> in document order with concatenated text", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Jane Doe")] }),
    new Paragraph({ children: [new TextRun("Led "), new TextRun("the migration.")] }),
  ]);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].text, "Jane Doe");
  assert.equal(paragraphs[1].text, "Led the migration.");
});

test("extractParagraphs preserves a <w:tab/> between two runs as a literal tab character, matching mammoth's own behavior", async () => {
  // Real regression: "University of London" <w:tab/> "Singapore" is a
  // common right-aligned resume layout. mammoth's HTML conversion already
  // turns <w:tab/> into a literal "\t" in Bullet.text (confirmed directly
  // against mammoth) - extractText() must match that exactly, or a
  // tab-separated line will fail to match during in-place editing and
  // force an unnecessary, formatting-losing fallback to regeneration.
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [
      new TextRun("University of London"),
      new TextRun({ text: "\t" }),
      new TextRun("Singapore"),
    ] }),
  ]);
  assert.equal(paragraphs[0].text, "University of London\tSingapore");
});

test("extractParagraphs marks a plain-run paragraph as isSimpleEditable", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Plain bullet text.")] }),
  ]);
  assert.equal(paragraphs[0].isSimpleEditable, true);
});

test("extractParagraphs marks a hyperlink-containing paragraph as NOT isSimpleEditable", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({
      children: [
        new TextRun("See "),
        new ExternalHyperlink({ link: "https://example.com", children: [new TextRun("my site")] }),
      ],
    }),
  ]);
  assert.equal(paragraphs[0].isSimpleEditable, false, "a paragraph containing a hyperlink run must not be treated as safely text-replaceable");
});

test("matchBulletsToParagraphs matches every bullet to its correct paragraph when text is unambiguous", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Senior Engineer, Acme Corp")] }),
    new Paragraph({ children: [new TextRun("Led migration to Kubernetes.")] }),
    new Paragraph({ children: [new TextRun("Organized team events.")] }),
  ]);
  const bullets = [
    bullet("Senior Engineer, Acme Corp", "Experience", 1),
    bullet("Led migration to Kubernetes.", "Experience", 2),
    bullet("Organized team events.", "Experience", 3),
  ];
  const result = matchBulletsToParagraphs(paragraphs, bullets);
  assert.equal(result.ok, true);
  assert.equal(result.matches.get(bullets[1]), paragraphs[1].element);
  assert.equal(result.matches.get(bullets[2]), paragraphs[2].element);
});

test("matchBulletsToParagraphs cleanly fails (not throws) when a bullet's text is absent from the document", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Led migration to Kubernetes.")] }),
  ]);
  const bullets = [bullet("This text was never in the original file.", "Experience", 1)];
  const result = matchBulletsToParagraphs(paragraphs, bullets);
  assert.equal(result.ok, false);
  assert.match(result.reason, /No matching paragraph/);
});

test("matchBulletsToParagraphs assigns identical-text bullets in two different sections to their own distinct paragraphs, never crossed", async () => {
  // The key correctness case for order-anchored matching: two sections each
  // have a bullet reading "Led cross-functional planning meetings." A naive
  // unordered text search could match both to the same paragraph, or match
  // section A's bullet to section B's paragraph. The forward-only pointer,
  // walked in true document order (Bullet.order), must keep them straight.
  const DUPLICATE_TEXT = "Led cross-functional planning meetings.";
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Senior Engineer, Acme Corp")] }),
    new Paragraph({ children: [new TextRun(DUPLICATE_TEXT)] }),
    new Paragraph({ children: [new TextRun("Product Manager, Beta Inc")] }),
    new Paragraph({ children: [new TextRun(DUPLICATE_TEXT)] }),
  ]);
  const bulletA = bullet("Senior Engineer, Acme Corp", "Experience", 1);
  const bulletB = bullet(DUPLICATE_TEXT, "Experience", 2);
  const bulletC = bullet("Product Manager, Beta Inc", "Experience", 3);
  const bulletD = bullet(DUPLICATE_TEXT, "Experience", 4);

  const result = matchBulletsToParagraphs(paragraphs, [bulletA, bulletB, bulletC, bulletD]);
  assert.equal(result.ok, true);
  assert.equal(result.matches.get(bulletB), paragraphs[1].element, "the first job's duplicate-text bullet must map to the first paragraph occurrence");
  assert.equal(result.matches.get(bulletD), paragraphs[3].element, "the second job's duplicate-text bullet must map to the second paragraph occurrence, not be reused/crossed");
  assert.notEqual(result.matches.get(bulletB), result.matches.get(bulletD));
});

test("matchBulletsToParagraphs works correctly even if bullets are passed out of document order", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("First bullet.")] }),
    new Paragraph({ children: [new TextRun("Second bullet.")] }),
  ]);
  const b1 = bullet("First bullet.", "Experience", 1);
  const b2 = bullet("Second bullet.", "Experience", 2);
  // Passed reversed - matchBulletsToParagraphs must sort by .order itself.
  const result = matchBulletsToParagraphs(paragraphs, [b2, b1]);
  assert.equal(result.ok, true);
  assert.equal(result.matches.get(b1), paragraphs[0].element);
  assert.equal(result.matches.get(b2), paragraphs[1].element);
});

test("matchSummaryParagraph matches a single-paragraph summary", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Backend engineer with 6 years of experience.")] }),
  ]);
  const result = matchSummaryParagraph(paragraphs, "Backend engineer with 6 years of experience.");
  assert.equal(result.ok, true);
  assert.equal(result.element, paragraphs[0].element);
});

test("matchSummaryParagraph aborts (ok:false) when the summary spans multiple paragraphs", async () => {
  const paragraphs = await loadParagraphs([
    new Paragraph({ children: [new TextRun("Line one of summary.")] }),
    new Paragraph({ children: [new TextRun("Line two of summary.")] }),
  ]);
  // Mirrors ResumeDocument.summary's shape: summaryLines.join("\n").
  const multiParagraphSummary = "Line one of summary.\nLine two of summary.";
  const result = matchSummaryParagraph(paragraphs, multiParagraphSummary);
  assert.equal(result.ok, false, "a multi-paragraph summary must never be force-matched to a single paragraph");
});
