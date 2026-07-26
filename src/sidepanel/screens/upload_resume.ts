// Upload Resume screen: parse a .docx/.pdf client-side and persist the
// structured result to chrome.storage.local.
import { parseDocx } from "../../lib/resume/parse_docx.ts";
import { parsePdf } from "../../lib/resume/parse_pdf.ts";
import type { ResumeDocument } from "../../lib/resume/models.ts";
import { persistResume, state } from "../state.ts";

export async function parseResumeFile(file: File): Promise<ResumeDocument> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    return parseDocx(arrayBuffer, file.name);
  }
  if (lowerName.endsWith(".pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    const workerSrc = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("pdf.worker.min.mjs")
      : undefined;
    return parsePdf(new Uint8Array(arrayBuffer), file.name, { workerSrc });
  }
  throw new Error(`Unsupported file type: ${file.name} (expected .docx or .pdf)`);
}

export function renderUploadResumeScreen(onChange: () => void): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <h2>Upload Resume</h2>
    <p class="muted">Parsed entirely in your browser - nothing is uploaded anywhere.</p>
    <input type="file" id="resume-file-input" accept=".docx,.pdf">
    <div id="resume-status" class="muted"></div>
    <div id="resume-preview"></div>
  `;

  const input = container.querySelector<HTMLInputElement>("#resume-file-input")!;
  const status = container.querySelector<HTMLElement>("#resume-status")!;
  const preview = container.querySelector<HTMLElement>("#resume-preview")!;

  if (state.resume) {
    status.textContent = `Currently using: ${state.resumeFileName}`;
    preview.appendChild(renderPreview(state.resume));
  }

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    status.textContent = "Parsing...";
    preview.innerHTML = "";

    try {
      const parsed = await parseResumeFile(file);
      await persistResume(parsed);
      status.textContent = `Parsed and saved: ${file.name} (${parsed.sourceFormat.toUpperCase()})`;
      preview.appendChild(renderPreview(parsed));
      onChange();
    } catch (err) {
      status.textContent = `Failed to parse: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  return container;
}

function renderPreview(resume: ResumeDocument): HTMLElement {
  const el = document.createElement("div");
  const contactEl = document.createElement("pre");
  contactEl.textContent = resume.contactBlock;
  el.appendChild(contactEl);

  for (const section of resume.sections) {
    const heading = document.createElement("div");
    heading.textContent = `${section.name} (${section.bullets.length} bullets)`;
    heading.style.fontWeight = "600";
    heading.style.marginTop = "8px";
    el.appendChild(heading);

    const list = document.createElement("ul");
    for (const bullet of section.bullets) {
      const li = document.createElement("li");
      li.textContent = `${bullet.isListItem ? "" : "[anchor] "}${bullet.text}`;
      list.appendChild(li);
    }
    el.appendChild(list);
  }
  return el;
}
