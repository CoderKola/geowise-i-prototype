import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Battery,
  BatteryCharging,
  Clock,
  Gauge,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Satellite,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrackMap } from '@/components/TrackMap'
import { PlaybackBar } from '@/components/PlaybackBar'
import { usePlayback } from '@/hooks/usePlayback'
import {
  fetchPoints,
  fetchSessions,
  subscribeStream,
  type Point,
  type Session,
  type StreamPoint,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const MPS_TO_MPH = 2.23694
const M_TO_FT = 3.28084

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLon = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
      </div>
      <div className={cn('font-mono text-2xl font-semibold', accent && 'text-[color:var(--go)]')}>
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  )
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<{ device: string | null; session: number } | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [connected, setConnected] = useState(false)
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const loadSessions = useCallback(async () => {
    try {
      const rows = await fetchSessions()
      setSessions(rows)
      // auto-select the most recent session on first load
      if (!selectedRef.current && rows.length > 0) {
        setSelected({ device: rows[0].device_id, session: rows[0].session_id })
      }
    } catch {
      /* feed offline; the status badge covers it */
    }
  }, [])

  // load sessions on mount + refresh occasionally
  useEffect(() => {
    loadSessions()
    const id = setInterval(loadSessions, 30000)
    return () => clearInterval(id)
  }, [loadSessions])

  // load points when selection changes
  useEffect(() => {
    if (!selected) return
    fetchPoints(selected.device, selected.session)
      .then(setPoints)
      .catch(() => setPoints([]))
  }, [selected])

  // live stream: append points for the selected session; refresh the list
  useEffect(() => {
    const unsub = subscribeStream((incoming: StreamPoint[]) => {
      setLastLiveAt(Date.now())
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
    }, setConnected)
    return () => unsub()
  }, [loadSessions])

  const live = lastLiveAt != null && Date.now() - lastLiveAt < 30000

  const playback = usePlayback(points)

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
    const speeds = points.map((p) => p.speed ?? 0)
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0
    return {
      count: points.length,
      distanceMi: dist / 1609.344,
      durationMs: last && first ? last.timestamp - first.timestamp : 0,
      lastSpeedMph: (last?.speed ?? 0) * MPS_TO_MPH,
      maxSpeedMph: maxSpeed * MPS_TO_MPH,
      altitudeFt: last?.altitude != null ? last.altitude * M_TO_FT : null,
      battery: last?.device_battery != null ? Math.round(last.device_battery * 100) : null,
      charging: last?.battery_charging === 1,
      lastFix: last ? new Date(last.timestamp).toLocaleTimeString() : null,
      network: last?.network_type ?? null,
    }
  }, [points])

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 lg:p-6">
      {/* header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Navigation className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">geowise</h1>
            <p className="text-xs text-muted-foreground">Live tracking dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? 'success' : 'muted'}>
            <span
              className={cn(
                'size-1.5 rounded-full',
                connected ? 'bg-[color:var(--go)]' : 'bg-muted-foreground',
              )}
            />
            {connected ? (live ? 'Live' : 'Connected') : 'Feed offline'}
          </Badge>
          <Button variant="outline" size="sm" onClick={loadSessions}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </header>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat
          icon={Gauge}
          label="Speed"
          value={stats.lastSpeedMph.toFixed(1)}
          sub={`mph · max ${stats.maxSpeedMph.toFixed(1)}`}
          accent={live}
        />
        <Stat icon={Route} label="Distance" value={stats.distanceMi.toFixed(2)} sub="miles" />
        <Stat
          icon={Clock}
          label="Duration"
          value={stats.durationMs > 0 ? fmtDuration(stats.durationMs) : '—'}
          sub={stats.lastFix ? `last fix ${stats.lastFix}` : undefined}
        />
        <Stat icon={MapPin} label="Points" value={String(stats.count)} sub="gps fixes" />
        <Stat
          icon={Activity}
          label="Altitude"
          value={stats.altitudeFt != null ? stats.altitudeFt.toFixed(0) : '—'}
          sub="feet"
        />
        <Stat
          icon={stats.charging ? BatteryCharging : Battery}
          label="Battery"
          value={stats.battery != null ? `${stats.battery}%` : '—'}
          sub={stats.charging ? 'charging' : (stats.network ?? undefined)}
        />
      </div>

      {/* map + sessions */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="min-h-[420px] gap-2 p-2 lg:min-h-[520px]">
          <div className="min-h-0 flex-1">
            <TrackMap
              points={points}
              live={live && !playback.active}
              playheadTs={playback.playheadTs}
            />
          </div>
          <PlaybackBar playback={playback} />
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Satellite className="size-4" /> Sessions
            </CardTitle>
            <CardDescription>
              {sessions.length === 0 ? 'Waiting for data…' : `${sessions.length} recorded`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex max-h-[440px] flex-col gap-1.5 overflow-y-auto">
            {sessions.map((s) => {
              const isSel =
                selected?.session === s.session_id && selected?.device === s.device_id
              return (
                <button
                  key={`${s.device_id}-${s.session_id}`}
                  onClick={() => setSelected({ device: s.device_id, session: s.session_id })}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                    isSel && 'border-primary bg-accent',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Session {s.session_id}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.points} pts</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(s.started_at).toLocaleString()}
                  </div>
                  {s.device_id ? (
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                      {s.device_id}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <footer className="text-center text-xs text-muted-foreground">
        Feed served locally on 127.0.0.1:3100 — never exposed through the tunnel.
      </footer>
    </div>
  )
}
