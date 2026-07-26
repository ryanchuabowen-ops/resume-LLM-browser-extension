// Shared wiring for the backend (rule-based vs Ollama) + model dropdown pair
// used by both the Tailor screen and the Find Jobs section - kept in one
// place so the two don't drift out of sync.
import type { AppSettings } from "../storage/schema.ts";
import { ollamaListModels } from "./messaging.ts";
import { persistSettings, state } from "./state.ts";

export interface BackendPickerElements {
  backendSelect: HTMLSelectElement;
  modelRow: HTMLElement;
  modelSelect: HTMLSelectElement;
  modelStatus: HTMLElement;
}

export function wireBackendPicker(
  els: BackendPickerElements,
  settingsKey: "rewriterBackend" | "jobSearchBackend",
): void {
  els.backendSelect.value = state.settings[settingsKey];
  els.modelRow.classList.toggle("hidden", els.backendSelect.value !== "ollama");

  async function refreshModels(): Promise<void> {
    els.modelSelect.innerHTML = "<option>Loading...</option>";
    els.modelStatus.textContent = "";
    try {
      const models = await ollamaListModels(state.settings.ollama.baseUrl);
      els.modelSelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        els.modelSelect.appendChild(opt);
      }
      if (models.includes(state.settings.ollama.model)) els.modelSelect.value = state.settings.ollama.model;
    } catch (err) {
      els.modelSelect.innerHTML = "<option value=''>(unavailable)</option>";
      els.modelStatus.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  els.backendSelect.addEventListener("change", async () => {
    const isOllama = els.backendSelect.value === "ollama";
    els.modelRow.classList.toggle("hidden", !isOllama);
    const updated: AppSettings = { ...state.settings, [settingsKey]: isOllama ? "ollama" : "rule_based" };
    await persistSettings(updated);
    if (isOllama) void refreshModels();
  });

  if (els.backendSelect.value === "ollama") void refreshModels();
}
