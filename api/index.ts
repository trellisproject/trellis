// Vercel serverless entry (Node runtime). Adapts the Node (req,res) that
// Vercel passes into a Web Request the Hono app understands, and writes the
// Web Response back. hono/vercel is Edge-only; @hono/node-server dropped its
// vercel adapter in v2 — so we adapt inline (small, dependency-free).
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/app.js";

export const config = { runtime: "nodejs" };

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const host = req.headers.host ?? "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    const url = `${proto}://${host}${req.url ?? "/"}`;
    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;

    const request = new Request(url, {
      method,
      headers: req.headers as Record<string, string>,
      body: body && body.length > 0 ? body : undefined,
    });

    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Internal error", code: "INTERNAL", detail: e instanceof Error ? e.message : String(e) }));
  }
}
