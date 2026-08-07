import { Activity, Battery, BatteryCharging, CalendarClock, Clock, Gauge, Route, Zap } from 'lucide-react'
import { fmtElapsed } from '@/components/PlaybackBar'

export interface HudStats {
  speedMph: number | null
  /** static max over the whole path, not the playhead */
  topSpeedMph: number | null
  distanceMi: number
  elapsedMs: number
  totalMs: number
  altitudeFt: number | null
  battery: number | null
  charging: boolean
  /** wall-clock of the playhead (replay) or the latest fix (live), epoch ms */
  clockTs: number | null
}

/** Epoch ms → local HH:MM:SS, shared with the video tiles' frame overlay. */
export function fmtWallClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function Item({
  icon: Icon,
  value,
  unit,
}: {
  icon: React.ElementType
  value: string
  unit?: string
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="font-mono text-xs font-semibold">{value}</span>
      {unit ? <span className="text-[10px] text-muted-foreground">{unit}</span> : null}
    </span>
  )
}

/**
 * Always-on metrics strip pinned inside the map's top edge.
 * - live mode: driven by the latest fix (speed/alt/battery) + session totals
 * - replay mode: driven by the playback playhead
 */
export function MapHud({ stats, mode }: { stats: HudStats; mode: 'live' | 'replay' }) {
  const showRange = stats.elapsedMs !== stats.totalMs
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card/90 px-3 py-2 backdrop-blur">
        {mode === 'replay' && (
          <span className="bg-[color:var(--amber)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            replay
          </span>
        )}
        <Item
          icon={Gauge}
          value={stats.speedMph != null ? stats.speedMph.toFixed(1) : '—'}
          unit="mph"
        />
        {stats.topSpeedMph != null && (
          <Item icon={Zap} value={stats.topSpeedMph.toFixed(1)} unit="mph top" />
        )}
        <Item icon={Route} value={stats.distanceMi.toFixed(2)} unit="mi" />
        <Item
          icon={Clock}
          value={
            showRange
              ? `${fmtElapsed(stats.elapsedMs)} / ${fmtElapsed(stats.totalMs)}`
              : fmtElapsed(stats.totalMs)
          }
        />
        {/* absolute wall-clock of the playhead — eyeball against the tiles' frame overlays */}
        {stats.clockTs != null && (
          <Item icon={CalendarClock} value={fmtWallClock(stats.clockTs)} />
        )}
        {stats.altitudeFt != null && (
          <Item icon={Activity} value={stats.altitudeFt.toFixed(0)} unit="ft" />
        )}
        {stats.battery != null && (
          <Item
            icon={stats.charging ? BatteryCharging : Battery}
            value={`${stats.battery}%`}
          />
        )}
      </div>
    </div>
  )
}
