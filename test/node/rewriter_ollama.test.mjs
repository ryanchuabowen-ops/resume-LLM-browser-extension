import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOllamaResponse, tailorWithOllama } from "../../src/lib/resume/rewriter_ollama.ts";

const JOB = {
  title: "Senior Backend Engineer",
  company: "TestCo",
  description: "We need a Senior Backend Engineer with Kubernetes, AWS, and PostgreSQL experience.",
};

// tailorRuleBased (called internally by tailorWithOllama to build the base
// result) reorders bullets by keyword relevance before candidates are
// numbered for the prompt - so a candidate's index is NOT its original
// resume position. This builds a stub `generate` that parses the actual
// "N: <original text>" lines out of the real prompt and maps rewrites by
// matching a substring of the ORIGINAL text, so tests stay correct
// regardless of internal reordering.
function mockGenerateFromPrompt(rewritesByOriginalSubstring, summary) {
  return async (prompt) => {
    const bullets = {};
    for (const line of prompt.split("\n")) {
      const match = /^(\d+): (.+)$/.exec(line);
      if (!match) continue;
      const [, index, originalText] = match;
      for (const [substring, rewrite] of Object.entries(rewritesByOriginalSubstring)) {
        if (originalText.includes(substring)) bullets[index] = rewrite;
      }
    }
    return JSON.stringify({ bullets, ...(summary ? { summary } : {}) });
  };
}

function buildResume() {
  return {
    contactBlock: "Jane Doe",
    summary: "Backend engineer with 6 years of experience.",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Senior Software Engineer, Acme Corp (2021-Present)", section: "Experience", order: 1, isListItem: false },
        { text: "Worked on the payments team using Kubernetes and Go.", section: "Experience", order: 2, isListItem: true },
        { text: "Helped junior engineers learn AWS and PostgreSQL.", section: "Experience", order: 3, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("parseOllamaResponse extracts bullets map and summary", () => {
  const raw = JSON.stringify({ bullets: { "0": "Rewritten one", "1": "Rewritten two" }, summary: "New summary" });
  const parsed = parseOllamaResponse(raw);
  assert.equal(parsed.bullets.get(0), "Rewritten one");
  assert.equal(parsed.bullets.get(1), "Rewritten two");
  assert.equal(parsed.summary, "New summary");
});

test("parseOllamaResponse throws on invalid JSON", () => {
  assert.throws(() => parseOllamaResponse("not json"));
});

test("parseOllamaResponse throws when 'bullets' is missing", () => {
  assert.throws(() => parseOllamaResponse(JSON.stringify({ summary: "x" })));
});

test("tailorWithOllama merges a successful rewrite and marks changed bullets", async () => {
  const resume = buildResume();
  const generate = mockGenerateFromPrompt({
    "Worked on the payments team": "Led backend development for the Kubernetes-based payments platform using Go.",
    "Helped junior engineers": "Mentored junior engineers on AWS and PostgreSQL best practices.",
  }, "Senior backend engineer specializing in Kubernetes and AWS.");

  const tailored = await tailorWithOllama(resume, JOB, generate);

  assert.equal(tailored.backendName, "ollama");
  assert.equal(tailored.summaryChanged, true);
  const rewordedBullets = tailored.bullets.filter((tb) => tb.changed);
  assert.equal(rewordedBullets.length, 2);
  assert.equal(tailored.warnings.length, 0);
});

test("tailorWithOllama rejects and reverts a bullet that invents a number", async () => {
  const resume = buildResume();
  const generate = mockGenerateFromPrompt({
    "Worked on the payments team": "Worked on the payments team using Kubernetes and Go.",
    "Helped junior engineers": "Streamlined AWS/PostgreSQL onboarding, boosting team velocity by 25%.",
  });

  const tailored = await tailorWithOllama(resume, JOB, generate);

  const mentored = tailored.bullets.find((tb) => tb.original.text.startsWith("Helped junior"));
  assert.equal(mentored.changed, false, "fabricated-number bullet must be reverted to original text");
  assert.equal(mentored.newText, "Helped junior engineers learn AWS and PostgreSQL.");
  assert.ok(tailored.warnings.some((w) => w.includes("reverted")), "must warn about the reverted bullet");
});

test("tailorWithOllama falls back to rule-based when generate() throws (Ollama unreachable)", async () => {
  const resume = buildResume();
  const generate = async () => { throw new Error("connection refused"); };

  const tailored = await tailorWithOllama(resume, JOB, generate);

  assert.equal(tailored.backendName, "rule_based");
  assert.ok(!tailored.bullets.some((tb) => tb.changed), "fallback must not claim any bullet was reworded");
  assert.ok(tailored.warnings.some((w) => w.includes("AI rewriting unavailable")));
});

test("tailorWithOllama falls back to rule-based when the response is unparseable", async () => {
  const resume = buildResume();
  const generate = async () => "this is not json";

  const tailored = await tailorWithOllama(resume, JOB, generate);

  assert.equal(tailored.backendName, "rule_based");
  assert.ok(tailored.warnings.some((w) => w.includes("AI rewriting unavailable")));
});

test("tailorWithOllama rejects a fabricated-number summary but keeps accepted bullet rewrites", async () => {
  const resume = buildResume();
  const generate = mockGenerateFromPrompt({
    "Worked on the payments team": "Led backend development for the Kubernetes-based payments platform.",
  }, "Backend engineer who improved throughput by 40%."); // resume.summary has no numbers at all

  const tailored = await tailorWithOllama(resume, JOB, generate);

  assert.equal(tailored.summary, resume.summary, "summary must be reverted");
  assert.equal(tailored.summaryChanged, false);
  assert.ok(tailored.warnings.some((w) => w.includes("summary was reverted")));
  const changedBullet = tailored.bullets.find((tb) => tb.original.text.startsWith("Worked on the payments"));
  assert.equal(changedBullet.changed, true, "the accepted bullet rewrite should still apply independently");
});
