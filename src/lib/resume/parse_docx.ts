// Parses a .docx file into a ResumeDocument using mammoth.
//
// mammoth converts Word's real numbering/list formatting into <ul><li>
// elements, which is used directly as the isListItem signal - more reliable
// than the old Python version's bullet-glyph regex, since it reads the
// document's actual list semantics rather than guessing from characters.
/// <reference types="node" />
import mammoth from "mammoth";
import { buildResumeDocument, type NormalizedLine } from "./build_document.ts";
import type { ResumeDocument } from "./models.ts";

interface HtmlBlock {
  tag: string; // "h1".."h6" | "p" | "li"
  text: string;
  // True only if mammoth wrapped this block's ENTIRE text in a single
  // <strong> - i.e. the original Word paragraph was bolded top to bottom,
  // not just a word or two inside it. Used by docx_writer.ts as the real
  // ground-truth signal for "should this line be styled like a title/
  // anchor" - see isFullyBold below and Bullet.isEmphasized in models.ts.
  emphasized: boolean;
}

// Deliberately not a full HTML parser (no DOMParser dependency, so this runs
// identically under Node tests and the bundled browser build): mammoth's
// default output for resume-shaped documents is a flat sequence of block
// elements with no nesting, so a regex block walker is sufficient.
const BLOCK_RE = /<(h[1-6]|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
const TAG_STRIP_RE = /<[^>]+>/g;
const STRONG_RE = /<strong>([\s\S]*?)<\/strong>/g;

// True only when the concatenation of text found INSIDE <strong> tags
// equals the block's full stripped text - i.e. every bit of visible text
// is bold, not just part of it. A block with mixed bold/non-bold runs
// (e.g. "Mixed: <strong>bold part</strong> plain part") must NOT count,
// since that's not the "this whole line is a bold anchor/title" case this
// exists to detect - confirmed against mammoth's real output for all
// three shapes (fully bold, not bold, mixed) before relying on this.
function isFullyBold(innerHtml: string): boolean {
  const fullText = innerHtml.replace(TAG_STRIP_RE, "").trim();
  if (!fullText) return false;
  let boldText = "";
  STRONG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRONG_RE.exec(innerHtml)) !== null) {
    boldText += match[1]!.replace(TAG_STRIP_RE, "");
  }
  return boldText.trim() === fullText;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlToBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase();
    const innerHtml = match[2]!;
    const text = decodeHtmlEntities(innerHtml.replace(TAG_STRIP_RE, "")).trim();
    if (text) blocks.push({ tag, text, emphasized: isFullyBold(innerHtml) });
  }
  return blocks;
}

function blockToLine(block: HtmlBlock): NormalizedLine {
  if (block.tag === "li") return { text: block.text, kind: "list_item", emphasized: block.emphasized };
  if (/^h[1-6]$/.test(block.tag)) return { text: block.text, kind: "heading", emphasized: block.emphasized };
  return { text: block.text, kind: "plain", emphasized: block.emphasized };
}

export async function parseDocx(arrayBuffer: ArrayBuffer, fileName: string): Promise<ResumeDocument> {
  // mammoth's browser build (used in the real bundled extension, via its
  // package.json "browser" field swap) reads options.arrayBuffer; its Node
  // build (used by `node --test`) reads options.buffer instead and ignores
  // arrayBuffer entirely. Passing both lets the same call work correctly
  // under both, without environment-detection branching in this function's
  // logic - but `Buffer` itself is a Node global that doesn't exist in the
  // browser, so it's only referenced when actually present.
  const nodeBuffer = typeof Buffer !== "undefined" ? Buffer.from(arrayBuffer) : undefined;
  const options = { arrayBuffer, buffer: nodeBuffer } as unknown as { arrayBuffer: ArrayBuffer };
  const result = await mammoth.convertToHtml(options);
  const blocks = htmlToBlocks(result.value);
  if (blocks.length === 0) {
    throw new Error("Could not extract any readable text from this DOCX file");
  }
  const lines = blocks.map(blockToLine);
  return buildResumeDocument(lines, "docx", fileName);
}
