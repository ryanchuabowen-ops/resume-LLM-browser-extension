import assert from "node:assert/strict";
import { test } from "node:test";
import { extractKeywords, scoreTextAgainstKeywords } from "../../src/lib/resume/keyword_extract.ts";

test("extractKeywords filters stopwords and short tokens, ranks by frequency", () => {
  const description = "We are hiring a Senior Backend Engineer. Backend Backend Kubernetes Python.";
  const keywords = extractKeywords(description);
  assert.ok(keywords.includes("backend"));
  assert.ok(keywords.includes("kubernetes"));
  assert.ok(keywords.includes("python"));
  assert.equal(keywords[0], "backend", "most frequent keyword should rank first");
  assert.ok(!keywords.includes("we"), "stopword must be filtered");
  assert.ok(!keywords.includes("a"), "short token must be filtered");
});

test("extractKeywords returns empty array for empty text", () => {
  assert.deepEqual(extractKeywords(""), []);
});

test("scoreTextAgainstKeywords counts case-insensitive substring matches", () => {
  const score = scoreTextAgainstKeywords("Led migration to Kubernetes using Go and gRPC.", [
    "kubernetes", "grpc", "payments",
  ]);
  assert.equal(score, 2);
});

test("scoreTextAgainstKeywords returns 0 for empty inputs", () => {
  assert.equal(scoreTextAgainstKeywords("", ["x"]), 0);
  assert.equal(scoreTextAgainstKeywords("text", []), 0);
});
