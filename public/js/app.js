    const BASE = "/api";
    const CITY = { lat: 44.4353308, lng: 26.0996553 };
    const MAP_THEME = Object.freeze({
      land: "#12232d",
      water: "#0b355d",
      park: "#12382f",
      residential: "#172a33",
      building: "#182a33",
      buildingEdge: "#2a414d",
      road: "#405866",
      majorRoad: "#718894",
      motorway: "#9bb1ba",
      rail: "#395765",
      label: "#d8e4e9",
      labelDim: "#91a7b1",
      halo: "#12232d",
      routeFallback: "#4b9bd8",
      routeCasing: "#d8e4e9",
      stop: "#5aa9ff",
      user: "#54a9ff",
    });
    const LIGHT_MAP_THEME = Object.freeze({
      land: "#f3f5f6",
      label: "#243746",
      halo: "#ffffff",
      routeFallback: "#1769aa",
      routeCasing: "#ffffff",
      stop: "#1769aa",
      user: "#0a78c2",
    });
    const MAP_STYLES = Object.freeze({
      dark: Object.freeze({
        label: "Întunecat",
        url: "https://tiles.openfreemap.org/styles/dark",
        overlay: MAP_THEME,
        customizeBase: true,
      }),
      light: Object.freeze({
        label: "Clar",
        url: "https://tiles.openfreemap.org/styles/positron",
        overlay: LIGHT_MAP_THEME,
        customizeBase: false,
      }),
    });

    const MODE_COLORS = Object.freeze({
      BUS: "#4b9bff",
      TROLLEYBUS: "#37c7b4",
      TRAM: "#ffb84d",
      SUBWAY: "#b58cff",
      TRAIN: "#ff7396",
      FERRY: "#58d2ff",
      WALK: "#a7b5bf",
      OTHER: "#c7d0d6",
    });

    // Map zoom configuration
    const MAP_ZOOM = Object.freeze({
      initial: 16,
      minimum: 10,
      maximum: 18,
      fitBoundsMaximum: 14,
      routeOverviewReduction: 3,
      userLocationReduction: 3,
    });

    // Below this many seconds an arrival reads as "now" rather than a countdown.
    const ARRIVAL_NOW_SECONDS = 45;

    const NEAREST_STOPS = 15;
    const VEHICLE_POLL_MS = 5000;
    const LS_FAV = "favLines";
    const LS_MAP_STYLE = "mapStyle";
    const hudEl = document.getElementById("hud");
    const nearbyView = document.getElementById("nearbyView");
    const lineView = document.getElementById("lineView");
    const linePageEl = document.getElementById("linePage");
    const lineFootEl = document.getElementById("lineFoot");
    const lineBarRoute = document.getElementById("lineBarRoute");
    const statusEl = document.getElementById("status");
    const backBtn = document.getElementById("backBtn");
    const linesCountEl = document.getElementById("linesCount");
    const linesListEl = document.getElementById("linesList");
    const gripEl = document.getElementById("grip");
    const chipsEl = document.getElementById("chips");
    const searchInput = document.getElementById("searchInput");
    const searchClear = document.getElementById("searchClear");
    const clockEl = document.getElementById("clock");
    const clockDateEl = document.getElementById("clockDate");
    const hudFeedEl = document.getElementById("hudFeed");
    const hudFeedLabelEl = document.getElementById("hudFeedLabel");

    const FILTERS = [
      { key: "all", label: "Toate" },
      { key: "BUS", label: "Autobuz" },
      { key: "TRAM", label: "Tramvai" },
      { key: "CABLE_CAR", label: "Troleibuz" },
      { key: "SUBWAY", label: "Metrou" },
      { key: "saved", label: "★ Salvate", saved: true },
    ];
    let activeType = "all";
    let searchResults = null;
    let searchTimer = null;
    let searchGen = 0;
    let detailDir = 0;
    let detailDetail = null;
    let dirStops = { 0: [], 1: [] };
    let lineStopPack = undefined;
    let dirTouched = false;
    // Stop list: pinned means the nearest stop is kept as the first visible row;
    // once the rider scrolls the list themselves, their position wins.
    let stopListPinned = true;
    let stopListScroll = 0;
    let stopListEl = null;

    let userLngLat = null;
    let vehicleMarkers = [];
    let vehicleMarkerMap = new Map();
    let stopPopup = null;
    let stopPopupHandle = null;
    let map;
    let mapStyleId = "dark";
    let mapStyleControl = null;
    let mapStyleLoading = false;
    let overlayHandlersReady = false;
    let overlaysReady = false;
    const mapSourceData = new Map();
    let fittedOnce = false;
    let fetchGen = 0;
    let nearbyGen = 0;
    let vehicleGen = 0;
    let moveTimer;
    let vehicleTimer = null;
    let lastStops = [];
    let lastPlottedVehicles = [];
    const stopInfoCache = new Map();
    const stopTimetableCache = new Map();
    const lineDirCache = new Map();
    let nearbyLines = [];
    let selectedLineId = null;
    let selectedLine = null;
    let selectedVehicleKey = null;
    let pathStopsOverride = null;
    let drawingLine = false;
    let dirPaths = { 0: [], 1: [] };

    function setFeedState(kind) {
      const state = kind === "ok" ? "live" : kind === "warn" ? "warn" : kind === "err" ? "error" : "sync";
      const label = state === "live" ? "LIVE" : state === "warn" ? "ATENȚIE" : state === "error" ? "EROARE" : "SYNC";
      hudFeedEl.className = "hud-feed is-" + state;
      hudFeedLabelEl.textContent = label;
    }

    function setStatus(msg, kind) {
      statusEl.textContent = msg;
      statusEl.className = "hud-status" + (kind ? " " + kind : "");
      setFeedState(kind);
    }

    function clearLegacyAuth() {
      try {
        localStorage.removeItem("appId");
        localStorage.removeItem("userInfo");
      } catch (err) {}
    }

    function bufText(buf) {
      return new TextDecoder().decode(buf);
    }

    async function apiFetch(path) {
      const res = await fetch(BASE + path);
      const buf = await res.arrayBuffer();
      if (!res.ok) {
        const err = new Error(path + " " + res.status);
        err.status = res.status;
        err.body = bufText(buf);
        throw err;
      }
      return buf;
    }

    function parseBoundsPath(bounds) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      return [sw.lat, sw.lng, ne.lat, ne.lng].join("/");
    }

    function prefersReducedMotion() {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function emptyFC() {
      return { type: "FeatureCollection", features: [] };
    }

    function setSourceData(id, data) {
      const nextData = data || emptyFC();
      mapSourceData.set(id, nextData);
      const src = map && map.getSource(id);
      if (src) src.setData(nextData);
    }

    function applyMapTheme(theme = MAP_THEME) {
      const setPaint = (id, property, value) => {
        if (!map.getLayer(id)) return;
        try {
          map.setPaintProperty(id, property, value);
        } catch (err) {}
      };
      const layers = (map.getStyle && map.getStyle().layers) || [];
      layers.forEach((layer) => {
        const sourceLayer = layer["source-layer"];
        if (layer.type === "background") {
          setPaint(layer.id, "background-color", theme.land);
          return;
        }
        if (layer.type === "fill") {
          if (sourceLayer === "water") setPaint(layer.id, "fill-color", theme.water);
          else if (["park", "landuse_park"].includes(layer.id)) {
            setPaint(layer.id, "fill-color", theme.park);
          } else if (layer.id === "landuse_residential") {
            setPaint(layer.id, "fill-color", theme.residential);
          } else if (sourceLayer === "building") {
            setPaint(layer.id, "fill-color", theme.building);
            setPaint(layer.id, "fill-outline-color", theme.buildingEdge);
          }
          return;
        }
        if (layer.type === "line") {
          if (sourceLayer === "waterway") setPaint(layer.id, "line-color", theme.water);
          else if (sourceLayer === "transportation") {
            if (layer.id.includes("motorway")) {
              setPaint(layer.id, "line-color", layer.id.includes("casing") ? theme.motorway : theme.road);
            } else if (layer.id.includes("major")) {
              setPaint(layer.id, "line-color", layer.id.includes("casing") ? theme.majorRoad : theme.road);
            } else if (layer.id.includes("rail") || layer.id.includes("railway")) {
              setPaint(layer.id, "line-color", layer.id.includes("dashline") ? theme.halo : theme.rail);
            } else {
              setPaint(layer.id, "line-color", theme.road);
            }
          }
          return;
        }
        if (layer.type === "symbol" && layer.layout && layer.layout["text-field"]) {
          const isWater = sourceLayer === "water_name" || sourceLayer === "waterway";
          setPaint(layer.id, "text-color", isWater ? theme.labelDim : theme.label);
          setPaint(layer.id, "text-halo-color", theme.halo);
          setPaint(layer.id, "text-halo-width", isWater ? 1.2 : 1.5);
          if (sourceLayer === "place") {
            try {
              map.setLayoutProperty(layer.id, "text-transform", "none");
            } catch (err) {}
          }
        }
      });
    }

    function boundsFromLngLats(lngLats) {
      const b = new maplibregl.LngLatBounds();
      (lngLats || []).forEach((ll) => {
        if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) b.extend(ll);
      });
      return b;
    }

    function isCompactLayout() {
      return window.matchMedia("(max-width: 719px), (orientation: landscape) and (max-height: 560px)").matches;
    }

    function overlayPadding() {
      const hud = hudEl.getBoundingClientRect();
      const gap = 12;
      if (isCompactLayout()) {
        const stack = Math.max(0, Math.round(window.innerHeight - hud.top));
        document.documentElement.style.setProperty("--hud-stack", stack + "px");
        return {
          top: 8,
          left: 8,
          right: 8,
          bottom: Math.max(8, stack + gap),
        };
      }
      document.documentElement.style.setProperty("--hud-stack", "0px");
      return {
        top: 8,
        right: 8,
        bottom: 8,
        left: Math.max(8, Math.round(hud.right) + gap),
      };
    }

    function syncMapPadding() {
      if (!map) return;
      try {
        map.setPadding(overlayPadding());
      } catch (err) {}
    }

    function fitMapBounds(bounds, pad, maxZoom) {
      if (!bounds || bounds.isEmpty()) return;
      syncMapPadding();
      map.fitBounds(bounds, {
        padding: 32,
        maxZoom: maxZoom || MAP_ZOOM.fitBoundsMaximum,
        duration: prefersReducedMotion() ? 0 : 500,
      });
    }

    function accuracyPolygon(lng, lat, radiusM) {
      const steps = 64;
      const coords = [];
      const dLat = radiusM / 111320;
      const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * 2 * Math.PI;
        coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
      }
      return { type: "Polygon", coordinates: [coords] };
    }

    function closeStopPopup() {
      if (stopPopup) {
        stopPopup.remove();
        stopPopup = null;
        stopPopupHandle = null;
      }
    }

    function setPopupContent(popup, content) {
      if (!popup) return;
      if (typeof content === "string") popup.setHTML(content);
      else popup.setDOMContent(content);
    }

    function makePopupHandle(popup) {
      return {
        getPopup: () => popup,
        isPopupOpen: () => !!(popup && popup.isOpen()),
        _stopFetchGen: 0,
      };
    }

    function keepPopupInView(popup) {
      const el = popup && popup.getElement && popup.getElement();
      if (!el || !isCompactLayout()) return;
      const inset = 8;
      const hudTop = hudEl.getBoundingClientRect().top;
      const board = el.querySelector(".stop-popup");
      if (board) {
        board.style.maxHeight = Math.max(140, hudTop - inset * 2 - 56) + "px";
      }
      el.style.marginLeft = "";
      el.style.marginTop = "";
      const r = el.getBoundingClientRect();
      let x = 0;
      let y = 0;
      if (r.left < inset) x = inset - r.left;
      else if (r.right > window.innerWidth - inset) x = window.innerWidth - inset - r.right;
      if (r.top < inset) y = inset - r.top;
      else if (r.bottom > hudTop - inset) y = hudTop - inset - r.bottom;
      el.style.marginLeft = x ? x + "px" : "";
      el.style.marginTop = y ? y + "px" : "";
    }

    function keepVehiclePopupInView(popup) {
      const el = popup && popup.getElement && popup.getElement();
      if (!el || !isCompactLayout()) return;
      const inset = 8;
      const hudTop = hudEl.getBoundingClientRect().top;
      el.style.marginLeft = "";
      el.style.marginTop = "";
      const r = el.getBoundingClientRect();
      let x = 0;
      let y = 0;
      if (r.left < inset) x = inset - r.left;
      else if (r.right > window.innerWidth - inset) x = window.innerWidth - inset - r.right;
      if (r.top < inset) y = inset - r.top;
      else if (r.bottom > hudTop - inset) y = hudTop - inset - r.bottom;
      el.style.marginLeft = x ? x + "px" : "";
      el.style.marginTop = y ? y + "px" : "";
    }

    function openStopPopup(s, lngLat) {
      closeStopPopup();
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        closeOnMove: false,
        maxWidth: "min(320px, calc(100vw - 16px))",
        className: "stop-popup-wrap",
        offset: 12,
        focusAfterOpen: false,
      })
        .setLngLat(lngLat)
        .setHTML(stopPopupPlaceholder(s))
        .addTo(map);
      stopPopup = popup;
      stopPopupHandle = makePopupHandle(popup);
      popup.on("close", () => {
        if (stopPopup === popup) {
          stopPopup = null;
          stopPopupHandle = null;
        }
      });
      requestAnimationFrame(() => keepPopupInView(popup));
      loadStopPopup(stopPopupHandle, s);
    }

    async function fetchStopInfo(stopId, opts) {
      const key = String(stopId);
      const wantsTimetable = !!(opts && opts.timetable);
      const cache = wantsTimetable ? stopTimetableCache : stopInfoCache;
      if (!(opts && opts.fresh) && cache.has(key)) return cache.get(key);
      const query = "?lang=ro" + (wantsTimetable ? "&timetable=true" : "");
      const json = await apiJson("/lines/stops/" + encodeURIComponent(key) + query);
      const info = json || {};
      cache.set(key, info);
      return info;
    }

    async function fetchStopLines(stopId) {
      const info = await fetchStopInfo(stopId);
      return info.lines || [];
    }

    function formatArrivalSeconds(sec) {
      if (sec == null || sec === "") return "";
      const n = Number(sec);
      if (!Number.isFinite(n) || n < 0) return "";
      if (n < ARRIVAL_NOW_SECONDS) return "acum";
      return Math.round(n / 60) + " min";
    }

    function isArrivalNow(sec, label) {
      if (sec != null && sec !== "") {
        const n = Number(sec);
        if (Number.isFinite(n)) return n >= 0 && n < ARRIVAL_NOW_SECONDS;
      }
      return /^(acum|now)$/i.test(String(label || "").trim());
    }

    function lineArrivals(line) {
      const times = line.arriving_times || line.arrivingTimes || [];
      const out = [];
      for (const t of times) {
        const raw = t && (t.arrivingTime != null ? t.arrivingTime : t.arriving_time);
        const label = formatArrivalSeconds(raw);
        if (!label) continue;
        const sec = Number(raw);
        const known = Number.isFinite(sec) && sec >= 0;
        out.push({
          label: label,
          now: isArrivalNow(known ? sec : null, label),
          scheduled: !!(t && t.timetable),
          seconds: known ? sec : Number.POSITIVE_INFINITY,
        });
        if (out.length >= 3) break;
      }
      if (!out.length) {
        const one = formatArrivalSeconds(line.arriving_time != null ? line.arriving_time : line.arrivingTime);
        if (one) {
          const rawOne = line.arriving_time != null ? line.arriving_time : line.arrivingTime;
          const secOne = Number(rawOne);
          const knownOne = Number.isFinite(secOne) && secOne >= 0;
          out.push({
            label: one,
            now: isArrivalNow(knownOne ? secOne : null, one),
            scheduled: !!(line.is_timetable || line.isTimetable),
            seconds: knownOne ? secOne : Number.POSITIVE_INFINITY,
          });
        }
      }
      return out;
    }

    function hexLuminance(hex) {
      const h = String(hex || "").replace("#", "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      if (full.length < 6) return 0.45;
      const r = parseInt(full.slice(0, 2), 16) / 255;
      const g = parseInt(full.slice(2, 4), 16) / 255;
      const b = parseInt(full.slice(4, 6), 16) / 255;
      const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    function inkOnHex(hex) {
      return hexLuminance(hex) > 0.5 ? "#0f172a" : "#ffffff";
    }

    function stopStreet(detail, name) {
      let addr = (detail && (detail.description || detail.address)) || "";
      addr = addr.replace(/,\s*Bucure[sș]ti\s*$/i, "").trim();
      if (!addr) return "";
      if (name && addr.toLowerCase() === String(name).toLowerCase()) return "";
      return addr;
    }

    function ticketOfficeNote(detail) {
      const office = detail && (detail.ticket_office || detail.ticketOffice);
      if (!office) return "";
      const sked = office.ticketOfficeSchedule || office.ticket_office_schedule || {};
      const parts = [];
      if (sked.weekday) parts.push("Zile lucrătoare " + sked.weekday);
      if (sked.saturday) parts.push("Sâmbătă " + sked.saturday);
      if (sked.sunday) parts.push("Duminică " + sked.sunday);
      const name = office.name || office.type || "";
      if (name && parts.length) return name + " · " + parts.join(" · ");
      if (parts.length) return parts.join(" · ");
      return "";
    }

    function stopPopupPlaceholder(s) {
      return (
        '<div class="stop-popup">' +
        '<div class="stop-head"><div class="stop-title">' +
        escapeHtml(s.name || "Stop") +
        "</div></div>" +
        '<div class="stop-skel"></div><div class="stop-skel"></div><div class="stop-skel"></div>' +
        "</div>"
      );
    }

    function renderStopPopup(s, detail) {
      const wrap = document.createElement("div");
      wrap.className = "stop-popup";
      wrap.setAttribute("role", "dialog");
      const name = (detail && detail.name) || s.name || "Stație";
      wrap.setAttribute("aria-label", "Informații stație " + name);
      const head = document.createElement("div");
      head.className = "stop-head";
      const title = document.createElement("div");
      title.className = "stop-title";
      title.textContent = name;
      head.appendChild(title);
      const headMeta = document.createElement("div");
      headMeta.className = "stop-head-meta";
      head.appendChild(headMeta);
      const street = stopStreet(detail, name);
      if (street) {
        const sub = document.createElement("div");
        sub.className = "stop-street";
        sub.textContent = street;
        head.appendChild(sub);
      }
      if (detail && (detail.has_disability || detail.hasDisability)) {
        const access = accessIconEl(true);
        access.classList.add("stop-access");
        head.appendChild(access);
      }
      const ticket = ticketOfficeNote(detail);
      if (ticket) {
        const note = document.createElement("div");
        note.className = "stop-street";
        note.textContent = ticket;
        head.appendChild(note);
      }
      const firstOrganization = detail && detail.organization ||
        ((detail && detail.lines || []).find((line) => line && line.organization) || {}).organization;
      const organization = organizationBadge(firstOrganization, "stop-organization");
      if (organization) head.appendChild(organization);

      wrap.appendChild(head);

      const lines = (detail && detail.lines) || [];
      if (!lines.length) {
        const empty = document.createElement("div");
        empty.className = "stop-note";
        empty.textContent = "Nu sunt plecări afișate.";
        wrap.appendChild(empty);
        return wrap;
      }

      const parsed = lines.map((line) => ({ line: line, arrivals: lineArrivals(line) }));
      const anyLive = parsed.some((p) => p.arrivals[0] && !p.arrivals[0].scheduled);
      const anySked = parsed.some((p) => p.arrivals[0] && p.arrivals[0].scheduled);
      const feedStatus = document.createElement("span");
      feedStatus.className = "stop-feed-status " + (anyLive ? "is-live" : anySked ? "is-schedule" : "is-empty");
      feedStatus.textContent = anyLive ? "LIVE" : anySked ? "ORAR" : "FĂRĂ DATE";
      const lineCount = document.createElement("span");
      lineCount.className = "stop-line-count";
      lineCount.textContent = lines.length + (lines.length === 1 ? " linie" : " linii");
      headMeta.append(feedStatus, lineCount);
      const board = document.createElement("div");
      board.className = "stop-board";
      for (const { line, arrivals } of parsed) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "stop-line";
        const route = line.name || "?";
        const dest = line.direction_name || line.directionName || "";
        const next = arrivals[0];
        row.setAttribute(
          "aria-label",
          "Linia " + route + (dest ? " spre " + dest : "") +
            (next ? ", " + next.label + (next.scheduled ? ", orar" : "") : "")
        );

        const bullet = document.createElement("span");
        bullet.className = "stop-bullet";
        const fill = routeColor(line);
        bullet.style.background = fill;
        bullet.style.color = inkOnHex(fill);
        bullet.textContent = route;

        const mid = document.createElement("span");
        mid.className = "stop-dest";
        const destEl = document.createElement("div");
        destEl.className = "stop-dest-name";
        destEl.textContent = dest || (line.type || "Deschide linia");
        mid.appendChild(destEl);
        const stopMeta = document.createElement("div");
        stopMeta.className = "stop-meta";
        const stopModeIcon = modeIconEl(line.type);
        if (stopModeIcon) stopMeta.appendChild(stopModeIcon);
        if (dest && line.type) {
          const k = document.createElement("span");
          k.className = "stop-kind";
          k.textContent = kindLabel(line.type);
          stopMeta.appendChild(k);
        }
        if (lineIsAccessible(line)) stopMeta.appendChild(accessIconEl(false));
        const lineOrganization = organizationBadge(line.organization, "stop-line-organization");
        if (lineOrganization) stopMeta.appendChild(lineOrganization);
        if (stopMeta.childNodes.length) mid.appendChild(stopMeta);
        const hours = line.timetable || [];
        if (hours.length) {
          const sked = document.createElement("div");
          sked.className = "stop-line-schedule";
          sked.textContent = hours
            .slice(0, 6)
            .map((h) => {
              const hour = h.hour || "";
              const mins = (h.minutes || []).join(" ");
              return mins ? hour + " " + mins : hour;
            })
            .filter(Boolean)
            .join(" · ");
          if (sked.textContent) mid.appendChild(sked);
        }

        row.append(bullet, mid, etaBlock(next, arrivals.slice(1)));
        if (line.id != null) {
          row.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            selectLine({
              id: line.id,
              name: line.name,
              type: line.type,
              color: line.color,
              dest: line.direction_name || line.directionName || "",
              direction: line.direction != null ? Number(line.direction) : null,
            });
          });
        }
        board.appendChild(row);
      }
      wrap.appendChild(board);
      const scheduled = parsed.filter((item) => {
        const line = item.line;
        const dir = Number(line && line.direction);
        return (
          line &&
          line.id != null &&
          line.is_timetable !== false &&
          line.isTimetable !== false &&
          (hasTimetableData(line) || dir === 0 || dir === 1)
        );
      });
      if (scheduled.length) {
        const section = document.createElement("section");
        section.className = "stop-timetables";
        const title = document.createElement("div");
        title.className = "stop-timetables-title";
        title.textContent = "Orar";
        section.appendChild(title);
        for (const item of scheduled) {
          const line = item.line;
          const dir = Number(line.direction);
          const load = hasTimetableData(line) || (dir !== 0 && dir !== 1)
            ? null
            : async (content) => {
                const result = await fetchStopTimetable(
                  { id: s.id, name: detail.name || s.name, lines: [line] },
                  line.id,
                  dir
                );
                const hours = result && result.line && result.line.timetable;
                if (!hours || !hours.length) throw new Error("timetable unavailable");
                line.timetable = hours;
                content.className = "timetable-content";
                content.replaceChildren(renderFullTimetable(hours));
              };
          const details = timetableDetails(line.timetable, "Linia " + (line.name || "?"), load);
          details.classList.add("stop-timetable");
          section.appendChild(details);
        }
        wrap.appendChild(section);
      }
      return wrap;
    }

    async function loadStopPopup(marker, s) {
      const popup = marker.getPopup();
      if (!popup || s.id == null) return;
      marker._stopFetchGen = (marker._stopFetchGen || 0) + 1;
      const token = marker._stopFetchGen;
      try {
        const detail = await fetchStopInfo(s.id, { fresh: true });
        if (marker._stopFetchGen !== token || !marker.isPopupOpen()) return;
        if (!detail || (!(detail.lines || []).length && !detail.name)) {
          throw new Error("Nu s-au putut încărca plecările");
        }
        setPopupContent(popup, renderStopPopup(s, detail));
        keepPopupInView(popup);
      } catch (e) {
        console.error(e);
        if (marker._stopFetchGen !== token || !marker.isPopupOpen()) return;
        setPopupContent(
          popup,
          '<div class="stop-popup">' +
            '<div class="stop-head"><div class="stop-title">' +
        escapeHtml(s.name || "Stație") +
            '</div></div><div class="stop-note is-err">' +
            escapeHtml(e.message || "Nu s-au putut încărca plecările") +
            "</div></div>"
        );
        keepPopupInView(popup);
      }
    }

    function clearStops() {
      setSourceData("stops", emptyFC());
      closeStopPopup();
    }

    function plotStops(stops, opts) {
      const features = [];
      const pts = [];
      (stops || []).forEach((s) => {
        if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
        pts.push([s.lng, s.lat]);
        features.push({
          type: "Feature",
          properties: {
            id: s.id != null ? String(s.id) : "",
            name: s.name || "",
            payload: JSON.stringify(s),
          },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        });
      });
      setSourceData("stops", { type: "FeatureCollection", features: features });
      if (!fittedOnce && pts.length && !(opts && opts.keepView)) {
        const b = boundsFromLngLats(pts);
        if (userLngLat) b.extend([userLngLat.lng, userLngLat.lat]);
        fitMapBounds(b, 0.15);
        fittedOnce = true;
      }
      return pts.length;
    }

    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function cssColor(c) {
      return typeof c === "string" && /^#[0-9A-Fa-f]{3,8}$/.test(c) ? c : "#888888";
    }

    function modeKey(type) {
      const t = String(type || "").toUpperCase().replace(/[\s-]+/g, "_");
      if (t === "CABLE_CAR" || t === "TROLLEYBUS" || t === "TROLLEY_BUS") return "TROLLEYBUS";
      if (t === "SUBWAY_STATION" || t === "METRO") return "SUBWAY";
      if (t === "TRAMWAY") return "TRAM";
      return t || "OTHER";
    }

    function modeColor(type, fallback) {
      const key = modeKey(type);
      return MODE_COLORS[key] || cssColor(fallback || MODE_COLORS.OTHER);
    }

    function routeColor(line) {
      return modeColor(line && (line.type || line.transport_type || line.transportType), line && line.color);
    }

    function haversineMeters(aLat, aLng, bLat, bLng) {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const sinLat = Math.sin(dLat / 2);
      const sinLng = Math.sin(dLng / 2);
      const h = sinLat * sinLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLng * sinLng;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function userLatLng() {
      if (userLngLat) return userLngLat;
      return { lat: CITY.lat, lng: CITY.lng };
    }

    function nearestStops(stops, n) {
      const origin = userLatLng();
      return (stops || [])
        .filter((s) => s && s.id != null && typeof s.lat === "number" && typeof s.lng === "number")
        .map((s) => ({ s, d: haversineMeters(origin.lat, origin.lng, s.lat, s.lng) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map((x) => x.s);
    }

    function decodePolyline(encoded) {
      if (!encoded) return [];
      const coords = [];
      let index = 0;
      let lat = 0;
      let lng = 0;
      while (index < encoded.length) {
        let b;
        let shift = 0;
        let result = 0;
        do {
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0;
        result = 0;
        do {
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        coords.push([lat / 1e5, lng / 1e5]);
      }
      return coords;
    }

    function setLinesCount(msg, kind) {
      linesCountEl.textContent = msg;
      linesCountEl.className = "hud-count" + (kind ? " " + kind : "");
    }

    function setLinesListMessage(msg) {
      linesListEl.innerHTML = '<div class="hud-empty">' + escapeHtml(msg) + "</div>";
    }

    function kindLabel(type) {
      const key = modeKey(type);
      if (key === "TROLLEYBUS") return "Troleibuz";
      if (key === "BUS") return "Autobuz";
      if (key === "TRAM") return "Tramvai";
      if (key === "SUBWAY") return "Metrou";
      if (key === "TRAIN") return "Tren";
      if (key === "FERRY") return "Feribot";
      if (key === "WALK") return "Mers pe jos";
      return type || "";
    }

    function lineHeadline(line) {
      const name = (line && (line.name || line.id)) || "";
      const kind = kindLabel(line && line.type);
      return kind ? name + " · " + kind : String(name);
    }

    function protoStr(obj, snake, camel) {
      if (!obj) return "";
      const v = obj[snake] != null && obj[snake] !== "" ? obj[snake] : obj[camel];
      return v == null ? "" : String(v);
    }

    function directionName(dir) {
      const d = detailDetail;
      if (dir === 0) return protoStr(d, "direction_name_tur", "directionNameTur");
      return protoStr(d, "direction_name_retur", "directionNameRetur");
    }

    function lastStopName(dir) {
      const stops = dirStops[dir] || [];
      const last = stops[stops.length - 1];
      return (last && last.name) || "";
    }

    function directionLabel(dir) {
      return directionName(dir) || lastStopName(dir) || "";
    }

    function matchDirFromDest(dest, tur, retur) {
      const d = String(dest || "").trim().toLowerCase();
      if (!d) return 0;
      const r = String(retur || "").trim().toLowerCase();
      const t = String(tur || "").trim().toLowerCase();
      if (r && (d === r || d.includes(r) || r.includes(d))) return 1;
      if (t && (d === t || d.includes(t) || t.includes(d))) return 0;
      return 0;
    }

    function initialDir(line) {
      const raw = line && line.direction;
      if (raw === 0 || raw === 1 || raw === "0" || raw === "1") return Number(raw);
      return matchDirFromDest(line && line.dest, directionName(0), directionName(1));
    }

    function pad2(n) {
      return String(n).padStart(2, "0");
    }

    function parseClockPart(raw, max) {
      const m = String(raw == null ? "" : raw).trim().match(/(\d{1,2})/);
      if (!m) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 0 || n > max) return null;
      return n;
    }

    function remainingTimetable(hours) {
      const now = new Date();
      const hNow = now.getHours();
      const mNow = now.getMinutes();
      const rows = [];
      for (const h of hours || []) {
        const hour = parseClockPart(h && h.hour, 23);
        if (hour == null) continue;
        const mins = [];
        for (const raw of h.minutes || []) {
          const min = parseClockPart(raw, 59);
          if (min == null) continue;
          if (hour > hNow || (hour === hNow && min >= mNow)) mins.push(min);
        }
        if (mins.length) rows.push({ hour: hour, minutes: mins });
      }
      return rows;
    }

    function remainingFromArrivals(line) {
      if (!line) return [];
      const secs = [];
      const arr = line.arriving_times || line.arrivingTimes || [];
      for (const t of arr) {
        const raw = t && (t.arrivingTime != null ? t.arrivingTime : t.arriving_time);
        const sec = Number(raw);
        if (Number.isFinite(sec) && sec >= 0) secs.push(sec);
      }
      if (!secs.length) {
        const raw = line.arriving_time != null ? line.arriving_time : line.arrivingTime;
        const sec = Number(raw);
        if (Number.isFinite(sec) && sec >= 0) secs.push(sec);
      }
      const byHour = new Map();
      const now = Date.now();
      for (const sec of secs) {
        const d = new Date(now + sec * 1000);
        const hour = d.getHours();
        const min = d.getMinutes();
        if (!byHour.has(hour)) byHour.set(hour, []);
        const mins = byHour.get(hour);
        if (!mins.includes(min)) mins.push(min);
      }
      return [...byHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, minutes]) => ({ hour: hour, minutes: minutes.sort((a, b) => a - b) }));
    }

    function renderTimetableBoard(rows) {
      const board = document.createElement("div");
      board.className = "line-tt-board";
      const times = document.createElement("div");
      times.className = "line-tt-times";
      let first = true;
      for (const row of rows) {
        for (const min of row.minutes) {
          const t = document.createElement("span");
          t.className = "line-tt-time" + (first ? " is-next" : "");
          t.textContent = pad2(row.hour) + ":" + pad2(min);
          times.appendChild(t);
          first = false;
        }
      }
      board.appendChild(times);
      return board;
    }

    function renderFullTimetable(hours) {
      const wrap = document.createElement("div");
      wrap.className = "timetable-full";
      for (const h of hours || []) {
        const hour = parseClockPart(h && h.hour, 23);
        const minutes = (h && h.minutes || [])
          .map((value) => parseClockPart(value, 59))
          .filter((value) => value != null)
          .map(pad2);
        if (hour == null && !minutes.length) continue;
        const row = document.createElement("div");
        row.className = "timetable-hour";
        const hourEl = document.createElement("span");
        hourEl.className = "timetable-hour-label";
        hourEl.textContent = hour == null ? "--:--" : pad2(hour) + ":00";
        const minEl = document.createElement("span");
        minEl.className = "timetable-hour-minutes";
        minEl.textContent = minutes.length ? minutes.join(", ") : "—";
        row.append(hourEl, minEl);
        wrap.appendChild(row);
      }
      return wrap;
    }

    function timetableDetails(hours, label, load) {
      const details = document.createElement("details");
      details.className = "timetable-details";
      const summary = document.createElement("summary");
      summary.textContent = label || "Vezi orarul complet";
      const content = document.createElement("div");
      content.className = "timetable-content";
      if (hours && hours.length) {
        content.appendChild(renderFullTimetable(hours));
      } else if (!load) {
        content.className = "timetable-content is-empty";
        content.textContent = "Orar indisponibil";
      }
      details.append(summary, content);
      if (load) {
        let loading = false;
        details.addEventListener("toggle", async () => {
          if (!details.open || loading || content.dataset.loaded) return;
          loading = true;
          content.dataset.loaded = "loading";
          content.className = "timetable-content is-loading";
          content.textContent = "Se încarcă orarul…";
          try {
            await load(content);
            content.dataset.loaded = "1";
          } catch (err) {
            content.className = "timetable-content is-error";
            content.textContent = "Orar indisponibil";
          } finally {
            loading = false;
          }
        });
      }
      return details;
    }

    function pickLineOnStop(lines, lineId, dir) {
      const id = String(lineId);
      const exact = (lines || []).filter((l) => String(l.id) === id);
      if (!exact.length) return null;
      const byDir = exact.find((l) => {
        const ld = l.direction != null ? Number(l.direction) : null;
        return ld === dir;
      });
      return byDir || exact[0];
    }

    function hasTimetableData(line) {
      return !!(line && Array.isArray(line.timetable) && line.timetable.length);
    }

    function mergeLineData(primary, fallback) {
      const merged = Object.assign({}, fallback || {}, primary || {});
      for (const key of ["timetable", "organization", "isTimetable", "is_timetable", "arrivingTimes", "arriving_times"]) {
        const value = primary && primary[key];
        const fallbackValue = fallback && fallback[key];
        if ((value == null || (Array.isArray(value) && !value.length)) && fallbackValue != null) {
          merged[key] = fallbackValue;
        }
      }
      return merged;
    }

    async function fetchStopTimetable(stop, lineId, dir) {
      const params = new URLSearchParams({
        stop_id: String(stop.id),
        selected_line_id: String(lineId),
        direction: String(dir),
        timetable: "true",
      });
      const detail = await apiJson("/lines/stop?" + params.toString());
      const line = pickLineOnStop(detail.lines || [], lineId, dir);
      if (!line) return null;
      const fallback = pickLineOnStop((stop && stop.lines) || [], lineId, dir);
      return {
        stop: Object.assign({}, stop, { name: detail.name || stop.name || "" }),
        line: mergeLineData(line, fallback),
      };
    }

    async function lineAtNearestStop(lineId, dir) {
      const stops = dirStops[dir] || [];
      const ranked = nearestStops(stops, 8);
      const pool = ranked.length ? ranked : stops.slice(0, 8);
      const hasUsefulLine = (line) => hasTimetableData(line) || lineArrivals(line).length > 0;
      for (const s of pool) {
        const line = pickLineOnStop(s.lines || [], lineId, dir);
        if (line && hasUsefulLine(line)) return { stop: s, line: line };
      }
      for (const s of pool) {
        if (s == null || s.id == null) continue;
        try {
          const info = await fetchStopInfo(s.id);
          const line = pickLineOnStop(info.lines || [], lineId, dir);
          if (line && hasUsefulLine(line)) {
            return { stop: Object.assign({}, s, { name: info.name || s.name }), line: line };
          }
          const timetable = await fetchStopTimetable(s, lineId, dir);
          if (timetable && hasUsefulLine(timetable.line)) return timetable;
        } catch (err) {
          console.error("stop timetable", s.id, err);
        }
      }
      return null;
    }

    function setLineBar(line) {
      if (!line || !line.name) {
        lineBarRoute.hidden = true;
        lineBarRoute.textContent = "";
        return;
      }
      lineBarRoute.hidden = false;
      lineBarRoute.textContent = line.name;
      const fill = routeColor(line);
      lineBarRoute.style.background = fill;
      lineBarRoute.style.color = inkOnHex(fill);
    }

    function setLineFoot(msg, kind) {
      lineFootEl.textContent = msg;
      lineFootEl.className = "line-foot" + (kind ? " " + kind : "");
    }

    function vehicleCountForDir(dir) {
      const list = lastPlottedVehicles || [];
      return list.filter((v) => v.direction == null || Number(v.direction) === dir).length;
    }

    function vehicleCountLabel(n) {
      if (!n) return "Niciun vehicul";
      return countLabel(n, "vehicul", "vehicule");
    }

    // Romanian numerals take "de" from twenty up: 20 de stații, 21 de vehicule.
    function countUnit(n, singular, plural) {
      return (n >= 20 ? "de " : "") + (n === 1 ? singular : plural);
    }

    function countLabel(n, singular, plural) {
      return n + " " + countUnit(n, singular, plural);
    }

    function updateDirVehicleCounts() {
      document.querySelectorAll(".line-dir-count").forEach((el) => {
        el.textContent = vehicleCountLabel(vehicleCountForDir(Number(el.dataset.dir)));
      });
      setLineFoot("");
    }

    const ORGANIZATION_NAMES = Object.freeze({
      1: "STB",
      2: "Metrorex",
      35: "STV Voluntari",
      36: "Ecotrans STCM",
      37: "Regio Serv Transport",
    });

    function organizationInfo(value) {
      if (!value || typeof value !== "object") return null;
      const logo = value.logo || value.logoFile || value.logo_file || "";
      const name = value.name || value.code || ORGANIZATION_NAMES[String(value.id)] || (value.id != null ? "Organizație #" + value.id : "");
      if (!logo && !name) return null;
      return { logo: String(logo), name: String(name || "Organizație") };
    }

    function safeImageUrl(value) {
      if (!value) return "";
      try {
        const url = new URL(String(value), location.origin);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
      } catch (err) {
        return "";
      }
    }

    function organizationBadge(value, className) {
      const organization = organizationInfo(value);
      if (!organization) return null;
      const badge = document.createElement("span");
      badge.className = "organization-badge" + (className ? " " + className : "");
      const logo = safeImageUrl(organization.logo);
      if (logo) {
        const image = document.createElement("img");
        image.className = "organization-logo";
        image.src = logo;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        badge.appendChild(image);
      }
      const name = document.createElement("span");
      name.className = "organization-name";
      name.textContent = organization.name;
      badge.appendChild(name);
      return badge;
    }

    function lineInfoBits(line, detail, packLine) {
      const bits = [];
      const kind = kindLabel((detail && detail.type) || (line && line.type));
      if (kind) bits.push(kind);
      const sms = protoStr(detail, "ticket_sms", "ticketSms") || protoStr(packLine, "ticket_sms", "ticketSms");
      const price = protoStr(detail, "price_ticket_sms", "priceTicketSms") || protoStr(packLine, "price_ticket_sms", "priceTicketSms");
      if (sms && price) bits.push("Bilet SMS la " + sms + " (" + price + " lei)");
      else if (sms) bits.push("Bilet SMS la " + sms);
      return bits;
    }

    function renderLinePage() {
      const line = selectedLine;
      const prevStops = linePageEl.querySelector(".line-stop-list");
      if (prevStops) stopListScroll = prevStops.scrollTop;
      stopListEl = null; // ignore scroll events from the list we are replacing
      linePageEl.replaceChildren();
      if (!line) return;

      const dirsWrap = document.createElement("div");
      const label = document.createElement("p");
      label.className = "line-dirs-label";
      label.id = "lineDirsLabel";
      label.textContent = "Direcție";
      const dirs = document.createElement("div");
      dirs.className = "line-dirs";
      dirs.setAttribute("role", "group");
      dirs.setAttribute("aria-labelledby", "lineDirsLabel");

      const available = [0, 1].filter((dir) => {
        const named = directionName(dir) || lastStopName(dir);
        const hasStops = (dirStops[dir] || []).length;
        const hasPath = dirPaths[dir] && dirPaths[dir].length;
        return named || hasStops || hasPath;
      });
      const show = available.length ? available : [0, 1];
      if (show.length === 1) dirs.classList.add("is-one");
      const fill = routeColor(line);
      const ink = inkOnHex(fill);

      for (const dir of show) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "line-dir" + (dir === detailDir ? " on" : "");
        btn.style.setProperty("--line", fill);
        btn.style.setProperty("--line-ink", ink);
        btn.setAttribute("aria-pressed", String(dir === detailDir));
        const kicker = document.createElement("span");
        kicker.className = "line-dir-kicker";
        const name = document.createElement("span");
        name.className = "line-dir-name";
        const dirName = directionLabel(dir);
        // Without a terminus name "Spre …" would read as "Spre Se încarcă…".
        if (dirName) {
          kicker.textContent = "Spre";
          name.textContent = dirName;
          btn.append(kicker, name);
        } else {
          name.textContent = "Se încarcă…";
          btn.appendChild(name);
        }
        const count = document.createElement("span");
        count.className = "line-dir-count";
        count.dataset.dir = String(dir);
        count.textContent = vehicleCountLabel(vehicleCountForDir(dir));
        btn.appendChild(count);
        btn.addEventListener("click", () => setLineDirection(dir));
        dirs.appendChild(btn);
      }
      dirsWrap.append(label, dirs);
      linePageEl.appendChild(dirsWrap);
      const organization = organizationInfo(
        (detailDetail && detailDetail.organization) ||
        (lineStopPack && lineStopPack.line && lineStopPack.line.organization)
      );
      if (organization) {
        const identity = document.createElement("div");
        identity.className = "line-identity";
        const badge = organizationBadge(organization, "line-organization");
        if (badge) identity.appendChild(badge);
        linePageEl.appendChild(identity);
      }

      if (lineStopPack === undefined) {
        const skel = document.createElement("div");
        skel.className = "line-skel";
        skel.setAttribute("aria-hidden", "true");
        const skel2 = document.createElement("div");
        skel2.className = "line-skel";
        skel2.setAttribute("aria-hidden", "true");
        linePageEl.append(skel, skel2);
      } else {
        const pack = lineStopPack;
        const packLine = pack && pack.line;
        const arrivals = packLine ? lineArrivals(packLine) : [];
        const stopName = pack && pack.stop && pack.stop.name;

        const nextSec = document.createElement("section");
        nextSec.className = "line-next";
        const nextH = document.createElement("h2");
        nextH.textContent = arrivals.length === 1 ? "Următoarea sosire" : "Următoarele sosiri";
        nextSec.appendChild(nextH);
        if (stopName) {
          const from = document.createElement("p");
          from.className = "line-from";
          from.textContent = "De la " + stopName;
          nextSec.appendChild(from);
        }
        if (arrivals.length) {
          const row = document.createElement("div");
          row.className = "line-next-row";
          for (const a of arrivals) row.appendChild(etaValue(a));
          nextSec.appendChild(row);
          if (arrivals[0] && arrivals[0].scheduled) {
            const flag = document.createElement("p");
            flag.className = "line-from";
            flag.textContent = "Din orar";
            nextSec.appendChild(flag);
          }
        } else {
          const empty = document.createElement("p");
          empty.className = "line-tt-empty";
          empty.textContent = pack ? "Nicio sosire la stația din apropiere." : "Nicio sosire pentru această direcție.";
          nextSec.appendChild(empty);
        }
        linePageEl.appendChild(nextSec);

        const hours = (packLine && packLine.timetable) || [];
        let rows = remainingTimetable(hours);
        const fromTimetable = rows.length > 0;
        if (!rows.length) rows = remainingFromArrivals(packLine);
        if (rows.length || hours.length) {
          const tt = document.createElement("section");
          tt.className = "line-tt";
          const ttH = document.createElement("h2");
          // Arrival-derived rows are not a published timetable, so they are not
          // labelled "Orarul de azi"; they are just clock times left today.
          ttH.textContent = rows.length && !fromTimetable ? "Restul zilei" : "Orarul de azi";
          tt.appendChild(ttH);
          if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "line-tt-empty";
            empty.textContent = "Nicio cursă în restul zilei.";
            tt.appendChild(empty);
          } else {
            tt.appendChild(renderTimetableBoard(rows));
          }
          if (hours.length) tt.appendChild(timetableDetails(hours));
          linePageEl.appendChild(tt);
        }
      }

      const stops = dirStops[detailDir] || [];
      if (stops.length) {
        const sec = document.createElement("section");
        sec.className = "line-stops";
        const h = document.createElement("h2");
        h.textContent = countLabel(stops.length, "stație", "stații");
        sec.appendChild(h);
        const near = nearestStops(stops, 1)[0];
        const list = document.createElement("div");
        list.className = "line-stop-list";
        for (const s of stops) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "line-stop" + (near && String(near.id) === String(s.id) ? " is-near" : "");
          const name = document.createElement("span");
          name.className = "line-stop-name";
          name.textContent = s.name || "Stație";
          row.appendChild(name);
          if (near && String(near.id) === String(s.id)) {
            const mark = document.createElement("span");
            mark.className = "line-stop-near";
            mark.textContent = "Lângă tine";
            row.appendChild(mark);
          }
          if (typeof s.lat === "number" && typeof s.lng === "number") {
            row.addEventListener("click", () => {
              map.flyTo({
                center: [s.lng, s.lat],
                zoom: Math.max(map.getZoom(), 16),
                duration: prefersReducedMotion() ? 0 : 500,
              });
              openStopPopup(s, [s.lng, s.lat]);
            });
          } else {
            row.disabled = true;
          }
          list.appendChild(row);
        }
        sec.appendChild(list);
        linePageEl.appendChild(sec);
        alignStopList(list);
      }

      const bits = lineInfoBits(line, detailDetail, lineStopPack && lineStopPack.line);
      const lineAccess = lineIsAccessible(detailDetail) ||
        lineIsAccessible(lineStopPack && lineStopPack.line) || lineIsAccessible(line);
      if (bits.length || lineAccess) {
        const info = document.createElement("section");
        info.className = "line-info";
        const infoH = document.createElement("h2");
        infoH.textContent = "Linia";
        info.appendChild(infoH);
        for (const bit of bits) {
          const p = document.createElement("p");
          p.textContent = bit;
          info.appendChild(p);
        }
        if (lineAccess) {
          const p = document.createElement("p");
          p.className = "line-access";
          p.appendChild(accessIconEl(false));
          p.appendChild(document.createTextNode("Vehicule accesibile pe această linie"));
          info.appendChild(p);
        }
        linePageEl.appendChild(info);
      }
    }

    // Open the stop list with the nearest stop as the first visible row, so the
    // rider reads from where they are; earlier stops sit above, scrolled away.
    function alignStopList(list) {
      stopListEl = list;
      const place = () => {
        if (list !== stopListEl) return;
        if (!stopListPinned) {
          list.scrollTop = stopListScroll;
          return;
        }
        const near = list.querySelector(".line-stop.is-near");
        if (!near) return;
        // Nudge rather than assign: the list may already be scrolled, and this
        // runs again after layout settles, so it has to be idempotent.
        const offset = near.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTop = Math.max(0, list.scrollTop + offset);
        stopListScroll = list.scrollTop;
      };
      place();
      // The panel can finish layout (or become visible) after this render, and
      // webfonts change row heights, so keep placing until the rider scrolls.
      requestAnimationFrame(place);
      if (typeof ResizeObserver === "function") {
        const ro = new ResizeObserver(() => {
          if (list !== stopListEl) {
            ro.disconnect();
            return;
          }
          place();
        });
        ro.observe(list);
      }
      list.addEventListener(
        "scroll",
        () => {
          if (list !== stopListEl) return; // events from lists we replaced
          if (list.scrollTop === stopListScroll) return; // our own placement
          stopListPinned = false;
          stopListScroll = list.scrollTop;
        },
        { passive: true }
      );
    }

    async function setLineDirection(dir, opts) {
      const line = selectedLine;
      if (!line || (dir !== 0 && dir !== 1)) return;
      if (!(opts && opts.force)) dirTouched = true;
      const same = detailDir === dir && lineStopPack !== undefined && !(opts && opts.force);
      detailDir = dir;
      const stops = dirStops[dir] || [];
      pathStopsOverride = stops.length ? stops : pathStopsOverride;
      plotStops(pathStopsOverride || [], { keepView: true });
      drawDirRoutes(routeColor(line), { fit: false });
      if (lastPlottedVehicles.length) plotVehicles(lastPlottedVehicles, routeColor(line));
      updateDirVehicleCounts();
      if (same) {
        renderLinePage();
        return;
      }
      lineStopPack = undefined;
      stopListPinned = true;
      renderLinePage();
      const pack = await lineAtNearestStop(line.id, dir);
      if (String(selectedLineId) !== String(line.id) || detailDir !== dir) return;
      lineStopPack = pack;
      renderLinePage();
    }

    async function apiJson(path) {
      const buf = await apiFetch(path);
      const text = bufText(buf);
      try {
        return JSON.parse(text);
      } catch (e) {
        const err = new Error("not json " + path);
        err.body = text.slice(0, 240);
        throw err;
      }
    }

    function segmentPathOf(obj) {
      if (!obj) return "";
      return obj.segment_path || obj.segmentPath || "";
    }

    function lineDest(line) {
      return (line && (line.dest || line.direction_name || line.directionName)) || "";
    }

    function arrivalSortKey(line) {
      const next = line && line.next;
      if (!next || !Number.isFinite(next.seconds) || next.seconds < 0) return Number.POSITIVE_INFINITY;
      return next.seconds;
    }

    function stopGlyph(type) {
      const t = String(type || "").toUpperCase();
      if (t === "SUBWAY_STATION" || t === "SUBWAY") return "M";
      if (t === "TICKET_OFFICE") return "T";
      return "\u2022";
    }

    function etaValue(next) {
      const val = document.createElement("span");
      const label = String((next && next.label) || "");
      const isNow = next && next.now != null
        ? !!next.now
        : /^(acum|now)$/i.test(label.trim());
      val.className = "eta-val" + (next && next.scheduled ? " is-sked" : "") + (isNow ? " is-now" : "");
      if (isNow) {
        val.textContent = "ACUM";
        return val;
      }
      const m = label.match(/(\d+)/);
      const num = document.createElement("span");
      num.className = "eta-num";
      num.textContent = m ? m[1] : label || "\u2014";
      const unit = document.createElement("span");
      unit.className = "eta-unit";
      unit.textContent = "min";
      val.append(num, unit);
      return val;
    }

    function etaBlock(next, extra) {
      const wrap = document.createElement("span");
      wrap.className = "stop-eta";
      if (!next || !next.label) {
        const dash = document.createElement("span");
        dash.className = "eta-dash";
        dash.textContent = "\u2014";
        wrap.appendChild(dash);
        return wrap;
      }
      wrap.appendChild(etaValue(next));
      const rest = (extra || []).map((a) => a.label).filter(Boolean);
      if (rest.length) {
        const more = document.createElement("div");
        more.className = "stop-eta-more";
        more.textContent = rest.join("  ");
        wrap.appendChild(more);
      }
      return wrap;
    }

    function favList() {
      try {
        const v = JSON.parse(localStorage.getItem(LS_FAV) || "[]");
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    }

    function isFav(id) {
      return favList().some((f) => String(f.id) === String(id));
    }

    function toggleFav(line) {
      if (!line || line.id == null) return false;
      const list = favList();
      const i = list.findIndex((f) => String(f.id) === String(line.id));
      let added;
      if (i >= 0) {
        list.splice(i, 1);
        added = false;
      } else {
        list.push({
          id: line.id,
          name: line.name,
          type: line.type,
          color: line.color,
          dest: lineDest(line),
        });
        added = true;
      }
      try {
        localStorage.setItem(LS_FAV, JSON.stringify(list));
      } catch (e) {}
      return added;
    }

    function savedBoardLines() {
      const out = [];
      for (const f of favList()) {
        const near = nearbyLines.find((l) => String(l.id) === String(f.id));
        out.push(Object.assign({}, f, { next: near ? near.next : null }));
      }
      return out.sort((a, b) => {
        const da = arrivalSortKey(a);
        const db = arrivalSortKey(b);
        if (da !== db) return da - db;
        return String(a.name || "").localeCompare(String(b.name || ""), "ro", { numeric: true });
      });
    }

    function visibleLines() {
      if (activeType === "saved") return savedBoardLines();
      if (activeType === "all") return nearbyLines;
      return nearbyLines.filter((l) => modeKey(l.type) === modeKey(activeType));
    }

    function renderChips() {
      chipsEl.replaceChildren();
      for (const f of FILTERS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (f.saved ? " chip-saved" : "") + (activeType === f.key ? " on" : "");
        const chipColor = f.saved ? "var(--live)" : f.key === "all" ? "var(--map-accent)" : modeColor(f.key);
        b.style.setProperty("--chip-color", chipColor);
        const chipMode = modeIconEl(f.key);
        if (chipMode) b.appendChild(chipMode);
        const chipLabel = document.createElement("span");
        chipLabel.className = "chip-label";
        chipLabel.textContent = f.label;
        b.appendChild(chipLabel);
        b.setAttribute("aria-pressed", String(activeType === f.key));
        b.addEventListener("click", () => {
          activeType = f.key;
          renderChips();
          renderBoard();
        });
        chipsEl.appendChild(b);
      }
    }

    function boardRow(line) {
      const row = document.createElement("div");
      row.className = "line-row" + (String(line.id) === String(selectedLineId) ? " selected" : "");
      row.dataset.id = String(line.id);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "line-main";
      const route = line.name || "?";
      const kind = kindLabel(line.type);
      const dest = lineDest(line);
      const next = line.next;
      main.setAttribute(
        "aria-label",
        [route, dest, next && next.label, next && next.scheduled ? "timetable" : "", kind]
          .filter(Boolean)
          .join(", ")
      );

      const bullet = document.createElement("span");
      bullet.className = "line-bullet";
      const fill = routeColor(line);
      bullet.style.background = fill;
      bullet.style.color = inkOnHex(fill);
      bullet.textContent = route;

      const mid = document.createElement("span");
      mid.className = "line-mid";
      const destEl = document.createElement("span");
      destEl.className = "line-dest";
      destEl.textContent = dest || kind || "Deschide linia";
      mid.appendChild(destEl);
      const meta = document.createElement("span");
      meta.className = "line-kind";
      const modeIcon = modeIconEl(line.type);
      if (modeIcon) meta.appendChild(modeIcon);
      if (dest && kind) meta.appendChild(document.createTextNode(kind));
      if (lineIsAccessible(line)) meta.appendChild(accessIconEl(false));
      if (meta.childNodes.length) mid.appendChild(meta);

      const eta = document.createElement("span");
      eta.className = "line-eta";
      if (next && next.label) {
        eta.appendChild(etaValue(next));
        if (next.scheduled) {
          const flag = document.createElement("span");
          flag.className = "eta-flag";
          flag.textContent = "ORAR";
          eta.appendChild(flag);
        }
      } else {
        const dash = document.createElement("span");
        dash.className = "eta-dash";
        dash.textContent = "\u2014";
        eta.appendChild(dash);
      }

      main.append(bullet, mid, eta);
      main.addEventListener("click", () => selectLine(line));

      const fav = document.createElement("button");
      fav.type = "button";
      fav.className = "line-fav" + (isFav(line.id) ? " on" : "");
      fav.textContent = "\u2605";
      fav.setAttribute("aria-label", (isFav(line.id) ? "Scoate " : "Salvează linia ") + route);
      fav.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleFav(line);
        const on = isFav(line.id);
        fav.classList.toggle("on", on);
        fav.setAttribute("aria-label", (on ? "Scoate " : "Salvează linia ") + route);
        if (activeType === "saved") renderBoard();
      });

      row.append(main, fav);
      return row;
    }

    function renderBoard() {
      if (selectedLineId != null) return;
      if (searchResults && searchInput.value.trim().length >= 3) return;
      const list = visibleLines();
      if (!list.length) {
        if (activeType === "saved") {
          setLinesCount("0 salvate");
          setLinesListMessage("Nicio linie salvată. Atinge \u2605 pe o linie pentru a o salva.");
        } else if (activeType !== "all") {
          const f = FILTERS.find((x) => x.key === activeType);
          setLinesCount("0 linii");
          setLinesListMessage("Nicio linie " + ((f && f.label) || activeType) + " în apropiere.");
        } else {
          setLinesCount("0 linii");
          setLinesListMessage(nearbyLines.length ? "Nicio linie în apropiere." : "Nicio linie la stațiile din apropiere.");
        }
        return;
      }
      setLinesCount(list.length === 1 ? "1 linie" : list.length + " linii");
      linesListEl.replaceChildren();
      for (const line of list) linesListEl.appendChild(boardRow(line));
    }

    function renderSearchResults(places, q) {
      linesListEl.replaceChildren();
      if (!places.length) {
        setLinesCount("0 locuri");
        setLinesListMessage('Niciun loc pentru "' + q + '".');
        return;
      }
      setLinesCount(places.length === 1 ? "1 loc" : places.length + " locuri");
      for (const p of places) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "place-row";
        const icon = document.createElement("span");
        icon.className = "place-icon";
        icon.textContent = stopGlyph(p.type);
        const mid = document.createElement("span");
        mid.className = "place-mid";
        const nm = document.createElement("span");
        nm.className = "place-name";
        nm.textContent = p.name || "Loc";
        const ds = document.createElement("span");
        ds.className = "place-desc";
        ds.textContent = p.description || kindLabel(p.type) || "";
        mid.append(nm, ds);
        btn.append(icon, mid);
        btn.addEventListener("click", () => {
          const lng = Number(p.lng);
          const lat = Number(p.lat);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
          map.flyTo({ center: [lng, lat], zoom: 17, duration: prefersReducedMotion() ? 0 : 600 });
          if (p.stop_id != null) {
            openStopPopup({ id: p.stop_id, name: p.name, lat: lat, lng: lng }, [lng, lat]);
          }
        });
        linesListEl.appendChild(btn);
      }
    }

    function runSearch(q) {
      const gen = ++searchGen;
      setLinesListMessage("Se caută\u2026");
      apiJson("/places?query=" + encodeURIComponent(q))
        .then((json) => {
          if (gen !== searchGen) return;
          const places = (json && json.places) || [];
          searchResults = places;
          renderSearchResults(places, q);
        })
        .catch((e) => {
          if (gen !== searchGen) return;
          console.error(e);
          setLinesListMessage("Căutarea a eșuat.");
        });
    }

    function clearSearch() {
      searchResults = null;
      searchGen++;
      searchInput.value = "";
      searchClear.hidden = true;
      renderBoard();
    }

    function startClock() {
      const tick = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        clockEl.textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
        try {
          clockDateEl.textContent = d
            .toLocaleDateString("ro-RO", { weekday: "short", day: "numeric", month: "short" })
            .toUpperCase();
        } catch (e) {
          clockDateEl.textContent = "Bucure\u0219ti";
        }
      };
      tick();
      setInterval(tick, 1000);
    }

    let sheetSnaps = [];
    let sheetIndex = 0;
    let dragState = null;
    const SHEET_TAP_SLOP = 6;

    function measureSnaps() {
      if (!isCompactLayout()) {
        sheetSnaps = [];
        return;
      }
      const h = hudEl.getBoundingClientRect().height;
      const gripH = gripEl ? gripEl.getBoundingClientRect().height : 0;
      let peekVisible;
      if (hudEl.classList.contains("is-line")) {
        const bar = hudEl.querySelector(".line-bar");
        const barH = bar ? bar.getBoundingClientRect().height : 0;
        peekVisible = gripH + barH + 8;
      } else {
        const top = hudEl.querySelector(".hud-top");
        const search = hudEl.querySelector(".hud-search");
        const head = hudEl.querySelector(".hud-board-head");
        const topH = top ? top.getBoundingClientRect().height : 0;
        const searchH = search ? search.getBoundingClientRect().height : 0;
        const chipsH = chipsEl ? chipsEl.getBoundingClientRect().height : 0;
        const headH = head ? head.getBoundingClientRect().height : 0;
        peekVisible = gripH + topH + searchH + chipsH + headH + 8;
      }
      const halfVisible = Math.max(peekVisible, h * 0.55);
      const peek = Math.max(0, h - peekVisible);
      const half = Math.max(0, Math.min(peek, h - halfVisible));
      sheetSnaps = [0, half, peek];
    }

    function applySheetY(y) {
      document.documentElement.style.setProperty("--sheet-y", Math.round(y) + "px");
    }

    function setSheetIndex(i, animate) {
      if (!isCompactLayout() || !sheetSnaps.length) return;
      sheetIndex = Math.max(0, Math.min(sheetSnaps.length - 1, i));
      document.body.classList.toggle("has-full-sheet", sheetIndex === 0);
      hudEl.classList.remove("dragging");
      applySheetY(sheetSnaps[sheetIndex]);
      const collapsed = sheetIndex === sheetSnaps.length - 1;
      if (gripEl) {
        gripEl.setAttribute("aria-expanded", String(!collapsed));
        gripEl.setAttribute("aria-label", collapsed ? "Extinde panoul" : "Restrânge panoul");
      }
      syncMapPadding();
      window.setTimeout(syncMapPadding, 360);
    }

    function toggleSheet() {
      const collapsedIndex = sheetSnaps.length - 1;
      setSheetIndex(sheetIndex === collapsedIndex ? 0 : collapsedIndex, true);
    }

    function syncSheetLayout() {
      measureSnaps();
      if (isCompactLayout()) {
        if (sheetSnaps.length) {
          setSheetIndex(hudEl.classList.contains("is-line") ? 0 : 1, false);
        }
        return;
      }
      applySheetY(0);
      document.body.classList.remove("has-full-sheet");
      document.documentElement.style.setProperty("--hud-stack", "0px");
    }

    function setupSheet() {
      syncSheetLayout();
      const onDown = (ev) => {
        if (!isCompactLayout()) return;
        dragState = {
          startY: ev.clientY,
          startOffset: sheetSnaps[sheetIndex] || 0,
          fromGrip: ev.currentTarget === gripEl,
          moved: false,
        };
        hudEl.classList.add("dragging");
      };
      const onMove = (ev) => {
        if (!dragState) return;
        const dy = ev.clientY - dragState.startY;
        if (Math.abs(dy) > SHEET_TAP_SLOP) dragState.moved = true;
        const full = sheetSnaps[0] || 0;
        const peek = sheetSnaps[sheetSnaps.length - 1] || 0;
        applySheetY(Math.max(full, Math.min(peek, dragState.startOffset + dy)));
        if (ev.cancelable) ev.preventDefault();
      };
      const onUp = (ev) => {
        if (!dragState) return;
        const wasGripTap = ev.type === "pointerup" && dragState.fromGrip && !dragState.moved;
        dragState = null;
        if (wasGripTap) {
          toggleSheet();
          return;
        }
        const y = parseFloat(document.documentElement.style.getPropertyValue("--sheet-y")) || 0;
        let best = 0;
        let bestD = Infinity;
        sheetSnaps.forEach((s, i) => {
          const d = Math.abs(s - y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        setSheetIndex(best, true);
      };
      if (gripEl) {
        gripEl.addEventListener("pointerdown", onDown);
        gripEl.addEventListener("click", (ev) => {
          if (ev.detail === 0) toggleSheet();
        });
      }
      const top = hudEl.querySelector(".hud-top");
      if (top) {
        top.addEventListener("pointerdown", (ev) => {
          if (ev.target.closest("button, a, input")) return;
          onDown(ev);
        });
      }
      const lineBar = hudEl.querySelector(".line-bar");
      if (lineBar) {
        lineBar.addEventListener("pointerdown", (ev) => {
          if (ev.target.closest("button, a, input")) return;
          onDown(ev);
        });
      }
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim();
      searchClear.hidden = !q;
      clearTimeout(searchTimer);
      if (q.length < 3) {
        if (searchResults) {
          searchResults = null;
          searchGen++;
          renderBoard();
        }
        return;
      }
      searchTimer = setTimeout(() => runSearch(q), 280);
    });
    searchClear.addEventListener("click", () => {
      clearSearch();
      searchInput.focus();
    });

    function renderLinesList(lines) {
      nearbyLines = lines.slice();
      renderBoard();
    }

    function markSelectedRow() {
      linesListEl.querySelectorAll(".line-row").forEach((el) => {
        const on = el.dataset.id === String(selectedLineId);
        el.classList.toggle("selected", on);
        if (on) el.scrollIntoView({ block: "nearest" });
      });
    }

    function lineIdFromHash(hash) {
      const raw = String(hash == null ? location.hash : hash).replace(/^#/, "");
      const m = raw.match(/^(?:!\/(?:line\/)?)?([^/?#]+)\/?$/i);
      if (!m) return null;
      try {
        const id = decodeURIComponent(m[1]).trim();
        if (!id || /^line$/i.test(id)) return null;
        return id;
      } catch (e) {
        return null;
      }
    }

    function setLineHash(id) {
      const next = "#" + encodeURIComponent(String(id));
      if (location.hash === next) return;
      history.replaceState(null, "", location.pathname + location.search + next);
    }

    function clearLineHash() {
      if (!location.hash) return;
      history.replaceState(null, "", location.pathname + location.search);
    }

    function syncLineView() {
      const inLine = selectedLineId != null;
      nearbyView.hidden = inLine;
      lineView.hidden = !inLine;
      hudEl.classList.toggle("is-line", inLine);
      if (isCompactLayout()) {
        measureSnaps();
        setSheetIndex(inLine ? 0 : 1, true);
      }
      syncMapPadding();
    }

    function exitLine() {
      if (selectedLineId == null && !pathStopsOverride && !selectedLine) {
        syncLineView();
        return;
      }
      selectedLineId = null;
      selectedLine = null;
      selectedVehicleKey = null;
      pathStopsOverride = null;
      dirPaths = { 0: [], 1: [] };
      dirStops = { 0: [], 1: [] };
      detailDetail = null;
      detailDir = 0;
      lineStopPack = undefined;
      dirTouched = false;
      drawingLine = false;
      stopVehiclePoll();
      clearVehicles();
      lastPlottedVehicles = [];
      clearRoute();
      closeStopPopup();
      linePageEl.replaceChildren();
      setLineFoot("Se încarcă linia…");
      setLineBar(null);
      markSelectedRow();
      syncLineView();
      renderBoard();
      loadStops();
    }

    function goBackFromLine() {
      clearLineHash();
      exitLine();
    }

    backBtn.addEventListener("click", goBackFromLine);

    function lineFromNearby(id) {
      const sid = String(id);
      return nearbyLines.find((line) => String(line.id) === sid) || null;
    }

    function applyLineFromHash() {
      const id = lineIdFromHash();
      if (!id) {
        if (selectedLineId != null) exitLine();
        else syncLineView();
        return;
      }
      if (String(selectedLineId) === String(id) && selectedLine) return;
      const known = lineFromNearby(id) || (selectedLine && String(selectedLine.id) === String(id) ? selectedLine : null);
      return selectLine(known || { id: id });
    }

    async function mapConcurrent(items, limit, worker) {
      const results = new Array(items.length);
      let next = 0;
      const run = async () => {
        while (next < items.length) {
          const index = next++;
          results[index] = await worker(items[index], index);
        }
      };
      const workers = Array.from({ length: Math.min(limit, items.length) }, run);
      await Promise.all(workers);
      return results;
    }

    async function loadNearbyLines(stops) {
      const gen = ++nearbyGen;
      const ranked = nearestStops(stops, NEAREST_STOPS);
      if (!ranked.length) {
        nearbyLines = [];
        setLinesCount("0 linii");
        setLinesListMessage("Nicio stație în apropiere de unde să colectez linii.");
        return;
      }
      setLinesCount("Se încarcă linii de la " + countLabel(ranked.length, "stație", "stații") + "…");
      const byId = new Map();
      const publish = () => {
        const list = [...byId.values()].sort((a, b) => {
          const da = arrivalSortKey(a);
          const db = arrivalSortKey(b);
          if (da !== db) return da - db;
          return String(a.name || "").localeCompare(String(b.name || ""), "ro", { numeric: true });
        });
        setLinesCount(list.length + (list.length === 1 ? " linie" : " linii"));
        renderLinesList(list);
      };
      try {
        await mapConcurrent(ranked, 6, async (stop) => {
          const lines = await fetchStopLines(stop.id).catch((err) => {
            console.error("stop lines", stop.id, err);
            return [];
          });
          if (gen !== nearbyGen) return;
          for (const line of lines) {
            if (line == null || line.id == null) continue;
            const id = String(line.id);
            if (byId.has(id)) continue;
            const arrivals = lineArrivals(line);
            const dirRaw = line.direction != null ? Number(line.direction) : NaN;
            byId.set(id, {
              id: line.id,
              name: line.name,
              type: line.type,
              color: line.color,
              dest: line.direction_name || line.directionName || "",
              direction: dirRaw === 0 || dirRaw === 1 ? dirRaw : null,
              next: arrivals[0] || null,
              access: lineIsAccessible(line),
            });
          }
          if (byId.size) publish();
        });
        if (gen !== nearbyGen) return;
        publish();
      } catch (e) {
        if (gen !== nearbyGen) return;
        console.error(e);
        setLinesCount((e.message || "eroare linii") + (e.status ? " (" + e.status + ")" : ""), "err");
        setLinesListMessage("Nu s-au putut încărca liniile din apropiere.");
      }
    }

    function clearVehicles() {
      vehicleMarkerMap.forEach((m) => m.remove());
      vehicleMarkerMap.clear();
      vehicleMarkers = [];
    }

    function stopVehiclePoll() {
      if (vehicleTimer) {
        clearInterval(vehicleTimer);
        vehicleTimer = null;
      }
      vehicleGen += 1;
    }

    async function fetchVehicles(lineId, direction) {
      const path =
        "/lines/v2/" +
        encodeURIComponent(String(lineId)) +
        "/vehicles/" +
        direction +
        "?lang=ro";
      return apiJson(path);
    }

    function vehicleKey(v) {
      if (v && v.id != null) return String(v.id);
      if (v && v.code != null) return String(v.code);
      return "";
    }

    function vehicleAnimDelay(key) {
      const s = String(key || "");
      let n = 0;
      for (let i = 0; i < s.length; i++) n = (n + s.charCodeAt(i) * (i + 1)) % 17;
      return (n * 0.11).toFixed(2) + "s";
    }

    function vehicleSvg(type) {
      var t = modeKey(type);
      if (t === "BUS") {
        return '<svg class="vehicle-icon-svg" viewBox="0 0 22 22" width="20" height="20" fill="currentColor"><rect x="3" y="4" width="16" height="13" rx="3" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="6" y="6" width="3.5" height="3" rx="0.5" fill="currentColor" opacity="0.45"/><rect x="12.5" y="6" width="3.5" height="3" rx="0.5" fill="currentColor" opacity="0.45"/><rect x="5" y="11" width="12" height="2.5" rx="1" fill="currentColor" opacity="0.35"/><circle cx="7.5" cy="18.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="18.5" r="1.5" fill="currentColor"/><line x1="6" y1="2" x2="16" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      }
      if (t === "TRAM") {
        return '<svg class="vehicle-icon-svg" viewBox="0 0 22 22" width="20" height="20" fill="currentColor"><rect x="4" y="5" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="6" y="7" width="10" height="4" rx="1" fill="currentColor" opacity="0.35"/><rect x="6" y="12.5" width="10" height="2" rx="1" fill="currentColor" opacity="0.25"/><line x1="9" y1="5" x2="7" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="5" x2="15" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="2" x2="17" y2="2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="19.5" r="1.5" fill="currentColor"/><circle cx="14" cy="19.5" r="1.5" fill="currentColor"/></svg>';
      }
      if (t === "TROLLEYBUS") {
        return '<svg class="vehicle-icon-svg" viewBox="0 0 22 22" width="20" height="20" fill="currentColor"><rect x="4" y="6" width="14" height="11" rx="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="6" y="8" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4"/><rect x="12" y="8" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4"/><rect x="6" y="12.5" width="10" height="2" rx="1" fill="currentColor" opacity="0.25"/><line x1="11" y1="6" x2="11" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="2" x2="15" y2="2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="19" r="1.5" fill="currentColor"/><circle cx="14" cy="19" r="1.5" fill="currentColor"/></svg>';
      }
      if (t === "SUBWAY") {
        return '<svg class="vehicle-icon-svg" viewBox="0 0 22 22" width="20" height="20" fill="currentColor"><rect x="3" y="5" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="5.5" y="7" width="11" height="5" rx="1.5" fill="currentColor" opacity="0.35"/><path d="M7 14.5 L11 17 L15 14.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="7.5" cy="19.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="19.5" r="1.5" fill="currentColor"/></svg>';
      }
      return '<svg class="vehicle-icon-svg" viewBox="0 0 22 22" width="20" height="20" fill="currentColor"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="11" cy="11" r="4" fill="currentColor" opacity="0.3"/></svg>';
    }

    const ACCESS_SVG =
      '<svg class="access-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="9" cy="4.5" r="2" fill="currentColor" stroke="none"/>' +
      '<path d="M9 7v5.5h5l2.5 5"/>' +
      '<circle cx="10.5" cy="15.5" r="5.5"/>' +
      "</svg>";

    function hasModeIcon(type) {
      const key = modeKey(type);
      return key === "BUS" || key === "TRAM" || key === "TROLLEYBUS" || key === "SUBWAY" || key === "TRAIN" || key === "FERRY" || key === "WALK";
    }

    function modeIconEl(type) {
      if (!hasModeIcon(type)) return null;
      const span = document.createElement("span");
      span.className = "mode-icon";
      span.style.color = modeColor(type);
      span.setAttribute("aria-hidden", "true");
      span.innerHTML = vehicleSvg(type);
      return span;
    }

    function lineIsAccessible(obj) {
      return !!(obj && (obj.access || obj.has_disability || obj.hasDisability));
    }

    function accessIconEl(withLabel) {
      const span = document.createElement("span");
      span.className = "access-icon" + (withLabel ? " has-label" : "");
      span.innerHTML = ACCESS_SVG;
      if (withLabel) {
        const t = document.createElement("span");
        t.className = "access-label";
        t.textContent = "Accesibil";
        span.appendChild(t);
      } else {
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", "Accesibil");
        span.title = "Accesibil";
      }
      return span;
    }

    function vehicleLatLng(v) {
      const lat = Number(v && (v.lat != null ? v.lat : v.latitude));
      const lng = Number(v && (v.lng != null ? v.lng : v.longitude));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) return null;
      return [lat, lng];
    }

    function distToSeg2(px, py, ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      return ex * ex + ey * ey;
    }

    function bearingDeg(lat1, lng1, lat2, lng2) {
      const r = Math.PI / 180;
      const φ1 = lat1 * r;
      const φ2 = lat2 * r;
      const Δλ = (lng2 - lng1) * r;
      const y = Math.sin(Δλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }

    function bearingOnPath(lat, lng, latlngs) {
      if (!latlngs || latlngs.length < 2) return null;
      let best = Infinity;
      let bestI = -1;
      for (let i = 0; i < latlngs.length - 1; i++) {
        const a = latlngs[i];
        const b = latlngs[i + 1];
        const d = distToSeg2(lng, lat, a[1], a[0], b[1], b[0]);
        if (d < best) {
          best = d;
          bestI = i;
        }
      }
      if (bestI < 0) return null;
      const a = latlngs[bestI];
      const b = latlngs[bestI + 1];
      return bearingDeg(a[0], a[1], b[0], b[1]);
    }

    function mobiAge(timestamp, ageSeconds) {
      let seconds = ageSeconds == null || ageSeconds === "" ? null : Number(ageSeconds);
      if (seconds != null && Number.isFinite(seconds)) {
        seconds = Math.max(0, Math.floor(seconds));
      } else {
        seconds = null;
        const time = Date.parse(String(timestamp || ""));
        if (Number.isFinite(time)) seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
      }
      if (seconds == null) return { label: "indisponibil", stale: true, seconds: null };
      let label = "acum";
      if (seconds >= 60 && seconds < 3600) label = Math.floor(seconds / 60) + " min";
      else if (seconds >= 3600) label = Math.floor(seconds / 3600) + " h";
      return { label: label, stale: seconds > 120, seconds: seconds };
    }

    function vehicleApiField(vehicle, snake, camel) {
      if (!vehicle) return null;
      const snakeValue = vehicle[snake];
      return snakeValue != null && snakeValue !== "" ? snakeValue : vehicle[camel];
    }

    function vehicleDisplayValue(value) {
      if (value == null || value === "") return "—";
      if (typeof value === "boolean") return value ? "Da" : "Nu";
      return escapeHtml(String(value));
    }

    function vehicleDisplayNumber(value) {
      if (value == null || value === "") return "—";
      const number = Number(value);
      return Number.isFinite(number) ? escapeHtml(String(number)) : vehicleDisplayValue(value);
    }

    function vehicleDisplayCoordinate(value) {
      if (value == null || value === "") return "—";
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(6) : vehicleDisplayValue(value);
    }

    function vehicleDisplayTimestamp(value) {
      if (value == null || value === "") return "—";
      const raw = String(value);
      const time = Date.parse(raw);
      if (!Number.isFinite(time)) return escapeHtml(raw);
      const date = new Date(time);
      return (
        '<time datetime="' +
        escapeHtml(date.toISOString()) +
        '" title="' +
        escapeHtml(raw) +
        '">' +
        escapeHtml(date.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })) +
        "</time>"
      );
    }

    function vehicleDisplayAge(age) {
      return age && age.seconds != null ? escapeHtml(String(age.seconds)) + " s" : "—";
    }

    function vehicleApiRow(label, value, className, valueClass) {
      return (
        '<div class="vehicle-api-row ' +
        (className || "") +
        '"><span>' +
        escapeHtml(label) +
        '</span><strong class="' +
        (valueClass || "") +
        '">' +
        (value || "—") +
        "</strong></div>"
      );
    }

    function vehicleRequestDirection(vehicle) {
      const raw = vehicle && vehicle.direction;
      if (raw == null || raw === "") return null;
      const direction = Number(raw);
      return Number.isFinite(direction) ? direction : null;
    }

    function vehicleDestination(vehicle) {
      const direction = vehicleRequestDirection(vehicle);
      return direction == null ? "" : directionLabel(direction);
    }

    function vehicleAccessValue(vehicle, fallback) {
      const value = vehicleApiField(vehicle, "has_disability", "hasDisability");
      return value == null ? (fallback == null ? null : !!fallback) : !!value;
    }

    function vehicleEnrichmentHtml(vehicle, hasAccess) {
      const mobi = vehicle && vehicle.mobi;
      if (!mobi && hasAccess == null) return "";
      const rows = [];
      const plate = mobi && mobi.licensePlate != null ? String(mobi.licensePlate) : "";
      if (mobi) {
        rows.push(vehicleApiRow("Placă", vehicleDisplayValue(plate), "vehicle-enrichment-plate"));
        rows.push(vehicleApiRow("Pasageri la bord", vehicleDisplayNumber(mobi.passengerCount), "vehicle-enrichment-passengers"));
        rows.push(vehicleApiRow("În urcări", vehicleDisplayNumber(mobi.boarded), "vehicle-enrichment-boarded"));
        rows.push(vehicleApiRow("Coborâri", vehicleDisplayNumber(mobi.alighted), "vehicle-enrichment-alighted"));
      } else {
        rows.push('<div class="vehicle-data-empty">Datele live mo-bi nu sunt disponibile.</div>');
      }
      if (hasAccess != null) {
        rows.push(
          vehicleApiRow(
            "Accesibil",
            hasAccess ? '<span class="access-icon">' + ACCESS_SVG + "</span>Da" : "Nu",
            "vehicle-enrichment-access"
          )
        );
      }
      return (
        '<div class="vehicle-enrichment">' +
        '<div class="vehicle-enrichment-heading"><span>Informații utile</span><span>' +
        (mobi ? "STB + mo-bi" : "STB · fără mo-bi") +
        "</span></div>" +
        rows.join("") +
        "</div>"
      );
    }

    function vehicleApiDetailsHtml(vehicle) {
      const mobi = vehicle && vehicle.mobi;
      const ll = vehicleLatLng(vehicle);
      const access = vehicleAccessValue(vehicle, null);
      const requestDirection = vehicleRequestDirection(vehicle);
      const mobiDirection = mobi && mobi.direction;
      const matchLabels = {
        id: "ID",
        code: "cod flotă",
        hardware: "ID hardware",
        "id+code": "ID + cod",
        "id+hardware": "ID + hardware",
      };
      const matchedBy = mobi && mobi.matchedBy ? matchLabels[mobi.matchedBy] || mobi.matchedBy : null;
      const stbRows = [
        vehicleApiRow("ID", vehicleDisplayValue(vehicleApiField(vehicle, "id", "id"))),
        vehicleApiRow("Latitudine", vehicleDisplayCoordinate(ll && ll[0])),
        vehicleApiRow("Longitudine", vehicleDisplayCoordinate(ll && ll[1])),
        vehicleApiRow("Cod flotă", vehicleDisplayValue(vehicleApiField(vehicle, "code", "code"))),
        vehicleApiRow("Tip transport", vehicleDisplayValue(vehicleApiField(vehicle, "transport_type", "transportType"))),
        vehicleApiRow("Accesibil", access == null ? "—" : access ? "Da" : "Nu"),
        vehicleApiRow("Direcție cerută", vehicleDisplayNumber(requestDirection)),
      ];
      const mobiRows = [
        vehicleApiRow("Sursă", vehicleDisplayValue(mobi && mobi.source)),
        vehicleApiRow("Placă", vehicleDisplayValue(mobi && mobi.licensePlate)),
        vehicleApiRow("Pasageri la bord", vehicleDisplayNumber(mobi && mobi.passengerCount)),
        vehicleApiRow("În urcări", vehicleDisplayNumber(mobi && mobi.boarded)),
        vehicleApiRow("Coborâri", vehicleDisplayNumber(mobi && mobi.alighted)),
        vehicleApiRow("Timestamp pasageri", vehicleDisplayTimestamp(mobi && mobi.passengerTimestamp)),
        vehicleApiRow("Vârstă pasageri", vehicleDisplayAge(mobi && mobi.passengerAgeSeconds != null ? mobiAge(mobi.passengerTimestamp, mobi.passengerAgeSeconds) : null)),
        vehicleApiRow("Timestamp poziție", vehicleDisplayTimestamp(mobi && mobi.positionTimestamp)),
        vehicleApiRow("Vârstă poziție", vehicleDisplayAge(mobi && mobi.positionAgeSeconds != null ? mobiAge(mobi.positionTimestamp, mobi.positionAgeSeconds) : null)),
        vehicleApiRow("Timestamp sursă", vehicleDisplayTimestamp(mobi && mobi.sourceTimestamp)),
        vehicleApiRow("ID sursă", vehicleDisplayNumber(mobi && mobi.sourceId)),
        vehicleApiRow("ID traseu", vehicleDisplayNumber(mobi && mobi.routeId)),
        vehicleApiRow("Direcție mo-bi", vehicleDisplayNumber(mobiDirection)),
        vehicleApiRow("Start cursă", vehicleDisplayTimestamp(mobi && mobi.tripStartTime)),
        vehicleApiRow("Potrivire", vehicleDisplayValue(matchedBy)),
      ];
      return (
        '<details class="vehicle-api-details">' +
        '<summary><span>Toate datele API</span><span class="vehicle-api-count">22 câmpuri</span></summary>' +
        '<div class="vehicle-api-groups">' +
        '<section class="vehicle-api-group"><h3>STB · vehicul</h3>' + stbRows.join("") + "</section>" +
        '<section class="vehicle-api-group"><h3>mo-bi.ro · detalii</h3>' + mobiRows.join("") + "</section>" +
        "</div></details>"
      );
    }

    function vehiclePopupHtml(vehicle, label, fleet, kind, fill, ink, hasAccess) {
      const kindName = kindLabel(kind) || "Vehicul";
      const mobi = vehicle && vehicle.mobi;
      const positionAge = mobi ? mobiAge(mobi.positionTimestamp, mobi.positionAgeSeconds) : null;
      const positionState = !positionAge || positionAge.seconds == null ? "unknown" : positionAge.stale ? "stale" : "live";
      const positionLabel = positionState === "live" ? "LIVE" : positionState === "stale" ? "VECHI" : "FĂRĂ POZIȚIE";
      const positionClass = positionState === "live" ? "is-live" : positionState === "stale" ? "is-stale" : "is-unknown";
      const vehicleIdValue = vehicleApiField(vehicle, "id", "id");
      const codeValue = vehicleApiField(vehicle, "code", "code");
      const vehicleId = vehicleIdValue != null ? String(vehicleIdValue) : "";
      const code = codeValue != null ? String(codeValue) : "";
      const identity = code ? "Flotă #" + code : vehicleId ? "ID " + vehicleId : "Identificator indisponibil";
      const destination = vehicleDestination(vehicle) || "Destinație indisponibilă";
      const access = vehicleAccessValue(vehicle, hasAccess);
      return (
        '<div id="vehicle-popup" class="vehicle-popup" role="dialog" aria-label="Informații vehicul ' +
        escapeHtml(label) +
        '">' +
        '<div class="vehicle-popup-header">' +
        '<span class="vehicle-popup-route" style="--popup-route:' +
        fill +
        ";--popup-route-ink:" +
        ink +
        '">' +
        escapeHtml(label) +
        "</span>" +
        '<div class="vehicle-popup-heading"><div class="vehicle-popup-title">' +
        escapeHtml(kindName) +
        '</div><div class="vehicle-popup-subtitle">Spre ' +
        escapeHtml(destination) +
        "</div></div>" +
        '<span class="vehicle-popup-status ' +
        positionClass +
        '">' +
        positionLabel +
        "</span>" +
        "</div>" +
        '<div class="vehicle-popup-context"><div><span>VEHICUL</span><strong>' +
        escapeHtml(identity) +
        '</strong></div><div><span>DESTINAȚIE</span><strong>' +
        escapeHtml(destination) +
        "</strong></div></div>" +
        vehicleEnrichmentHtml(vehicle, access) +
        vehicleApiDetailsHtml(vehicle) +
        "</div>"
      );
    }

    function setVehiclePopupLabels(popup) {
      const apply = () => {
        const element = popup && popup.getElement && popup.getElement();
        const close = element && element.querySelector(".maplibregl-popup-close-button");
        if (close) close.setAttribute("aria-label", "Închide informațiile vehiculului");
      };
      apply();
      requestAnimationFrame(apply);
    }

    function vehicleMarkerKey(vehicle) {
      const key = vehicleKey(vehicle);
      return key ? key + ":" + String(vehicle.direction == null ? "" : vehicle.direction) : "";
    }

    function vehicleMarkerHtml(vehicle, label, fleet, kind, brg) {
      return (
        '<span class="vehicle-mark"><span class="vehicle-beacon"><span class="vehicle-icon' +
        (brg != null ? " has-heading" : "") +
        '"' +
        (brg != null ? ' style="--veh-brg:' + brg.toFixed(1) + 'deg"' : "") +
        ' data-veh-type="' +
        escapeHtml(String(kind || "").toUpperCase()) +
        '"><svg class="vehicle-arrow" viewBox="0 0 12 14" width="10" height="12"><polygon points="6,0 12,14 0,14" fill="currentColor"/></svg>' +
        vehicleSvg(kind) +
        '</span></span><span class="vehicle-code">' +
        escapeHtml(label) +
        "</span></span>"
      );
    }

    function vehicleMarkerAria(vehicle, label, fleet, kind, hasAccess) {
      const plate = vehicle && vehicle.mobi && vehicle.mobi.licensePlate ? ", placa " + vehicle.mobi.licensePlate : "";
      return (
        "Vehicul " +
        label +
        (fleet && fleet !== label ? " flotă " + fleet : "") +
        (kind ? ", " + kindLabel(kind) : "") +
        (hasAccess ? ", accesibil" : "") +
        plate
      );
    }

    function updateVehicleMarker(marker, vehicle, label, fleet, kind, fill, ink, hasAccess, brg, selected, openKey) {
      const element = marker._vehicleElement;
      const key = vehicleKey(vehicle);
      const ll = vehicleLatLng(vehicle);
      const popup = marker.getPopup();
      const popupElement = popup && popup.getElement && popup.getElement();
      const oldDetails = popupElement && popupElement.querySelector(".vehicle-api-details");
      const detailsOpen = !!(oldDetails && oldDetails.open);
      const oldBoard = popupElement && popupElement.querySelector(".vehicle-popup");
      const scrollTop = oldBoard ? oldBoard.scrollTop : 0;
      marker._vehicle = vehicle;
      marker.setLngLat([ll[1], ll[0]]);
      element.className = "vehicle-no" + (selected ? " selected" : "");
      element.style.setProperty("--veh", fill);
      element.style.setProperty("--veh-ink", ink);
      element.style.setProperty("--veh-delay", vehicleAnimDelay(key));
      element.setAttribute("aria-label", vehicleMarkerAria(vehicle, label, fleet, kind, hasAccess));
      element.innerHTML = vehicleMarkerHtml(vehicle, label, fleet, kind, brg);
      popup.setHTML(vehiclePopupHtml(vehicle, label, fleet, kind, fill, ink, hasAccess));
      requestAnimationFrame(() => {
        const nextElement = popup.getElement && popup.getElement();
        const nextDetails = nextElement && nextElement.querySelector(".vehicle-api-details");
        if (detailsOpen && nextDetails) nextDetails.open = true;
        const nextBoard = nextElement && nextElement.querySelector(".vehicle-popup");
        if (nextBoard) nextBoard.scrollTop = scrollTop;
        setVehiclePopupLabels(popup);
      });
      if (openKey && key === openKey) {
        if (!popup.isOpen()) marker.togglePopup();
        requestAnimationFrame(() => keepVehiclePopupInView(popup));
      }
    }

    function plotVehicles(vehicles, color, opts) {
      const routeNo = (selectedLine && selectedLine.name) || "";
      const openKey = opts && opts.openKey;
      const fill = cssColor(color);
      const ink = inkOnHex(fill);
      const activeKeys = new Set();
      (vehicles || []).forEach((v) => {
        const ll = vehicleLatLng(v);
        const markerKey = vehicleMarkerKey(v);
        if (!ll || !markerKey || activeKeys.has(markerKey)) return;
        const fleet = v.code != null ? String(v.code) : vehicleKey(v) || "";
        const label = routeNo || fleet || "?";
        const kind = v.transport_type || v.transportType || "";
        const hasAccess = !!(v.has_disability || v.hasDisability);
        const key = vehicleKey(v);
        const selected = key && key === selectedVehicleKey;
        const otherWay = v.direction != null && Number(v.direction) !== detailDir;
        if (otherWay) return;
        const path = dirPaths[v.direction];
        const brg = path ? bearingOnPath(ll[0], ll[1], path) : null;
        const existing = vehicleMarkerMap.get(markerKey);
        if (existing) {
          activeKeys.add(markerKey);
          updateVehicleMarker(existing, v, label, fleet, kind, fill, ink, hasAccess, brg, selected, openKey);
          return;
        }
        const element = document.createElement("div");
        element.className = "vehicle-no" + (selected ? " selected" : "");
        element.style.setProperty("--veh", fill);
        element.style.setProperty("--veh-ink", ink);
        element.style.setProperty("--veh-delay", vehicleAnimDelay(key));
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", vehicleMarkerAria(v, label, fleet, kind, hasAccess));
        element.innerHTML = vehicleMarkerHtml(v, label, fleet, kind, brg);
        const popup = new maplibregl.Popup({
          offset: 18,
          closeButton: true,
          closeOnMove: false,
          focusAfterOpen: false,
          maxWidth: "min(352px, calc(100vw - 16px))",
          className: "vehicle-popup-wrap",
        }).setHTML(vehiclePopupHtml(v, label, fleet, kind, fill, ink, hasAccess));
        const marker = new maplibregl.Marker({ element, anchor: "center", offset: [0, 0] })
          .setLngLat([ll[1], ll[0]])
          .setPopup(popup)
          .addTo(map);
        marker._vehKey = key;
        setVehiclePopupLabels(popup);
        marker._vehicleKey = markerKey;
        marker._vehicleElement = element;
        marker._vehicle = v;
        element.addEventListener("click", (ev) => {
          ev.stopPropagation();
          showPathForVehicle(marker._vehicle);
        });
        element.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          showPathForVehicle(marker._vehicle);
        });
        vehicleMarkerMap.set(markerKey, marker);
        activeKeys.add(markerKey);
        if (openKey && key === openKey) {
          marker.togglePopup();
          requestAnimationFrame(() => keepVehiclePopupInView(popup));
        }
      });
      for (const [key, marker] of vehicleMarkerMap) {
        if (activeKeys.has(key)) continue;
        marker.remove();
        vehicleMarkerMap.delete(key);
      }
      vehicleMarkers = Array.from(vehicleMarkerMap.values());
    }

    async function loadDirPaths(lineId) {
      const next = { 0: [], 1: [] };
      const stops = { 0: [], 1: [] };
      await Promise.all(
        [0, 1].map(async (dir) => {
          try {
            const d = await fetchLineDirection(lineId, dir);
            next[dir] = decodePolyline(segmentPathOf(d));
            stops[dir] = d.stops || [];
          } catch (err) {
            console.error("direction path", dir, err);
            next[dir] = [];
            stops[dir] = [];
          }
        })
      );
      dirStops = stops;
      return next;
    }

    async function fetchLineDirection(lineId, dir) {
      const key = String(lineId) + ":" + dir;
      if (lineDirCache.has(key)) return lineDirCache.get(key);
      const detail = await fetchLineDetail(lineId, "/direction/" + dir);
      lineDirCache.set(key, detail);
      return detail;
    }

    async function lineStopsFromDetail(lineId, detail) {
      const primary = (detail && detail.stops) || [];
      if (primary.length) return primary;
      const packs = await Promise.all(
        [0, 1].map((dir) =>
          fetchLineDirection(lineId, dir).catch((err) => {
            console.error("direction stops", dir, err);
            return { stops: [] };
          })
        )
      );
      const seen = new Set();
      const out = [];
      for (const pack of packs) {
        for (const s of pack.stops || []) {
          const id = s.id != null ? String(s.id) : String(s.lat) + ":" + String(s.lng);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(s);
        }
      }
      return out;
    }

    function showPathForVehicle(v) {
      const line = selectedLine;
      if (!line) return;
      selectedVehicleKey = vehicleKey(v);
      if (isCompactLayout() && sheetSnaps.length) setSheetIndex(sheetSnaps.length - 1, true);
      plotVehicles(lastPlottedVehicles, routeColor(line), { openKey: selectedVehicleKey });
      window.setTimeout(() => {
        const marker = vehicleMarkerMap.get(vehicleMarkerKey(v));
        if (marker) keepVehiclePopupInView(marker.getPopup());
      }, 380);
    }

    async function refreshVehicles(line) {
      const gen = ++vehicleGen;
      const id = line.id;
      try {
        const packs = await Promise.all(
          [0, 1].map((dir) =>
            fetchVehicles(id, dir).catch((err) => {
              console.error("vehicles", dir, err);
              return { vehicles: [] };
            })
          )
        );
        if (gen !== vehicleGen || String(selectedLineId) !== String(id)) return;
        const list = [];
        const seen = new Set();
        packs.forEach((pack, dir) => {
          for (const v of pack.vehicles || []) {
            const key = v.id != null ? String(v.id) : v.code + ":" + v.lat + ":" + v.lng;
            if (seen.has(key)) continue;
            seen.add(key);
            list.push(Object.assign({}, v, { direction: dir }));
          }
        });
        lastPlottedVehicles = list;
        plotVehicles(list, routeColor(line));
        updateDirVehicleCounts();
      } catch (e) {
        if (gen !== vehicleGen) return;
        console.error(e);
      }
    }

    function startVehiclePoll(line) {
      stopVehiclePoll();
      selectedLine = line;
      refreshVehicles(line);
      vehicleTimer = setInterval(() => refreshVehicles(line), VEHICLE_POLL_MS);
    }

    function clearRoute() {
      stopRouteFlow();
      setSourceData("route", emptyFC());
    }

    // Dash sequence that shifts the gap forward along the line's coordinate
    // order. Since each direction's polyline is ordered start→end in travel
    // direction, the pulse flows the way vehicles actually move.
    const ROUTE_FLOW_DASHES = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
      [0, 1, 3, 3],
      [0, 1.5, 3, 2.5],
      [0, 2, 3, 2],
      [0, 2.5, 3, 1.5],
      [0, 3, 3, 1],
      [0, 3.5, 3, 0.5],
    ];
    let routeFlowRAF = null;
    let routeFlowLast = 0;
    let routeFlowStep = 0;

    function stopRouteFlow() {
      if (routeFlowRAF != null) cancelAnimationFrame(routeFlowRAF);
      routeFlowRAF = null;
    }

    function startRouteFlow() {
      if (routeFlowRAF != null || prefersReducedMotion() || selectedLineId == null) return;
      const tick = (ts) => {
        if (selectedLineId == null || !map || !map.getLayer("route-flow")) {
          stopRouteFlow();
          return;
        }
        routeFlowRAF = requestAnimationFrame(tick);
        if (ts - routeFlowLast < 55) return;
        routeFlowLast = ts;
        routeFlowStep = (routeFlowStep + 1) % ROUTE_FLOW_DASHES.length;
        map.setPaintProperty("route-flow", "line-dasharray", ROUTE_FLOW_DASHES[routeFlowStep]);
      };
      routeFlowRAF = requestAnimationFrame(tick);
    }

    function drawDirRoutes(color, opts) {
      const stroke = cssColor(color);
      const features = [];
      const lngLats = [];
      const activeHasPath = dirPaths[detailDir] && dirPaths[detailDir].length >= 2;
      for (const dir of [0, 1]) {
        const latlngs = dirPaths[dir];
        if (!latlngs || latlngs.length < 2) continue;
        const coords = latlngs.map((p) => [p[1], p[0]]);
        coords.forEach((c) => lngLats.push(c));
        const active = activeHasPath ? dir === detailDir : true;
        features.push({
          type: "Feature",
          properties: { color: stroke, active: active ? 1 : 0 },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
      setSourceData("route", { type: "FeatureCollection", features: features });
      if (map.getLayer("route-line")) {
        map.setPaintProperty("route-line", "line-color", stroke);
      }
      if (!features.length) {
        stopRouteFlow();
        return false;
      }
      startRouteFlow();
      if (!(opts && opts.fit === false)) {
        fitMapBounds(boundsFromLngLats(lngLats), 0.12);
      }
      return true;
    }

    async function fetchLineDetail(lineId, suffix) {
      const path = "/lines/" + encodeURIComponent(String(lineId)) + (suffix || "") + "?lang=ro";
      return apiJson(path);
    }

    async function selectLine(line) {
      if (drawingLine) return;
      const startZoom = map ? map.getZoom() : MAP_ZOOM.initial;
      drawingLine = true;
      selectedLineId = line.id;
      selectedLine = line;
      selectedVehicleKey = null;
      pathStopsOverride = null;
      dirPaths = { 0: [], 1: [] };
      dirStops = { 0: [], 1: [] };
      detailDetail = null;
      detailDir = initialDir(line);
      lineStopPack = undefined;
      dirTouched = false;
      stopListPinned = true;
      stopListScroll = 0;
      setLineHash(line.id);
      setLineBar(line);
      setLineFoot("Se încarcă vehiculele…");
      renderLinePage();
      syncLineView();
      stopVehiclePoll();
      clearVehicles();
      lastPlottedVehicles = [];
      clearStops();
      closeStopPopup();
      startVehiclePoll(line);
      try {
        const detail = await fetchLineDetail(line.id);
        if (String(selectedLineId) !== String(line.id)) return;
        detailDetail = detail;
        if (detail) {
          if (!line.name && detail.name) line.name = detail.name;
          if (!line.type && detail.type) line.type = detail.type;
          if (!line.color && detail.color) line.color = detail.color;
          selectedLine = line;
          setLineBar(line);
        }
        if (!dirTouched) detailDir = initialDir(line);
        renderLinePage();
        dirPaths = await loadDirPaths(line.id);
        if (String(selectedLineId) !== String(line.id)) return;
        if (!dirPaths[0].length && !dirPaths[1].length) {
          const main = decodePolyline(segmentPathOf(detail));
          if (main.length) dirPaths[detailDir] = main;
        }
        const stops = (dirStops[detailDir] && dirStops[detailDir].length)
          ? dirStops[detailDir]
          : await lineStopsFromDetail(line.id, detail);
        if (String(selectedLineId) !== String(line.id)) return;
        pathStopsOverride = stops;
        const ok = drawDirRoutes(routeColor(line), { fit: false });
        map.easeTo({
          zoom: Math.max(MAP_ZOOM.minimum, startZoom - MAP_ZOOM.routeOverviewReduction),
          duration: prefersReducedMotion() ? 0 : 400,
        });
        await setLineDirection(detailDir, { force: true });
        if (String(selectedLineId) !== String(line.id)) return;
        if (!ok) setLineFoot("Nicio rută desenată pentru această linie", "warn");
        else updateDirVehicleCounts();
      } catch (e) {
        console.error(e);
        setLineFoot((e.message || "eroare linie") + (e.status ? " (" + e.status + ")" : ""), "err");
      } finally {
        drawingLine = false;
      }
    }

    async function loadStops() {
      if (map.getZoom() < MAP_ZOOM.minimum) {
        if (pathStopsOverride || selectedLineId) return;
        setStatus("Apropie la " + MAP_ZOOM.minimum + "+ pentru a încărca stațiile (acum " + Math.round(map.getZoom()) + ")", "warn");
        clearStops();
        lastStops = [];
        setLinesCount("Apropie");
        setLinesListMessage("Apropie la " + MAP_ZOOM.minimum + "+ pentru a încărca liniile din apropiere.");
        return;
      }
      if (selectedLineId != null) return;
      const gen = ++fetchGen;
      const path = "/lines/v2/home/stops/" + parseBoundsPath(map.getBounds());
      if (!selectedLineId)       setStatus("Se încarcă stațiile…");
      try {
        const obj = await apiJson(path);
        if (gen !== fetchGen) return;
        lastStops = obj.stops || [];
        if (pathStopsOverride) {
          plotStops(pathStopsOverride, { keepView: true });
        } else if (selectedLineId) {
          clearStops();
        } else {
          const n = plotStops(lastStops);
          statusEl.innerHTML =
            '<span class="count">' + n + "</span> " + countUnit(n, "stație", "stații") + " în apropiere";
          statusEl.className = "hud-status ok";
          setFeedState("ok");
        }
        if (selectedLineId == null) await loadNearbyLines(lastStops);
      } catch (e) {
        if (gen !== fetchGen) return;
        console.error(e);
        setStatus((e.message || "eroare încărcare") + (e.status ? " (" + e.status + ")" : ""), "err");
        setLinesCount((e.message || "eroare încărcare"), "err");
      }
    }

    function setUserLoc(lat, lng, accuracy) {
      userLngLat = { lat: lat, lng: lng };
      const features = [
        {
          type: "Feature",
          properties: { kind: "you" },
          geometry: { type: "Point", coordinates: [lng, lat] },
        },
      ];
      if (accuracy && Number.isFinite(accuracy) && accuracy > 8) {
        features.unshift({
          type: "Feature",
          properties: { kind: "accuracy" },
          geometry: accuracyPolygon(lng, lat, accuracy),
        });
      }
      setSourceData("user", { type: "FeatureCollection", features: features });
    }

    function locate() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({ lat: CITY.lat, lng: CITY.lng, acc: null, fallback: true, reason: "no geolocation API" });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              acc: pos.coords.accuracy,
              fallback: false,
            });
          },
          (err) => {
            resolve({
              lat: CITY.lat,
              lng: CITY.lng,
              acc: null,
              fallback: true,
              reason: err && err.message ? err.message : "denied",
            });
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
        );
      });
    }

    async function recenterOnUser() {
      const btn = document.querySelector(".map-locate");
      const status = document.getElementById("map-rail-status");
      let resultMessage = "Locația a fost actualizată.";
      if (btn) {
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-busy", "true");
      }
      if (status) status.textContent = "Se localizează…";
      if (selectedLineId == null) setStatus("Se localizează…");
      try {
        const loc = await locate();
        setUserLoc(loc.lat, loc.lng, loc.acc);
        map.stop();
        map.jumpTo({
          center: [loc.lng, loc.lat],
          zoom: Math.max(MAP_ZOOM.minimum, MAP_ZOOM.initial - MAP_ZOOM.userLocationReduction),
        });
        console.log("User location zoom:", map.getZoom());
        if (loc.fallback) {
          resultMessage = "Locația nu este disponibilă. Folosim centrul București.";
          if (selectedLineId == null) {
            setStatus("Fallback locație: centrul București (" + loc.reason + ")", "warn");
          }
        }
      } catch (err) {
        resultMessage = "Locația nu a putut fi actualizată.";
        if (selectedLineId == null) setStatus(resultMessage, "err");
        console.error("Location recenter failed", err);
      } finally {
        if (btn) {
          btn.removeAttribute("aria-disabled");
          btn.removeAttribute("aria-busy");
        }
        if (status) status.textContent = resultMessage;
      }
    }

    let attributionOpenPreference = null;

    function setupAttributionControl() {
      const details = map && map.getContainer && map.getContainer().querySelector(".maplibregl-ctrl-attrib");
      const button = details && details.querySelector(".maplibregl-ctrl-attrib-button");
      if (!details || !button) return;
      const container = details.closest(".maplibregl-ctrl-bottom-right");
      const label = "Informații despre hartă";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const open = !details.open;
        details.open = open;
        details.classList.toggle("maplibregl-compact-show", open);
        if (container) container.classList.toggle("is-attribution-open", open);
        attributionOpenPreference = open;
      }, true);
      details.addEventListener("toggle", () => {
        if (container) container.classList.toggle("is-attribution-open", details.open);
      });
      collapseAttribution();
    }

    function settleAttributionControl() {
      const details = map && map.getContainer && map.getContainer().querySelector(".maplibregl-ctrl-attrib");
      if (!details) return;
      const open = attributionOpenPreference === true;
      if (details.open !== open) details.open = open;
      details.classList.toggle("maplibregl-compact-show", open);
      const container = details.closest(".maplibregl-ctrl-bottom-right");
      if (container) container.classList.toggle("is-attribution-open", open);
    }

    function collapseAttribution() {
      const el = map && map.getContainer && map.getContainer().querySelector(".maplibregl-ctrl-attrib");
      if (!el) return;
      el.classList.remove("maplibregl-compact-show");
      el.removeAttribute("open");
      if ("open" in el) el.open = false;
    }

    function railButton(className, label, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-rail-btn " + className;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.innerHTML = '<span class="map-rail-icon" aria-hidden="true"></span>';
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
        onClick();
      });
      return btn;
    }

    function zoomDuration() {
      return prefersReducedMotion() ? 0 : 220;
    }

    function MapRailControl() {}
    MapRailControl.prototype.onAdd = function (mapInstance) {
      const wrap = document.createElement("div");
      wrap.className = "maplibregl-ctrl map-rail";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Controale hartă");

      const zoomIn = railButton("map-zoom-in", "Mărește", () => {
        mapInstance.zoomIn({ duration: zoomDuration() });
      });
      const zoomOut = railButton("map-zoom-out", "Micșorează", () => {
        mapInstance.zoomOut({ duration: zoomDuration() });
      });
      const locateBtn = railButton("map-locate", "Locația mea", () => {
        recenterOnUser();
      });
      const zoomGroup = document.createElement("div");
      zoomGroup.className = "map-rail-zoom";
      zoomGroup.setAttribute("role", "group");
      zoomGroup.setAttribute("aria-label", "Nivelul de zoom");
      const status = document.createElement("span");
      status.id = "map-rail-status";
      status.className = "map-rail-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      locateBtn.setAttribute("aria-describedby", status.id);

      const syncZoomState = () => {
        const zoom = mapInstance.getZoom();
        const zoomInDisabled = zoom >= mapInstance.getMaxZoom() - 0.01;
        const zoomOutDisabled = zoom <= mapInstance.getMinZoom() + 0.01;
        zoomIn.setAttribute("aria-disabled", String(zoomInDisabled));
        zoomOut.setAttribute("aria-disabled", String(zoomOutDisabled));
        zoomIn.tabIndex = zoomInDisabled ? -1 : 0;
        zoomOut.tabIndex = zoomOutDisabled ? -1 : 0;
      };
      this._map = mapInstance;
      this._syncZoomState = syncZoomState;
      mapInstance.on("zoom", syncZoomState);
      mapInstance.on("zoomend", syncZoomState);

      zoomGroup.append(zoomIn, zoomOut);
      wrap.append(locateBtn, zoomGroup, status);
      this._container = wrap;
      syncZoomState();
      return wrap;
    };
    MapRailControl.prototype.onRemove = function () {
      if (this._map && this._syncZoomState) {
        this._map.off("zoom", this._syncZoomState);
        this._map.off("zoomend", this._syncZoomState);
      }
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this._container = null;
      this._map = null;
      this._syncZoomState = null;
    };

    function activeMapStyle() {
      return MAP_STYLES[mapStyleId] || MAP_STYLES.dark;
    }

    function restoreMapStylePreference() {
      try {
        const saved = localStorage.getItem(LS_MAP_STYLE);
        if (saved && MAP_STYLES[saved]) mapStyleId = saved;
      } catch (err) {}
    }

    function storeMapStylePreference() {
      try {
        localStorage.setItem(LS_MAP_STYLE, mapStyleId);
      } catch (err) {}
    }

    function waitForMapStyle(url) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          map.off("style.load", onLoad);
          if (error) reject(error);
          else resolve();
        };
        const onLoad = () => finish();
        const timer = setTimeout(() => finish(new Error("Map style timeout")), 20000);
        map.on("style.load", onLoad);
        try {
          map.setStyle(url, { diff: false });
        } catch (err) {
          finish(err);
        }
      });
    }

    async function loadActiveMapStyle() {
      const style = activeMapStyle();
      await waitForMapStyle(style.url);
      if (style.customizeBase) applyMapTheme(style.overlay);
      ensureOverlayLayers();
      map.once("idle", settleAttributionControl);
    }

    async function switchMapStyle() {
      if (!map || mapStyleLoading) return;
      const previousId = mapStyleId;
      mapStyleId = mapStyleId === "dark" ? "light" : "dark";
      mapStyleLoading = true;
      overlaysReady = false;
      if (mapStyleControl) mapStyleControl.sync();
      if (mapStyleControl) mapStyleControl.announce("Se schimbă stilul hărții");
      try {
        await loadActiveMapStyle();
        storeMapStylePreference();
        if (mapStyleControl) mapStyleControl.announce("Stilul hărții: " + activeMapStyle().label);
      } catch (err) {
        mapStyleId = previousId;
        overlaysReady = false;
        try {
          await loadActiveMapStyle();
        } catch (restoreError) {}
        if (mapStyleControl) mapStyleControl.announce("Stilul hărții nu a putut fi schimbat");
      } finally {
        mapStyleLoading = false;
        if (mapStyleControl) mapStyleControl.sync();
      }
    }

    function MapStyleControl() {}
    MapStyleControl.prototype.onAdd = function () {
      const wrap = document.createElement("div");
      wrap.className = "maplibregl-ctrl map-rail map-style-control";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Stilul hărții");
      const button = railButton("map-style-button", "Hartă clară", () => switchMapStyle());
      button.setAttribute("aria-pressed", "false");
      const status = document.createElement("span");
      status.className = "map-style-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      wrap.append(button, status);
      this._container = wrap;
      this._button = button;
      this._status = status;
      this.sync();
      return wrap;
    };
    MapStyleControl.prototype.onRemove = function () {
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this._container = null;
      this._button = null;
      this._status = null;
    };
    MapStyleControl.prototype.sync = function () {
      if (!this._button) return;
      const light = mapStyleId === "light";
      this._button.disabled = mapStyleLoading;
      this._button.setAttribute("aria-pressed", String(light));
      this._button.setAttribute("aria-label", "Hartă " + activeMapStyle().label.toLowerCase());
      this._button.title = light ? "Folosește stilul întunecat" : "Folosește stilul clar";
      if (mapStyleLoading) this._button.setAttribute("aria-busy", "true");
      else this._button.removeAttribute("aria-busy");
    };
    MapStyleControl.prototype.announce = function (message) {
      if (this._status) this._status.textContent = message;
    };

    function ensureOverlayLayers() {
      if (overlaysReady) return;
      const theme = activeMapStyle().overlay;
      map.addSource("route", { type: "geojson", data: mapSourceData.get("route") || emptyFC() });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": theme.routeCasing,
          "line-width": ["case", ["==", ["get", "active"], 1], 7, 4],
          "line-opacity": ["case", ["==", ["get", "active"], 1], 0.92, 0.35],
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": theme.routeFallback,
          "line-width": ["case", ["==", ["get", "active"], 1], 4, 2.5],
          "line-opacity": ["case", ["==", ["get", "active"], 1], 0.94, 0.28],
        },
      });
      map.addLayer({
        id: "route-flow",
        type: "line",
        source: "route",
        filter: ["==", ["get", "active"], 1],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": theme.routeCasing,
          "line-width": 2.5,
          "line-opacity": 0.7,
          "line-dasharray": [0, 4, 3],
        },
      });
      map.addSource("stops", { type: "geojson", data: mapSourceData.get("stops") || emptyFC() });
      map.addLayer({
        id: "stops-hit",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 18,
          "circle-color": theme.land,
          "circle-opacity": 0,
        },
      });
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        minzoom: 15.2,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 1.15],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": theme.label,
          "text-halo-color": theme.halo,
          "text-halo-width": 1.5,
        },
      });
      map.addLayer({
        id: "stops-fill",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 3.25, 17, 5.5],
          "circle-color": theme.stop,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.2, 17, 2],
          "circle-stroke-color": theme.routeCasing,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.42, 14, 0.68, 17, 0.95],
          "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.32, 14, 0.55, 17, 0.95],
        },
      });
      map.addSource("user", { type: "geojson", data: mapSourceData.get("user") || emptyFC() });
      map.addLayer({
        id: "user-accuracy",
        type: "fill",
        source: "user",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: { "fill-color": theme.user, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "user-accuracy-line",
        type: "line",
        source: "user",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: { "line-color": theme.user, "line-width": 1.5, "line-opacity": 0.72 },
      });
      map.addLayer({
        id: "user-dot",
        type: "circle",
        source: "user",
        filter: ["==", ["get", "kind"], "you"],
        paint: {
          "circle-radius": 7,
          "circle-color": theme.routeCasing,
          "circle-stroke-width": 3,
          "circle-stroke-color": theme.user,
        },
      });
      if (!overlayHandlersReady) {
        map.on("mouseenter", "stops-hit", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "stops-hit", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", (e) => {
          const hits = map.queryRenderedFeatures(e.point, { layers: ["stops-hit", "stops-fill", "user-dot"] });
          if (!hits.length) {
            closeStopPopup();
            return;
          }
          const hit = hits[0];
          if (hit.layer.id === "user-dot") {
            new maplibregl.Popup({ offset: 12, closeButton: false })
              .setLngLat(e.lngLat)
              .setText("Tu")
              .addTo(map);
            return;
          }
          try {
            const s = JSON.parse(hit.properties.payload);
            openStopPopup(s, e.lngLat);
          } catch (err) {
            console.error(err);
          }
        });
        overlayHandlersReady = true;
      }
      overlaysReady = true;
    }

    function whenMapReady() {
      return new Promise((resolve) => {
        if (map.isStyleLoaded()) resolve();
        else map.once("load", resolve);
      });
    }

    async function boot() {
      clearLegacyAuth();
      restoreMapStylePreference();
      renderChips();
      startClock();
      setupSheet();

      map = new maplibregl.Map({
        container: "map",
        style: activeMapStyle().url,
        center: [CITY.lng, CITY.lat],
        zoom: MAP_ZOOM.initial,
        minZoom: MAP_ZOOM.minimum,
        maxZoom: MAP_ZOOM.maximum,
        pitchWithRotate: false,
        attributionControl: false,
      });
      window.__map = map;
      map.on("styleimagemissing", (event) => {
        if (event.id !== "wood-pattern" || map.hasImage(event.id)) return;
        map.addImage(event.id, {
          width: 2,
          height: 2,
          data: new Uint8Array([18, 56, 47, 255, 18, 56, 47, 255, 18, 56, 47, 255, 18, 56, 47, 255]),
        });
      });
      map.dragRotate.disable();
      if (map.touchPitch) map.touchPitch.disable();
      if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
      map.addControl(new MapRailControl(), "top-right");
      mapStyleControl = new MapStyleControl();
      map.addControl(mapStyleControl, "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      setupAttributionControl();
      await whenMapReady();
      if (activeMapStyle().customizeBase) applyMapTheme(activeMapStyle().overlay);
      settleAttributionControl();
      map.once("idle", settleAttributionControl);
      ensureOverlayLayers();
      map.resize();
      syncMapPadding();
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          syncSheetLayout();
          syncMapPadding();
        }).observe(hudEl);
      }
      window.addEventListener("resize", () => {
        syncSheetLayout();
        map.resize();
        syncMapPadding();
      });

       setStatus("Se solicită locația…");
      const loc = await locate();
      setUserLoc(loc.lat, loc.lng, loc.acc);
      map.jumpTo({
        center: [loc.lng, loc.lat],
        zoom: Math.max(MAP_ZOOM.minimum, MAP_ZOOM.initial - MAP_ZOOM.userLocationReduction),
      });
      console.log("User location zoom:", map.getZoom());
      map.resize();
      if (loc.fallback) setStatus("Fallback locație: centrul București (" + loc.reason + ")", "warn");

      map.on("moveend", () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(loadStops, 250);
      });

      if (map.getZoom() < MAP_ZOOM.minimum) map.setZoom(MAP_ZOOM.minimum);
      const bootHashId = lineIdFromHash();
      if (bootHashId) selectedLineId = bootHashId;
      window.addEventListener("hashchange", () => {
        applyLineFromHash();
      });
      await loadStops();
      await applyLineFromHash();
    }

    boot().catch((e) => {
      console.error(e);
      setStatus(e.message || String(e), "err");
    });
