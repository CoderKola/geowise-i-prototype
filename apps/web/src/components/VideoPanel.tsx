import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtWallClock } from '@/components/MapHud'
import type { MediaSegment } from '@/lib/api'

// Near-live ride video: the phone uploads ~15s MP4 chunks per camera.
// - Live mode: auto-plays the newest chunk per facing (~20-40s behind reality).
// - Replay: video and GPS share ONE full-session timeline. Each tile carries
//   its own scrubber spanning the WHOLE session (not the 15s chunk): dragging
//   it seeks the shared clock, which computes chunk + offset and routes the
//   right (preloaded) chunk into the tile. While playing, the master tile's
//   rendered frame IS the clock (timeupdate -> syncTo), so map and video
//   never drift apart.

// Fixed rail slots. The front-of-car phone provides both "Front" feeds: its
// back camera looks forward down the road, its front camera looks rearward.
// "Center" is reserved for a future center-mounted device (null = no feed
// wired up yet). Rewire here as cameras land.
const SLOTS: { label: string; facing: MediaSegment['facing'] | null }[] = [
  { label: 'Front 1', facing: 'back' },
  { label: 'Front 2', facing: 'front' },
  { label: 'Center', facing: null },
]

/** Max staleness before a bracketed segment is considered "no coverage". */
const COVERAGE_SLACK_MS = 5_000

function segmentForPlayhead(
  segments: MediaSegment[],
  ts: number,
): MediaSegment | null {
  let candidate: MediaSegment | null = null
  for (const s of segments) {
    if (s.started_at <= ts) candidate = s
    else break // sorted by started_at
  }
  if (candidate && ts <= candidate.ended_at + COVERAGE_SLACK_MS) return candidate
  return null
}

// Browsers cap HTMLMediaElement.playbackRate (Chrome/Firefox clamp at 16× in
// source); beyond the cap the drift-correction seek below takes over (playback
// looks stepped at 30×). Probe the running browser's real clamp once at module
// load so the master-clock/rate threshold always matches it exactly.
const RATE_PROBE = 32
const RATE_FALLBACK = 16

function probeMaxVideoRate(): number {
  try {
    const el = document.createElement('video')
    el.playbackRate = RATE_PROBE
    const clamped = el.playbackRate
    // A browser that doesn't clamp on set echoes the probe value back — it
    // can't actually decode that fast, so keep the conservative fallback.
    if (Number.isFinite(clamped) && clamped > 0 && clamped < RATE_PROBE) return clamped
  } catch {
    /* some engines throw NotSupportedError on out-of-range rates */
  }
  return RATE_FALLBACK
}

const MAX_VIDEO_RATE = probeMaxVideoRate()

// Mobile: 3-across strip, portrait tiles. Desktop: slot fills its rail share.
const TILE_BOX = 'aspect-[3/4] lg:aspect-auto lg:min-h-0 lg:flex-1'

interface SlotEntry {
  seg: MediaSegment
  /** resolved once when the chunk enters the slot — never swapped mid-view */
  src: string
}

function FacingTile({
  facing,
  segments,
  live,
  playheadTs,
  startTs,
  endTs,
  playing,
  speed,
  isMaster,
  urlFor,
  onScrub,
  onPlayToggle,
  onClockSync,
}: {
  facing: MediaSegment['facing']
  segments: MediaSegment[]
  live: boolean
  playheadTs: number | null
  /** full session timestamp range — the tile scrubber spans all of it */
  startTs: number | null
  endTs: number | null
  playing: boolean
  speed: number
  /** this tile's frame drives the shared clock while playing */
  isMaster: boolean
  urlFor: (id: number) => string
  onScrub: (ts: number) => void
  onPlayToggle: (playing: boolean) => void
  onClockSync: (ts: number) => void
}) {
  // Double-buffered players: the target chunk loads in the HIDDEN slot and the
  // slots swap only once its first frame is decoded. Remounting a single
  // <video> per chunk blanks the tile for the load duration — at 10× map speed
  // chunks rotate every ~1.5 real seconds, which reads as constant blinking.
  const refA = useRef<HTMLVideoElement | null>(null)
  const refB = useRef<HTMLVideoElement | null>(null)
  const [active, setActive] = useState<0 | 1>(0)
  const [slotSegs, setSlotSegs] = useState<(SlotEntry | null)[]>([null, null])
  // Rendered frame's wall-clock (seg.started_at + currentTime), refreshed from
  // the browser's own timeupdate cadence (~4 Hz) — drives the sync overlay.
  const [frameTs, setFrameTs] = useState<number | null>(null)

  const elFor = (slot: 0 | 1) => (slot === 0 ? refA : refB).current

  const segment = useMemo(() => {
    if (segments.length === 0) return null
    if (playheadTs != null) return segmentForPlayhead(segments, playheadTs)
    return segments[segments.length - 1] // newest (live or idle)
  }, [segments, playheadTs])

  // Media-seconds per wall-second for a loaded chunk. Under encoder overload
  // (dual-cam), the phone produces 15s of frames over MORE than 15s of wall
  // time — e.g. a 25s wall span holding a 15s file (scale 0.6). All wall<->
  // media time conversions must go through this or the video overshoots the
  // playhead mid-chunk and freezes ("choppy" replay). 1 until metadata loads.
  const chunkScale = (el: HTMLVideoElement | null, seg: MediaSegment): number => {
    if (el == null) return 1
    const spanS = (seg.ended_at - seg.started_at) / 1000
    const dur = el.duration
    return Number.isFinite(dur) && dur > 0 && spanS > 0 ? Math.min(1, dur / spanS) : 1
  }

  const seekTo = (el: HTMLVideoElement, seg: MediaSegment) => {
    if (playheadTs != null) {
      el.currentTime = Math.max(
        0,
        ((playheadTs - seg.started_at) / 1000) * chunkScale(el, seg),
      )
    }
  }

  const swapTo = (slot: 0 | 1, seg: MediaSegment) => {
    const el = elFor(slot)
    if (el) {
      seekTo(el, seg)
      if (live || playing) el.play().catch(() => {})
    }
    elFor(slot === 0 ? 1 : 0)?.pause()
    setActive(slot)
  }

  // Route the target chunk into the hidden slot (or swap if it's already there).
  useEffect(() => {
    if (segment == null) {
      setSlotSegs([null, null])
      return
    }
    if (slotSegs[active]?.seg.id === segment.id) return
    const hidden: 0 | 1 = active === 0 ? 1 : 0
    if (slotSegs[hidden]?.seg.id === segment.id) {
      // Already loaded (e.g. scrubbed back to the previous chunk) — swap now.
      const el = elFor(hidden)
      if (el && el.readyState >= 2) swapTo(hidden, segment)
      return // otherwise onLoadedData will swap when ready
    }
    setSlotSegs((prev) => {
      const next = [...prev]
      next[hidden] = { seg: segment, src: urlFor(segment.id) }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, slotSegs, active])

  // Hidden slot finished loading the target chunk — swap seamlessly.
  const onSlotReady = (slot: 0 | 1) => () => {
    const seg = slotSegs[slot]?.seg
    if (seg == null || segment == null || seg.id !== segment.id || slot === active) return
    swapTo(slot, seg)
  }

  // Map playback: actually PLAY the visible video at the map's speed, and only
  // hard-seek when it drifts from the playhead. (Merely stepping currentTime
  // on a paused element renders ~1 frame per second — a slideshow.)
  //
  // The drift slack scales with speed: at high rates the decoder often can't
  // keep up, and a tight threshold degenerates into a rapid seek/stall loop
  // (video visibly "snapping"). Better to let it lag a little and correct
  // rarely. While paused/scrubbing, sync tightly — accuracy beats smoothness.
  //
  // MASTER tile exception: while playing at a rate the browser can honor, the
  // clock is derived from THIS tile's frame (timeupdate -> onClockSync), so
  // correcting its currentTime from the clock would chase our own tail.
  useEffect(() => {
    if (playheadTs == null) return
    const entry = slotSegs[active]
    const el = elFor(active)
    if (el == null || entry == null) return
    const seg = entry.seg
    const scale = chunkScale(el, seg)
    // Effective playback rate honors the chunk's time-scale: a chunk holding
    // 15s of media across a 25s wall span must play at 0.6x per 1x of session
    // time to stay in step with the map.
    const rate = Math.min(speed * scale, MAX_VIDEO_RATE)
    const masterDrives = isMaster && playing && speed * scale <= MAX_VIDEO_RATE
    if (!masterDrives) {
      const target = ((playheadTs - seg.started_at) / 1000) * scale
      const mediaLenS = ((seg.ended_at - seg.started_at) / 1000) * scale
      const slack = playing ? Math.max(0.75, speed * 0.35) : 0.25
      // Only correct within this chunk's own range — while the NEXT chunk is
      // still loading, let the visible one run out naturally (no rewinding).
      if (target >= 0 && target <= mediaLenS + 1 && Math.abs(el.currentTime - target) > slack) {
        el.currentTime = Math.max(0, target)
      }
    }
    if (el.playbackRate !== rate) el.playbackRate = rate
    if (playing && el.paused && !el.ended) {
      el.play().catch(() => {}) // muted, so autoplay policy allows it
    } else if (!playing && !el.paused) {
      el.pause()
    }
  }, [playheadTs, slotSegs, active, playing, speed, isMaster])

  const tsAt = (slot: 0 | 1): number | null => {
    const entry = slotSegs[slot]
    const el = elFor(slot)
    if (entry == null || el == null) return null
    // Inverse of the wall->media mapping: frame position back to wall-clock.
    return entry.seg.started_at + (el.currentTime / chunkScale(el, entry.seg)) * 1000
  }

  // timeupdate on the visible slot: refresh the frame-time overlay, and — for
  // the master tile while playing — feed the shared clock (the rendered frame
  // IS the session time).
  const onTimeUpdate = (slot: 0 | 1) => () => {
    if (slot !== active) return
    const ts = tsAt(slot)
    if (ts != null) setFrameTs(ts)
    if (!isMaster || live || !playing) return
    const el = elFor(slot)
    if (el == null || el.paused || el.seeking) return
    const entry = slotSegs[slot]
    if (entry == null || speed * chunkScale(el, entry.seg) > MAX_VIDEO_RATE) return
    if (ts != null) onClockSync(ts)
  }

  const togglePlay = () => {
    if (live) return
    if (playing) {
      onPlayToggle(false)
      return
    }
    // Idle: anchor the session clock to the displayed frame before rolling.
    if (playheadTs == null) {
      const ts = tsAt(active)
      if (ts != null) onScrub(ts)
    }
    onPlayToggle(true)
  }

  const showPlaceholder = slotSegs[0] == null && slotSegs[1] == null
  const hasTimeline = startTs != null && endTs != null && endTs > startTs
  const showScrubber = !live && hasTimeline && !showPlaceholder
  // Signed offset between this tile's rendered frame and the map playhead.
  const driftS =
    frameTs != null && playheadTs != null ? (frameTs - playheadTs) / 1000 : null

  return (
    <div className={cn('relative overflow-hidden bg-black', TILE_BOX)}>
      {showPlaceholder ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
          {segments.length === 0 ? 'no feed' : 'no coverage here'}
        </div>
      ) : (
        ([0, 1] as const).map((slot) => {
          const entry = slotSegs[slot]
          if (entry == null) return null
          const isActive = slot === active
          return (
            <video
              key={slot} // stable per slot — chunk changes swap src, not the element
              ref={slot === 0 ? refA : refB}
              src={entry.src}
              className={cn(
                'absolute inset-0 h-full w-full cursor-pointer object-cover',
                !isActive && 'pointer-events-none opacity-0',
              )}
              muted
              playsInline
              preload="auto"
              autoPlay={live && isActive}
              onClick={togglePlay}
              onLoadedData={onSlotReady(slot)}
              onTimeUpdate={onTimeUpdate(slot)}
            />
          )
        })
      )}
      <span className="pointer-events-none absolute top-1.5 left-2 bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
        {facing}
      </span>
      {/* Frame wall-clock + sync drift vs the map playhead: green under 0.5s,
          amber beyond — stitching accuracy at a glance, always visible. */}
      {frameTs != null && !showPlaceholder && (
        <span
          className={cn(
            'pointer-events-none absolute right-1.5 bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white',
            showScrubber ? 'bottom-9' : 'bottom-1.5',
          )}
        >
          {fmtWallClock(frameTs)}
          {driftS != null && (
            <span
              className={cn(
                'ml-1.5',
                Math.abs(driftS) < 0.5
                  ? 'text-[color:var(--go)]'
                  : 'text-[color:var(--amber)]',
              )}
            >
              {`${driftS >= 0 ? '+' : ''}${driftS.toFixed(1)}s`}
            </span>
          )}
        </span>
      )}
      {/* Full-session scrubber: same timestamp range as the map's playback
          bar, so dragging here moves the GPS tracker anywhere on the route
          and the right chunk is computed + loaded on the fly. */}
      {showScrubber && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-2 py-1.5">
          <button
            onClick={togglePlay}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-white hover:text-white/70"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <input
            type="range"
            min={startTs}
            max={endTs}
            step={250}
            value={playheadTs ?? endTs}
            onChange={(e) => onScrub(Number(e.target.value))}
            className="min-w-0 flex-1 accent-primary"
            aria-label="Session position"
          />
        </div>
      )}
    </div>
  )
}

/**
 * Camera rail: three fixed slots, always rendered. Vertical stack on desktop
 * (right of the map), 3-across strip on mobile.
 */
export function VideoPanel({
  segments,
  live,
  playheadTs,
  startTs,
  endTs,
  playing,
  speed,
  urlFor,
  cacheLoaded,
  cacheTotal,
  onScrub,
  onPlayToggle,
  onClockSync,
}: {
  segments: MediaSegment[]
  live: boolean
  playheadTs: number | null
  startTs: number | null
  endTs: number | null
  playing: boolean
  speed: number
  urlFor: (id: number) => string
  cacheLoaded: number
  cacheTotal: number
  onScrub: (ts: number) => void
  onPlayToggle: (playing: boolean) => void
  onClockSync: (ts: number) => void
}) {
  const byFacing = useMemo(() => {
    const map = new Map<MediaSegment['facing'], MediaSegment[]>()
    for (const s of segments) {
      const list = map.get(s.facing) ?? []
      list.push(s)
      map.set(s.facing, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.started_at - b.started_at)
    return map
  }, [segments])

  // First slot with coverage at the playhead acts as the clock master.
  const masterFacing = useMemo(() => {
    if (playheadTs == null) return null
    for (const slot of SLOTS) {
      if (slot.facing == null) continue
      if (segmentForPlayhead(byFacing.get(slot.facing) ?? [], playheadTs)) return slot.facing
    }
    return null
  }, [byFacing, playheadTs])

  const buffering = cacheTotal > 0 && cacheLoaded < cacheTotal

  return (
    <div className="grid h-full grid-cols-3 lg:flex lg:flex-col">
      {SLOTS.map((slot, i) => {
        const segs = slot.facing != null ? byFacing.get(slot.facing) ?? [] : []
        return (
          <section
            key={slot.label}
            className={cn(
              'flex min-w-0 flex-col lg:min-h-0 lg:flex-1',
              i > 0 && 'border-l lg:border-l-0 lg:border-t',
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b bg-secondary px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground">
                {slot.label}
              </span>
              {live && segs.length > 0 ? (
                <span className="text-[10px] font-medium uppercase text-[color:var(--go)]">
                  near-live
                </span>
              ) : buffering && segs.length > 0 ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  buffering {cacheLoaded}/{cacheTotal}
                </span>
              ) : null}
            </div>
            {slot.facing != null ? (
              <FacingTile
                facing={slot.facing}
                segments={segs}
                live={live}
                playheadTs={playheadTs}
                startTs={startTs}
                endTs={endTs}
                playing={playing}
                speed={speed}
                isMaster={slot.facing === masterFacing}
                urlFor={urlFor}
                onScrub={onScrub}
                onPlayToggle={onPlayToggle}
                onClockSync={onClockSync}
              />
            ) : (
              <div
                className={cn(
                  'flex items-center justify-center bg-black/90 text-xs text-white/40',
                  TILE_BOX,
                )}
              >
                no feed
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
