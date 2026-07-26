// src/background/ollama_client.ts
function explainOllamaError(baseUrl, resp) {
  if (resp.status === 403) {
    return `Ollama at ${baseUrl} rejected this request (HTTP 403) because its OLLAMA_ORIGINS allowlist doesn't include this extension's origin. This is not a connectivity problem - Ollama is running and was reached. Fix: set the OLLAMA_ORIGINS environment variable to include this extension's chrome-extension:// origin (or "chrome-extension://*"), then fully quit and restart Ollama (not just close the window - the running process must restart to pick up the new setting). See the README for exact steps.`;
  }
  return `Ollama at ${baseUrl} returned an error: HTTP ${resp.status} ${resp.statusText}`;
}
async function ollamaGenerate(baseUrl, model, prompt) {
  let resp;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, format: "json", stream: false })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${baseUrl} - is it running? (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!resp.ok) throw new Error(explainOllamaError(baseUrl, resp));
  const data = await resp.json();
  if (typeof data.response !== "string") {
    throw new Error("Ollama response missing a 'response' field");
  }
  return data.response;
}
async function ollamaListModels(baseUrl) {
  let resp;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET" });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${baseUrl} - is it running? (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!resp.ok) throw new Error(explainOllamaError(baseUrl, resp));
  const data = await resp.json();
  return (data.models ?? []).map((m) => m.name).filter((name) => typeof name === "string");
}

// src/background/index.ts
console.log("[job-tailor] background service worker started");
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OLLAMA_LIST_MODELS") {
    ollamaListModels(message.baseUrl).then((models) => sendResponse({ models })).catch(
      (err) => sendResponse({ error: err instanceof Error ? err.message : String(err) })
    );
    return true;
  }
  if (message.type === "OLLAMA_GENERATE") {
    ollamaGenerate(message.baseUrl, message.model, message.prompt).then((rawText) => sendResponse({ rawText })).catch(
      (err) => sendResponse({ error: err instanceof Error ? err.message : String(err) })
    );
    return true;
  }
  return false;
});
//# sourceMappingURL=background.js.map
