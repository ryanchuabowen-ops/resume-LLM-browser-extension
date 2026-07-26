// Defense-in-depth for the hard product-safety constraint in filler_dom.ts:
// no code path may ever click a submit-like control or call form.submit()/
// requestSubmit(). The real guarantee is that this code is simply never
// written (see the comment at the top of filler_dom.ts) - this test is a
// static safety net that would catch an accidental future regression in
// the *built* bundle, which is what actually ships and runs on real pages.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

test("dist/content.js contains no .click(, .submit(, or requestSubmit calls", async () => {
  const bundlePath = path.join(root, "dist/content.js");
  let code;
  try {
    code = await readFile(bundlePath, "utf-8");
  } catch {
    assert.fail(`dist/content.js not found at ${bundlePath} - run "npm run build" before this test`);
    return;
  }

  const forbidden = [".click(", ".submit(", "requestSubmit"];
  const found = forbidden.filter((pattern) => code.includes(pattern));
  assert.deepEqual(found, [], `content.js must never call ${found.join(", ")} - this is the hard no-submit guarantee`);
});
