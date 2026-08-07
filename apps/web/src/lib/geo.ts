import type { Point } from '@/lib/api'

export const MPS_TO_MPH = 2.23694
export const M_TO_FT = 3.28084

// Android reports altitude above the WGS84 ellipsoid, which sits ~33.8 m above
// mean sea level around NYC; iOS reports MSL directly. Normalize both to
// approximate MSL for display. Legacy rows with a null platform are all iOS;
// older Android rows stamped a build fingerprint, so anything non-null that
// isn't iOS is treated as Android.
export const NYC_GEOID_OFFSET_M = 33.8

export function mslAltitudeM(p: Point): number | null {
  if (p.altitude == null) return null
  const isIos = p.platform == null || p.platform.toLowerCase().startsWith('i')
  return isIos ? p.altitude : p.altitude + NYC_GEOID_OFFSET_M
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLon = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
