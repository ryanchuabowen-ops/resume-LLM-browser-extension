import { diffTailoredResume } from "../../lib/resume/diff.ts";
import type { TailoredResume } from "../../lib/resume/rewriter_base.ts";
import { tailorWithOllama } from "../../lib/resume/rewriter_ollama.ts";
import { tailorRuleBased } from "../../lib/resume/rewriter_rule_based.ts";
import { ollamaGenerate, ollamaListModels } from "../messaging.ts";
import { persistSettings, state } from "../state.ts";

export function renderTailorReviewScreen(onChange: () => void): HTMLElement {
  const container = document.createElement("div");

  if (!state.resume) {
    container.innerHTML = `<h2>Tailor Resume</h2><p class="muted">Upload a resume first.</p>`;
    return container;
  }
  if (!state.job || !state.job.description.trim()) {
    container.innerHTML = `<h2>Tailor Resume</h2><p class="muted">Add a job description first.</p>`;
    return container;
  }

  container.innerHTML = `
    <h2>Tailor Resume</h2>
    <div class="form-row">
      <label>Backend
        <select id="backend-select">
          <option value="rule_based">Rule-based (offline)</option>
          <option value="ollama">Ollama (local AI)</option>
        </select>
      </label>
      <label id="model-row" class="hidden">Ollama model <select id="model-select"></select></label>
    </div>
    <div id="model-status" class="muted"></div>
    <button id="tailor-btn">Tailor resume</button>
    <div id="tailor-status" class="muted"></div>
    <div id="tailor-result" class="hidden"></div>
  `;

  const backendSelect = container.querySelector<HTMLSelectElement>("#backend-select")!;
  const modelRow = container.querySelector<HTMLElement>("#model-row")!;
  const modelSelect = container.querySelector<HTMLSelectElement>("#model-select")!;
  const tailorBtn = container.querySelector<HTMLButtonElement>("#tailor-btn")!;
  const status = container.querySelector<HTMLElement>("#tailor-status")!;
  const modelStatus = container.querySelector<HTMLElement>("#model-status")!;
  const resultEl = container.querySelector<HTMLElement>("#tailor-result")!;

  backendSelect.value = state.settings.rewriterBackend;
  modelRow.classList.toggle("hidden", backendSelect.value !== "ollama");

  async function refreshModels(): Promise<void> {
    modelSelect.innerHTML = "<option>Loading...</option>";
    modelStatus.textContent = "";
    try {
      const models = await ollamaListModels(state.settings.ollama.baseUrl);
      modelSelect.innerHTML = "";
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
      }
      if (models.includes(state.settings.ollama.model)) modelSelect.value = state.settings.ollama.model;
    } catch (err) {
      modelSelect.innerHTML = "<option value=''>(unavailable)</option>";
      modelStatus.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  backendSelect.addEventListener("change", async () => {
    const isOllama = backendSelect.value === "ollama";
    modelRow.classList.toggle("hidden", !isOllama);
    await persistSettings({ ...state.settings, rewriterBackend: isOllama ? "ollama" : "rule_based" });
    if (isOllama) void refreshModels();
  });

  if (backendSelect.value === "ollama") void refreshModels();

  tailorBtn.addEventListener("click", async () => {
    tailorBtn.disabled = true;
    resultEl.classList.add("hidden");
    status.textContent = backendSelect.value === "ollama"
      ? "Tailoring with local AI - this can take a minute or more on first load..."
      : "Tailoring...";

    try {
      const resume = state.resume!;
      const job = state.job!;
      let tailored: TailoredResume;

      if (backendSelect.value === "ollama") {
        const model = modelSelect.value;
        await persistSettings({ ...state.settings, ollama: { ...state.settings.ollama, model } });
        tailored = await tailorWithOllama(resume, job, (prompt) =>
          ollamaGenerate(state.settings.ollama.baseUrl, model, prompt));
      } else {
        tailored = tailorRuleBased(resume, job);
      }

      state.tailored = tailored;
      state.generatedDocx = null; // stale after re-tailoring
      status.textContent = `Done (backend: ${tailored.backendName}).`;
      renderResult(resultEl, tailored);
      resultEl.classList.remove("hidden");
      onChange();
    } catch (err) {
      status.textContent = `Tailoring failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      tailorBtn.disabled = false;
    }
  });

  if (state.tailored) {
    renderResult(resultEl, state.tailored);
    resultEl.classList.remove("hidden");
  }

  return container;
}

function renderResult(container: HTMLElement, tailored: TailoredResume): void {
  container.innerHTML = "";

  const summaryEl = document.createElement("p");
  summaryEl.textContent = tailored.summary || "(no summary section detected)";
  container.appendChild(summaryEl);

  if (tailored.warnings.length > 0) {
    const warn = document.createElement("div");
    warn.className = "warnings";
    warn.innerHTML = tailored.warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("");
    container.appendChild(warn);
  }

  const diffs = diffTailoredResume(tailored.bullets);
  let lastSection: string | null = null;
  for (const d of diffs) {
    if (d.section !== lastSection) {
      const label = document.createElement("div");
      label.className = "bullet-section-label";
      label.textContent = d.section;
      container.appendChild(label);
      lastSection = d.section;
    }

    const block = document.createElement("div");
    block.className = "bullet-block" + (d.highlight ? " highlight" : "");
    const spansHtml = d.spans.map((s) => {
      if (s.kind === "insert") return `<span class="ins">${escapeHtml(s.text)}</span>`;
      if (s.kind === "delete") return `<span class="del">${escapeHtml(s.text)}</span>`;
      return escapeHtml(s.text);
    }).join(" ");

    let badges = "";
    if (d.highlight) badges += `<span class="badge">strong match</span>`;
    if (d.reordered) badges += `<span class="badge">reordered</span>`;
    if (d.reworded) badges += `<span class="badge">reworded</span>`;

    block.innerHTML = `<div>${spansHtml}${badges}</div>`;
    container.appendChild(block);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}
