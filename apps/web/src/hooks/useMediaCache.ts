import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mediaFileUrl, type MediaSegment } from '@/lib/api'

// Blob-caches the video chunks playback needs next so tiles and cross-chunk
// scrubbing never wait on the network.
// - Small sessions (≤ PRELOAD_MAX chunks): preload everything up front.
// - Larger sessions: sliding window PER FACING keyed on the playhead — the
//   bracketing chunk + the next WINDOW_AHEAD + the previous WINDOW_BEHIND,
//   fetched in playback order (bracketing chunk first after a scrub jump).
//   Chunks leaving the window get their object URLs revoked, so memory stays
//   bounded regardless of session length. With no playhead (idle/live) the
//   window anchors on the newest chunks.
// Cache is keyed by segment id: a session switch revokes stale URLs and
// queues the new set; SSE-appended segments just extend/slide the window.

const CONCURRENCY = 3
/** sessions up to this many chunks are fully preloaded (prototype scale) */
const PRELOAD_MAX = 12
const WINDOW_AHEAD = 4
const WINDOW_BEHIND = 1

export interface MediaCache {
  /** cached object URL when available, network URL as fallback */
  urlFor: (id: number) => string
  /** cached count over the current want-set (window-relative above PRELOAD_MAX) */
  loaded: number
  total: number
  ready: boolean
}

/**
 * Segment ids to cache, in fetch-priority order. Window mode interleaves
 * facings level-by-level (both brackets, then both next-1s, …) so no camera
 * starves while the other fills its lookahead.
 */
function wantedIds(segments: MediaSegment[], playheadTs: number | null): number[] {
  if (segments.length <= PRELOAD_MAX) return segments.map((s) => s.id)

  const byFacing = new Map<MediaSegment['facing'], MediaSegment[]>()
  for (const s of segments) {
    const list = byFacing.get(s.facing) ?? []
    list.push(s)
    byFacing.set(s.facing, list)
  }

  const perFacing: number[][] = []
  for (const list of byFacing.values()) {
    list.sort((a, b) => a.started_at - b.started_at)
    const ids: number[] = []
    if (playheadTs != null) {
      // Bracketing chunk (last started at/before the playhead; first chunk
      // when the playhead precedes all of them), then ahead, then behind.
      let anchor = 0
      for (let i = 0; i < list.length; i++) {
        if (list[i].started_at <= playheadTs) anchor = i
        else break
      }
      ids.push(list[anchor].id)
      for (let k = 1; k <= WINDOW_AHEAD; k++) {
        if (anchor + k < list.length) ids.push(list[anchor + k].id)
      }
      for (let k = 1; k <= WINDOW_BEHIND; k++) {
        if (anchor - k >= 0) ids.push(list[anchor - k].id)
      }
    } else {
      // Idle/live: newest chunks first — the newest is what the tile shows.
      const size = 1 + WINDOW_AHEAD + WINDOW_BEHIND
      for (let i = list.length - 1; i >= Math.max(0, list.length - size); i--) {
        ids.push(list[i].id)
      }
    }
    perFacing.push(ids)
  }

  const ordered: number[] = []
  const depth = Math.max(0, ...perFacing.map((ids) => ids.length))
  for (let k = 0; k < depth; k++) {
    for (const ids of perFacing) if (k < ids.length) ordered.push(ids[k])
  }
  return ordered
}

export function useMediaCache(
  segments: MediaSegment[],
  playheadTs: number | null,
): MediaCache {
  const cacheRef = useRef(new Map<number, string>())
  // Latest wanted set — long-running workers consult it so a fetch finishing
  // after a session switch or window slide doesn't cache (and leak) a stale chunk.
  const wantedRef = useRef<Set<number>>(new Set())
  const inFlightRef = useRef<Set<number>>(new Set())
  const [, setVersion] = useState(0)

  // Recomputed every playhead tick, but cheap; the fetch effect below only
  // fires when the window's CONTENTS change (chunk-boundary crossings).
  const wanted = useMemo(() => wantedIds(segments, playheadTs), [segments, playheadTs])
  const wantedKey = wanted.join(',')
  const wantedNow = useRef(wanted)
  wantedNow.current = wanted

  useEffect(() => {
    const ids = wantedNow.current
    const wantedSet = new Set(ids)
    wantedRef.current = wantedSet

    let changed = false
    for (const [id, url] of cacheRef.current) {
      if (!wantedSet.has(id)) {
        URL.revokeObjectURL(url)
        cacheRef.current.delete(id)
        changed = true
      }
    }

    // Priority order is baked into `ids` (bracketing chunk first).
    const queue = ids.filter(
      (id) => !cacheRef.current.has(id) && !inFlightRef.current.has(id),
    )

    const worker = async () => {
      for (;;) {
        const id = queue.shift()
        if (id == null) return
        if (!wantedRef.current.has(id)) continue
        inFlightRef.current.add(id)
        try {
          const r = await fetch(mediaFileUrl(id))
          if (!r.ok) throw new Error(String(r.status))
          const blob = await r.blob()
          if (wantedRef.current.has(id)) {
            cacheRef.current.set(id, URL.createObjectURL(blob))
          }
        } catch {
          /* leave uncached — tiles fall back to the network URL */
        }
        inFlightRef.current.delete(id)
        setVersion((n) => n + 1)
      }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) worker()

    if (changed) setVersion((n) => n + 1)
  }, [wantedKey])

  // Revoke everything on unmount.
  useEffect(
    () => () => {
      for (const url of cacheRef.current.values()) URL.revokeObjectURL(url)
      cacheRef.current.clear()
    },
    [],
  )

  const urlFor = useCallback(
    (id: number) => cacheRef.current.get(id) ?? mediaFileUrl(id),
    [],
  )

  let loaded = 0
  for (const id of wanted) if (cacheRef.current.has(id)) loaded++

  return { urlFor, loaded, total: wanted.length, ready: loaded === wanted.length }
}
