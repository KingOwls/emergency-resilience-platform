import http from "node:http";
import { URL } from "node:url";
import { route } from "../app.mjs";
import { errorResponse, parseJson } from "./http.mjs";
import { log } from "./log.mjs";

export function startServer({ port = 3000, onStarted } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      const result = await route({
        method: req.method || "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: parseJson(raw),
      });
      res.writeHead(result.status, result.headers);
      res.end(JSON.stringify(result.body));
    } catch (error) {
      log("error", "request_failed", { path: url.pathname, error: error?.message });
      const result = errorResponse(error);
      res.writeHead(result.status, result.headers);
      res.end(JSON.stringify(result.body));
    }
  });
  server.listen(port, "0.0.0.0", () => {
    log("info", "service_started", { port });
    onStarted?.();
  });
  return server;
}
