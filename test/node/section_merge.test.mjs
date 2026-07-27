import assert from "node:assert/strict";
import { test } from "node:test";
import { findMergeCandidates, mergeSparseSections } from "../../src/lib/resume/section_merge.ts";

function bullet(text, section, order, isListItem = true) {
  return { text, section, order, isListItem };
}

function buildDocument() {
  return {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [
      {
        name: "Skills, Activities & Interests",
        bullets: [bullet("Languages: Fluent in English and Mandarin.", "Skills, Activities & Interests", 1)],
      },
      {
        name: "Technical Skills",
        bullets: [
          bullet("R and Python: full data analysis pipeline.", "Technical Skills", 2),
          bullet("SQL, Tableau, and pandas.", "Technical Skills", 3),
          bullet("Data mining, text mining, sentiment analysis.", "Technical Skills", 4),
        ],
      },
      {
        name: "Education",
        bullets: [bullet("University of London, Singapore", "Education", 5, false)],
      },
    ],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("findMergeCandidates flags a sparse section immediately followed by another section", () => {
  const candidates = findMergeCandidates(buildDocument().sections);
  assert.deepEqual(candidates, [{ sparseIndex: 0, nextIndex: 1 }]);
});

test("findMergeCandidates does not flag a section with zero bullets, or one with many", () => {
  const sections = [
    { name: "Empty Heading", bullets: [] },
    { name: "Technical Skills", bullets: [bullet("a", "Technical Skills", 1), bullet("b", "Technical Skills", 2), bullet("c", "Technical Skills", 3)] },
  ];
  assert.deepEqual(findMergeCandidates(sections), []);
});

test("mergeSparseSections unconditionally merges a sparse section into the next, preserving the sub-heading as a bold anchor line", () => {
  // Deterministic, no LLM: the user explicitly chose this simpler,
  // always-available version over an earlier LLM-judged one, accepting
  // that it can't distinguish "related" from "coincidentally both short"
  // the way the LLM version could.
  const document = buildDocument();

  const merged = mergeSparseSections(document);
  assert.equal(merged.sections.length, 2, "the sparse section and the one after it must collapse into one");

  const section = merged.sections[0];
  assert.equal(section.name, "Skills, Activities & Interests");
  assert.equal(section.bullets.length, 5, "1 original bullet + 1 synthetic sub-heading anchor + 3 merged-in bullets");
  assert.equal(section.bullets[0].text, "Languages: Fluent in English and Mandarin.");
  assert.equal(section.bullets[1].text, "Technical Skills");
  assert.equal(section.bullets[1].isListItem, false, "the merged-in sub-heading must render as a bold anchor line, not a bullet");
  assert.equal(section.bullets[2].text, "R and Python: full data analysis pipeline.");
  assert.equal(section.bullets[3].text, "SQL, Tableau, and pandas.");
  assert.equal(section.bullets[4].text, "Data mining, text mining, sentiment analysis.");

  assert.equal(merged.sections[1].name, "Education", "an unrelated, non-sparse section must be untouched");

  // Bullet.order must remain a single, gap-free monotonic sequence across
  // the whole document after merging - downstream logic depends on it.
  const allOrders = merged.sections.flatMap((s) => s.bullets.map((b) => b.order));
  assert.deepEqual(allOrders, [1, 2, 3, 4, 5, 6]);
});

test("mergeSparseSections merges two sparse sections even when they are topically unrelated - the accepted trade-off of going deterministic", () => {
  // This is the explicit, accepted risk of dropping the LLM judgment: a
  // purely deterministic "sparse + followed by another heading" rule
  // cannot tell "genuinely a sub-heading" apart from "coincidentally both
  // short, unrelated sections." The user chose this trade-off explicitly.
  const document = {
    contactBlock: "",
    summary: "",
    sections: [
      { name: "Awards", bullets: [bullet("Dean's List 2023.", "Awards", 1)] },
      { name: "Certifications", bullets: [bullet("AWS Certified Solutions Architect.", "Certifications", 2)] },
    ],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };

  const merged = mergeSparseSections(document);
  assert.equal(merged.sections.length, 1, "both sparse sections merge, even though they are unrelated");
  assert.equal(merged.sections[0].name, "Awards");
  assert.equal(merged.sections[0].bullets[1].text, "Certifications");
});

test("mergeSparseSections is a no-op when there are no sparse-section candidates", () => {
  const document = {
    contactBlock: "",
    summary: "",
    sections: [{ name: "Experience", bullets: [bullet("a", "Experience", 1), bullet("b", "Experience", 2), bullet("c", "Experience", 3)] }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };

  const merged = mergeSparseSections(document);
  assert.deepEqual(merged, document);
});
