import type {
  BackgroundRequest,
  OllamaGenerateResponse,
  OllamaListModelsResponse,
} from "../lib/messaging/contract.ts";
import { ollamaGenerate, ollamaListModels } from "./ollama_client.ts";

console.log("[job-tailor] background service worker started");

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message.type === "OLLAMA_LIST_MODELS") {
    ollamaListModels(message.baseUrl)
      .then((models) => sendResponse({ models } satisfies OllamaListModelsResponse))
      .catch((err) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) } satisfies OllamaListModelsResponse),
      );
    return true; // keep the message channel open for the async response
  }

  if (message.type === "OLLAMA_GENERATE") {
    ollamaGenerate(message.baseUrl, message.model, message.prompt)
      .then((rawText) => sendResponse({ rawText } satisfies OllamaGenerateResponse))
      .catch((err) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) } satisfies OllamaGenerateResponse),
      );
    return true;
  }

  return false;
});
