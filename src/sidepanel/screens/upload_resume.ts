// Upload Resume screen: parse a .docx/.pdf client-side and persist the
// structured result to chrome.storage.local.
import { parseDocx } from "../../lib/resume/parse_docx.ts";
import { parsePdf, type Row } from "../../lib/resume/parse_pdf.ts";
import { reconstructLinesWithOllama } from "../../lib/resume/pdf_line_reconstruct.ts";
import type { ResumeDocument } from "../../lib/resume/models.ts";
import { mergeSparseSections } from "../../lib/resume/section_merge.ts";
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
    // When a wrapped line has neither a bullet glyph nor a hanging indent
    // (a real, user-reported case), the plain indentation heuristic
    // (mergeWrappedLines) has no signal at all to work with - let the
    // local LLM judge it from content instead, when the user has already
    // opted into the Ollama backend elsewhere in the app. Falls back to
    // the indentation heuristic on any failure, same as everywhere else
    // Ollama is optionally involved - never blocks the upload.
    const reconstructLines = state.settings.rewriterBackend === "ollama"
      ? (rows: Row[]) => reconstructLinesWithOllama(rows, (prompt, system) =>
          ollamaGenerate(state.settings.ollama.baseUrl, state.settings.ollama.model, prompt, system))
      : undefined;
    const resume = await parsePdf(new Uint8Array(arrayBuffer), file.name, { workerSrc, reconstructLines });
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
      // Cleanup: fold a sparse section immediately followed by another
      // heading into that heading as a sub-heading instead of leaving it
      // as its own awkward, near-empty section (see section_merge.ts).
      // Deterministic and always applied - no Ollama dependency.
      const parsed = mergeSparseSections(parsedFile);

      await persistResume(parsed, originalDocxBytes);
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
