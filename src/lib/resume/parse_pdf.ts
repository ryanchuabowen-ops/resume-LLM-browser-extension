// Parses a .pdf file into a ResumeDocument using pdfjs-dist.
//
// PDFs give text only, no structural signal for lists (unlike DOCX's real
// numbering data) - same limitation the old Python pdfplumber path had, so
// this keeps the same bullet-glyph regex heuristic for list-item detection.
import { buildResumeDocument, type NormalizedLine } from "./build_document.ts";
import type { ResumeDocument } from "./models.ts";

// Matches Python's _BULLET_PREFIX_RE: a leading bullet glyph, stripped from
// the line text before classification/storage.
const BULLET_PREFIX_RE = /^\s*[•‣▪●○◦\-*]\s+/;

export interface ParsePdfOptions {
  /** Required in the browser: chrome.runtime.getURL("pdf.worker.min.mjs").
   * Confirmed by live testing that pdfjs's browser build throws
   * ("No GlobalWorkerOptions.workerSrc specified") rather than falling back
   * when this is missing - unlike its Node build, which silently falls back
   * to main-thread parsing without one. Leave undefined only in Node tests. */
  workerSrc?: string;
}

export async function parsePdf(
  data: Uint8Array,
  fileName: string,
  options: ParsePdfOptions = {},
): Promise<ResumeDocument> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (options.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc;
  }

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const lines: NormalizedLine[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let currentLine = "";
    for (const item of content.items) {
      if (!("str" in item)) continue; // skip TextMarkedContent entries
      currentLine += item.str;
      if (item.hasEOL) {
        lines.push(classifyLine(currentLine));
        currentLine = "";
      }
    }
    if (currentLine.trim()) lines.push(classifyLine(currentLine));
  }

  if (lines.length === 0) {
    throw new Error("Could not extract any readable text from this PDF file");
  }
  return buildResumeDocument(lines, "pdf", fileName);
}

function classifyLine(raw: string): NormalizedLine {
  const isListItem = BULLET_PREFIX_RE.test(raw);
  const text = raw.replace(BULLET_PREFIX_RE, "");
  return { text, kind: isListItem ? "list_item" : "plain" };
}
