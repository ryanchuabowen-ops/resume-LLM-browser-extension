// Pure keyword-scoring logic, split cleanly from DOM traversal (content/
// filler_dom.ts) so it's directly Node-unit-testable - an improvement over
// the Python version, where scoring and Playwright DOM calls lived in the
// same function. Port of job-agent/autofill/field_mapper.py's _match_field.
import { FIELD_SPECS } from "./profile_fields.ts";

// Minimum matched-keyword length required to accept a mapping. A wrong
// guess (e.g. filling "Desired Salary" with a phone number) is worse than
// leaving a field blank for the human to fill in during review.
export const MIN_CONFIDENCE = 4;

export interface FieldMatch {
  key: string | null;
  confidence: number;
}

export function matchField(labelText: string): FieldMatch {
  const lowered = labelText.toLowerCase();
  let bestKey: string | null = null;
  let bestLen = 0;

  for (const spec of FIELD_SPECS) {
    for (const kw of spec.keywords) {
      if (kw.length > bestLen && lowered.includes(kw)) {
        bestLen = kw.length;
        bestKey = spec.key;
      }
    }
  }

  if (bestLen < MIN_CONFIDENCE) return { key: null, confidence: bestLen };
  return { key: bestKey, confidence: bestLen };
}
