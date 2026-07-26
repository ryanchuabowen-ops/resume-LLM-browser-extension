// Ports the exact regression cases verified against the Python guard,
// including the real Mistral-Nemo fabrication caught in live testing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { introducesNewNumbers } from "../../src/lib/resume/numeric_guard.ts";

test("flags a fabricated percentage not present in the original (real Mistral-Nemo case)", () => {
  const original = "Helped junior engineers learn AWS and PostgreSQL.";
  const rewritten = "Streamlined AWS and PostgreSQL integration by mentoring junior engineers, " +
    "resulting in a 25% efficiency increase.";
  assert.equal(introducesNewNumbers(original, rewritten), true);
});

test("allows a rewrite with no new numbers", () => {
  const original = "Led migration of payments service to Kubernetes.";
  const rewritten = "Spearheaded backend development for Kubernetes-based payments platform.";
  assert.equal(introducesNewNumbers(original, rewritten), false);
});

test("allows reusing an existing number", () => {
  const original = "Cut latency by 40% across 3 services.";
  const rewritten = "Reduced latency by 40% across 3 services through caching.";
  assert.equal(introducesNewNumbers(original, rewritten), false);
});

test("flags a changed number even if one was already present", () => {
  const original = "Cut latency by 40%.";
  const rewritten = "Reduced latency by 50%.";
  assert.equal(introducesNewNumbers(original, rewritten), true);
});
