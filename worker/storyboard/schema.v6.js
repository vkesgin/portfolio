// schema.v6.js: storyboard JSON schema v6 (structured characters/location) + minimal validator.
// Sent to the model only as prose (json_object mode); strict json_schema mode is NOT used (alphabetical keys, gemma runaway).
export const SHOTS = [
  "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up",
  "aerial_drone", "pov", "over_the_shoulder", "insert",
];
export const MOVES = [
  "static", "pan", "tilt", "dolly_in", "dolly_out", "tracking",
  "crane_up", "crane_down", "handheld", "zoom_in", "zoom_out", "orbit", "drone_flyover",
];
export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"];
export const CONFIDENCE = ["high", "medium", "low"];

const str = { type: "string" };
const nonEmpty = { type: "string", minLength: 1 };

export const STORYBOARD_SCHEMA_V6 = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "logline", "core_message", "interpretations", "assumptions",
    "location_en", "characters_en", "anchor_prompt_en", "aspect_ratio", "scenes",
  ],
  properties: {
    title: nonEmpty,
    logline: str,
    core_message: str,
    interpretations: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "meaning", "confidence"],
        properties: { name: nonEmpty, meaning: str, confidence: { type: "string", enum: CONFIDENCE } },
      },
    },
    assumptions: { type: "array", maxItems: 6, items: str },
    location_en: nonEmpty,
    characters_en: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "look"],
        properties: { name: nonEmpty, look: nonEmpty }, // name: "THE ELEPHANT" (normalised in code)
      },
    },
    anchor_prompt_en: nonEmpty,
    aspect_ratio: { type: "string", enum: ASPECTS },
    scenes: {
      type: "array", minItems: 3, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "n", "title", "duration_s", "shot", "camera_move", "characters", "action",
          "onscreen_text", "vo", "sound", "image_prompt_en",
        ],
        properties: {
          n: { type: "integer" },
          title: str,
          duration_s: { type: "number" },
          shot: { type: "string", enum: SHOTS },
          camera_move: { type: "string", enum: MOVES },
          characters: { type: "array", maxItems: 4, items: nonEmpty }, // canonical names from characters_en
          action: str,
          onscreen_text: str,
          vo: str,
          sound: str,
          image_prompt_en: nonEmpty,
        },
      },
    },
  },
};

// Minimal validator for exactly the JSON-Schema subset used above.
export function validate(schema, v, path = "$", errs = []) {
  const t = schema.type;
  if (t === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) { errs.push(`${path}: expected object`); return errs; }
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${path}.${k}: missing`);
    if (schema.additionalProperties === false)
      for (const k of Object.keys(v)) if (!schema.properties[k]) errs.push(`${path}.${k}: unexpected key`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) validate(s, v[k], `${path}.${k}`, errs);
  } else if (t === "array") {
    if (!Array.isArray(v)) { errs.push(`${path}: expected array`); return errs; }
    if (schema.minItems != null && v.length < schema.minItems) errs.push(`${path}: ${v.length} < minItems ${schema.minItems}`);
    if (schema.maxItems != null && v.length > schema.maxItems) errs.push(`${path}: ${v.length} > maxItems ${schema.maxItems}`);
    v.forEach((x, i) => validate(schema.items, x, `${path}[${i}]`, errs));
  } else if (t === "string") {
    if (typeof v !== "string") errs.push(`${path}: expected string`);
    else {
      if (schema.minLength != null && v.trim().length < schema.minLength) errs.push(`${path}: empty`);
      if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: "${v}" not in enum`);
    }
  } else if (t === "integer") {
    if (!Number.isInteger(v)) errs.push(`${path}: expected integer`);
  } else if (t === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) errs.push(`${path}: expected number`);
  }
  return errs;
}
