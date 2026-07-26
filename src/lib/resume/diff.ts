// Word-level diff between original and tailored bullet text, for the side
// panel's review screen. Port of job-agent/resume/diff.py, using the `diff`
// npm package instead of Python's difflib.
import { diffWords } from "diff";
import type { TailoredBullet } from "./rewriter_base.ts";

export interface DiffSpan {
  text: string;
  kind: "equal" | "insert" | "delete";
}

export interface BulletDiff {
  section: string;
  originalOrder: number;
  newOrder: number;
  reordered: boolean;
  reworded: boolean;
  highlight: boolean;
  spans: DiffSpan[];
}

function wordDiff(original: string, next: string): DiffSpan[] {
  return diffWords(original, next).map((part) => ({
    text: part.value,
    kind: part.added ? "insert" : part.removed ? "delete" : "equal",
  }));
}

export function diffBullet(tb: TailoredBullet): BulletDiff {
  const reworded = tb.changed && tb.newText.trim() !== tb.original.text.trim();
  const reordered = tb.newOrder !== tb.original.order - 1; // Bullet.order is 1-indexed
  return {
    section: tb.original.section,
    originalOrder: tb.original.order,
    newOrder: tb.newOrder,
    reordered,
    reworded,
    highlight: tb.highlight,
    spans: reworded ? wordDiff(tb.original.text, tb.newText) : [{ text: tb.newText, kind: "equal" }],
  };
}

export function diffTailoredResume(bullets: TailoredBullet[]): BulletDiff[] {
  return bullets.map(diffBullet);
}
