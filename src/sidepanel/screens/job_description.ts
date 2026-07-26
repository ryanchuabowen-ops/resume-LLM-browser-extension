import { buildGoogleJobsUrl } from "../../lib/job/google_jobs_url.ts";
import { generateQueriesRuleBased, generateQueriesWithOllama } from "../../lib/job/query_generator.ts";
import { wireBackendPicker } from "../backend_picker.ts";
import { extractJobDescriptionFromActiveTab, ollamaGenerate } from "../messaging.ts";
import { state } from "../state.ts";

export function renderJobDescriptionScreen(onChange: () => void): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <h2>Job Description</h2>
    <p class="muted">Browse to a job posting in your browser, then extract it here - or just paste it in below.</p>
    <button id="extract-btn">Extract from this page</button>
    <div id="extract-status" class="muted"></div>
    <div class="form-row">
      <label>Job title <input type="text" id="job-title"></label>
      <label>Company <input type="text" id="job-company"></label>
    </div>
    <label>Description
      <textarea id="job-description" rows="10"></textarea>
    </label>

    <hr>

    <h2>Find Jobs</h2>
    <p class="muted">
      Reads your uploaded resume and suggests a few Google Jobs searches worth trying - it opens
      real Google Jobs tabs for you to browse, it does not read or collect any results itself.
    </p>
    <div id="find-jobs-body"></div>
  `;

  const titleInput = container.querySelector<HTMLInputElement>("#job-title")!;
  const companyInput = container.querySelector<HTMLInputElement>("#job-company")!;
  const descTextarea = container.querySelector<HTMLTextAreaElement>("#job-description")!;
  const status = container.querySelector<HTMLElement>("#extract-status")!;

  if (state.job) {
    titleInput.value = state.job.title;
    companyInput.value = state.job.company;
    descTextarea.value = state.job.description;
  }

  function syncStateFromInputs(): void {
    state.job = { title: titleInput.value, company: companyInput.value, description: descTextarea.value };
  }
  titleInput.addEventListener("input", syncStateFromInputs);
  companyInput.addEventListener("input", syncStateFromInputs);
  descTextarea.addEventListener("input", syncStateFromInputs);

  container.querySelector<HTMLButtonElement>("#extract-btn")!.addEventListener("click", async () => {
    status.textContent = "Extracting...";
    try {
      const result = await extractJobDescriptionFromActiveTab();
      titleInput.value = result.title;
      companyInput.value = result.company;
      descTextarea.value = result.description;
      state.jobExtractConfidence = result.confidence;
      syncStateFromInputs();

      if (result.confidence === "none") {
        status.textContent = "Couldn't find a job description on this page - paste it manually below.";
      } else if (result.confidence === "fallback") {
        status.textContent = "Extracted using a best-effort guess - please review and edit if needed.";
      } else {
        status.textContent = "Extracted.";
      }
      onChange();
    } catch (err) {
      status.textContent =
        `Extraction failed: ${err instanceof Error ? err.message : String(err)}. You can paste the description manually below.`;
    }
  });

  renderFindJobs(container.querySelector<HTMLElement>("#find-jobs-body")!);

  return container;
}

function renderFindJobs(container: HTMLElement): void {
  if (!state.resume) {
    container.innerHTML = `<p class="muted">Upload a resume first.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="form-row">
      <label>Backend
        <select id="fj-backend-select">
          <option value="rule_based">Rule-based (offline)</option>
          <option value="ollama">Ollama (local AI)</option>
        </select>
      </label>
      <label id="fj-model-row" class="hidden">Ollama model <select id="fj-model-select"></select></label>
    </div>
    <div id="fj-model-status" class="muted"></div>
    <div class="form-row">
      <label>Location / remote preference (optional)
        <input type="text" id="fj-location" placeholder="e.g. remote, or a city">
      </label>
    </div>
    <button id="fj-find-btn">Find jobs</button>
    <div id="fj-status" class="muted"></div>
    <div id="fj-warnings"></div>
    <div id="fj-results"></div>
  `;

  const backendSelect = container.querySelector<HTMLSelectElement>("#fj-backend-select")!;
  const modelRow = container.querySelector<HTMLElement>("#fj-model-row")!;
  const modelSelect = container.querySelector<HTMLSelectElement>("#fj-model-select")!;
  const modelStatus = container.querySelector<HTMLElement>("#fj-model-status")!;
  const locationInput = container.querySelector<HTMLInputElement>("#fj-location")!;
  const findBtn = container.querySelector<HTMLButtonElement>("#fj-find-btn")!;
  const status = container.querySelector<HTMLElement>("#fj-status")!;
  const warningsEl = container.querySelector<HTMLElement>("#fj-warnings")!;
  const resultsEl = container.querySelector<HTMLElement>("#fj-results")!;

  locationInput.value = state.profile.location ?? "";

  wireBackendPicker({ backendSelect, modelRow, modelSelect, modelStatus }, "jobSearchBackend");

  findBtn.addEventListener("click", async () => {
    findBtn.disabled = true;
    resultsEl.innerHTML = "";
    warningsEl.innerHTML = "";
    status.textContent = backendSelect.value === "ollama"
      ? "Reading your resume with local AI - this can take a minute or more..."
      : "Generating search queries...";

    try {
      const resume = state.resume!;
      let queries: string[];
      let warnings: string[] = [];

      if (backendSelect.value === "ollama") {
        const model = modelSelect.value;
        const result = await generateQueriesWithOllama(resume, (prompt) =>
          ollamaGenerate(state.settings.ollama.baseUrl, model, prompt));
        queries = result.queries;
        warnings = result.warnings;
      } else {
        queries = generateQueriesRuleBased(resume);
      }

      const location = locationInput.value.trim();
      const finalQueries = location ? queries.map((q) => `${q} ${location}`) : queries;

      status.textContent = `Found ${finalQueries.length} search${finalQueries.length === 1 ? "" : "es"} to try.`;
      if (warnings.length > 0) {
        warningsEl.className = "warnings";
        warningsEl.innerHTML = warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("");
      }
      renderQueryResults(resultsEl, finalQueries);
    } catch (err) {
      status.textContent = `Could not generate search queries: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      findBtn.disabled = false;
    }
  });
}

function renderQueryResults(container: HTMLElement, queries: string[]): void {
  if (queries.length === 0) {
    container.innerHTML = `<p class="muted">No search suggestions - try adding more detail to your resume.</p>`;
    return;
  }

  for (const query of queries) {
    const row = document.createElement("div");
    row.className = "bullet-block";

    const label = document.createElement("span");
    label.textContent = query;
    row.appendChild(label);

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open in Google Jobs";
    openBtn.style.marginLeft = "10px";
    openBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: buildGoogleJobsUrl(query) });
    });
    row.appendChild(openBtn);

    container.appendChild(row);
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}
