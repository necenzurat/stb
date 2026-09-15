"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PORT = Number(process.env.PORT) || 8001;
const UPSTREAM_HOST = "info.stb.ro";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function filterHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || HOP.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function proxyApi(req, res) {
  const upstream = https.request(
    {
      hostname: UPSTREAM_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...filterHeaders(req.headers), host: UPSTREAM_HOST },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, filterHeaders(upRes.headers));
      upRes.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("upstream error: " + err.message);
  });
  req.pipe(upstream);
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent((urlPath.split("?")[0] || "/"));
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) return null;
  return abs;
}

function servePublic(req, res) {
  const filePath = safePublicPath(req.url || "/");
  if (!filePath) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad path");
    return;
  }
  fs.stat(filePath, (err, st) => {
    const target = !err && st.isDirectory() ? path.join(filePath, "index.html") : filePath;
    fs.readFile(target, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }
  servePublic(req, res);
});

server.listen(PORT, () => {
  console.log("http://localhost:" + PORT);
});
