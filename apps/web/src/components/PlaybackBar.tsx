import { Pause, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PLAYBACK_SPEEDS, type Playback } from '@/hooks/usePlayback'
import { cn } from '@/lib/utils'

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Flat strip overlaid on the bottom edge of the map (mirrors the top HUD). */
export function PlaybackBar({ playback }: { playback: Playback }) {
  const { startTs, endTs, playheadTs, playing, speed, active } = playback
  // A single fix has no timeline to scrub — render the bar disabled.
  const hasTimeline = startTs != null && endTs != null && endTs > startTs
  const pos = playheadTs ?? startTs ?? 0

  return (
    <div className="flex h-11 items-center gap-3 border-t bg-card/90 px-3 backdrop-blur">
      <Button
        size="icon"
        className="size-8"
        disabled={!hasTimeline}
        onClick={playing ? playback.pause : playback.play}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {hasTimeline ? fmtClock(pos) : '—'}
      </span>
      <input
        type="range"
        min={startTs ?? 0}
        max={endTs ?? 1}
        step={500}
        value={pos}
        disabled={!hasTimeline}
        onChange={(e) => playback.seek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-primary disabled:opacity-50"
        aria-label="Playback position"
      />
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {hasTimeline
          ? `${fmtElapsed(pos - startTs)} / ${fmtElapsed(endTs - startTs)}`
          : '–:–– / –:––'}
      </span>
      <div className="hidden gap-1 sm:flex">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            disabled={!hasTimeline}
            onClick={() => playback.setSpeed(s)}
            className={cn(
              'cursor-pointer px-1.5 py-0.5 font-mono text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50',
              s === speed
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      {active && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={playback.exit}
          aria-label="Exit playback"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
