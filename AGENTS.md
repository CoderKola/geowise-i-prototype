# geowise-i-prototype — agent instructions

Single source of truth for coding agents. Per-app rules live in each app's own
`AGENTS.md` (`apps/mobile`, `apps/server`, `apps/web`) — read the one for the app
you're touching.

## Stack and layout

Monorepo, three apps:

```
apps/
├── mobile/   React Native + Expo SDK 54 (records GPS, uploads, CSV export)
├── server/   Node + Express + SQLite (ingest :3000, local-only feed :3100)
└── web/      Vite + React + Tailwind + shadcn-style components (Leaflet dashboard)
```

**Platform strategy:** Android is the product target — real testing runs on EAS APK
builds. The iPhone is a dev device only (Expo Go, foreground-only fallback); no iOS
builds are planned.

## Run commands

- Mobile dev: `cd apps/mobile && npx expo start --tunnel` (Metro on :8081)
- Server: `cd apps/server && npm start` (needs `.env` with `UPLOAD_TOKEN`)
- Tunnel: `cloudflared tunnel --url http://localhost:3000`
- Web dashboard: `cd apps/web && npm run dev` (Vite on :5173)
- Android APK: `cd apps/mobile && npx eas-cli build --platform android --profile preview`

## Conventions

### Naming
- `camelCase` functions/variables; `PascalCase` components/types/interfaces;
  `SCREAMING_SNAKE_CASE` module constants.
- Files: `camelCase.ts` for modules, `PascalCase.tsx` for React components.
- No `I`-prefixed interfaces.

### Functions and logic
- Prefer small pure functions with early returns over nested conditionals.
- Named exports only — no default exports except where a framework requires it.
- One module = one responsibility.

### Async discipline
- `async/await` only, never `.then()` chains.
- No floating promises — `await` them, or explicitly `void` with a comment.
- Catch errors at call boundaries (UI handlers, task entry points); don't swallow
  them in helpers.
- Expo background tasks must be defined at module top level (import side-effect),
  never inside components.

### TypeScript
- Strict mode; no `any` — use `unknown` + narrowing.
- Explicit return types on exported functions.
- Exhaustive `switch` over unions/enums with a `never` check in the default case.

### Imports
- Always at the top of the module — no inline imports in function bodies.
- **One documented exception:** the lazy `require('react-native-vision-camera')`
  in `apps/mobile/src/camera/camera.ts` (and `DriveMode.tsx`) keeps Expo Go from
  crashing on a missing native module. Do not "fix" it into a top-level import.

### Python (future analysis tooling — Phase 4)
No Python exists yet; when it arrives:
- Python 3.12+, `pyproject.toml` + `uv`, `ruff` for lint/format.
- PEP 8 `snake_case`; type hints mandatory on public functions; `pathlib` over `os.path`.
- Analysis code lives under `tools/` or `apps/analysis` — never inside the Node server.

## Boundaries

- Do **not** bump Expo SDK 54 (the dev iPhone's Expo Go cap) or change pinned
  dependency versions.
- Do **not** edit `apps/mobile/patches/` or `apps/mobile/plugins/withRawPropsJsiValue.js`
  without an explicit request — both are load-bearing for the Android camera build.
- Never commit `.env`, `*.db`, or `apps/server/media/`.
- Stage explicit file paths only — never `git add -A` / `git add .`.

## Verification

- Type-check mobile: `cd apps/mobile && npx tsc --noEmit`
- Type-check web: `cd apps/web && npx tsc -b` (also `npm run lint` → oxlint)
- Server has no build step; smoke it: start server + tunnel + Metro (see README's
  4-terminal quick dev loop) and confirm points flow to the dashboard.
