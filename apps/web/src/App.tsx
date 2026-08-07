import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigation, RefreshCw, Satellite, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TrackMap } from '@/components/TrackMap'
import { PlaybackBar } from '@/components/PlaybackBar'
import { MapHud, type HudStats } from '@/components/MapHud'
import { VideoPanel } from '@/components/VideoPanel'
import { usePlayback } from '@/hooks/usePlayback'
import { useMediaCache } from '@/hooks/useMediaCache'
import {
  fetchMedia,
  fetchPoints,
  fetchSessions,
  subscribeStream,
  type MediaSegment,
  type Point,
  type Session,
  type StreamPoint,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { haversineMeters, mslAltitudeM, M_TO_FT, MPS_TO_MPH } from '@/lib/geo'

/** A fix within this window means the pipeline is truly live. */
const LIVE_WINDOW_MS = 30_000

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type FeedStatus = 'live' | 'stale' | 'offline'

const STATUS_STYLE: Record<FeedStatus, { dot: string; text: string; label: string }> = {
  live: { dot: 'bg-[color:var(--go)]', text: 'text-[color:var(--go)]', label: 'LIVE' },
  stale: { dot: 'bg-[color:var(--amber)]', text: 'text-[color:var(--amber)]', label: 'STALE' },
  offline: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'OFFLINE' },
}

/**
 * Three-state pipeline freshness indicator:
 * LIVE = a fix arrived within the live window; STALE = feed reachable but the
 * phone has gone quiet; OFFLINE = the SSE connection to the feed is down.
 * Dimmed during playback of an old session, where freshness is irrelevant.
 */
function FeedIndicator({
  status,
  lastFixTs,
  now,
  dimmed,
}: {
  status: FeedStatus
  lastFixTs: number | null
  now: number
  dimmed: boolean
}) {
  const style = STATUS_STYLE[status]
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 font-mono text-xs transition-opacity',
        dimmed && 'opacity-40',
      )}
    >
      <span className={cn('size-2', style.dot)} />
      <span className={cn('font-semibold tracking-wide', style.text)}>{style.label}</span>
      {status !== 'offline' && lastFixTs != null && (
        <span className="text-muted-foreground">· {fmtAgo(now - lastFixTs)}</span>
      )}
    </span>
  )
}

/** Thin uppercase strip used as a flat panel header. */
function PanelLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b bg-secondary px-3 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">
        {children}
      </span>
      {aside}
    </div>
  )
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<{ device: string | null; session: number } | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [media, setMedia] = useState<MediaSegment[]>([])
  const [connected, setConnected] = useState(false)
  // Newest fix timestamp seen anywhere in the pipeline (any device/session).
  const [lastFixTs, setLastFixTs] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // 1s ticker driving the "X ago" freshness text.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const rows = await fetchSessions()
      setSessions(rows)
      if (rows.length > 0) {
        const newest = Math.max(...rows.map((r) => r.ended_at))
        setLastFixTs((prev) => Math.max(prev ?? 0, newest))
      }
      // auto-select the most recent session on first load
      if (!selectedRef.current && rows.length > 0) {
        setSelected({ device: rows[0].device_id, session: rows[0].session_id })
      }
    } catch {
      /* feed offline; the status indicator covers it */
    }
  }, [])

  // load sessions on mount + refresh occasionally
  useEffect(() => {
    loadSessions()
    const id = setInterval(loadSessions, 30000)
    return () => clearInterval(id)
  }, [loadSessions])

  // load points + video segments when selection changes
  useEffect(() => {
    if (!selected) return
    fetchPoints(selected.device, selected.session)
      .then(setPoints)
      .catch(() => setPoints([]))
    fetchMedia(selected.device, selected.session)
      .then(setMedia)
      .catch(() => setMedia([]))
  }, [selected])

  // live stream: append points/segments for the selected session; refresh the list
  useEffect(() => {
    const unsub = subscribeStream(
      (incoming: StreamPoint[]) => {
        if (incoming.length > 0) {
          const newest = Math.max(...incoming.map((p) => p.timestamp))
          setLastFixTs((prev) => Math.max(prev ?? 0, newest))
        }
        const sel = selectedRef.current
        if (sel) {
          const mine = incoming.filter(
            (p) => p.session_id === sel.session && (p.device_id ?? null) === (sel.device ?? null),
          )
          if (mine.length > 0) {
            setPoints((prev) => {
              const seen = new Set(prev.map((p) => p.point_id))
              const fresh = mine.filter((p) => !seen.has(p.point_id))
              return fresh.length > 0 ? [...prev, ...fresh] : prev
            })
          }
        }
        loadSessions()
      },
      setConnected,
      (segment: MediaSegment) => {
        const sel = selectedRef.current
        if (
          sel &&
          segment.session_id === sel.session &&
          (segment.device_id ?? null) === (sel.device ?? null)
        ) {
          setMedia((prev) =>
            prev.some((s) => s.id === segment.id) ? prev : [...prev, segment],
          )
        }
        loadSessions()
      },
    )
    return () => unsub()
  }, [loadSessions])

  const live = connected && lastFixTs != null && now - lastFixTs < LIVE_WINDOW_MS
  const feedStatus: FeedStatus = !connected ? 'offline' : live ? 'live' : 'stale'

  const playback = usePlayback(points)
  const mediaCache = useMediaCache(media, playback.playheadTs)

  const stats = useMemo(() => {
    const coords = points.filter((p) => p.lat != null && p.lon != null)
    let dist = 0
    for (let i = 1; i < coords.length; i++) {
      dist += haversineMeters(
        [coords[i - 1].lat!, coords[i - 1].lon!],
        [coords[i].lat!, coords[i].lon!],
      )
    }
    const last = points[points.length - 1]
    const first = points[0]
    return {
      count: points.length,
      distanceMi: dist / 1609.344,
      durationMs: last && first ? last.timestamp - first.timestamp : 0,
      lastFix: last ? new Date(last.timestamp).toLocaleTimeString() : null,
    }
  }, [points])

  // Static top speed over the whole path (max recorded fix speed).
  const topSpeedMph = useMemo(() => {
    let max: number | null = null
    for (const p of points) {
      if (p.speed != null && (max == null || p.speed > max)) max = p.speed
    }
    return max != null ? max * MPS_TO_MPH : null
  }, [points])

  // Stats at the playhead position, driving the HUD during playback.
  // Uses the same bracketing-fix logic as TrackMap's interpolated marker.
  const playheadStats = useMemo((): HudStats | null => {
    const ts = playback.playheadTs
    if (ts == null) return null
    const timed = points.filter((p) => p.lat != null && p.lon != null) as (Point & {
      lat: number
      lon: number
    })[]
    if (timed.length === 0) return null
    let i = 0
    while (i + 1 < timed.length && timed[i + 1].timestamp <= ts) i++
    let dist = 0
    for (let k = 1; k <= i; k++) {
      dist += haversineMeters([timed[k - 1].lat, timed[k - 1].lon], [timed[k].lat, timed[k].lon])
    }
    const a = timed[i]
    const b = timed[i + 1]
    if (b && ts > a.timestamp) {
      const f = Math.min(1, (ts - a.timestamp) / (b.timestamp - a.timestamp))
      dist += f * haversineMeters([a.lat, a.lon], [b.lat, b.lon])
    }
    const altM = mslAltitudeM(a)
    return {
      speedMph: a.speed != null ? a.speed * MPS_TO_MPH : null,
      topSpeedMph,
      distanceMi: dist / 1609.344,
      elapsedMs: ts - timed[0].timestamp,
      totalMs: timed[timed.length - 1].timestamp - timed[0].timestamp,
      altitudeFt: altM != null ? altM * M_TO_FT : null,
      battery: a.device_battery != null ? Math.round(a.device_battery * 100) : null,
      charging: a.battery_charging === 1,
      clockTs: ts,
    }
  }, [points, playback.playheadTs, topSpeedMph])

  // Latest-fix stats, driving the HUD outside playback (live/idle view).
  const latestStats = useMemo((): HudStats | null => {
    const last = points[points.length - 1]
    if (last == null) return null
    const altM = mslAltitudeM(last)
    return {
      speedMph: last.speed != null ? last.speed * MPS_TO_MPH : null,
      topSpeedMph,
      distanceMi: stats.distanceMi,
      elapsedMs: stats.durationMs,
      totalMs: stats.durationMs,
      altitudeFt: altM != null ? altM * M_TO_FT : null,
      battery: last.device_battery != null ? Math.round(last.device_battery * 100) : null,
      charging: last.battery_charging === 1,
      clockTs: last.timestamp,
    }
  }, [points, stats, topSpeedMph])

  const hudStats = playheadStats ?? latestStats

  return (
    <div className="flex min-h-screen flex-col lg:grid lg:h-screen lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:grid-rows-[48px_minmax(0,1fr)]">
      {/* header strip */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3 lg:col-span-3 lg:h-full">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center bg-primary text-primary-foreground">
            <Navigation className="size-4" />
          </div>
          <h1 className="text-sm font-semibold uppercase tracking-wider">geowise</h1>
        </div>
        <div className="flex-1" />
        <FeedIndicator
          status={feedStatus}
          lastFixTs={lastFixTs}
          now={now}
          dimmed={playback.active}
        />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={loadSessions}>
          <RefreshCw /> Refresh
        </Button>
      </header>

      {/* sessions rail (left on desktop, last on mobile) */}
      <aside className="order-3 flex flex-col border-t lg:order-none lg:min-h-0 lg:border-t-0 lg:border-r">
        <PanelLabel
          aside={
            <span className="font-mono text-[11px] text-muted-foreground">
              {sessions.length}
            </span>
          }
        >
          <Satellite className="size-3.5" /> Sessions
        </PanelLabel>
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {sessions.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">Waiting for data…</div>
          )}
          {sessions.map((s) => {
            const isSel =
              selected?.session === s.session_id && selected?.device === s.device_id
            return (
              <button
                key={`${s.device_id}-${s.session_id}`}
                onClick={() => setSelected({ device: s.device_id, session: s.session_id })}
                className={cn(
                  'relative block w-full cursor-pointer border-b px-3 py-2.5 text-left transition-colors hover:bg-accent',
                  isSel && 'bg-accent',
                )}
              >
                {isSel && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    Session {s.session_id}
                    {s.media_segments > 0 ? (
                      <Video className="size-3.5 text-muted-foreground" />
                    ) : null}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{s.points} pts</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleString()}
                </div>
                {isSel && stats.lastFix ? (
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {stats.count} pts loaded · last fix {stats.lastFix}
                  </div>
                ) : null}
                {s.device_id ? (
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                    {s.device_id}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </aside>

      {/* map fills the center: HUD pinned inside its top edge, playback bar its bottom */}
      <main className="relative order-1 h-[55vh] lg:order-none lg:h-auto lg:min-h-0">
        <TrackMap
          points={points}
          live={live && !playback.active}
          playheadTs={playback.playheadTs}
        />
        {hudStats && (
          <MapHud stats={hudStats} mode={playheadStats != null ? 'replay' : 'live'} />
        )}
        <div className="absolute inset-x-0 bottom-0 z-[1000]">
          <PlaybackBar playback={playback} />
        </div>
      </main>

      {/* camera rail (right on desktop, strip under the map on mobile) */}
      <aside className="order-2 border-t lg:order-none lg:min-h-0 lg:border-t-0 lg:border-l">
        <VideoPanel
          segments={media}
          live={live && !playback.active}
          playheadTs={playback.playheadTs}
          startTs={playback.startTs}
          endTs={playback.endTs}
          playing={playback.playing}
          speed={playback.speed}
          urlFor={mediaCache.urlFor}
          cacheLoaded={mediaCache.loaded}
          cacheTotal={mediaCache.total}
          onScrub={playback.seek}
          onPlayToggle={(p) => (p ? playback.play() : playback.pause())}
          onClockSync={playback.syncTo}
        />
      </aside>
    </div>
  )
}
