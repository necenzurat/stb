# info.stb.ro — API reference (reverse-engineered)

Unofficial documentation of the backend used by the **InfoTB** web app at
[https://info.stb.ro/](https://info.stb.ro/) (Angular SPA, vendor: Radcom "SmartCity").
Derived from the app bundle (`main-es2015.*.js`) and verified with live requests on 2026-09-15.

- **Base URL:** `https://info.stb.ro/api/web/v2-6`
- **SSO base:** `https://info.stb.ro/websso`
- **Backend:** Spring (Tomcat 9). Errors are Tomcat HTML pages (400/404/500) or plain JSON/text.
- **Encoding:** JSON for most endpoints; **Protobuf (proto2)** for the lines/stops/vehicles/routes endpoints (`Content-Type: application/octet-stream`). Schema in [Protobuf schema](#protobuf-schema).
- **CORS:** `Access-Control-Allow-Origin: *`.

---

## 1. Authentication & required headers

There are two independent layers.

### 1.1 Device layer (required for *every* call)

Every request must carry these headers, otherwise Tomcat returns `400 Missing request header '<X>'`:

| Header | Value | Notes |
|---|---|---|
| `App-Id` | UUID v4 | Generated once per client, persisted (localStorage `App-Id`). |
| `User-Info` | bcrypt-looking token | Obtained from `GET /proxy/user/auth` (see below). Bound to `App-Id`, `Lang` and `Source`. Empty string is accepted by the header check but rejected later. |
| `OS-Type` | `Web` | |
| `App-Version` | e.g. `2.6.0` | Any non-empty string works. |
| `Device-Name` | e.g. `Chrome` | Any non-empty string works. |
| `OS-Version` | e.g. `5.0` | Any non-empty string works. |
| `Lang` | `ro` \| `en` | Must match the value used when the `User-Info` token was issued, else `412`. |
| `Source` | `ro.radcom.smartcity.web` | Must be present, else `412`. |

Status semantics:

- `400` → a header is missing.
- `412 Precondition Failed` (empty body) → `User-Info` missing/invalid/expired or bound to a different `App-Id`/`Lang`. The web client reacts by calling `/proxy/user/auth` again and retrying the request once. Sending a *wrong* `User-Info` for an `App-Id` appears to invalidate the previously issued token for that `App-Id`.
- `401` → JWT expired → client calls `/identity/refreshToken` and retries.
- `403` → client logs user out.

#### `GET /proxy/user/auth` — obtain `User-Info`

Headers: all of the above **plus** `App-key: gcALgRyZHC,qFonZ=Jde` (constant baked into the web bundle, `environment.userInfoAppKey`). `User-Info` not needed for this call.

```json
{ "data": { "userInfo": "$2a$10$..." } }
```

Use `data.userInfo` as the `User-Info` header for subsequent calls.

Minimal working example:

```bash
B=https://info.stb.ro/api/web/v2-6
APPID=$(uuidgen | tr A-Z a-z)
H=(-H "App-Id: $APPID" -H "OS-Type: Web" -H "App-Version: 2.6.0" -H "Device-Name: Chrome" \
   -H "OS-Version: 5.0" -H "Lang: ro" -H "Source: ro.radcom.smartcity.web" -H "Content-Type: application/json")
UI=$(curl -s "${H[@]}" -H "App-key: gcALgRyZHC,qFonZ=Jde" "$B/proxy/user/auth" | jq -r .data.userInfo)
curl -s "${H[@]}" -H "User-Info: $UI" "$B/agency?lang=ro"
```

### 1.2 User layer (account features only)

User endpoints (`/identity/*`, `/profile*`, `/subscriptions*`, `/order/*`, `/feedback/*`, `/places/favorites`, `/proxy/user/notifications`, `/users/profile`, `/card_design`, `/payment_methods`, `/counties`, `/localities/*`, `/customer_type`, `/education_units`) additionally require:

```
Authorization: Bearer <accessToken>
```

Missing → `400 Missing request header 'Authorization'` (Tomcat HTML) or `400 {"Lipseste unul dintre headerele obligatorii"}` (feedback module).

Tokens come from the SSO flow:

1. `GET /proxy/signIn` → `{"data":{"clientId":"123","scope":"openid profile email company address phone address","responseType":"id_token token","nonce":"..."}}`
2. Browser redirect to
   `https://info.stb.ro/websso/login?lang=ro&redirectUri=<origin>/auth&clientId=123&responseType=id_token token&state=<random>&scope=<scope>&nonce=<nonce>&osType=Web&appId=<App-Id>&appVersion=<v>&deviceName=<b>&osVersion=<os>&userInfo=<User-Info>`
   (`/websso/signup?...clientId=...` and `/websso/forgot-password?...` for the other flows; `GET /proxy/signUp` returns `{"data":{"clientId":"123"}}`).
3. SSO redirects back to `<origin>/auth#accessToken=…&tokenType=Bearer&idToken=<JWT>&expiresIn=<sec>&refreshToken=…&state=…&scope=…` (URL-fragment, parsed with `URLSearchParams`).
4. Client stores the user object in localStorage `user-buc` and schedules a refresh after `expiresIn` seconds.

Legacy (non-SSO) endpoints still present in the bundle:

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/proxy/signIn` | `{"user":{"email","password"},"device":{}}` | `withCredentials` |
| `POST` | `/users/signUp` | `{"user":{"email","password"}}` | |
| `POST` | `/users/reset_password` | `{"email"}` | |
| `PUT`  | `/users/profile` | profile object | |
| `POST` | `/identity/refreshToken` | *(null)* | Header `Refresh-Token: <refreshToken>`; response `data.{accessToken,refreshToken,tokenType,expiresIn}` |
| `GET`  | `/identity/userInfo` | | user type / info (`data`) |
| `POST` | `/identity/editProfile` | profile fields | |
| `POST` | `/identity/changePassword` | `{old,new…}` | |
| `GET`  | `/identity/logout` | | |
| `GET`  | `/identity/deleteAccount` | | |

Client-side interceptor also adds `Refresh-Token` when retrying after a `401`.

---

## 2. Public transit endpoints (no user login)

All need the device-layer headers (§1.1). `lang` query param: `ro` (default) or `en`.

### 2.1 JSON

#### `GET /agency?lang=ro`
Filters/metadata for the planner.

```json
{
  "organizations": [
    {"id":1,"name":"Societatea de Transport Bucuresti STB SA","selected":true,"logo":"https://info.stbsa.ro/src/img/avl/stbsa/logos/logo202608.png"},
    {"id":2,"name":"METROREX","selected":true,"logo":"..."},
    {"id":35,"name":"Serviciul Transport Voluntari S.A.","selected":true,"logo":"..."},
    {"id":36,"name":"Societatea Ecotrans STCM","selected":true,"logo":"..."},
    {"id":37,"name":"Regio Serv Transport","selected":true,"logo":"..."}
  ],
  "transport_types": [
    {"type":"BUS","name":"Autobuz","selected":true},
    {"type":"CABLE_CAR","name":"Troleibuz","selected":true},
    {"type":"TRAM","name":"Tramvai","selected":true},
    {"type":"SUBWAY","name":"Metrou","selected":true}
  ],
  "has_disability_filter": true,
  "commercial_enabled": false,
  "stop_types": [
    {"id":1,"type":"STATION","name":"Statie suprafata","icon_color":"#FF0000","icon_url":null,"selected":false},
    {"id":2,"type":"SUBWAY_STATION","name":"Statie metrou","icon_color":"#0657FF","icon_url":null,"selected":true},
    {"id":3,"type":"TICKET_OFFICE","name":"Punct de vanzare","icon_color":"#1c6910","icon_url":null,"selected":false}
  ]
}
```

Note: trolleybus is encoded as `CABLE_CAR`.

#### `GET /places?query=<text>`
Stop / place search (client requires ≥3 chars matching `^['-A-Za-zăâîșțȘȚĂÂÎ0-9 ]{3,}$`).

```json
{"places":[
  {"name":"Piata Unirii","lat":44.427513,"lng":26.101826,"type":"SUBWAY_STATION","description":"Piata Unirii","stop_id":9552},
  {"name":"Piata Unirii 4","lat":44.427806,"lng":26.104,"type":"STATION","description":"Bd. I.C.Bratianu, Bucuresti","stop_id":7512}
]}
```

#### `GET /notifications?limit=10&offset=0`
Service alerts (traffic notices). Home widget uses `limit=10`; notifications page uses `limit=100&offset=0`.

```json
{"notifications":[{
  "id":8466,"created_at":1789411140000,
  "title":"Liniile 23 și 27 funcționează normal pe Str. Liviu Rebreanu de la",
  "message":"Liniile 23 &#537;i 27 func&#539;ioneaz&#259; normal pe Str. Liviu Rebreanu de la ora 21:25.",
  "lines":[{"id":null,"name":"23","type":"TRAM","color":"#BE1622", "...":null}]
}]}
```
`message` is HTML-entity encoded; `created_at` is epoch ms.

#### `GET /lines/stops/{stop_id}`
Stop details as JSON (client requests `arraybuffer` but server answers `application/json`).

```json
{
  "name":"Piata Unirii 4","description":"Bd. I.C.Bratianu, Bucuresti","transport_type":"STATION",
  "ticket_office":{"ticketOfficeSchedule":{}},"has_disability":true,
  "lines":[{"id":887,"name":"100","type":"BUS","color":"#1D71B8","description":"Bd. I.C.Bratianu, Bucuresti",
            "direction":0,"direction_name":"Aeroport Henri Coanda","arriving_time":null,"arriving_times":null,
            "is_timetable":true,"timetable":null,"organization":{"logo":"...","id":1},"has_disability":null,"current_capacity":null}]
}
```

#### `GET /server/date`
Declared in the bundle; currently returns `500` (backend proxy I/O error). Unused in practice.

### 2.2 Protobuf (response `application/octet-stream`)

Decode with the schema below. Numeric `int64` fields decode as strings in `protobuf-json` output.

| Method | Path | Response message | Purpose |
|---|---|---|---|
| `GET` | `/lines?lang=ro` | `RequestGetLinesDTO` | All lines (id, name, type, color, has_notifications, ticket_sms, organization). ~19 KB. |
| `GET` | `/lines/{line_id}?lang=ro` | `ResponseGetLineDTO` | Line detail, both directions: `segment_path` (Google encoded polyline), `direction_name_tur`, `direction_name_retur`, `stops[]`. |
| `GET` | `/lines/{line_id}/direction/{0\|1}?lang=ro` | `ResponseGetLineDTO` | Same, single direction (0 = tur / outbound, 1 = retur / return). |
| `GET` | `/lines/v2/{line_id}/vehicles/{direction}?lang=ro` | `ResponseGetVehiclesDTO` | Live vehicle positions for a line+direction (`id`, `lat`, `lng`, `code` = fleet number, `transport_type`, `has_disability`). Client polls every 30 s. |
| `GET` | `/lines/v2/{line_id}/stops/{stop_id}?lang=ro` | `ResponseGetStopsDTO` | Arrivals for one line at one stop incl. full `timetable[]` (hour → minutes). Client polls every 30 s. |
| `GET` | `/lines/stop?stop_id={id}[&selected_line_id={line_id}][&direction={0\|1}]` | `ResponseStopDTO` | All lines arriving at a stop with next `arriving_times[]` (seconds); with `selected_line_id` also returns that line's `vehicles[]` and `segment_path`. Client polls every 30 s. |
| `GET` | `/lines/v2/home/stops/{swLat}/{swLng}/{neLat}/{neLng}` | `ResponseGetHomeStopsDTO` | Stops within a map bounding box (Google `LatLngBounds.toUrlValue()` with `,`→`/`). Client only calls at zoom ≥ 15. |
| `POST` | `/routes` | `Routes` | Trip planner. JSON request body (below). |

Arrival semantics (`TimesDTO`): `arrivingTime` = seconds until arrival, `-1`/absent = unknown, `timetable=true` = value from schedule rather than live AVL; `has_disability` = accessible vehicle.

#### `POST /routes` — trip planner

Request (JSON, `Content-Type: application/json`):

```json
{
  "start_lat": 44.427513, "start_lng": 26.101826,
  "stop_lat": 44.4459,    "stop_lng": 26.0975,
  "start_time": 1789460000000,          // epoch ms
  "max_walk_distance": 1000,            // metres (client default 1000, slider 0–2000 step 100)
  "user_has_disability": false,         // optional
  "transport_types": [ {"type":"BUS","name":"Autobuz","selected":true}, ... ],   // optional, objects from /agency
  "organisations":   [ {"id":1,"name":"...","selected":true}, ... ]              // optional, objects from /agency
}
```

Response `Routes`:

```json
{"routes":[{
  "start_time":"2026-09-15T09:03:00+0300","stop_time":"2026-09-15T09:24:00+0300","duration":1260,
  "segments":[
    {"id":"-1:1:7257","transport_type":"WALK","transport_name":"WALK","transport_color":"#444444",
     "start_time":"...","stop_time":"...","duration":"660000","segment_path":"<encoded polyline>",
     "stops":[{"id":"-1","lat":44.427513,"lng":26.101826,"name":"Plecare","time":"...","segment_index":0}, ...]},
    {"id":"1:7257:1:6424","transport_type":"BUS","transport_line_id":"184","transport_name":"381",
     "transport_color":"#1D71B8","direction_name":"Clabucet","direction":0,"is_timetable":true,
     "duration":"420000","segment_path":"...","stops":[...],"organization":{"id":"1","name":"STBSA"}}
  ]}],
 "results_from_filters": true }
```

`duration` on `Route` is seconds; on `Segments` it is milliseconds. An empty result is just `{"results_from_filters":true}`. Segment `id` format: `<orgId>:<fromStopId>:<orgId>:<toStopId>` (`-1` = user position).

Shareable planner URL handled by the SPA: `https://info.stb.ro/traseu?start_lat=&start_lng=&stop_lat=&stop_lng=&start_time=&start_name=&stop_name=&transport_types=BUS,TRAM`.

---

## 3. User / account endpoints (Bearer token required)

Discovered from the bundle; not exercised live (require an STB account). Bodies are JSON unless noted.

### Favorites
| Method | Path | Body |
|---|---|---|
| `GET` | `/places/favorites` | |
| `POST` | `/places/favorites` | place `{name,lat,lng,type,…}` |
| `PUT` | `/places/favorites/{id}` | place |
| `DELETE` | `/places/favorites/{id}` | |

### Push/line notifications
| Method | Path | Body |
|---|---|---|
| `GET` | `/proxy/user/notifications` | |
| `POST` | `/proxy/user/notifications` | subscription prefs |

### Profiles & cards (travel cards)
| Method | Path | Body / params |
|---|---|---|
| `GET` | `/profiles?is_active=1` | |
| `POST` | `/profiles` | filter (company cards) |
| `GET` | `/profiles/download_excel` | → `blob` |
| `GET` | `/profile?id={id}` \| `/profile?card_sdist={sdist}` | |
| `GET` | `/profile/delete/{id}` | |
| `GET` | `/profile/card/{id_or_sdist}` | |
| `POST` | `/profile/addcard` | card data |
| `GET` | `/card/delete/{id}` | (company card) |
| `GET` | `/profile/card/block_reasons` | |
| `POST` | `/profile/card/block` | `{card, reason…}` |
| `GET` | `/profile/card/new_topup_info` | |
| `POST` | `/profile/card/topup` | top-up request |
| `POST` | `/profile/card/transactions_history` | filter |
| `GET` | `/profile/card/transaction_types` | |
| `GET` | `/profile/transaction/details/{id}` | |
| `GET` | `/profile/pay_fine/{id}` | |
| `POST` | `/profile/documents` | filter |
| `POST` | `/profile/send_documents` | documents |
| `GET` | `/consent` | (404 without auth) |

### Subscriptions (passes)
| Method | Path | Body / params |
|---|---|---|
| `GET` | `/subscriptions` | non-nominal types |
| `GET` | `/subscriptions?card_sdist={sdist}` \| `?profile_id={id}` | |
| `POST` | `/subscriptions` | `{id_sub}` or list filter |
| `POST` | `/subscriptions?card_sdist={sdist}` | sum-to-pay |
| `POST` | `/subscriptions/{profile_id}` | `{id_sub, selected_options}` |
| `POST` | `/subscriptions/renewal?card_sdist={sdist}` | `{renewal_id, quantity}` |
| `POST` | `/save/subscriptions?card_sdist={sdist}` | purchase (adds `has_consent:true`) |
| `POST` | `/save/subscriptions/{profile_id}` | `{id_sub, selected_options, start_date}` |
| `POST` | `/save/subscriptions/renewal?card_sdist={sdist}` | `{start_date, renewal_id, has_consent, quantity, payment_method}` |

### Orders / shop
| Method | Path | Body |
|---|---|---|
| `POST` | `/order/validation` | new card / recharge / buy |
| `POST` | `/order/save` | validated cards |
| `POST` | `/order/history` | filter |
| `GET` | `/order/status` | |
| `GET` | `/order/details/{id}` | |
| `GET` | `/order/download_invoice/{id}.pdf` | → PDF |
| `GET` | `/card_design` | |
| `GET` | `/payment_methods` | |

### Reference data
| Method | Path |
|---|---|
| `GET` | `/counties` |
| `GET` | `/localities/{county_id}` |
| `GET` | `/customer_type?scope={scope}` |
| `GET` | `/education_units?id_customer_type={id}` |

### Feedback / petitions
Extra headers used by the client: `limit: 5`, `offset: 0`.

| Method | Path | Body |
|---|---|---|
| `GET` | `/feedback/modules` | |
| `POST` | `/feedback/add` | message |
| `POST` | `/feedback/list` | filter |
| `GET` | `/feedback/details/{id}` | |
| `POST` | `/feedback/reply/{id}` | reply |
| `POST` | `/feedback/change/{id}` | `{"close":true}` |

---

## 4. Protobuf schema

Embedded base64 in the bundle (`environment.protobuf`), package `ro.radcom.rp.protofiles.generate`, `syntax = "proto2"`.
Decode: `protoc --decode=ro.radcom.rp.protofiles.generate.<Message> stb.proto < body.bin`.

```proto
syntax = "proto2";
package ro.radcom.rp.protofiles.generate;

message ResponseGetHomeStopsDTO { repeated StopDTO stops = 1; }
message ResponseGetStopsDTO     { repeated TransportTypeDTO stops = 1; }
message ResponseGetVehiclesDTO  { repeated ResponseGetLineVehiclesDTO vehicles = 1; }

message RequestGetLinesDTO { repeated RequestLineDTO lines = 1; optional string name = 3; }

message RequestLineDTO {
  optional int64 id = 1; optional string name = 2; optional string type = 3;
  optional bool has_notifications = 4; optional bool line_notification_disabled = 5;
  optional string color = 6; optional string price_ticket_sms = 7; optional string ticket_sms = 8;
  optional Organization organization = 9;
}

message Organization {
  optional int64 id = 1; optional string code = 2; optional string name = 3;
  optional string logo_file = 4; optional string logo = 5; optional bool is_active = 6; optional bool selected = 7;
}

message ResponseGetLineDTO {
  optional int64 id = 1; optional string name = 2; optional string type = 3;
  optional bool has_notifications = 4; optional string color = 5;
  optional string price_ticket_sms = 6; optional string ticket_sms = 7;
  optional Organization organization = 8; optional string segment_path = 9;
  optional string direction_name_tur = 10; optional string direction_name_retur = 11;
  repeated StopDTO stops = 12;
}

message StopDTO {
  optional int64 id = 1; optional double lat = 2; optional double lng = 3;
  optional string name = 4; optional string description = 5; optional string type = 6;
  optional int64 favorite_id = 7; optional TicketOfficeDTO ticket_office_type = 8;
  repeated LineDTO lines = 9; optional string icon_color = 10;
}

message TicketOfficeDTO {
  optional TicketOfficeSchedule ticketOfficeSchedule = 1; optional string type = 2; optional string name = 3;
  optional string description = 4; optional double lat = 5; optional double lng = 6; optional int64 id = 7;
  optional string icon_color = 8; optional string photo_url = 9;
}

message LineDTO {
  optional int64 id = 1; optional string name = 2; optional string type = 3; optional string color = 4;
  optional string description = 5; optional int32 direction = 6; optional string direction_name = 7;
  optional int64 arriving_time = 8; repeated TimesDTO arriving_times = 9; optional bool is_timetable = 10;
  repeated HoursDTO timetable = 11; optional Organization organization = 12; optional bool has_disability = 13;
}

message HoursDTO { optional string hour = 1; repeated string minutes = 2; }
message TimesDTO { optional bool timetable = 1; optional int64 arrivingTime = 2; optional bool has_disability = 3; }
message TicketOfficeSchedule { optional string weekday = 1; optional string saturday = 2; optional string sunday = 3; }

message ResponseStopDTO {
  optional string name = 1; optional string address = 2; optional string image = 3; optional int64 favorite_id = 4;
  optional string type = 5; optional string subtype = 6; optional string schedule_weekday = 7;
  optional string schedule_saturday = 8; optional string schedule_sunday = 9;
  repeated ResponseLineDTO lines = 10; optional bool has_disability = 11;
}

message ResponseLineDTO {
  optional string name = 1; optional int64 id = 2; optional string type = 3; optional string color = 4;
  optional string direction_name = 5; optional int64 arriving_time = 6; optional bool is_timetable = 7;
  optional int32 direction = 8; repeated TimesDTO arriving_times = 9; repeated HoursDTO timetable = 10;
  optional string segment_path = 11; repeated ResponseVehiclesDTO vehicles = 12; optional bool has_disability = 13;
}

message ResponseVehiclesDTO {
  optional int64 id = 1; optional double lat = 2; optional double lng = 3;
  optional string transport_type = 4; optional bool has_disability = 5;
}

message ResponseGetLineVehiclesDTO {
  optional int64 id = 1; optional double lat = 2; optional double lng = 3; optional string code = 4;
  optional string transport_type = 5; optional bool has_disability = 6;
}

message Routes { repeated Route routes = 1; optional bool results_from_filters = 2; optional string name = 3; }

message Route {
  optional Stops vehicle = 1; optional bool has_disability = 2;
  optional double transport_vehicle_lat = 3; optional double transport_vehicle_lng = 4;
  optional string start_time = 5; optional string stop_time = 6; optional int32 duration = 7;
  optional bool isOnVehicle = 8; repeated Segments segments = 9;
}

message Stops {
  optional int64 id = 1; optional double lat = 2; optional double lng = 3; optional string name = 4;
  optional string time = 5; optional int32 segment_index = 6; optional bool isViewed = 7;
}

message Segments {
  optional string id = 1; optional string transport_type = 2; optional int64 transport_line_id = 3;
  optional int64 transport_vehicle_id = 4; optional string transport_vehicle_code = 5;
  optional string transport_name = 6; optional string transport_color = 7;
  optional double transport_vehicle_lat = 8; optional double transport_vehicle_lng = 9;
  optional string start_time = 10; optional string stop_time = 11; optional string segment_path = 12;
  optional string direction_name = 13; optional int32 direction = 14; optional int64 remaining_duration = 15;
  optional int64 duration = 16; optional bool is_timetable = 17; repeated Stops stops = 18;
  optional Organization organization = 19;
}

message TransportTypeDTO {
  optional string transport_type = 1; repeated LineDTO lines = 2; optional string name = 3;
  optional string description = 4; optional TicketOfficeDTO ticket_office = 5; optional int64 favorite_id = 6;
  optional string photo_url = 7; optional BicycleStationDTO bicycle_station = 8; optional bool has_disability = 9;
}

message BicycleStationDTO { optional string type = 1; optional int64 occupied_spots = 2; optional int64 empty_spots = 3; }
```

---

## 5. Enumerations & conventions

- **transport type:** `BUS`, `CABLE_CAR` (= trolleybus), `TRAM`, `SUBWAY`, `WALK` (routes only).
- **stop type:** `STATION`, `SUBWAY_STATION`, `TICKET_OFFICE`.
- **direction:** `0` = tur (outbound, `direction_name_tur`), `1` = retur (return). The map UI uses `3` internally for "both".
- **organization ids:** 1 STB SA, 2 Metrorex, 35 STV Voluntari, 36 Ecotrans STCM, 37 Regio Serv Transport.
- **line colors** (from `/lines`): tram `#BE1622`, day bus `#1D71B8`, night bus `#2D2E83`, City Tour `#00b0f0`; subway `#9807ff` (client constant).
- **segment_path:** Google Maps encoded polyline (decode with `geometry.encoding.decodePath` or any polyline lib).
- **timestamps:** `created_at` epoch ms; `start_time` request epoch ms; route times ISO-8601 `+0300`.
- **refresh cadence used by the official client:** 30 s for vehicles/arrivals, 60 s for planner re-search.
- City defaults: center `44.4353308, 26.0996553`, zoom 15, identifier `buc`.

## 6. Misc

- Google Maps key embedded in `index.html`: `AIzaSyAZvXldnZgBQYcVwV1l16KjUqmXOHALcQ0` (browser-restricted, listed for completeness).
- GA4: `G-GGV4NQV48N`. Petitions: `https://petitii.stb.ro/formular`. Phone: `021 9391`.
- Mobile apps use the same backend (`Source` differs); iOS app id 6443993594.
