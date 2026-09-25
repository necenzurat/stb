const DEFAULT_APP_KEY = "gcALgRyZHC,qFonZ=Jde";
const BASE_HEADERS = Object.freeze({
  "OS-Type": "Web",
  "App-Version": "2.6.0",
  "Device-Name": "ratb-proxy",
  "OS-Version": "server",
  Lang: "ro",
  Source: "ro.radcom.smartcity.web",
});

function randomId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function responseJson(response) {
  if (response && typeof response.json === "function") return response.json();
  const text = response && typeof response.text === "function" ? await response.text() : "";
  return text ? JSON.parse(text) : null;
}

function createUpstreamCredentials(runtimeEnv) {
  const env = runtimeEnv || {};
  const appKey = env.STB_APP_KEY || DEFAULT_APP_KEY;
  let appId = env.STB_APP_ID || randomId();
  let userInfo = env.STB_USER_INFO || "";
  let authPromise = null;

  function baseHeaders(extra) {
    return { ...(extra || {}), ...BASE_HEADERS, "App-Id": appId };
  }

  async function authenticate(fetchAuth) {
    if (userInfo) return userInfo;
    if (!authPromise) {
      authPromise = Promise.resolve()
        .then(() => fetchAuth(baseHeaders({ "App-key": appKey })))
        .then(async (response) => {
          if (!response || response.ok === false) {
            throw new Error("authentication failed" + (response && response.status ? " (" + response.status + ")" : ""));
          }
          const data = await responseJson(response);
          const token = data && data.data && data.data.userInfo;
          if (!token) throw new Error("authentication response missing userInfo");
          userInfo = token;
          return token;
        })
        .finally(() => {
          authPromise = null;
        });
    }
    return authPromise;
  }

  async function getHeaders(fetchAuth, includeUserInfo, extra) {
    const headers = baseHeaders(extra);
    if (includeUserInfo !== false) headers["User-Info"] = await authenticate(fetchAuth);
    return headers;
  }

  function invalidate() {
    userInfo = "";
    authPromise = null;
  }

  return { getHeaders, invalidate };
}

module.exports = { createUpstreamCredentials };
