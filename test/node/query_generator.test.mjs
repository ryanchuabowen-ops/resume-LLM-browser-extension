import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateQueriesRuleBased,
  generateQueriesWithOllama,
  mostRecentJobTitle,
  parseQueriesResponse,
} from "../../src/lib/job/query_generator.ts";

function buildResume() {
  return {
    contactBlock: "Jane Doe\njane.doe@example.com",
    summary: "Backend engineer specializing in distributed systems.",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Senior Backend Engineer, Acme Corp (2021-Present)", section: "Experience", order: 1, isListItem: false },
        { text: "Built services with Python, Kubernetes, and AWS.", section: "Experience", order: 2, isListItem: true },
        { text: "Led migration to PostgreSQL and gRPC.", section: "Experience", order: 3, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("mostRecentJobTitle extracts the title before the first comma", () => {
  assert.equal(mostRecentJobTitle(buildResume()), "Senior Backend Engineer");
});

test("mostRecentJobTitle returns null when there are no anchor lines", () => {
  const resume = { ...buildResume(), sections: [{ name: "Skills", bullets: [
    { text: "Python, Kubernetes, AWS", section: "Skills", order: 1, isListItem: true },
  ] }] };
  assert.equal(mostRecentJobTitle(resume), null);
});

test("generateQueriesRuleBased produces distinct, deduped, resume-grounded queries", () => {
  const queries = generateQueriesRuleBased(buildResume(), 4);
  assert.ok(queries.length > 0);
  assert.ok(queries.length <= 4);
  assert.equal(new Set(queries.map((q) => q.toLowerCase())).size, queries.length, "no duplicates");
  assert.ok(queries.some((q) => q.includes("Senior Backend Engineer")));
  assert.ok(queries.some((q) => /python|kubernetes|aws|postgresql|grpc/i.test(q)));
});

test("parseQueriesResponse extracts a string array and drops non-string/empty entries", () => {
  const raw = JSON.stringify({ queries: ["a query", "", "  another query  ", 42, null] });
  const result = parseQueriesResponse(raw);
  assert.deepEqual(result, ["a query", "another query"]);
});

test("parseQueriesResponse throws on invalid JSON or missing 'queries'", () => {
  assert.throws(() => parseQueriesResponse("not json"));
  assert.throws(() => parseQueriesResponse(JSON.stringify({ foo: "bar" })));
});

test("generateQueriesWithOllama returns AI queries grounded in the resume", async () => {
  const resume = buildResume();
  const generate = async () => JSON.stringify({
    queries: [
      "Senior Backend Engineer Python jobs",
      "Kubernetes AWS platform engineer remote jobs",
    ],
  });
  const result = await generateQueriesWithOllama(resume, generate);
  assert.equal(result.queries.length, 2);
  assert.equal(result.warnings.length, 0);
});

test("generateQueriesWithOllama drops a hallucinated query with no overlap with the resume", async () => {
  const resume = buildResume();
  const generate = async () => JSON.stringify({
    queries: [
      "Senior Backend Engineer Python jobs", // real overlap
      "professional deep sea welding jobs",   // fabricated, unrelated to resume
    ],
  });
  const result = await generateQueriesWithOllama(resume, generate);
  assert.equal(result.queries.length, 1);
  assert.equal(result.queries[0], "Senior Backend Engineer Python jobs");
  assert.ok(result.warnings.some((w) => w.includes("dropped")));
});

test("generateQueriesWithOllama falls back to rule-based when generate() throws", async () => {
  const resume = buildResume();
  const generate = async () => { throw new Error("connection refused"); };
  const result = await generateQueriesWithOllama(resume, generate);
  assert.ok(result.queries.length > 0);
  assert.ok(result.warnings.some((w) => w.includes("AI query generation unavailable")));
});

test("generateQueriesWithOllama falls back to rule-based when every suggestion is unrelated", async () => {
  const resume = buildResume();
  const generate = async () => JSON.stringify({ queries: ["deep sea welding jobs", "competitive yodeling jobs"] });
  const result = await generateQueriesWithOllama(resume, generate);
  assert.ok(result.queries.some((q) => q.includes("Senior Backend Engineer")), "should fall back to rule-based");
  assert.ok(result.warnings.some((w) => w.includes("didn't look related")));
});
