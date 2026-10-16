import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

// The page's small backend lives in server/api.ts and is served by the same dev
// server, so `npm run dev` is the only command. It is reloaded on every request,
// so edits to server/ apply without a restart.
function api(): Plugin {
  return {
    name: "playground-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api", (req, res) => void handle(server, req, res));
    },
  };
}

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  try {
    const mod = (await server.ssrLoadModule("/server/api.ts")) as typeof import("./server/api.ts");
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : undefined;
    const out = await mod.route(url.pathname, url.searchParams, body);
    if (out instanceof Uint8Array) {
      res.setHeader("content-type", "image/png");
      res.end(out);
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default defineConfig({ plugins: [react(), api()] });
