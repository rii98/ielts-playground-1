import { chat } from "./ollama.ts";

// `npm run ping` — checks the Ollama key and model work. Never prints the key.
try {
  const started = Date.now();
  const { model } = await chat({ system: "", user: "Say OK." });
  console.log(`✓ Ollama works (${model}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
