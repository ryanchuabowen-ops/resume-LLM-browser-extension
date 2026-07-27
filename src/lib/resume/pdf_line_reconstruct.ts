// Optional LLM-backed alternative to parse_pdf.ts's pure indentation
// heuristic (mergeWrappedLines) for deciding which physical PDF lines are
// really wrapped continuations of the line before them. The heuristic has
// no signal at all when a section's wrapped lines have neither a bullet
// glyph nor a hanging indent - a real, user-reported case (a "Technical
// Skills" section where every line, wrapped or not, sat at the same left
// margin). An LLM can still often tell from CONTENT alone (e.g. "...data
// mining and text (social" doesn't end a sentence, so the next line must
// be its continuation) where indentation gives nothing to go on.
//
// Asks about ONE ambiguous adjacent pair at a time, not a whole page's
// lines in one batch - confirmed by direct, repeated testing against a
// real failing case: a single batch call asking mistral-nemo to judge 5
// lines at once got one line wrong, identically, on 3 repeated attempts
// (a deterministic blind spot, not random noise - re-asking or voting
// across repeated calls to the SAME model would never have fixed it), and
// different models made different, often worse mistakes (a majority vote
// across models would have overruled the one model that got it right).
// Asking the exact same model about isolated pairs instead got most lines
// right - but also surfaced a DIFFERENT failure mode worth documenting
// honestly: for one specific pair the model's answer was inconsistent
// across repeated identical calls (5 of 7 wrong), not deterministic -
// unlike the batch call's blind spot, more calls to the same pair COULD
// average this out, but the model's bias leaned toward the wrong answer
// often enough that voting isn't a reliable fix here either. The
// structural fix that actually matters: each ambiguous pair is judged
// against the ORIGINAL, unmodified previous ROW's text (rows[i-1]), never
// against the growing merged accumulator - confirmed directly that
// comparing against an already-merged blob lets a single wrong guess
// cascade, sweeping several unrelated bullets into one nonsensical blob;
// comparing against the clean original row instead contains any mistake
// to just the one pair it affects, which is a far more acceptable failure
// mode than a runaway merge. The LLM is only invoked for pairs where
// neither a bullet glyph nor a hanging indent already gives a confident
// answer - most resumes need zero LLM calls for this step at all, keeping
// the common case fast.
//
// Pure except for an injected `generate` callback, same pattern as
// rewriter_ollama.ts/section_merge.ts - the network call happens in
// background/ollama_client.ts.
import { classifyLine, looksLikeLabeledEntry, mergeWrappedLines, type Row } from "./parse_pdf.ts";

// Matches parse_pdf.ts's own CONTINUATION_INDENT_TOLERANCE - kept in sync
// deliberately, since both are compensating for the same float jitter in
// pdfjs-extracted coordinates.
const CONTINUATION_INDENT_TOLERANCE = 5;

export const PAIRWISE_SYSTEM_MESSAGE = `You will be given two consecutive lines extracted from a PDF resume, in the order they appeared on the page. PDF text has no paragraph structure - a sentence, bullet, or heading that's too long for one physical line simply wraps onto the next, appearing as a separate line with nothing marking it as a continuation.

Decide whether Line B is a direct continuation of the sentence in Line A (because Line A's sentence was too long to fit on one physical line and simply wrapped), or whether Line B starts its own new, separate bullet, heading, or entry. A line ending mid-sentence or mid-word strongly suggests the next line continues it; a line ending with a complete thought (like a date range, or a full sentence) suggests what follows is new.

Respond with ONLY a JSON object of this exact shape, no other text:
{"continues": true or false}`;

export function buildPairwisePrompt(previousText: string, currentText: string): string {
  return `Line A: ${previousText.trim()}\nLine B: ${currentText.trim()}`;
}

export function parsePairwiseResponse(rawText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Ollama returned unparseable output: ${err instanceof Error ? err.message : String(err)}`);
  }
  const continues = (parsed as { continues?: unknown } | null)?.continues;
  if (typeof continues !== "boolean") {
    throw new Error("Ollama response missing a boolean 'continues' field");
  }
  return continues;
}

export type GenerateFn = (prompt: string, system?: string) => Promise<string>;

// Never throws - any failure (network, parsing) falls back to the pure
// indentation heuristic for the WHOLE page, exactly matching the "never
// block the user" fallback discipline used everywhere else Ollama is
// optionally involved in this codebase. A failure on one pair is treated
// as Ollama being unreachable/misbehaving in general, not a one-off - so
// the whole page falls back together rather than mixing partial LLM
// results with partial heuristic ones.
export async function reconstructLinesWithOllama(rows: Row[], generate: GenerateFn): Promise<string[]> {
  if (rows.length === 0) return [];
  try {
    const merged: string[] = [rows[0]!.text];
    let lastLineStartX = rows[0]!.x;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const startsNewBullet = classifyLine(row.text).kind === "list_item";
      const startsLabeledEntry = looksLikeLabeledEntry(row.text);
      const hasIndentSignal = row.x > lastLineStartX + CONTINUATION_INDENT_TOLERANCE;

      let shouldMerge: boolean;
      if (startsNewBullet || startsLabeledEntry) {
        shouldMerge = false; // a bullet glyph, or a "Label:" prefix, always starts a new entry - no need to ask (and this is exactly the transition the LLM proved unreliable on)
      } else if (hasIndentSignal) {
        shouldMerge = true; // hanging indent is already a reliable signal - no need to ask
      } else {
        // Ambiguous: no bullet glyph and no indent signal - exactly the
        // case the plain heuristic has nothing to go on for. Ask about
        // just this one pair - critically, using the ORIGINAL previous
        // ROW's own text (rows[i-1]), never the growing merged
        // accumulator. A wrong merge decision earlier must not corrupt
        // the context for every later comparison - confirmed directly
        // that comparing against an already-merged blob lets one bad
        // guess cascade into several unrelated bullets getting swept
        // together; comparing against the clean original row instead
        // contains each mistake to just the one pair it affects.
        const rawText = await generate(buildPairwisePrompt(rows[i - 1]!.text, row.text), PAIRWISE_SYSTEM_MESSAGE);
        shouldMerge = parsePairwiseResponse(rawText);
      }

      if (shouldMerge) {
        merged[merged.length - 1] = `${merged[merged.length - 1]!.trimEnd()} ${row.text.trim()}`;
      } else {
        merged.push(row.text);
        lastLineStartX = row.x;
      }
    }
    return merged;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`AI-assisted PDF line reconstruction unavailable (${message}); used the indentation-based heuristic instead.`);
    return mergeWrappedLines(rows);
  }
}
