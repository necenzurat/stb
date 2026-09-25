const protobuf = require("protobufjs");

const PROTO_SCHEMA = `
syntax = "proto2";
package ro.radcom.rp.protofiles.generate;

message ResponseGetHomeStopsDTO { repeated StopDTO stops = 1; }
message ResponseGetStopsDTO { repeated TransportTypeDTO stops = 1; }
message ResponseGetVehiclesDTO { repeated ResponseGetLineVehiclesDTO vehicles = 1; }
message RequestGetLinesDTO { repeated RequestLineDTO lines = 1; optional string name = 3; }
message RequestLineDTO {
  optional int64 id = 1;
  optional string name = 2;
  optional string type = 3;
  optional bool has_notifications = 4;
  optional bool line_notification_disabled = 5;
  optional string color = 6;
  optional string price_ticket_sms = 7;
  optional string ticket_sms = 8;
  optional Organization organization = 9;
}
message Organization {
  optional int64 id = 1;
  optional string code = 2;
  optional string name = 3;
  optional string logo_file = 4;
  optional string logo = 5;
  optional bool is_active = 6;
  optional bool selected = 7;
}
message ResponseGetLineDTO {
  optional int64 id = 1;
  optional string name = 2;
  optional string type = 3;
  optional bool has_notifications = 4;
  optional string color = 5;
  optional string price_ticket_sms = 6;
  optional string ticket_sms = 7;
  optional Organization organization = 8;
  optional string segment_path = 9;
  optional string direction_name_tur = 10;
  optional string direction_name_retur = 11;
  repeated StopDTO stops = 12;
}
message StopDTO {
  optional int64 id = 1;
  optional double lat = 2;
  optional double lng = 3;
  optional string name = 4;
  optional string description = 5;
  optional string type = 6;
  optional int64 favorite_id = 7;
  optional TicketOfficeDTO ticket_office_type = 8;
  repeated LineDTO lines = 9;
  optional string icon_color = 10;
}
message TicketOfficeDTO {
  optional TicketOfficeSchedule ticketOfficeSchedule = 1;
  optional string type = 2;
  optional string name = 3;
  optional string description = 4;
  optional double lat = 5;
  optional double lng = 6;
  optional int64 id = 7;
  optional string icon_color = 8;
  optional string photo_url = 9;
}
message LineDTO {
  optional int64 id = 1;
  optional string name = 2;
  optional string type = 3;
  optional string color = 4;
  optional string description = 5;
  optional int32 direction = 6;
  optional string direction_name = 7;
  optional int64 arriving_time = 8;
  repeated TimesDTO arriving_times = 9;
  optional bool is_timetable = 10;
  repeated HoursDTO timetable = 11;
  optional Organization organization = 12;
  optional bool has_disability = 13;
}
message HoursDTO { optional string hour = 1; repeated string minutes = 2; }
message TimesDTO {
  optional bool timetable = 1;
  optional int64 arrivingTime = 2;
  optional bool has_disability = 3;
}
message TicketOfficeSchedule {
  optional string weekday = 1;
  optional string saturday = 2;
  optional string sunday = 3;
}
message ResponseStopDTO {
  optional string name = 1;
  optional string address = 2;
  optional string image = 3;
  optional int64 favorite_id = 4;
  optional string type = 5;
  optional string subtype = 6;
  optional string schedule_weekday = 7;
  optional string schedule_saturday = 8;
  optional string schedule_sunday = 9;
  repeated ResponseLineDTO lines = 10;
  optional bool has_disability = 11;
}
message ResponseLineDTO {
  optional string name = 1;
  optional int64 id = 2;
  optional string type = 3;
  optional string color = 4;
  optional string direction_name = 5;
  optional int64 arriving_time = 6;
  optional bool is_timetable = 7;
  optional int32 direction = 8;
  repeated TimesDTO arriving_times = 9;
  repeated HoursDTO timetable = 10;
  optional string segment_path = 11;
  repeated ResponseVehiclesDTO vehicles = 12;
  optional bool has_disability = 13;
}
message ResponseVehiclesDTO {
  optional int64 id = 1;
  optional double lat = 2;
  optional double lng = 3;
  optional string transport_type = 4;
  optional bool has_disability = 5;
}
message ResponseGetLineVehiclesDTO {
  optional int64 id = 1;
  optional double lat = 2;
  optional double lng = 3;
  optional string code = 4;
  optional string transport_type = 5;
  optional bool has_disability = 6;
}
message Routes {
  repeated Route routes = 1;
  optional bool results_from_filters = 2;
  optional string name = 3;
}
message Route {
  optional Stops vehicle = 1;
  optional bool has_disability = 2;
  optional double transport_vehicle_lat = 3;
  optional double transport_vehicle_lng = 4;
  optional string start_time = 5;
  optional string stop_time = 6;
  optional int32 duration = 7;
  optional bool isOnVehicle = 8;
  repeated Segments segments = 9;
}
message Stops {
  optional int64 id = 1;
  optional double lat = 2;
  optional double lng = 3;
  optional string name = 4;
  optional string time = 5;
  optional int32 segment_index = 6;
  optional bool isViewed = 7;
}
message Segments {
  optional string id = 1;
  optional string transport_type = 2;
  optional int64 transport_line_id = 3;
  optional int64 transport_vehicle_id = 4;
  optional string transport_vehicle_code = 5;
  optional string transport_name = 6;
  optional string transport_color = 7;
  optional double transport_vehicle_lat = 8;
  optional double transport_vehicle_lng = 9;
  optional string start_time = 10;
  optional string stop_time = 11;
  optional string segment_path = 12;
  optional string direction_name = 13;
  optional int32 direction = 14;
  optional int64 remaining_duration = 15;
  optional int64 duration = 16;
  optional bool is_timetable = 17;
  repeated Stops stops = 18;
  optional Organization organization = 19;
}
message TransportTypeDTO {
  optional string transport_type = 1;
  repeated LineDTO lines = 2;
  optional string name = 3;
  optional string description = 4;
  optional TicketOfficeDTO ticket_office = 5;
  optional int64 favorite_id = 6;
  optional string photo_url = 7;
  optional BicycleStationDTO bicycle_station = 8;
  optional bool has_disability = 9;
}
message BicycleStationDTO {
  optional string type = 1;
  optional int64 occupied_spots = 2;
  optional int64 empty_spots = 3;
}
`;

const root = protobuf.parse(PROTO_SCHEMA).root;
root.resolveAll();
const ROUTES = [
  [/^\/lines\/v2\/home\/stops(?:\/|$)/, "ResponseGetHomeStopsDTO"],
  [/^\/lines\/v2\/[^/]+\/vehicles\/[^/]+$/, "ResponseGetVehiclesDTO"],
  [/^\/lines\/v2\/[^/]+\/stops\/[^/]+$/, "ResponseGetStopsDTO"],
  [/^\/lines\/[^/]+\/direction\/[^/]+$/, "ResponseGetLineDTO"],
  [/^\/lines\/stop$/, "ResponseStopDTO"],
  [/^\/lines\/[^/]+$/, "ResponseGetLineDTO"],
  [/^\/lines$/, "RequestGetLinesDTO"],
  [/^\/routes$/, "Routes"],
];

function normalizePath(pathname) {
  const value = String(pathname || "/").split("?")[0] || "/";
  return value.replace(/^\/api(?=\/|$)/, "") || "/";
}

function protobufTypeForPath(pathname) {
  const path = normalizePath(pathname);
  const match = ROUTES.find(([pattern]) => pattern.test(path));
  return match ? match[1] : null;
}

function isProtobufPath(pathname) {
  return Boolean(protobufTypeForPath(pathname));
}

function defaultValue(field) {
  if (field.repeated) return [];
  if (field.resolvedType) return null;
  if (field.type === "bool") return false;
  if (field.type === "string") return "";
  if (field.type === "bytes") return "";
  if (["int32", "sint32", "sfixed32", "fixed32", "float", "double"].includes(field.type)) return 0;
  if (["int64", "sint64", "sfixed64", "fixed64", "uint64"].includes(field.type)) return "0";
  if (field.type === "enum") return 0;
  return null;
}

function readScalar(reader, type) {
  if (type === "double") return reader.double();
  if (type === "float") return reader.float();
  if (type === "int32") return reader.int32();
  if (type === "sint32") return reader.sint32();
  if (type === "sfixed32") return reader.sfixed32();
  if (type === "fixed32") return reader.fixed32();
  if (type === "int64") return reader.int64().toString();
  if (type === "sint64") return reader.sint64().toString();
  if (type === "sfixed64") return reader.sfixed64().toString();
  if (type === "fixed64") return reader.fixed64().toString();
  if (type === "uint64") return reader.uint64().toString();
  if (type === "bool") return reader.bool();
  if (type === "string") return reader.string();
  if (type === "bytes") return reader.bytes();
  if (type === "enum") return reader.int32();
  throw new Error("unsupported protobuf field type: " + type);
}

function canPack(field) {
  return !field.resolvedType && !["string", "bytes", "group"].includes(field.type);
}

function readFieldValue(reader, field) {
  if (field.resolvedType) {
    const length = reader.uint32();
    const end = reader.pos + length;
    const value = decodeMessage(reader, field.resolvedType, end);
    reader.pos = end;
    return value;
  }
  return readScalar(reader, field.type);
}

function decodeMessage(reader, type, end) {
  const result = {};
  for (const field of type.fieldsArray) result[field.name] = defaultValue(field);
  const limit = end == null ? reader.len : end;
  while (reader.pos < limit) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    const field = type.fieldsById[fieldNumber];
    if (!field) {
      reader.skipType(wireType);
      continue;
    }
    if (field.repeated) {
      if (!result[field.name]) result[field.name] = [];
      if (wireType === 2 && canPack(field)) {
        const packedEnd = reader.pos + reader.uint32();
        while (reader.pos < packedEnd) result[field.name].push(readFieldValue(reader, field));
      } else {
        result[field.name].push(readFieldValue(reader, field));
      }
    } else {
      result[field.name] = readFieldValue(reader, field);
    }
  }
  return result;
}

function decodeProtobufResponse(pathname, body) {
  const typeName = protobufTypeForPath(pathname);
  if (!typeName) throw new Error("no protobuf message for " + pathname);
  const type = root.lookupType("ro.radcom.rp.protofiles.generate." + typeName);
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const reader = protobuf.Reader.create(bytes);
  return decodeMessage(reader, type, reader.len);
}

function isProtobufContentType(contentType) {
  return /application\/(?:octet-stream|protobuf|x-protobuf)/i.test(String(contentType || ""));
}

module.exports = {
  decodeProtobufResponse,
  isProtobufContentType,
  isProtobufPath,
  protobufTypeForPath,
};
