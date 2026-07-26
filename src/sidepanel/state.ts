// Shared in-memory app state for the side panel, backed by chrome.storage.local
// for the parts that should survive the panel closing/reopening (resume,
// profile, settings). Job description and tailored-result stay in-memory
// only - they're per-tab-session data, not meant to persist indefinitely.
import type { JobPostingInput } from "../lib/job/types.ts";
import type { ResumeDocument } from "../lib/resume/models.ts";
import type { TailoredResume } from "../lib/resume/rewriter_base.ts";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type AppSettings, type UserProfile } from "../storage/schema.ts";
import { getProfile, getResume, getSettings, setProfile, setResume, setSettings } from "../storage/storage.ts";

export interface AppState {
  resume: ResumeDocument | null;
  resumeFileName: string | null;
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
  }
  state.profile = profile;
  state.settings = settings;
}

export async function persistResume(resume: ResumeDocument): Promise<void> {
  state.resume = resume;
  state.resumeFileName = resume.sourceFileName;
  await setResume({ document: resume, parsedAt: new Date().toISOString() });
}

export async function persistProfile(profile: UserProfile): Promise<void> {
  state.profile = profile;
  await setProfile(profile);
}

export async function persistSettings(settings: AppSettings): Promise<void> {
  state.settings = settings;
  await setSettings(settings);
}
