// chrome.storage.local schema. Port of job-agent/user_profile/models.py + store.py.
import type { ResumeDocument } from "../lib/resume/models.js";

export interface EeoAnswers {
  gender: string;
  raceEthnicity: string;
  veteranStatus: string;
  disabilityStatus: string;
}

export interface UserProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  portfolioUrl: string;
  githubUrl: string;
  workAuthorization: string;
  requiresSponsorship: string;
  defaultEeoAnswers: EeoAnswers;
}

export const DEFAULT_PROFILE: UserProfile = {
  fullName: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  linkedinUrl: "",
  portfolioUrl: "",
  githubUrl: "",
  workAuthorization: "",
  requiresSponsorship: "",
  defaultEeoAnswers: {
    gender: "Decline to answer",
    raceEthnicity: "Decline to answer",
    veteranStatus: "Decline to answer",
    disabilityStatus: "Decline to answer",
  },
};

export interface AppSettings {
  rewriterBackend: "rule_based" | "ollama";
  // Separate from rewriterBackend so tailoring and job-query generation can
  // use different backends, sharing the same Ollama connection config below.
  jobSearchBackend: "rule_based" | "ollama";
  ollama: { baseUrl: string; model: string };
}

export const DEFAULT_SETTINGS: AppSettings = {
  rewriterBackend: "rule_based",
  jobSearchBackend: "rule_based",
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "mistral-nemo:latest" },
};

export interface StoredResume {
  document: ResumeDocument;
  parsedAt: string;
}

export interface StorageSchema {
  resume?: StoredResume;
  profile?: UserProfile;
  settings?: AppSettings;
}
