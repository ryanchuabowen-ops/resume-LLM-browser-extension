// Ports job-agent/tests/smoke_rule_rewrite.py's core regression cases:
// bullets must reorder by keyword relevance within a job's own bullets, but
// must NEVER cross a "Job Title, Company" anchor line into a different
// employer's bullets - a real bug the Python version hit and fixed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentListRuns, tailorRuleBased } from "../../src/lib/resume/rewriter_rule_based.ts";

const JOB = {
  title: "Senior Backend Engineer",
  company: "TestCo",
  description: "We need a Senior Backend Engineer to scale our Kubernetes-based payments " +
    "platform. You'll work with Python, Go, and gRPC, and mentor junior engineers. " +
    "Experience with AWS and PostgreSQL is a strong plus.",
};

function bullet(text, section, order, isListItem) {
  return { text, section, order, isListItem };
}

function buildTwoEmployerResume() {
  const bullets = [
    bullet("Senior Software Engineer, Acme Corp (2021-Present)", "Experience", 1, false),
    bullet("Organized the team holiday party for 3 years running.", "Experience", 2, true),
    bullet("Wrote internal documentation for onboarding.", "Experience", 3, true),
    bullet("Software Engineer, Beta Inc (2018-2021)", "Experience", 4, false),
    bullet("Led migration of payments service to Kubernetes using Go and gRPC.", "Experience", 5, true),
    bullet("Mentored 3 junior engineers on AWS and PostgreSQL best practices.", "Experience", 6, true),
  ];
  return {
    contactBlock: "Jane Doe\njane.doe@example.com",
    summary: "Backend engineer with 6 years building distributed systems.",
    sections: [{ name: "Experience", bullets }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("segmentListRuns splits on anchor lines", () => {
  const resume = buildTwoEmployerResume();
  const runs = segmentListRuns(resume.sections[0].bullets);
  assert.equal(runs.length, 4, "anchor, run, anchor, run");
  assert.equal(runs[0].length, 1);
  assert.equal(runs[0][0].isListItem, false);
  assert.equal(runs[1].length, 2);
  assert.equal(runs[2].length, 1);
  assert.equal(runs[3].length, 2);
});

test("tailorRuleBased reorders within a job's bullets but never crosses employers", () => {
  const resume = buildTwoEmployerResume();
  const tailored = tailorRuleBased(resume, JOB);

  assert.equal(tailored.backendName, "rule_based");
  assert.ok(!tailored.bullets.some((tb) => tb.changed), "rule-based must never claim to reword text");

  const byText = new Map(tailored.bullets.map((tb) => [tb.original.text, tb]));
  const acmeHeader = byText.get("Senior Software Engineer, Acme Corp (2021-Present)");
  const betaHeader = byText.get("Software Engineer, Beta Inc (2018-2021)");
  const party = byText.get("Organized the team holiday party for 3 years running.");
  const docs = byText.get("Wrote internal documentation for onboarding.");
  const led = byText.get("Led migration of payments service to Kubernetes using Go and gRPC.");
  const mentored = byText.get("Mentored 3 junior engineers on AWS and PostgreSQL best practices.");

  // Job-title header lines must never be reordered or highlighted.
  assert.equal(acmeHeader.highlight, false);
  assert.equal(betaHeader.highlight, false);

  // Acme's bullets must stay before the Beta header; Beta's must stay after it.
  assert.ok(party.newOrder < betaHeader.newOrder, "Acme bullet leaked past the Beta header");
  assert.ok(docs.newOrder < betaHeader.newOrder, "Acme bullet leaked past the Beta header");
  assert.ok(led.newOrder > betaHeader.newOrder, "Beta bullet leaked before its own header");
  assert.ok(mentored.newOrder > betaHeader.newOrder, "Beta bullet leaked before its own header");

  // Within Beta's own bullets, the more keyword-relevant one ranks first.
  assert.ok(mentored.newOrder < led.newOrder, "more relevant bullet should rank first within its own job");
  assert.equal(mentored.highlight, true);
  assert.equal(led.highlight, true);
  assert.equal(party.highlight, false, "irrelevant bullet should not be highlighted");
  assert.equal(docs.highlight, false);
});

test("tailorRuleBased with no keywords leaves order unchanged and warns", () => {
  const resume = buildTwoEmployerResume();
  const tailored = tailorRuleBased(resume, { title: "X", company: "Y", description: "" });
  assert.ok(tailored.warnings.length > 0);
  const experience = tailored.bullets.filter((tb) => tb.original.section === "Experience");
  for (const tb of experience) {
    assert.equal(tb.newOrder, tb.original.order - 1, "no keywords means original order preserved");
  }
});
