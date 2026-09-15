const UPSTREAM_HOST = "info.stb.ro";
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;
const UPSTREAM_API_PATH = "/api/web/v2-6";
const PROXY_PATH = "/api";

const HOP_HEADERS = new Set([
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

function buildProxyHeaders(incomingHeaders) {
  const headers = new Headers();
  for (const [key, value] of incomingHeaders.entries()) {
    if (!HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set("host", UPSTREAM_HOST);
  return headers;
}

function filterResponseHeaders(upstreamHeaders) {
  const headers = new Headers();
  for (const [key, value] of upstreamHeaders.entries()) {
    if (!HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  if (!headers.has("access-control-allow-origin")) {
    headers.set("access-control-allow-origin", "*");
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(PROXY_PATH + "/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": request.headers.get("access-control-request-headers") || "*",
            "access-control-max-age": "86400",
          },
        });
      }

      const upstreamPath = url.pathname.slice(PROXY_PATH.length);
      const upstreamUrl = new URL(UPSTREAM_API_PATH + upstreamPath + url.search, UPSTREAM_ORIGIN);
      const upstreamHeaders = buildProxyHeaders(request.headers);
      const hasBody = !["GET", "HEAD"].includes(request.method);

      try {
        const upstreamResponse = await fetch(upstreamUrl.toString(), {
          method: request.method,
          headers: upstreamHeaders,
          body: hasBody ? request.body : null,
          redirect: "follow",
        });

        const respHeaders = filterResponseHeaders(upstreamResponse.headers);

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: respHeaders,
        });
      } catch (err) {
        return new Response("upstream error: " + err.message, {
          status: 502,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
