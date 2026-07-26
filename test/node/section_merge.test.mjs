import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMergeJudgePrompt,
  findMergeCandidates,
  mergeSectionsWithOllama,
  parseMergeJudgeResponse,
} from "../../src/lib/resume/section_merge.ts";

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

test("buildMergeJudgePrompt names both candidate sections and asks for a JSON boolean", () => {
  const prompt = buildMergeJudgePrompt("Skills, Activities & Interests", "Technical Skills");
  assert.match(prompt, /Skills, Activities & Interests/);
  assert.match(prompt, /Technical Skills/);
  assert.match(prompt, /"merge": true or false/);
});

test("parseMergeJudgeResponse extracts the boolean", () => {
  assert.equal(parseMergeJudgeResponse('{"merge": true}'), true);
  assert.equal(parseMergeJudgeResponse('{"merge": false}'), false);
});

test("parseMergeJudgeResponse throws on invalid JSON or a missing/non-boolean 'merge' field", () => {
  assert.throws(() => parseMergeJudgeResponse("not json"));
  assert.throws(() => parseMergeJudgeResponse('{"foo": "bar"}'));
  assert.throws(() => parseMergeJudgeResponse('{"merge": "yes"}'));
});

test("mergeSectionsWithOllama merges a sparse section into the next when the LLM says they're related, preserving the sub-heading as a bold anchor line", async () => {
  const document = buildDocument();
  const generate = async () => JSON.stringify({ merge: true });

  const result = await mergeSectionsWithOllama(document, generate);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.document.sections.length, 2, "the two related sections must collapse into one");

  const merged = result.document.sections[0];
  assert.equal(merged.name, "Skills, Activities & Interests");
  assert.equal(merged.bullets.length, 5, "1 original bullet + 1 synthetic sub-heading anchor + 3 merged-in bullets");
  assert.equal(merged.bullets[0].text, "Languages: Fluent in English and Mandarin.");
  assert.equal(merged.bullets[1].text, "Technical Skills");
  assert.equal(merged.bullets[1].isListItem, false, "the merged-in sub-heading must render as a bold anchor line, not a bullet");
  assert.equal(merged.bullets[2].text, "R and Python: full data analysis pipeline.");
  assert.equal(merged.bullets[3].text, "SQL, Tableau, and pandas.");
  assert.equal(merged.bullets[4].text, "Data mining, text mining, sentiment analysis.");

  assert.equal(result.document.sections[1].name, "Education", "the unrelated third section must be untouched");

  // Bullet.order must remain a single, gap-free monotonic sequence across
  // the whole document after merging - downstream logic depends on it.
  const allOrders = result.document.sections.flatMap((s) => s.bullets.map((b) => b.order));
  assert.deepEqual(allOrders, [1, 2, 3, 4, 5, 6]);
});

test("mergeSectionsWithOllama leaves sections untouched when the LLM says they're unrelated", async () => {
  const document = buildDocument();
  const generate = async () => JSON.stringify({ merge: false });

  const result = await mergeSectionsWithOllama(document, generate);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.document, document);
});

test("mergeSectionsWithOllama leaves sections untouched and warns when Ollama is unreachable", async () => {
  const document = buildDocument();
  const generate = async () => { throw new Error("connection refused"); };

  const result = await mergeSectionsWithOllama(document, generate);
  assert.deepEqual(result.document, document);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Could not check whether some sections should be merged/);
});

test("mergeSectionsWithOllama is a no-op when there are no sparse-section candidates", async () => {
  const document = {
    contactBlock: "",
    summary: "",
    sections: [{ name: "Experience", bullets: [bullet("a", "Experience", 1), bullet("b", "Experience", 2), bullet("c", "Experience", 3)] }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  let called = false;
  const generate = async () => { called = true; return JSON.stringify({ merge: true }); };

  const result = await mergeSectionsWithOllama(document, generate);
  assert.equal(called, false, "must not call the LLM at all when there's nothing to judge");
  assert.deepEqual(result.document, document);
});
