// Raw OOXML zip/XML plumbing for in-place .docx editing. Deliberately the
// only module that touches JSZip/DOMParser/XMLSerializer directly - callers
// (docx_paragraphs.ts, docx_inplace.ts) work against the parsed Document,
// never the zip or raw text.
//
// DOMParser/XMLSerializer are referenced only inside function bodies here,
// never at module scope. In the real extension (side panel) these are
// native browser globals. Under `node --test`, they don't exist natively -
// test files polyfill them onto `globalThis` from `@xmldom/xmldom` (a
// devDependency, imported only from test files, never from anything under
// src/) before calling into this module. Because nothing here touches them
// at module-evaluation time, the same code works unmodified in both
// environments with no environment-detection branching.
import JSZip from "jszip";

const DOCUMENT_XML_PATH = "word/document.xml";
const XML_DECLARATION_RE = /^\s*<\?xml[^?]*\?>/;
const DEFAULT_XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface LoadedDocxXml {
  zip: JSZip;
  doc: Document;
  xmlDeclaration: string;
}

export async function loadDocxXml(bytes: ArrayBuffer): Promise<LoadedDocxXml> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new Error(`Not a valid .docx (zip) file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const entry = zip.file(DOCUMENT_XML_PATH);
  if (!entry) {
    throw new Error(`Missing ${DOCUMENT_XML_PATH} inside the .docx`);
  }
  const xmlText = await entry.async("text");
  const declMatch = xmlText.match(XML_DECLARATION_RE);
  const xmlDeclaration = declMatch ? declMatch[0] : DEFAULT_XML_DECLARATION;

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (hasParseError(doc)) {
    throw new Error("Malformed XML in word/document.xml");
  }

  return { zip, doc, xmlDeclaration };
}

// Native browser DOMParser never throws on malformed input - it returns a
// Document containing a <parsererror> element instead. @xmldom/xmldom (the
// Node test-only polyfill) can throw directly for the same bad input; that
// path is handled by loadDocxXml's caller via a normal try/catch since
// nothing here swallows exceptions. This function only covers the
// non-throwing browser failure shape, so both environments' failure modes
// are actually caught.
function hasParseError(doc: Document): boolean {
  return doc.getElementsByTagName("parsererror").length > 0;
}

export function serializeDocxXml(doc: Document, xmlDeclaration: string): string {
  const body = new XMLSerializer().serializeToString(doc);
  return `${xmlDeclaration}${body}`;
}

export async function rezipDocx(zip: JSZip, newDocumentXml: string): Promise<Blob> {
  zip.file(DOCUMENT_XML_PATH, newDocumentXml);
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
