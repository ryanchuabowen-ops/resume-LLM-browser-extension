// Discriminated-union message types shared by background/content/sidepanel,
// so message handlers get TypeScript exhaustiveness checking.
import type { UserProfile } from "../../storage/schema.ts";

// --- Side panel <-> background: Ollama network calls -----------------------
// Background owns ONLY the raw HTTP call - prompt building, response
// parsing, merging, and the numeric-fabrication guard all live in
// lib/resume/rewriter_ollama.ts and run in the side panel. Background is
// kept deliberately dumb: a local-LLM generate call can take tens of
// seconds to minutes, and centralizing just the fetch() in the background
// service worker means the request survives the side panel being closed
// mid-request, which a panel-initiated fetch would not.
export interface OllamaListModelsRequest {
  type: "OLLAMA_LIST_MODELS";
  baseUrl: string;
}
export type OllamaListModelsResponse = { models: string[] } | { error: string };

export interface OllamaGenerateRequest {
  type: "OLLAMA_GENERATE";
  baseUrl: string;
  model: string;
  prompt: string;
}
export type OllamaGenerateResponse = { rawText: string } | { error: string };

export type BackgroundRequest = OllamaListModelsRequest | OllamaGenerateRequest;

// --- Side panel <-> content script: job description + autofill -------------
export interface ExtractJobDescriptionRequest {
  type: "EXTRACT_JOB_DESCRIPTION";
}
export interface ExtractJobDescriptionResult {
  title: string;
  company: string;
  description: string;
  confidence: "selector" | "fallback" | "none";
}

export interface AutofillFormRequest {
  type: "AUTOFILL_FORM";
  profile: UserProfile;
  resumeFile?: { buffer: ArrayBuffer; fileName: string; mimeType: string };
}
export interface AutofillResult {
  filled: string[];
  unmappedLabels: string[];
  errors: string[];
  resumeUploaded: boolean;
}

export type ContentRequest = ExtractJobDescriptionRequest | AutofillFormRequest;
