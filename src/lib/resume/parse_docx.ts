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
}

// Deliberately not a full HTML parser (no DOMParser dependency, so this runs
// identically under Node tests and the bundled browser build): mammoth's
// default output for resume-shaped documents is a flat sequence of block
// elements with no nesting, so a regex block walker is sufficient.
const BLOCK_RE = /<(h[1-6]|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
const TAG_STRIP_RE = /<[^>]+>/g;

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
    const text = decodeHtmlEntities(match[2]!.replace(TAG_STRIP_RE, "")).trim();
    if (text) blocks.push({ tag, text });
  }
  return blocks;
}

function blockToLine(block: HtmlBlock): NormalizedLine {
  if (block.tag === "li") return { text: block.text, kind: "list_item" };
  if (/^h[1-6]$/.test(block.tag)) return { text: block.text, kind: "heading" };
  return { text: block.text, kind: "plain" };
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
