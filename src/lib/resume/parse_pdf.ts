// Parses a .pdf file into a ResumeDocument using pdfjs-dist.
//
// PDFs give text only, no structural signal for lists (unlike DOCX's real
// numbering data) - same limitation the old Python pdfplumber path had, so
// this keeps a bullet-glyph regex heuristic for list-item detection, plus
// (see mergeWrappedLines below) an indentation-based heuristic to
// reassemble bullets that wrap across multiple visual lines - PDFs have no
// paragraph boundaries, so without this every wrapped bullet gets shredded
// into several disconnected fragments, one per physical line.
import { buildResumeDocument, type NormalizedLine } from "./build_document.ts";
import type { ResumeDocument } from "./models.ts";

// Matches Python's _BULLET_PREFIX_RE (a small set of standard Unicode
// bullet glyphs) PLUS the Private Use Area (U+E000-U+F8FF) - real,
// user-reported PDFs commonly use a Wingdings/Symbol-font bullet character
// mapped into the PUA (U+F0B7 confirmed directly via pdfjs against a real
// resume) rather than a normal Unicode bullet, and standard-bullets-only
// detection silently failed to recognize a single bullet in that document.
const BULLET_PREFIX_RE = /^\s*[•‣▪●○◦\-*-]\s+/;

// A line starting with a short capitalized label followed by a colon (e.g.
// "Python language:", "MySQL and SQLite Database:", "Certificates:") is a
// strong, deliberate resume-formatting convention marking the start of a
// new entry - confirmed directly against a real resume's "Technical
// Skills" section, where this pattern correctly identified every single
// new entry and never matched any of the continuation fragments between
// them. This is a far more reliable signal than an LLM's judgment for
// exactly this kind of transition (see pdf_line_reconstruct.ts's header
// comment for why) and a far more reliable signal than guessing from
// length/shape, since a deliberate "Label:" prefix is a positive,
// intentional marker - not a coincidence of where a line happened to wrap.
const LABELED_ENTRY_RE = /^[A-Z][A-Za-z0-9,.()/ ]{1,55}:/;

export function looksLikeLabeledEntry(text: string): boolean {
  return LABELED_ENTRY_RE.test(text.trim());
}

export interface ParsePdfOptions {
  /** Required in the browser: chrome.runtime.getURL("pdf.worker.min.mjs").
   * Confirmed by live testing that pdfjs's browser build throws
   * ("No GlobalWorkerOptions.workerSrc specified") rather than falling back
   * when this is missing - unlike its Node build, which silently falls back
   * to main-thread parsing without one. Leave undefined only in Node tests. */
  workerSrc?: string;
  /** Optional LLM-backed override for merging wrapped lines, in place of
   * the plain indentation heuristic (mergeWrappedLines) - see
   * pdf_line_reconstruct.ts, which composes this from an Ollama call. This
   * function itself must never throw or block parsing (the real
   * implementation already falls back to mergeWrappedLines internally on
   * any failure); this parameter exists purely so parse_pdf.ts stays free
   * of any chrome/network dependency. */
  reconstructLines?: (rows: Row[]) => Promise<string[]>;
}

export interface Row {
  text: string;
  x: number;
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

    const rows: Row[] = [];
    let currentText = "";
    let currentX: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue; // skip TextMarkedContent entries
      if (currentX === null && item.str.trim()) currentX = item.transform[4];
      currentText += item.str;
      if (item.hasEOL) {
        if (currentText.trim()) rows.push({ text: currentText, x: currentX ?? 0 });
        currentText = "";
        currentX = null;
      }
    }
    if (currentText.trim()) rows.push({ text: currentText, x: currentX ?? 0 });

    // Merge continuation lines PER PAGE, not across a page boundary - each
    // page can have its own margins, and a fresh page is virtually always
    // the start of new content, never a mid-bullet continuation.
    const mergedForPage = options.reconstructLines ? await options.reconstructLines(rows) : mergeWrappedLines(rows);
    for (const text of mergedForPage) {
      lines.push(classifyLine(text));
    }
  }

  if (lines.length === 0) {
    throw new Error("Could not extract any readable text from this PDF file");
  }
  return buildResumeDocument(lines, "pdf", fileName);
}

// A bullet or anchor line that's too long to fit on one physical line wraps
// onto the next, which PDF represents as a totally separate row with no
// indication it's a continuation - unlike DOCX, where mammoth already gives
// each list item as one paragraph regardless of how many visual lines it
// wraps to. The reliable, common-convention signal recovering this: wrapped
// continuation text is hanging-indented further right than the line that
// started the current bullet/anchor, while a genuinely new bullet/anchor
// resets back to the left margin. Comparing each row's indent against the
// x of the most recent NON-continuation row (not just the immediately
// preceding row) is what correctly merges a bullet wrapping across 3+
// lines, since every one of those continuation lines shares the same
// indent rather than increasing line over line - confirmed directly
// against a real resume PDF before relying on this.
const CONTINUATION_INDENT_TOLERANCE = 5; // points of slack for float jitter in the extracted coordinates

export function mergeWrappedLines(rows: Row[]): string[] {
  const merged: string[] = [];
  let lastLineStartX: number | null = null;

  for (const row of rows) {
    const isContinuation = lastLineStartX !== null
      && row.x > lastLineStartX + CONTINUATION_INDENT_TOLERANCE
      && !looksLikeLabeledEntry(row.text);
    if (isContinuation && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]!.trimEnd()} ${row.text.trim()}`;
    } else {
      merged.push(row.text);
      lastLineStartX = row.x;
    }
  }
  return merged;
}

export function classifyLine(raw: string): NormalizedLine {
  const isListItem = BULLET_PREFIX_RE.test(raw);
  const text = raw.replace(BULLET_PREFIX_RE, "").trim();
  return { text, kind: isListItem ? "list_item" : "plain" };
}
