// Message-sending helpers - the only place the side panel talks to
// background/content. Content-script messages try sending directly first
// (works if a content script from a prior action this session is already
// injected in the tab) and only inject on demand if that fails, avoiding
// double-injection from re-injecting on every click.
import type {
  AutofillFormRequest,
  AutofillResult,
  ContentRequest,
  ExtractJobDescriptionResult,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaListModelsRequest,
  OllamaListModelsResponse,
} from "../lib/messaging/contract.ts";

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found - open a job page first");
  if (!/^https?:/.test(tab.url ?? "")) {
    throw new Error("This only works on a real web page (not a chrome:// or extension page)");
  }
  return tab.id;
}

async function sendToActiveTab<TResponse>(message: ContentRequest): Promise<TResponse> {
  const tabId = await getActiveTabId();
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

export function extractJobDescriptionFromActiveTab(): Promise<ExtractJobDescriptionResult> {
  return sendToActiveTab({ type: "EXTRACT_JOB_DESCRIPTION" });
}

export function autofillActiveTab(request: Omit<AutofillFormRequest, "type">): Promise<AutofillResult> {
  return sendToActiveTab({ type: "AUTOFILL_FORM", ...request });
}

export async function ollamaListModels(baseUrl: string): Promise<string[]> {
  const request: OllamaListModelsRequest = { type: "OLLAMA_LIST_MODELS", baseUrl };
  const response = (await chrome.runtime.sendMessage(request)) as OllamaListModelsResponse;
  if ("error" in response) throw new Error(response.error);
  return response.models;
}

export async function ollamaGenerate(baseUrl: string, model: string, prompt: string, system?: string): Promise<string> {
  const request: OllamaGenerateRequest = { type: "OLLAMA_GENERATE", baseUrl, model, prompt, system };
  const response = (await chrome.runtime.sendMessage(request)) as OllamaGenerateResponse;
  if ("error" in response) throw new Error(response.error);
  return response.rawText;
}
