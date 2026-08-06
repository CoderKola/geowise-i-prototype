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

export function TrackMap({ points, live }: { points: Point[]; live: boolean }) {
  const track: LatLngExpression[] = useMemo(
    () =>
      points
        .filter((p) => p.lat != null && p.lon != null)
        .map((p) => [p.lat as number, p.lon as number]),
    [points],
  )

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
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {track.length > 1 && (
        <Polyline positions={track} pathOptions={{ color: '#4F46E5', weight: 4, opacity: 0.85 }} />
      )}
      {latest && (
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
      <FitOnLoad track={track} fitKey={fitKey} />
      <FollowLatest lat={last?.lat ?? null} lon={last?.lon ?? null} follow={live} />
    </MapContainer>
  )
}
