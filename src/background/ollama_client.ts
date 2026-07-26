// The only place a network request to Ollama is made from - see contract.ts
// for why this lives in the background service worker.
//
// A 403 here specifically means Ollama's own server-side Origin allowlist
// rejected the request (separate from, and not fixable via, browser CORS or
// this extension's host_permissions) - confirmed by directly testing this
// machine's Ollama instance with a chrome-extension:// Origin header, which
// returned exactly a 403 with an empty body. Every other non-ok status is a
// genuine reachability/server problem.
function explainOllamaError(baseUrl: string, resp: Response): string {
  if (resp.status === 403) {
    return (
      `Ollama at ${baseUrl} rejected this request (HTTP 403) because its OLLAMA_ORIGINS ` +
      `allowlist doesn't include this extension's origin. This is not a connectivity problem - ` +
      `Ollama is running and was reached. Fix: set the OLLAMA_ORIGINS environment variable to ` +
      `include this extension's chrome-extension:// origin (or "chrome-extension://*"), then fully ` +
      `quit and restart Ollama (not just close the window - the running process must restart to ` +
      `pick up the new setting). See the README for exact steps.`
    );
  }
  return `Ollama at ${baseUrl} returned an error: HTTP ${resp.status} ${resp.statusText}`;
}

export async function ollamaGenerate(baseUrl: string, model: string, prompt: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, format: "json", stream: false }),
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${baseUrl} - is it running? (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!resp.ok) throw new Error(explainOllamaError(baseUrl, resp));

  const data = (await resp.json()) as { response?: unknown };
  if (typeof data.response !== "string") {
    throw new Error("Ollama response missing a 'response' field");
  }
  return data.response;
}

export async function ollamaListModels(baseUrl: string): Promise<string[]> {
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET" });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${baseUrl} - is it running? (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!resp.ok) throw new Error(explainOllamaError(baseUrl, resp));

  const data = (await resp.json()) as { models?: Array<{ name?: unknown }> };
  return (data.models ?? [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === "string");
}
