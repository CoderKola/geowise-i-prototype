const { z } = require('zod');

// Strict validation — "only what we need and ask". Unknown/extra fields are
// rejected (.strict()); every numeric is range/finite-checked; batch is capped.

const nullableNum = z.number().finite().nullable();
// Newer fields: optional so older app builds still validate, defaulting to null
// so the parsed object always carries every key (better-sqlite3 named params).
const optNum = z.number().finite().nullable().optional().default(null);
const optInt = z.number().int().nullable().optional().default(null);
// Identity strings are truncated, not rejected: APKs already in the field can
// send longer values than planned (e.g. a verbose Android osName), and one
// overlong label must not block a whole batch of good points.
const optStr = (max) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .nullable()
    .optional()
    .default(null);

const PointSchema = z
  .object({
    device_id: z.string().max(64).nullable(),
    session_id: z.number().int().nonnegative(),
    point_id: z.number().int().nonnegative(),
    timestamp: z.number().finite().positive(),
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    accuracy: nullableNum,
    altitude: nullableNum,
    speed: nullableNum,
    bearing: nullableNum,
    device_battery: nullableNum,
    altitude_accuracy: optNum,
    mocked: optInt,
    pressure: optNum,
    relative_altitude: optNum,
    battery_charging: optInt,
    network_type: z.string().max(32).nullable().optional().default(null),
    platform: optStr(32),
    device_model: optStr(64),
    device_type: optStr(16),
    os_version: optStr(32),
  })
  .strict();

const BatchSchema = z
  .object({
    points: z.array(PointSchema).min(1).max(500),
  })
  .strict();

// Multipart text fields for /media arrive as strings — coerce the numerics.
// The app sends device_id as '' when null (FormData can't carry null).
const MediaMetaSchema = z
  .object({
    device_id: z
      .string()
      .max(64)
      .transform((s) => (s === '' ? null : s)),
    session_id: z.coerce.number().int().nonnegative(),
    facing: z.enum(['front', 'back']),
    started_at: z.coerce.number().int().positive(),
    ended_at: z.coerce.number().int().positive(),
  })
  .strict();

module.exports = { PointSchema, BatchSchema, MediaMetaSchema };
