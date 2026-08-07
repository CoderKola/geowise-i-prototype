import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaSegment, Point } from '@/lib/api'

export const PLAYBACK_SPEEDS = [1, 2, 5, 10, 30] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export interface Playback {
  /** true once the user has started or scrubbed a playback */
  active: boolean
  playing: boolean
  speed: PlaybackSpeed
  /** current playhead position on the session timeline (epoch ms), null when inactive */
  playheadTs: number | null
  startTs: number | null
  endTs: number | null
  play: () => void
  pause: () => void
  seek: (ts: number) => void
  /**
   * Clock correction from the master video tile: while a video is rendering,
   * the playhead is derived FROM the frame so GPS and video never drift.
   * No-op when playback is inactive; small deltas are ignored (the rAF loop
   * already tracks closely — sub-threshold corrections would only jitter).
   */
  syncTo: (ts: number) => void
  setSpeed: (s: PlaybackSpeed) => void
  exit: () => void
}

/** Ignore master-clock corrections smaller than this (session-time ms). */
const SYNC_THRESHOLD_MS = 120

/**
 * Drives a playhead across a session's timestamp range with requestAnimationFrame.
 * Playback advances in session time (wall-clock at 1×), so recording gaps —
 * phone asleep, standing still — replay at their true duration scaled by speed.
 *
 * The timeline range comes from the GPS coords; video-only sessions (media but
 * no fixes — e.g. a ride whose points were lost) fall back to the chunks'
 * time range so the video is still scrubbable.
 */
export function usePlayback(points: Point[], media: MediaSegment[] = []): Playback {
  const range = useMemo(() => {
    const coords = points.filter((p) => p.lat != null && p.lon != null)
    if (coords.length > 0) {
      return {
        start: coords[0].timestamp,
        end: coords[coords.length - 1].timestamp,
        firstId: coords[0].point_id,
      }
    }
    if (media.length > 0) {
      let start = Infinity
      let end = -Infinity
      for (const m of media) {
        if (m.started_at < start) start = m.started_at
        if (m.ended_at > end) end = m.ended_at
      }
      // firstId keyed off the media range so a session switch still resets.
      return { start, end, firstId: -start }
    }
    return { start: null, end: null, firstId: null }
  }, [points, media])

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(10)
  const [playheadTs, setPlayheadTs] = useState<number | null>(null)

  // Mirrors so the rAF loop reads fresh values without re-subscribing.
  const playheadRef = useRef<number | null>(null)
  const speedRef = useRef<number>(speed)
  speedRef.current = speed
  const rangeRef = useRef(range)
  rangeRef.current = range

  const exit = useCallback(() => {
    setPlaying(false)
    playheadRef.current = null
    setPlayheadTs(null)
  }, [])

  // Reset when the session changes — keyed on the first point rather than the
  // points array identity, so live SSE appends don't kill an active playback.
  useEffect(() => {
    exit()
  }, [range.firstId, exit])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const { start, end } = rangeRef.current
      if (start == null || end == null) {
        setPlaying(false)
        return
      }
      const dt = now - last
      last = now
      let next = (playheadRef.current ?? start) + dt * speedRef.current
      if (next >= end) {
        next = end
        setPlaying(false)
      } else {
        raf = requestAnimationFrame(frame)
      }
      playheadRef.current = next
      setPlayheadTs(next)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const play = useCallback(() => {
    const { start, end } = rangeRef.current
    if (start == null || end == null || end <= start) return
    // Play from the start when nothing is scrubbed or the last run finished.
    if (playheadRef.current == null || playheadRef.current >= end) {
      playheadRef.current = start
      setPlayheadTs(start)
    }
    setPlaying(true)
  }, [])

  const pause = useCallback(() => setPlaying(false), [])

  const seek = useCallback((ts: number) => {
    playheadRef.current = ts
    setPlayheadTs(ts)
  }, [])

  const syncTo = useCallback((ts: number) => {
    if (playheadRef.current == null) return
    if (Math.abs(ts - playheadRef.current) < SYNC_THRESHOLD_MS) return
    playheadRef.current = ts
    setPlayheadTs(ts)
  }, [])

  return {
    active: playheadTs != null,
    playing,
    speed,
    playheadTs,
    startTs: range.start,
    endTs: range.end,
    play,
    pause,
    seek,
    syncTo,
    setSpeed,
    exit,
  }
}
