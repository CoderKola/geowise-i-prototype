// The dashboard feed runs LOCAL ONLY on the laptop (never tunneled).
export const FEED = 'http://localhost:3100'

export interface Session {
  device_id: string | null
  session_id: number
  points: number
  started_at: number
  ended_at: number
}

export interface Point {
  point_id: number
  timestamp: number
  lat: number | null
  lon: number | null
  accuracy: number | null
  altitude: number | null
  speed: number | null
  bearing: number | null
  device_battery: number | null
  battery_charging: number | null
  network_type: string | null
}

// Shape pushed over SSE (the full ingest row).
export interface StreamPoint extends Point {
  device_id: string | null
  session_id: number
}

export async function fetchSessions(): Promise<Session[]> {
  const r = await fetch(`${FEED}/api/sessions`)
  const j = await r.json()
  return j.sessions ?? []
}

export async function fetchPoints(
  deviceId: string | null,
  sessionId: number,
): Promise<Point[]> {
  const params = new URLSearchParams({ session_id: String(sessionId) })
  if (deviceId != null) params.set('device_id', deviceId)
  const r = await fetch(`${FEED}/api/points?${params.toString()}`)
  const j = await r.json()
  return j.points ?? []
}

// Subscribe to the live SSE stream. Returns an unsubscribe function.
export function subscribeStream(
  onPoints: (points: StreamPoint[]) => void,
  onState: (connected: boolean) => void,
): () => void {
  const es = new EventSource(`${FEED}/api/stream`)
  es.onopen = () => onState(true)
  es.onerror = () => onState(false)
  es.onmessage = (e) => {
    try {
      onPoints(JSON.parse(e.data) as StreamPoint[])
    } catch {
      /* ignore malformed frame */
    }
  }
  return () => es.close()
}
