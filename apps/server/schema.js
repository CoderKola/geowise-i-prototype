const { z } = require('zod');

// Strict validation — "only what we need and ask". Unknown/extra fields are
// rejected (.strict()); every numeric is range/finite-checked; batch is capped.

const nullableNum = z.number().finite().nullable();
// Newer fields: optional so older app builds still validate, defaulting to null
// so the parsed object always carries every key (better-sqlite3 named params).
const optNum = z.number().finite().nullable().optional().default(null);
const optInt = z.number().int().nullable().optional().default(null);

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
  })
  .strict();

const BatchSchema = z
  .object({
    points: z.array(PointSchema).min(1).max(500),
  })
  .strict();

module.exports = { PointSchema, BatchSchema };
