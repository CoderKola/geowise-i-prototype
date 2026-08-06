import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { Point } from '@/lib/api'

// NOTE: effects below depend on primitive lat/lon values, not array refs —
// fresh [lat,lon] arrays every render would re-fire panTo/fitBounds endlessly
// and the map never settles (gray tiles).

function FollowLatest({
  lat,
  lon,
  follow,
}: {
  lat: number | null
  lon: number | null
  follow: boolean
}) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lon != null && follow) map.panTo([lat, lon], { animate: true })
  }, [lat, lon, follow, map])
  return null
}

function FitOnLoad({ track, fitKey }: { track: LatLngExpression[]; fitKey: string }) {
  const map = useMap()
  useEffect(() => {
    if (track.length > 1) {
      map.fitBounds(track as [number, number][], { padding: [40, 40] })
    } else if (track.length === 1) {
      map.setView(track[0], 16)
    }
    // fitKey changes only when the session (first point) changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map])
  return null
}

export function TrackMap({
  points,
  live,
  playheadTs = null,
}: {
  points: Point[]
  live: boolean
  /** playback position (epoch ms); when set, the map renders playback state */
  playheadTs?: number | null
}) {
  const timed = useMemo(
    () =>
      points.filter((p) => p.lat != null && p.lon != null) as (Point & {
        lat: number
        lon: number
      })[],
    [points],
  )
  const track: LatLngExpression[] = useMemo(() => timed.map((p) => [p.lat, p.lon]), [timed])

  // Playback view: the portion of the track covered so far, plus a marker
  // linearly interpolated between the two GPS fixes bracketing the playhead.
  const playback = useMemo(() => {
    if (playheadTs == null || timed.length === 0) return null
    let i = 0
    while (i + 1 < timed.length && timed[i + 1].timestamp <= playheadTs) i++
    const a = timed[i]
    const b = timed[i + 1]
    let pos: [number, number] = [a.lat, a.lon]
    if (b && playheadTs > a.timestamp) {
      const f = Math.min(1, (playheadTs - a.timestamp) / (b.timestamp - a.timestamp))
      pos = [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]
    }
    const done: LatLngExpression[] = [
      ...timed.slice(0, i + 1).map((p) => [p.lat, p.lon] as [number, number]),
      pos,
    ]
    return { pos, done }
  }, [playheadTs, timed])

  const last = [...points].reverse().find((p) => p.lat != null && p.lon != null)
  const latest: LatLngExpression | null = last ? [last.lat!, last.lon!] : null
  const first = points.find((p) => p.lat != null && p.lon != null)
  const fitKey = first ? `${first.point_id}:${first.lat},${first.lon}` : 'none'
  const center: LatLngExpression = latest ?? [40.7128, -74.006] // NYC fallback

  return (
    <MapContainer
      center={center}
      zoom={15}
      className="h-full w-full rounded-xl z-0"
      scrollWheelZoom
    >
      {/* CARTO Positron: light grey basemap with subtle green for parks */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={20}
      />
      {track.length > 1 && (
        <Polyline
          positions={track}
          pathOptions={{ color: '#4F46E5', weight: 4, opacity: playback ? 0.2 : 0.85 }}
        />
      )}
      {playback && playback.done.length > 1 && (
        <Polyline
          positions={playback.done}
          pathOptions={{ color: '#4F46E5', weight: 4, opacity: 0.9 }}
        />
      )}
      {!playback && latest && (
        <CircleMarker
          center={latest}
          radius={8}
          pathOptions={{
            color: '#ffffff',
            weight: 3,
            fillColor: live ? '#16A34A' : '#4F46E5',
            fillOpacity: 1,
          }}
        />
      )}
      {playback && (
        <CircleMarker
          center={playback.pos}
          radius={8}
          pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#D97706', fillOpacity: 1 }}
        />
      )}
      <FitOnLoad track={track} fitKey={fitKey} />
      <FollowLatest
        lat={last?.lat ?? null}
        lon={last?.lon ?? null}
        follow={live && !playback}
      />
    </MapContainer>
  )
}
