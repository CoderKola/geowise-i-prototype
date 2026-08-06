import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Point } from '@/lib/api'

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
  setSpeed: (s: PlaybackSpeed) => void
  exit: () => void
}

/**
 * Drives a playhead across a session's timestamp range with requestAnimationFrame.
 * Playback advances in session time (wall-clock at 1×), so recording gaps —
 * phone asleep, standing still — replay at their true duration scaled by speed.
 */
export function usePlayback(points: Point[]): Playback {
  const range = useMemo(() => {
    const coords = points.filter((p) => p.lat != null && p.lon != null)
    return coords.length > 0
      ? {
          start: coords[0].timestamp,
          end: coords[coords.length - 1].timestamp,
          firstId: coords[0].point_id,
        }
      : { start: null, end: null, firstId: null }
  }, [points])

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
    setSpeed,
    exit,
  }
}
