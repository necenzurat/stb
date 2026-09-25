import authApi from "./upstream-auth.js";
import protobufApi from "./protobuf.js";
import vehicleEnrichmentApi from "./vehicle-enrichment.js";

const { createUpstreamCredentials } = authApi;
const { decodeProtobufResponse, isProtobufContentType, isProtobufPath } = protobufApi;
const { createVehicleEnricher } = vehicleEnrichmentApi;

const UPSTREAM_HOST = "info.stb.ro";
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;
const UPSTREAM_API_PATH = "/api/web/v2-6";
const PROXY_PATH = "/api";
let credentials;
let vehicleEnricher;

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

function requestAuth(headers) {
  return fetch(new URL(UPSTREAM_API_PATH + "/proxy/user/auth", UPSTREAM_ORIGIN).toString(), {
    method: "GET",
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!vehicleEnricher) {
      vehicleEnricher = createVehicleEnricher({
        url: env.MOBI_API_URL,
        ttlMs: env.MOBI_CACHE_TTL_MS,
        staleTtlMs: env.MOBI_STALE_TTL_MS,
        timeoutMs: env.MOBI_TIMEOUT_MS,
      });
      vehicleEnricher.prime();
    }

    if (url.pathname.startsWith(PROXY_PATH + "/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": "Content-Type",
            "access-control-max-age": "86400",
          },
        });
      }

      const upstreamPath = url.pathname.slice(PROXY_PATH.length);
      const upstreamUrl = new URL(UPSTREAM_API_PATH + upstreamPath + url.search, UPSTREAM_ORIGIN);
      const isAuthRequest = upstreamPath === "/proxy/user/auth";
      const hasBody = !["GET", "HEAD"].includes(request.method);
      const body = hasBody ? await request.clone().arrayBuffer() : null;
      const contentType = request.headers.get("content-type");
      const extraHeaders = hasBody && contentType ? { "content-type": contentType } : {};
      if (!credentials) credentials = createUpstreamCredentials(env);
      const getHeaders = async () => new Headers(await credentials.getHeaders(requestAuth, !isAuthRequest, extraHeaders));
      const send = (headers) =>
        fetch(upstreamUrl.toString(), {
          method: request.method,
          headers,
          body: hasBody ? body.slice(0) : null,
          redirect: "follow",
        });

      try {
        let upstreamResponse = await send(await getHeaders());
        if (!isAuthRequest && (upstreamResponse.status === 401 || upstreamResponse.status === 412)) {
          credentials.invalidate();
          upstreamResponse = await send(await getHeaders());
        }

        const respHeaders = filterResponseHeaders(upstreamResponse.headers);
        const canDecode =
          isProtobufPath(upstreamPath) &&
          upstreamResponse.ok &&
          isProtobufContentType(upstreamResponse.headers.get("content-type"));

        if (canDecode) {
          try {
            let value = decodeProtobufResponse(upstreamPath, await upstreamResponse.arrayBuffer());
            try {
              value = await vehicleEnricher.enrichVehicleResponse(value, upstreamPath);
            } catch (err) {}
            respHeaders.set("content-type", "application/json; charset=utf-8");
            respHeaders.delete("content-encoding");
            respHeaders.delete("content-length");
            return new Response(JSON.stringify(value), {
              status: upstreamResponse.status,
              statusText: upstreamResponse.statusText,
              headers: respHeaders,
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: "invalid protobuf response" }), {
              status: 502,
              headers: {
                "access-control-allow-origin": "*",
                "content-type": "application/json; charset=utf-8",
              },
            });
          }
        }

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
