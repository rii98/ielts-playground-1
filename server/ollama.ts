import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.ts";

// Loads .env once (Node 20.12+). Values already set in the environment win.
let envLoaded = false;
export function settings() {
  if (!envLoaded) {
    envLoaded = true;
    const file = join(ROOT, ".env");
    if (existsSync(file)) process.loadEnvFile(file);
  }
  return {
    key: process.env.OLLAMA_API_KEY?.trim() ?? "",
    model: process.env.OLLAMA_MODEL?.trim() || "gemma4:31b-cloud",
    baseUrl: (process.env.OLLAMA_BASE_URL?.trim() || "https://ollama.com").replace(/\/+$/, ""),
  };
}

export interface ChatInput {
  system: string;
  user: string;
  /** Base64 images (no data: prefix), attached to the user message. */
  images?: string[];
}

/** One chat call to Ollama. Returns the model's reply exactly as it came back. */
export async function chat(input: ChatInput): Promise<{ text: string; model: string }> {
  const s = settings();
  if (!s.key) throw new Error("No Ollama key yet. Ask Claude to run /setup.");

  const messages = [
    ...(input.system.trim() ? [{ role: "system", content: input.system }] : []),
    { role: "user", content: input.user, ...(input.images?.length ? { images: input.images } : {}) },
  ];

  const res = await fetch(`${s.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.key}` },
    body: JSON.stringify({ model: s.model, stream: false, messages }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new Error("Ollama didn't accept the key. Check OLLAMA_API_KEY in .env.");
    if (res.status === 429) throw new Error("Too many requests to Ollama. Wait a minute and try again.");
    throw new Error(`Ollama error ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return { text: json.message?.content ?? "", model: s.model };
}
