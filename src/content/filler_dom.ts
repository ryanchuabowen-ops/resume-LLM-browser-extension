// Fills a mapped application form. Port of job-agent/autofill/filler.py.
//
// HARD PRODUCT-SAFETY CONSTRAINT: this module contains no code path that
// ever clicks a submit-like button, or calls .submit()/.requestSubmit() on
// a form. That is not a runtime check that could be bypassed or fail - the
// code to do it simply does not exist here. Review/submission is always
// left to the human. DO NOT add a submit path to this file.
import { matchField } from "../lib/autofill/field_mapper.ts";
import { getFieldValue } from "../lib/autofill/profile_fields.ts";
import type { UserProfile } from "../storage/schema.ts";

export interface AutofillReport {
  filled: string[];
  unmappedLabels: string[];
  errors: string[];
}

const TEXT_LIKE_TYPES = new Set(["", "text", "email", "tel", "url", "search"]);

function gatherLabelText(el: Element): string {
  const parts: string[] = [];
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) parts.push(label.textContent);
  }
  for (const attr of ["aria-label", "placeholder", "name"]) {
    const val = el.getAttribute(attr);
    if (val) parts.push(val);
  }
  return parts.filter(Boolean).join(" ").trim();
}

// Plain `el.value = x` is silently ignored by React/Vue-controlled inputs,
// since those frameworks override the native value property setter to hook
// their own state. Calling the native setter directly, then dispatching the
// events the framework listens for, is the actual fix - this is the real
// content-script replacement for what Playwright's page.fill() did.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(el: HTMLSelectElement, value: string): boolean {
  const lowered = value.toLowerCase();
  for (const option of Array.from(el.options)) {
    if (option.textContent?.trim().toLowerCase() === lowered || option.value.toLowerCase() === lowered) {
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }
  return false;
}

export function fillApplication(profile: UserProfile): AutofillReport {
  const report: AutofillReport = { filled: [], unmappedLabels: [], errors: [] };
  const elements = document.querySelectorAll("input, textarea, select");

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el as HTMLInputElement).type.toLowerCase();
      if (!TEXT_LIKE_TYPES.has(type)) continue; // file/hidden/submit/button/checkbox/radio - not handled here
    }

    const labelText = gatherLabelText(el);
    const { key } = matchField(labelText);
    if (!key) {
      if (labelText) report.unmappedLabels.push(labelText);
      continue;
    }

    const value = getFieldValue(profile, key);
    if (!value) continue;

    try {
      if (tag === "select") {
        if (setSelectValue(el as HTMLSelectElement, value)) {
          report.filled.push(`${key}: ${labelText || tag}`);
        }
      } else {
        setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, value);
        report.filled.push(`${key}: ${labelText || tag}`);
      }
    } catch (err) {
      report.errors.push(`Failed to fill ${key} (${labelText}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return report;
}
