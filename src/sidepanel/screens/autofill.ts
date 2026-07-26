import { tailoredDocxFileName } from "../../lib/resume/docx_writer.ts";
import { generateOutputDocx, type GenerationMethod } from "../../lib/resume/generate_output_docx.ts";
import type { AutofillResult } from "../../lib/messaging/contract.ts";
import { autofillActiveTab } from "../messaging.ts";
import { state } from "../state.ts";

let lastGeneratedMethod: GenerationMethod | null = null;
let lastFallbackReason: string | undefined;

async function ensureGeneratedDocx(): Promise<{ blob: Blob; fileName: string }> {
  if (state.generatedDocx) return state.generatedDocx;
  const fileName = state.job
    ? tailoredDocxFileName(state.job.company, state.job.title)
    : tailoredDocxFileName("job", "resume");
  const result = await generateOutputDocx(state.resume!, state.tailored!, state.originalDocxBytes, fileName);
  lastGeneratedMethod = result.method;
  lastFallbackReason = result.fallbackReason;
  if (result.fallbackReason) {
    console.warn("In-place edit declined, regenerated instead:", result.fallbackReason);
  }
  state.generatedDocx = { blob: result.blob, fileName: result.fileName };
  return state.generatedDocx;
}

export function renderAutofillScreen(_onChange: () => void): HTMLElement {
  const container = document.createElement("div");

  if (!state.resume || !state.tailored) {
    container.innerHTML = `<h2>Apply</h2><p class="muted">Tailor your resume first.</p>`;
    return container;
  }

  container.innerHTML = `
    <h2>Apply</h2>
    <p class="muted">Opens the form on your current tab, fills in what it can, and stops.
    You always review everything and click Submit yourself.</p>
    <button id="download-btn">Download tailored .docx</button>
    <div id="download-status" class="muted"></div>
    <hr>
    <button id="autofill-btn">Autofill this page</button>
    <div id="autofill-status" class="muted"></div>
    <div id="autofill-report" class="hidden"></div>
  `;

  const downloadBtn = container.querySelector<HTMLButtonElement>("#download-btn")!;
  const downloadStatus = container.querySelector<HTMLElement>("#download-status")!;
  const autofillBtn = container.querySelector<HTMLButtonElement>("#autofill-btn")!;
  const autofillStatus = container.querySelector<HTMLElement>("#autofill-status")!;
  const reportEl = container.querySelector<HTMLElement>("#autofill-report")!;

  downloadBtn.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    downloadStatus.textContent = "Generating...";
    try {
      const { blob, fileName } = await ensureGeneratedDocx();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      downloadStatus.textContent = `Downloaded: ${fileName} - ${formatMethodNote(lastGeneratedMethod, lastFallbackReason)}`;
    } catch (err) {
      downloadStatus.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      downloadBtn.disabled = false;
    }
  });

  autofillBtn.addEventListener("click", async () => {
    autofillBtn.disabled = true;
    autofillStatus.textContent = "Filling the form on the current page...";
    reportEl.classList.add("hidden");
    try {
      const { blob, fileName } = await ensureGeneratedDocx();
      const resumeFile = { buffer: await blob.arrayBuffer(), fileName, mimeType: blob.type };
      const result = await autofillActiveTab({ profile: state.profile, resumeFile });
      autofillStatus.textContent = "Done. Review everything on the page, then click Submit yourself.";
      renderReport(reportEl, result);
      reportEl.classList.remove("hidden");
    } catch (err) {
      autofillStatus.textContent = `Autofill failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      autofillBtn.disabled = false;
    }
  });

  return container;
}

function renderReport(container: HTMLElement, result: AutofillResult): void {
  const parts: string[] = [];
  parts.push(`<h3>Autofill report</h3>`);
  parts.push(`<div><strong>Filled (${result.filled.length}):</strong><br>${result.filled.map(escapeHtml).join("<br>")}</div>`);
  if (result.unmappedLabels.length > 0) {
    parts.push(`<div><strong>Left blank for you to fill in:</strong><br>${result.unmappedLabels.map(escapeHtml).join("<br>")}</div>`);
  }
  if (!result.resumeUploaded) {
    parts.push(`<div class="warnings">Resume was not uploaded automatically - attach it manually before submitting.</div>`);
  }
  if (result.errors.length > 0) {
    parts.push(`<div class="warnings">${result.errors.map(escapeHtml).join("<br>")}</div>`);
  }
  container.innerHTML = parts.join("");
}

// Plain-language status of which output the user actually got - the whole
// point of in-place editing is formatting fidelity, so this isn't buried in
// a console log. Raw technical reasons (paragraph text, exception
// messages) stay in console.warn (see ensureGeneratedDocx) - never shown
// here.
function formatMethodNote(method: GenerationMethod | null, fallbackReason: string | undefined): string {
  if (method === "in_place") return "edited in place, your original formatting was preserved.";
  if (fallbackReason) return "regenerated from scratch (your original layout couldn't be safely preserved this time).";
  return "regenerated with standard formatting.";
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}
