#!/usr/bin/env node
// Local server for the UI: serves ui/ and lets the "Refresh data" button run `npm run scrape`.
// Listens on 127.0.0.1 only. No dependencies beyond Node itself.
//
// Usage: npm start            (then open http://localhost:4173)
//        PORT=8080 npm start
//
// API:
//   GET  /api/scrape   status of the current or last scrape: { running, startedAt, finishedAt, exitCode, log }
//   POST /api/scrape   start a scrape (409 if one is already running)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./output.js";

const PORT = Number(process.env.PORT) || 4173;
const HOST = "127.0.0.1";
const UI_DIR = path.join(ROOT, "ui");
const LOG_LINES_KEPT = 200;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** State of the current (or most recent) scrape run. */
let job = { running: false, startedAt: null, finishedAt: null, exitCode: null, log: [] };

function appendLog(chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  job.log.push(...lines);
  if (job.log.length > LOG_LINES_KEPT) job.log.splice(0, job.log.length - LOG_LINES_KEPT);
  for (const l of lines) console.log(`  [scrape] ${l}`);
}

function startScrape() {
  job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, log: [] };
  const child = spawn(process.execPath, [path.join(ROOT, "scraper", "scrape.js")], { cwd: ROOT });
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  const finish = (code) => {
    if (!job.running) return;
    job.running = false;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    console.log(`Scrape finished with exit code ${code}.`);
  };
  child.on("error", (err) => {
    appendLog(`Could not start the scraper: ${err.message}`);
    finish(1);
  });
  child.on("close", (code) => finish(code ?? 1));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Only accept POSTs from this server's own pages, so other websites can't trigger a scrape.
 * The Host allowlist also blocks DNS-rebinding (a foreign hostname resolving to 127.0.0.1).
 */
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !LOCAL_HOSTS.has(req.headers.host)) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(UI_DIR, "." + rel);
  if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    // no-store so a reload after a scrape always picks up the new data.js.
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : buf);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || HOST}`);

  if (pathname === "/api/scrape") {
    if (req.method === "GET") return sendJson(res, 200, job);
    if (req.method === "POST") {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: "Cross-origin request refused" });
      if (job.running) return sendJson(res, 409, { error: "A scrape is already running", ...job });
      console.log("Starting scrape (requested from the UI) ...");
      startScrape();
      return sendJson(res, 202, job);
    }
    res.writeHead(405, { Allow: "GET, POST" }).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  serveStatic(req, res, pathname);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is in use. Try: PORT=${PORT + 1} npm start`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Guidelines Explorer running at http://localhost:${PORT}  (Ctrl+C to stop)`);
});
