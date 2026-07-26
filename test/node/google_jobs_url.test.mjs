import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGoogleJobsUrl } from "../../src/lib/job/google_jobs_url.ts";

test("buildGoogleJobsUrl encodes the query and uses the Jobs vertical parameter", () => {
  const url = buildGoogleJobsUrl("senior backend engineer python & kubernetes jobs");
  assert.ok(url.startsWith("https://www.google.com/search?q="));
  assert.ok(url.includes("&ibp=htl;jobs"));
  assert.ok(url.includes(encodeURIComponent("senior backend engineer python & kubernetes jobs")));
  assert.ok(!url.includes(" "), "spaces must be encoded, not left raw");
});
