import { extractJobDescriptionFromActiveTab } from "../messaging.ts";
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

  return container;
}
