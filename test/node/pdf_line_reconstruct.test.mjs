import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAIRWISE_SYSTEM_MESSAGE,
  buildPairwisePrompt,
  parsePairwiseResponse,
  reconstructLinesWithOllama,
} from "../../src/lib/resume/pdf_line_reconstruct.ts";

test("buildPairwisePrompt presents exactly the two lines being compared", () => {
  const prompt = buildPairwisePrompt("R language: intro line ending mid (social", "media) continuation.");
  assert.match(prompt, /Line A: R language: intro line ending mid \(social/);
  assert.match(prompt, /Line B: media\) continuation\./);
});

test("PAIRWISE_SYSTEM_MESSAGE documents the expected response shape", () => {
  assert.match(PAIRWISE_SYSTEM_MESSAGE, /continues/);
});

test("parsePairwiseResponse extracts the boolean", () => {
  assert.equal(parsePairwiseResponse('{"continues": true}'), true);
  assert.equal(parsePairwiseResponse('{"continues": false}'), false);
});

test("parsePairwiseResponse throws on invalid JSON or a missing/non-boolean 'continues' field", () => {
  assert.throws(() => parsePairwiseResponse("not json"));
  assert.throws(() => parsePairwiseResponse('{"foo": "bar"}'));
  assert.throws(() => parsePairwiseResponse('{"continues": "yes"}'));
});

test("reconstructLinesWithOllama skips the LLM entirely when a bullet glyph or hanging indent already gives a confident answer", async () => {
  let calls = 0;
  const generate = async () => { calls++; return JSON.stringify({ continues: true }); };

  const rows = [
    { text: "Senior Engineer, Acme Corp (2021-Present)", x: 54 },
    { text: "- Built a thing spanning", x: 54 }, // starts a new bullet (glyph) - no ambiguity
    { text: "multiple teams and reducing costs.", x: 72 }, // hanging indent - no ambiguity
    { text: "- Mentored 3 junior engineers.", x: 54 }, // new bullet (glyph) again
  ];
  const merged = await reconstructLinesWithOllama(rows, generate);
  assert.equal(calls, 0, "neither a bullet glyph nor a clear indent difference should ever need an LLM call");
  assert.deepEqual(merged, [
    "Senior Engineer, Acme Corp (2021-Present)",
    "- Built a thing spanning multiple teams and reducing costs.",
    "- Mentored 3 junior engineers.",
  ]);
});

test("reconstructLinesWithOllama skips the LLM for a line matching the 'Label:' new-entry pattern, even with no indent signal", async () => {
  // Real finding: on the exact real resume that motivated this feature,
  // the LLM turned out to be unreliable (biased toward the wrong answer)
  // specifically on the transition INTO a new "Label: description" entry.
  // Every new entry in that section happened to follow this common,
  // deliberate resume convention - a far more reliable, deterministic
  // signal than asking the model, so it's checked before ever calling out.
  let calls = 0;
  const generate = async () => { calls++; return JSON.stringify({ continues: true }); };

  const rows = [
    { text: "R language: intro line ending mid", x: 54 },
    { text: "Python language: a new labeled entry, not a continuation", x: 54 },
  ];
  const merged = await reconstructLinesWithOllama(rows, generate);
  assert.equal(calls, 0, "a 'Label:' prefix should be decided deterministically, no LLM call needed");
  assert.deepEqual(merged, rows.map((r) => r.text));
});

test("reconstructLinesWithOllama asks the LLM only for genuinely ambiguous pairs (no glyph, no indent, no label) and uses its answer", async () => {
  // Real regression: a "Technical Skills" section had every line - wrapped
  // or not - at the exact same left margin with no bullet glyphs at all,
  // so neither of the fast signals can tell continuation from a new entry.
  // "Python language:" itself is caught by the deterministic label check
  // (see the test above), so the only calls left are for the genuinely
  // label-less continuation fragments between labeled entries.
  const rows = [
    { text: "R language: Highly Proficient at R programming for data science pipeline, data mining and text (social", x: 54 },
    { text: "media) mining to extract valuable insights (e.g. Sentiment analysis) and conducting inferential,", x: 54 },
    { text: "predictive and diagnostic analysis", x: 54 },
    { text: "Python language: Highly proficient at using Python for entire data analysis pipeline.", x: 54 },
  ];
  const seenPrompts = [];
  const generate = async (prompt) => {
    seenPrompts.push(prompt);
    return JSON.stringify({ continues: true });
  };

  const merged = await reconstructLinesWithOllama(rows, generate);
  assert.equal(seenPrompts.length, 2, "one LLM call per label-less, indent-less ambiguous pair (rows 1 and 2 only - row 3 is caught by the label check)");
  assert.ok(!seenPrompts.some((p) => p.includes("Python language")), "the labeled row must never even reach the LLM");
  assert.deepEqual(merged, [
    "R language: Highly Proficient at R programming for data science pipeline, data mining and text (social media) mining to extract valuable insights (e.g. Sentiment analysis) and conducting inferential, predictive and diagnostic analysis",
    "Python language: Highly proficient at using Python for entire data analysis pipeline.",
  ]);
});

test("reconstructLinesWithOllama contains a wrong merge decision instead of letting it cascade into later, unrelated pairs", async () => {
  // Real regression: comparing an ambiguous pair against the GROWING
  // MERGED ACCUMULATOR (rather than the original adjacent row) meant one
  // wrong "yes, merge" decision corrupted the text used for every later
  // comparison, and on a real 11-line resume section this swept 4
  // completely unrelated bullets into one nonsensical blob. Each pair must
  // be judged against the clean original rows[i-1], so a single mistake
  // stays isolated. Deliberately avoids the "Label:" pattern here (that
  // case is now handled deterministically, see the tests above) to keep
  // testing the LLM-judged, cascade-prone path specifically.
  const rows = [
    { text: "Alpha entry, first sentence fragment", x: 54 },
    { text: "continues alpha.", x: 54 }, // ambiguous - correctly merges into Alpha
    { text: "however this next part discusses a totally different, unrelated topic", x: 54 }, // the model will WRONGLY say this continues "continues alpha." too
    { text: "and this final part discusses yet another unrelated topic", x: 54 }, // must NOT also get swept in just because the previous one was wrongly merged
  ];
  const seenPrompts = [];
  const generate = async (prompt) => {
    seenPrompts.push(prompt);
    if (prompt.includes("Alpha entry")) return JSON.stringify({ continues: true }); // correct
    if (prompt.includes("continues alpha.") && prompt.includes("however this next part")) return JSON.stringify({ continues: true }); // WRONG, simulating the real model's mistake
    if (prompt.includes("however this next part") && prompt.includes("and this final part")) return JSON.stringify({ continues: false }); // correct, IF asked about the clean original pair
    throw new Error(`unexpected prompt in test stub: ${prompt}`);
  };

  const merged = await reconstructLinesWithOllama(rows, generate);
  assert.deepEqual(merged, [
    "Alpha entry, first sentence fragment continues alpha. however this next part discusses a totally different, unrelated topic", // the one contained mistake
    "and this final part discusses yet another unrelated topic", // must stay separate, NOT swept into the same blob
  ]);
  assert.ok(
    seenPrompts.some((p) => p.includes("however this next part") && p.includes("and this final part") && !p.includes("continues alpha.")),
    "the final comparison must use the previous row's own original text, not the already-merged blob",
  );
});

test("reconstructLinesWithOllama falls back to the indentation heuristic for the whole page when the LLM is unreachable", async () => {
  const rows = [
    { text: "R language: intro line ending mid (social", x: 54 },
    { text: "media) continuation, no glyph, no indent.", x: 54 }, // ambiguous - would trigger a call
    { text: "Senior Engineer, Acme Corp (2021-Present)", x: 54 },
    { text: "Built a thing spanning", x: 54 },
    { text: "multiple teams.", x: 72 }, // indented - the heuristic alone should still merge this even in the fallback
  ];
  const generate = async () => { throw new Error("connection refused"); };

  const merged = await reconstructLinesWithOllama(rows, generate);
  assert.deepEqual(merged, [
    "R language: intro line ending mid (social", // heuristic alone can't merge this (no signal) - stays separate, an acceptable fallback degradation
    "media) continuation, no glyph, no indent.",
    "Senior Engineer, Acme Corp (2021-Present)",
    "Built a thing spanning multiple teams.",
  ]);
});

test("reconstructLinesWithOllama returns an empty array without calling the LLM when there are no rows", async () => {
  let called = false;
  const generate = async () => { called = true; return "{}"; };
  const merged = await reconstructLinesWithOllama([], generate);
  assert.deepEqual(merged, []);
  assert.equal(called, false);
});
