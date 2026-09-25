"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const {
  decodeProtobufResponse,
  isProtobufContentType,
  isProtobufPath,
} = require("./src/protobuf");
const { createUpstreamCredentials } = require("./src/upstream-auth");
const { createVehicleEnricher } = require("./src/vehicle-enrichment");

const PORT = Number(process.env.PORT) || 8001;
const UPSTREAM_HOST = "info.stb.ro";
const UPSTREAM_API_PATH = "/api/web/v2-6";
const PROXY_PATH = "/api";
const PUBLIC_DIR = path.join(__dirname, "public");
const credentials = createUpstreamCredentials(process.env);
const vehicleEnricher = createVehicleEnricher({
  url: process.env.MOBI_API_URL,
  ttlMs: process.env.MOBI_CACHE_TTL_MS,
  staleTtlMs: process.env.MOBI_STALE_TTL_MS,
  timeoutMs: process.env.MOBI_TIMEOUT_MS,
});

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

function upstreamPathFromUrl(url) {
  try {
    return new URL(url || "/", "http://localhost").pathname.slice(PROXY_PATH.length) || "/";
  } catch (err) {
    return "/";
  }
}

function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function requestUpstream(options) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers, host: UPSTREAM_HOST, "accept-encoding": "identity" };
    if (options.body && options.body.length) headers["content-length"] = String(options.body.length);
    const upstream = https.request(
      {
        hostname: UPSTREAM_HOST,
        port: 443,
        path: options.path,
        method: options.method,
        headers,
      },
      (upRes) => {
        const chunks = [];
        upRes.on("data", (chunk) => chunks.push(chunk));
        upRes.on("end", () => resolve({ status: upRes.statusCode || 502, headers: upRes.headers, body: Buffer.concat(chunks) }));
        upRes.on("error", reject);
      }
    );
    upstream.on("error", reject);
    if (options.body && options.body.length) upstream.write(options.body);
    upstream.end();
  });
}

async function requestAuth(headers) {
  const result = await requestUpstream({
    method: "GET",
    path: UPSTREAM_API_PATH + "/proxy/user/auth",
    headers,
  });
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    json: async () => JSON.parse(result.body.toString("utf8")),
  };
}

function sendUpstreamError(res, err) {
  if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
  res.end("upstream error: " + err.message);
}

function sendDecodeError(res) {
  if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "invalid protobuf response" }));
}

async function sendUpstreamResponse(res, upstreamPath, result) {
  const responseHeaders = filterHeaders(result.headers);
  const canDecode =
    isProtobufPath(upstreamPath) &&
    result.status >= 200 &&
    result.status < 300 &&
    isProtobufContentType(result.headers["content-type"]);
  if (!canDecode) {
    res.writeHead(result.status, responseHeaders);
    res.end(result.body);
    return;
  }
  try {
    let value = decodeProtobufResponse(upstreamPath, result.body);
    try {
      value = await vehicleEnricher.enrichVehicleResponse(value, upstreamPath);
    } catch (err) {}
    responseHeaders["content-type"] = "application/json; charset=utf-8";
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
    res.writeHead(result.status, responseHeaders);
    res.end(JSON.stringify(value));
  } catch (err) {
    sendDecodeError(res);
  }
}

async function proxyApi(req, res) {
  const upstreamPath = upstreamPathFromUrl(req.url);
  const isAuthRequest = upstreamPath === "/proxy/user/auth";
  const requestPath = UPSTREAM_API_PATH + req.url.slice(PROXY_PATH.length);
  try {
    const body = await readRequestBody(req);
    const contentType = req.headers["content-type"];
    const extraHeaders = body.length && contentType ? { "content-type": contentType } : {};
    const getHeaders = () => credentials.getHeaders(requestAuth, !isAuthRequest, extraHeaders);
    let result = await requestUpstream({ method: req.method, path: requestPath, headers: await getHeaders(), body });
    if (!isAuthRequest && (result.status === 401 || result.status === 412)) {
      credentials.invalidate();
      result = await requestUpstream({ method: req.method, path: requestPath, headers: await getHeaders(), body });
    }
    await sendUpstreamResponse(res, upstreamPath, result);
  } catch (err) {
    sendUpstreamError(res, err);
  }
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
  if (url.startsWith(PROXY_PATH + "/")) {
    proxyApi(req, res);
    return;
  }
  servePublic(req, res);
});

server.listen(PORT, () => {
  console.log("http://localhost:" + PORT);
});
