# apps/web — agent instructions

Root `AGENTS.md` applies; this file adds web-only rules.

## Stack

- Vite + React + TypeScript, Tailwind CSS v4, shadcn-style components
  (`src/components/ui/` — `class-variance-authority` + `tailwind-merge` via `cn()`).
  Extend the existing ui primitives instead of adding a component library.
- Map is **Leaflet** via `react-leaflet`. Keep map logic in the map components
  (`TrackMap` and friends); use imperative Leaflet APIs only through refs/hooks,
  not by querying the DOM.

## Data source

- The dashboard reads **only from the local feed** (`127.0.0.1:3100` via
  `src/lib/api.ts`). Never call the ingest server (:3000), the tunnel, or any
  external API for track data — the feed being local-only is a security invariant.

## Verification

- `npx tsc -b` for types, `npm run lint` (oxlint), `npm run dev` for a visual check.
