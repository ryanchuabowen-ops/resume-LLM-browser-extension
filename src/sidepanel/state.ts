// Shared in-memory app state for the side panel, backed by chrome.storage.local
// for the parts that should survive the panel closing/reopening (resume,
// profile, settings). Job description and tailored-result stay in-memory
// only - they're per-tab-session data, not meant to persist indefinitely.
import type { JobPostingInput } from "../lib/job/types.ts";
import type { ResumeDocument } from "../lib/resume/models.ts";
import type { TailoredResume } from "../lib/resume/rewriter_base.ts";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../storage/binary.ts";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type AppSettings, type StoredResume, type UserProfile } from "../storage/schema.ts";
import { getProfile, getResume, getSettings, setProfile, setResume, setSettings } from "../storage/storage.ts";

export interface AppState {
  resume: ResumeDocument | null;
  resumeFileName: string | null;
  // Raw original .docx bytes, kept only for sourceFormat === "docx" -
  // needed by generate_output_docx.ts to attempt in-place editing. Null
  // for PDF sources and whenever storing them wasn't possible (see
  // persistResume's quota-fallback behavior below).
  originalDocxBytes: ArrayBuffer | null;
  job: JobPostingInput | null;
  jobExtractConfidence: "selector" | "fallback" | "none" | null;
  tailored: TailoredResume | null;
  profile: UserProfile;
  settings: AppSettings;
  generatedDocx: { blob: Blob; fileName: string } | null;
}

export const state: AppState = {
  resume: null,
  resumeFileName: null,
  originalDocxBytes: null,
  job: null,
  jobExtractConfidence: null,
  tailored: null,
  profile: DEFAULT_PROFILE,
  settings: DEFAULT_SETTINGS,
  generatedDocx: null,
};

export async function loadPersistedState(): Promise<void> {
  const [storedResume, profile, settings] = await Promise.all([getResume(), getProfile(), getSettings()]);
  if (storedResume) {
    state.resume = storedResume.document;
    state.resumeFileName = storedResume.document.sourceFileName;
    state.originalDocxBytes = storedResume.originalDocxBase64
      ? base64ToArrayBuffer(storedResume.originalDocxBase64)
      : null;
  }
  state.profile = profile;
  state.settings = settings;
}

export async function persistResume(resume: ResumeDocument, originalDocxBytes?: ArrayBuffer): Promise<void> {
  state.resume = resume;
  state.resumeFileName = resume.sourceFileName;
  state.originalDocxBytes = originalDocxBytes ?? null;

  const withBytes: StoredResume = {
    document: resume,
    parsedAt: new Date().toISOString(),
    originalDocxBase64: originalDocxBytes ? arrayBufferToBase64(originalDocxBytes) : undefined,
  };
  try {
    await setResume(withBytes);
  } catch (err) {
    // Most likely chrome.storage.local's quota, e.g. a heavily-styled
    // template with embedded images. Degrade to "parsed resume persists,
    // in-place editing unavailable for this file" rather than losing the
    // whole stored resume over it.
    if (!originalDocxBytes) throw err;
    console.warn("Could not persist original .docx bytes (quota?); saving parsed resume only.", err);
    state.originalDocxBytes = null;
    await setResume({ document: resume, parsedAt: withBytes.parsedAt });
  }
}

export async function persistProfile(profile: UserProfile): Promise<void> {
  state.profile = profile;
  await setProfile(profile);
}

export async function persistSettings(settings: AppSettings): Promise<void> {
  state.settings = settings;
  await setSettings(settings);
}
