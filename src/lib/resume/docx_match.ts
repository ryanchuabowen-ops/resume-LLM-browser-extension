// Correlates TailoredBullet/summary text back to specific <w:p> elements in
// the original document.xml, without ever guessing. Order-anchored: bullets
// are matched in true document order (Bullet.order is a single monotonic
// counter across the whole document - see build_document.ts) against XML
// paragraphs walked in document order, with a forward-only pointer. This
// structurally prevents two sections that happen to share identical bullet
// text from ever being matched to each other's paragraphs, without needing
// to replicate mammoth's heading/list-item classification at the XML layer.
import type { Bullet } from "./models.ts";
import type { XmlParagraph } from "./docx_paragraphs.ts";

export type MatchResult =
  | { ok: true; matches: Map<Bullet, Element> }
  | { ok: false; reason: string };

export type SummaryMatchResult =
  | { ok: true; element: Element }
  | { ok: false; reason: string };

function normalizeForFuzzyMatch(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Matches the summary as its own independent pass, before bullets, so a
// changed summary never collides with bullet matching. `alreadyConsumed`
// lets the orchestrator feed this result into matchBulletsToParagraphs so
// the same paragraph is never claimed twice.
export function matchSummaryParagraph(
  paragraphs: XmlParagraph[],
  originalSummary: string,
): SummaryMatchResult {
  const target = originalSummary.trim();
  if (!target) return { ok: false, reason: "Original summary is empty" };

  const exact = paragraphs.filter((p) => p.text.trim() === target);
  if (exact.length === 1) return { ok: true, element: exact[0]!.element };
  if (exact.length > 1) {
    return { ok: false, reason: `Summary text matches ${exact.length} paragraphs (ambiguous)` };
  }

  const normalizedTarget = normalizeForFuzzyMatch(target);
  const normalized = paragraphs.filter((p) => normalizeForFuzzyMatch(p.text) === normalizedTarget);
  if (normalized.length === 1) return { ok: true, element: normalized[0]!.element };

  // Zero or ambiguous (including the common case of a multi-paragraph
  // summary, which by construction can never equal any single paragraph's
  // text) - abort rather than guess or leave stale text in place.
  return { ok: false, reason: "Summary text does not correspond to exactly one paragraph in the original document" };
}

export function matchBulletsToParagraphs(
  paragraphs: XmlParagraph[],
  orderedBullets: Bullet[],
  alreadyConsumed: Set<Element> = new Set(),
): MatchResult {
  const sorted = [...orderedBullets].sort((a, b) => a.order - b.order);
  const consumedIndices = new Set<number>();
  const matches = new Map<Bullet, Element>();

  let pointer = 0;
  for (const bullet of sorted) {
    const target = bullet.text.trim();

    let foundIndex = findFirstUnconsumed(paragraphs, pointer, consumedIndices, alreadyConsumed, (p) => p.text.trim() === target);

    if (foundIndex === -1) {
      const normalizedTarget = normalizeForFuzzyMatch(target);
      const candidates = collectUnconsumed(paragraphs, pointer, consumedIndices, alreadyConsumed, (p) => normalizeForFuzzyMatch(p.text) === normalizedTarget);
      if (candidates.length === 1) {
        foundIndex = candidates[0]!;
      } else {
        return {
          ok: false,
          reason: candidates.length === 0
            ? `No matching paragraph found for bullet: "${truncate(target)}"`
            : `Ambiguous match (${candidates.length} candidates) for bullet: "${truncate(target)}"`,
        };
      }
    }

    consumedIndices.add(foundIndex);
    matches.set(bullet, paragraphs[foundIndex]!.element);
    pointer = foundIndex + 1;
  }

  return { ok: true, matches };
}

function truncate(s: string): string {
  return s.length > 60 ? `${s.slice(0, 60)}...` : s;
}

function findFirstUnconsumed(
  paragraphs: XmlParagraph[],
  fromIndex: number,
  consumedIndices: Set<number>,
  alreadyConsumed: Set<Element>,
  predicate: (p: XmlParagraph) => boolean,
): number {
  for (let i = fromIndex; i < paragraphs.length; i++) {
    if (consumedIndices.has(i) || alreadyConsumed.has(paragraphs[i]!.element)) continue;
    if (predicate(paragraphs[i]!)) return i;
  }
  return -1;
}

function collectUnconsumed(
  paragraphs: XmlParagraph[],
  fromIndex: number,
  consumedIndices: Set<number>,
  alreadyConsumed: Set<Element>,
  predicate: (p: XmlParagraph) => boolean,
): number[] {
  const result: number[] = [];
  for (let i = fromIndex; i < paragraphs.length; i++) {
    if (consumedIndices.has(i) || alreadyConsumed.has(paragraphs[i]!.element)) continue;
    if (predicate(paragraphs[i]!)) result.push(i);
  }
  return result;
}
