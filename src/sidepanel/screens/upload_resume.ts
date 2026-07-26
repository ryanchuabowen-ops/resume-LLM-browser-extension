// Upload Resume screen: parse a .docx/.pdf client-side and persist the
// structured result to chrome.storage.local.
import { parseDocx } from "../../lib/resume/parse_docx.ts";
import { parsePdf } from "../../lib/resume/parse_pdf.ts";
import type { ResumeDocument } from "../../lib/resume/models.ts";
import { mergeSectionsWithOllama } from "../../lib/resume/section_merge.ts";
import { ollamaGenerate } from "../messaging.ts";
import { persistResume, state } from "../state.ts";

export interface ParsedResumeFile {
  resume: ResumeDocument;
  // Present only for .docx uploads - the same ArrayBuffer already read for
  // parsing, reused rather than re-read, kept so in-place editing can later
  // operate on the user's actual original file bytes.
  originalDocxBytes?: ArrayBuffer;
}

export async function parseResumeFile(file: File): Promise<ParsedResumeFile> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const resume = await parseDocx(arrayBuffer, file.name);
    return { resume, originalDocxBytes: arrayBuffer };
  }
  if (lowerName.endsWith(".pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    const workerSrc = typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("pdf.worker.min.mjs")
      : undefined;
    const resume = await parsePdf(new Uint8Array(arrayBuffer), file.name, { workerSrc });
    return { resume };
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
      const { resume: parsedFile, originalDocxBytes } = await parseResumeFile(file);
      let parsed = parsedFile;
      let mergeWarning = "";

      // Best-effort cleanup: ask the local LLM whether any oddly-sparse
      // detected section is actually a sub-heading that got misdetected as
      // its own section (see section_merge.ts). Only attempted when the
      // user has already opted into the Ollama backend elsewhere in the
      // app; on any failure this just leaves the resume's sections exactly
      // as originally parsed - never blocks the upload.
      if (state.settings.rewriterBackend === "ollama") {
        try {
          const { document, warnings } = await mergeSectionsWithOllama(parsed, (prompt) =>
            ollamaGenerate(state.settings.ollama.baseUrl, state.settings.ollama.model, prompt));
          parsed = document;
          if (warnings.length > 0) mergeWarning = ` (${warnings[0]})`;
        } catch {
          // Never let a section-merge failure block the upload itself.
        }
      }

      await persistResume(parsed, originalDocxBytes);
      status.textContent = `Parsed and saved: ${file.name} (${parsed.sourceFormat.toUpperCase()})${mergeWarning}`;
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
