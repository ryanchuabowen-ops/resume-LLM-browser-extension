// Zip/XML plumbing round-trip. Polyfills DOMParser/XMLSerializer from
// @xmldom/xmldom onto globalThis (Node has no native XML DOM) - docx_xml.ts
// only references them inside function bodies, never at module scope, so
// this works even though the polyfill assignment runs after ESM import
// evaluation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { loadDocxXml, rezipDocx, serializeDocxXml } from "../../src/lib/resume/docx_xml.ts";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";

async function buildFixtureDocxBytes() {
  const doc = new DocxDocument({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "Jane Doe", bold: true })] }),
        new Paragraph({ children: [new TextRun("jane.doe@example.com")] }),
        new Paragraph({ children: [new TextRun({ text: "Experience", bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: "Senior Engineer, Acme Corp", bold: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun("Led migration to Kubernetes.")] }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  return blob.arrayBuffer();
}

test("loadDocxXml -> serializeDocxXml -> rezipDocx round trip with zero mutation reparses identically", async () => {
  const originalBytes = await buildFixtureDocxBytes();
  const original = await parseDocx(originalBytes, "fixture.docx");

  const { zip, doc, xmlDeclaration } = await loadDocxXml(originalBytes);
  const newXml = serializeDocxXml(doc, xmlDeclaration);
  assert.ok(newXml.startsWith("<?xml"), "serialized XML must keep the declaration XMLSerializer itself drops");

  const rezippedBlob = await rezipDocx(zip, newXml);
  assert.ok(rezippedBlob.size > 0);

  const reopened = await parseDocx(await rezippedBlob.arrayBuffer(), "fixture.docx");
  assert.deepEqual(reopened, original, "a no-op parse/serialize/rezip cycle must not change the extracted content");
});

test("loadDocxXml rejects a file that isn't a zip at all", async () => {
  const notAZip = new TextEncoder().encode("this is definitely not a docx").buffer;
  await assert.rejects(() => loadDocxXml(notAZip), /Not a valid \.docx/);
});

test("loadDocxXml rejects a zip missing word/document.xml", async () => {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("hello.txt", "not a resume");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  await assert.rejects(() => loadDocxXml(bytes), /Missing word\/document\.xml/);
});

test("loadDocxXml rejects malformed XML inside word/document.xml (xmldom-throw shape)", async () => {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body><w:p>unclosed");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  await assert.rejects(() => loadDocxXml(bytes));
});

test("loadDocxXml rejects a well-formed document containing a <parsererror> element (native-DOMParser failure shape)", async () => {
  // Native browser DOMParser never throws on bad input - it returns a
  // Document whose content includes a <parsererror> element instead of
  // throwing (xmldom, used everywhere else in this file, throws for actual
  // malformed input, so this is the one case that can't be reproduced by
  // just feeding xmldom bad XML - it has to be simulated directly to prove
  // hasParseError's detection branch, not just the try/catch branch).
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body><parsererror>simulated browser parse failure</parsererror></w:body></w:document>",
  );
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  await assert.rejects(() => loadDocxXml(bytes), /Malformed XML/);
});
