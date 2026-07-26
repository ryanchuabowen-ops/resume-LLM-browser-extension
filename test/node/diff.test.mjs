import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBullet } from "../../src/lib/resume/diff.ts";

function tailoredBullet({ text, order = 1, newText = text, changed = false, highlight = false, newOrder = 0 }) {
  return {
    original: { text, section: "Experience", order, isListItem: true },
    newText,
    changed,
    highlight,
    newOrder,
  };
}

test("diffBullet reports no reword/reorder when nothing changed", () => {
  const tb = tailoredBullet({ text: "Led migration to Kubernetes.", order: 1, newOrder: 0 });
  const d = diffBullet(tb);
  assert.equal(d.reworded, false);
  assert.equal(d.reordered, false);
  assert.equal(d.spans.length, 1);
  assert.equal(d.spans[0].kind, "equal");
});

test("diffBullet reports reordered when newOrder differs from original position", () => {
  const tb = tailoredBullet({ text: "Led migration to Kubernetes.", order: 3, newOrder: 0 });
  const d = diffBullet(tb);
  assert.equal(d.reordered, true);
});

test("diffBullet produces insert/delete spans for reworded text", () => {
  const tb = tailoredBullet({
    text: "Worked on Kubernetes migration.",
    newText: "Led Kubernetes migration for the payments team.",
    changed: true,
  });
  const d = diffBullet(tb);
  assert.equal(d.reworded, true);
  assert.ok(d.spans.some((s) => s.kind === "insert"));
  assert.ok(d.spans.some((s) => s.kind === "delete") || d.spans.some((s) => s.kind === "equal"));
});

test("diffBullet does not report reworded when changed=false even if text differs incidentally", () => {
  // changed flag is the source of truth (rule-based backend never sets it),
  // guards against accidentally treating a rule-based bullet as reworded.
  const tb = tailoredBullet({ text: "Same text", newText: "Same text", changed: false });
  const d = diffBullet(tb);
  assert.equal(d.reworded, false);
});
