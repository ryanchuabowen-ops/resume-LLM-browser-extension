// Adversarial fixtures proving tryGenerateInPlaceDocx always fails clean
// (blob:null, never a throw) and generateOutputDocx() seamlessly falls
// through to a valid regenerated blob for every one of them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

import JSZip from "jszip";
import { Document as DocxDocument, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { tryGenerateInPlaceDocx } from "../../src/lib/resume/docx_inplace.ts";
import { generateOutputDocx } from "../../src/lib/resume/generate_output_docx.ts";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";

const W_NS_DECL =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function buildMinimalDocxZip(bodyXml) {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${W_NS_DECL}><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

function simpleTailoredResume(resume) {
  const bullets = resume.sections.flatMap((s) => s.bullets);
  return {
    backendName: "rule_based",
    bullets: bullets.map((b) => ({ original: b, newText: b.text, changed: false, highlight: false, newOrder: b.order })),
    summary: resume.summary,
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };
}

function baseResume() {
  return {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Experience",
      bullets: [{ text: "Only bullet.", section: "Experience", order: 1, isListItem: true }],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("tryGenerateInPlaceDocx cleanly fails on bytes that aren't a zip at all", async () => {
  const resume = baseResume();
  const tailored = simpleTailoredResume(resume);
  const garbageBytes = new TextEncoder().encode("not a docx, just text").buffer;
  const result = await tryGenerateInPlaceDocx(garbageBytes, resume, tailored);
  assert.equal(result.blob, null);
  assert.ok(result.reason);
});

test("tryGenerateInPlaceDocx cleanly fails on a zip missing word/document.xml", async () => {
  const resume = baseResume();
  const tailored = simpleTailoredResume(resume);
  const zip = new JSZip();
  zip.file("readme.txt", "not a resume");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  const result = await tryGenerateInPlaceDocx(bytes, resume, tailored);
  assert.equal(result.blob, null);
  assert.ok(result.reason);
});

test("tryGenerateInPlaceDocx cleanly fails when a section's bullets live in different table cells", async () => {
  // Two bullets in the same ResumeDocument section, but physically placed
  // in separate table cells (a two-column resume layout) - reordering
  // would be meaningless across cells, so reorderSectionParagraphs' shared-
  // parent check must reject this, and the orchestrator must turn that
  // into a clean fallback rather than a corrupt reorder.
  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Left column bullet.", section: "Experience", order: 1, isListItem: true },
        { text: "Right column bullet.", section: "Experience", order: 2, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  // newOrder swapped relative to original order, forcing an actual move.
  const tailored = {
    backendName: "rule_based",
    bullets: [
      { original: resume.sections[0].bullets[0], newText: "Left column bullet.", changed: false, highlight: false, newOrder: 2 },
      { original: resume.sections[0].bullets[1], newText: "Right column bullet.", changed: false, highlight: false, newOrder: 1 },
    ],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const doc = new DocxDocument({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun("Experience")] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun("Left column bullet.")] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun("Right column bullet.")] })] }),
              ],
            }),
          ],
        }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const originalBytes = await blob.arrayBuffer();

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.equal(result.blob, null, "reordering across table cells must never be attempted");
  assert.ok(result.reason);

  const fallback = await generateOutputDocx(resume, tailored, originalBytes, "out.docx");
  assert.equal(fallback.method, "regenerated");
  assert.equal(fallback.fallbackReason, result.reason);
  assert.ok(fallback.blob.size > 0);
  const reopened = await parseDocx(await fallback.blob.arrayBuffer(), "out.docx");
  assert.ok(reopened.sections.some((s) => s.name === "Experience"));
});

test("tryGenerateInPlaceDocx cleanly fails when a changed bullet lives inside a content-control (w:sdt) wrapper", async () => {
  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Experience",
      bullets: [{ text: "Bullet inside a content control.", section: "Experience", order: 1, isListItem: true }],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const tailored = {
    backendName: "ollama",
    bullets: [{
      original: resume.sections[0].bullets[0],
      newText: "Rewritten text that should never be written into a content control.",
      changed: true,
      highlight: false,
      newOrder: 1,
    }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const bodyXml =
    "<w:p><w:r><w:t>Experience</w:t></w:r></w:p>" +
    "<w:p><w:sdt><w:sdtPr/><w:sdtContent>" +
    "<w:r><w:t>Bullet inside a content control.</w:t></w:r>" +
    "</w:sdtContent></w:sdt></w:p>";
  const originalBytes = await buildMinimalDocxZip(bodyXml);

  const result = await tryGenerateInPlaceDocx(originalBytes, resume, tailored);
  assert.equal(result.blob, null, "text must never be written into a structurally complex (sdt-wrapped) paragraph");
  assert.match(result.reason, /structurally complex/);

  const fallback = await generateOutputDocx(resume, tailored, originalBytes, "out.docx");
  assert.equal(fallback.method, "regenerated");
  assert.ok(fallback.blob.size > 0);
});

test("generateOutputDocx never attempts in-place editing for PDF-sourced resumes, even if bytes are (incorrectly) provided", async () => {
  const resume = { ...baseResume(), sourceFormat: "pdf" };
  const tailored = simpleTailoredResume(resume);
  const someBytes = new TextEncoder().encode("irrelevant").buffer;
  const result = await generateOutputDocx(resume, tailored, someBytes, "out.docx");
  assert.equal(result.method, "regenerated");
  assert.equal(result.fallbackReason, undefined, "PDF sources were never eligible, so there's no fallback reason to report - just the normal path");
});
