import { Pause, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PLAYBACK_SPEEDS, type Playback } from '@/hooks/usePlayback'
import { cn } from '@/lib/utils'

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PlaybackBar({ playback }: { playback: Playback }) {
  const { startTs, endTs, playheadTs, playing, speed, active } = playback
  // A single fix has no timeline to scrub.
  if (startTs == null || endTs == null || endTs <= startTs) return null
  const pos = playheadTs ?? startTs

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Button
        size="icon"
        className="size-8"
        onClick={playing ? playback.pause : playback.play}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {fmtClock(pos)}
      </span>
      <input
        type="range"
        min={startTs}
        max={endTs}
        step={500}
        value={pos}
        onChange={(e) => playback.seek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-primary"
        aria-label="Playback position"
      />
      <span className="font-mono text-xs text-muted-foreground">
        {fmtElapsed(pos - startTs)} / {fmtElapsed(endTs - startTs)}
      </span>
      <div className="flex gap-1">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => playback.setSpeed(s)}
            className={cn(
              'cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors',
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
