const DEFAULT_URL = "https://mo-bi.ro/python_api";
const DEFAULT_TTL_MS = 30000;
const DEFAULT_STALE_TTL_MS = 120000;
const DEFAULT_TIMEOUT_MS = 4000;
const VEHICLE_PATH_RE = /^\/lines\/v2\/[^/]+\/vehicles\/[^/]+$/;

function numberValue(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textValue(value) {
  return value == null ? "" : String(value);
}

function identityKey(value) {
  const text = textValue(value).trim().toUpperCase();
  return /^\d+$/.test(text) && text !== "0" ? text : "";
}

function plateKey(value) {
  return textValue(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseTime(value) {
  const time = Date.parse(textValue(value));
  return Number.isFinite(time) ? time : null;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function configuredUrl(value) {
  const candidate = textValue(value || DEFAULT_URL).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_URL;
    return url.toString().replace(/\/$/, "");
  } catch (err) {
    return DEFAULT_URL;
  }
}

async function defaultRequestJson(url, timeoutMs) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ratb-proxy/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("mo-bi HTTP " + response.status);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function recordFrom(raw) {
  const vehicle = raw && raw.vehicle;
  const trip = vehicle && vehicle.trip;
  const identity = vehicle && vehicle.vehicle;
  const position = vehicle && vehicle.position;
  const passenger = vehicle && vehicle.passenger_info;
  const plate = textValue(identity && identity.license_plate);
  const externalId = identityKey(identity && identity.id);
  const code = plateKey(identity && identity.license_plate);
  if (!externalId && !code) return null;
  return {
    externalId,
    plate,
    plateKey: code,
    hardwareId: identityKey(identity && identity.th_id),
    routeId: numberValue(trip && trip.route_id),
    direction: numberValue(trip && trip.direction_id),
    tripStartTime: textValue(trip && trip.start_time) || null,
    sourceId: numberValue(raw && raw.src),
    sourceTimestamp: textValue(raw && raw.timestamp) || null,
    positionTimestamp: textValue(position && position.timestamp) || null,
    positionTime: parseTime(position && position.timestamp),
    passengerCount: numberValue(passenger && passenger.on_board),
    boarded: numberValue(passenger && passenger.in),
    alighted: numberValue(passenger && passenger.out),
    passengerTimestamp: textValue(passenger && passenger.timestamp) || null,
    passengerTime: parseTime(passenger && passenger.timestamp),
  };
}

function addIndex(index, key, record) {
  if (!key) return;
  const previous = index.get(key);
  if (!previous || (record.positionTime || 0) > (previous.positionTime || 0)) index.set(key, record);
}

function buildIndex(rows) {
  const byId = new Map();
  const byPlate = new Map();
  const byHardware = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const record = recordFrom(raw);
    if (!record) continue;
    addIndex(byId, record.externalId, record);
    addIndex(byPlate, record.plateKey, record);
    addIndex(byHardware, record.hardwareId, record);
  }
  return { byId, byPlate, byHardware };
}

function recordForVehicle(vehicle, index) {
  const id = identityKey(vehicle && vehicle.id);
  const code = plateKey(vehicle && (vehicle.code || vehicle.license_plate || vehicle.licensePlate));
  const hardware = identityKey(vehicle && (vehicle.th_id || vehicle.thId));
  const byId = id ? index.byId.get(id) : null;
  const byPlate = code ? index.byPlate.get(code) : null;
  const byHardware = hardware || (code && /^\d+$/.test(code) ? index.byHardware.get(code) : null);
  if (byId && byPlate && byId === byPlate) return { record: byId, matchedBy: "id+code" };
  if (byId && byHardware && byId === byHardware) return { record: byId, matchedBy: "id+hardware" };
  if (byPlate) return { record: byPlate, matchedBy: "code" };
  if (byHardware) return { record: byHardware, matchedBy: "hardware" };
  if (byId) return { record: byId, matchedBy: "id" };
  return null;
}

function ageSeconds(time, now) {
  return time == null ? null : Math.max(0, Math.floor((now - time) / 1000));
}

function enrichmentFor(record, now) {
  const passengerAge = ageSeconds(record.passengerTime, now);
  const positionAge = ageSeconds(record.positionTime, now);
  return {
    source: "mo-bi.ro",
    licensePlate: record.plate || null,
    passengerCount: record.passengerCount,
    boarded: record.boarded,
    alighted: record.alighted,
    passengerTimestamp: record.passengerTimestamp,
    passengerAgeSeconds: passengerAge,
    positionTimestamp: record.positionTimestamp,
    positionAgeSeconds: positionAge,
    sourceTimestamp: record.sourceTimestamp,
    sourceId: record.sourceId,
    routeId: record.routeId,
    direction: record.direction,
    tripStartTime: record.tripStartTime,
    matchedBy: null,
  };
}

function createVehicleEnricher(options) {
  const config = options || {};
  const url = configuredUrl(config.url);
  const ttlMs = boundedNumber(config.ttlMs, DEFAULT_TTL_MS, 10000, 3600000);
  const staleTtlMs = boundedNumber(config.staleTtlMs, DEFAULT_STALE_TTL_MS, ttlMs, 3600000);
  const timeoutMs = boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 30000);
  const requestJson = config.requestJson || defaultRequestJson;
  let index = { byId: new Map(), byPlate: new Map(), byHardware: new Map() };
  let fetchedAt = 0;
  let lastAttemptAt = 0;
  let inFlight = null;

  function prime() {
    const now = Date.now();
    if (inFlight) return inFlight;
    if (lastAttemptAt && now - lastAttemptAt < ttlMs) return Promise.resolve(index);
    inFlight = Promise.resolve()
      .then(() => requestJson(url, timeoutMs))
      .then((rows) => {
        index = buildIndex(rows);
        fetchedAt = Date.now();
        lastAttemptAt = fetchedAt;
        return index;
      })
      .catch(() => {
        lastAttemptAt = Date.now();
        if (fetchedAt && Date.now() - fetchedAt < staleTtlMs) return index;
        index = { byId: new Map(), byPlate: new Map(), byHardware: new Map() };
        fetchedAt = 0;
        return index;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function enrichVehicleResponse(payload, pathname) {
    if (!VEHICLE_PATH_RE.test(String(pathname || "").split("?")[0])) return payload;
    if (!payload || !Array.isArray(payload.vehicles)) return payload;
    if (!fetchedAt) {
      prime();
      return payload;
    }
    prime();
    const currentIndex = index;
    const now = Date.now();
    return {
      ...payload,
      vehicles: payload.vehicles.map((vehicle) => {
        const match = recordForVehicle(vehicle, currentIndex);
        if (!match) return vehicle;
        return {
          ...vehicle,
          mobi: { ...enrichmentFor(match.record, now), matchedBy: match.matchedBy },
        };
      }),
    };
  }

  return { enrichVehicleResponse, prime };
}

module.exports = { createVehicleEnricher, normalize: { identityKey, plateKey } };
