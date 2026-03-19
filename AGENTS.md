# Better GCP - Agent Onboarding

> This file is for all coding agents (Claude Code, Codex, Cursor, etc.). Read this first before touching anything.

## Project Overview

A local-only Electron desktop app for browsing Google Cloud Platform services with a clean, Finder-like UI. No telemetry, no cloud backend. Auth via `gcloud auth application-default login`.

## Tech Stack

- **Runtime**: Electron 30, Node.js 18+
- **Frontend**: React 18, TypeScript, Vite
- **Backend (main process)**: TypeScript, `@google-cloud/storage`, `@google-cloud/bigquery`, `google-auth-library` (Vertex AI REST)
- **Package manager**: pnpm (or npm)
- **Build**: Vite (renderer) + tsc (electron), electron-builder (packaging)
- **Platform**: macOS (primary target, arm64)

## File Structure

```
src/                      # Renderer process (React UI)
  App.tsx                 # Tab switcher (ServiceTab union + TAB_ORDER array)
  GcsTab.tsx              # Cloud Storage browser
  BigQueryTab.tsx         # BigQuery editor + results
  VertexAITab.tsx         # Vertex AI custom jobs
  PipelinesTab.tsx        # Vertex AI Pipelines with DAG visualization
  main.tsx                # React entry point
  styles.css              # ALL styling (one file, CSS variables, no component lib)

electron/                 # Main process (Electron backend)
  main.ts                 # App entry, window creation, IPC handlers
  preload.ts              # Context bridge (window.gcs, window.bq, window.pipelines, etc.)
  renderer.d.ts           # TypeScript declarations for window.* APIs
  types.ts                # Canonical type definitions
  gcs.ts                  # GCS operations (@google-cloud/storage)
  bigquery.ts             # BigQuery operations (@google-cloud/bigquery)
  vertexai.ts             # Vertex AI custom jobs (REST)
  vertexai-pipelines.ts   # Vertex AI Pipelines (REST)
  gcloud-env.ts           # Loads gcloud auth environment

shared/types.ts           # Frontend-visible types (MUST stay in sync with electron/types.ts)

scripts/
  dev.mjs                 # Dev server launcher
  package.mjs             # Packaging script
```

**Dependency flow**: `src/` and `electron/` may import from `shared/`, but `shared/` must not import from `src/` or `electron/`.

## Commands

```bash
npm run dev          # Dev mode with hot-reload (Vite + Electron)
npm run build        # Build for production (vite build + tsc)
npm run typecheck    # Type-check both frontend and electron
npm run package      # Build + package as macOS app (electron-builder)
npm start            # Run the built Electron app

make dev             # Shortcut for dev mode
make run             # Build + package + launch
make dmg             # Build + package as DMG
```

## Path Alias

`@shared/*` resolves to `shared/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## IPC Pattern

Renderer <-> Main communication uses Electron IPC:

1. Backend functions in `electron/<service>.ts`
2. Handlers in `electron/main.ts` via `ipcMain.handle('<namespace>:<action>', ...)`
3. Exposed in `electron/preload.ts` via `contextBridge.exposeInMainWorld('<namespace>', {...})`
4. TypeScript declarations in `electron/renderer.d.ts`
5. Called from React as `window.<namespace>.<action>(...)`

**IPC response convention:**
```typescript
// Data responses:
{ ok: true, data: T } | { ok: false, error: string }
// Action responses:
{ ok: boolean, error?: string }
```

**Current namespaces:** `gcs`, `bq`, `vertexai`, `pipelines`, `shell`

### Adding a New Tab / Service

1. Create `electron/<service>.ts` with exported functions
2. Add types to **both** `electron/types.ts` and `shared/types.ts` (keep in sync!)
3. Register IPC handlers in `electron/main.ts`
4. Expose via `contextBridge` in `electron/preload.ts`
5. Declare on `Window` in `electron/renderer.d.ts`
6. Create `src/<Service>Tab.tsx` (default export, optional `isActive` prop)
7. Add to `ServiceTab` union + `TAB_ORDER` + render in `src/App.tsx`
8. Add styles to `src/styles.css`

## Coding Rules

### Style
- Prefer `type` over `interface` (project convention)
- All CSS in `src/styles.css` — never create separate CSS files
- CSS variables for theming: `--ink`, `--muted`, `--bg`, `--panel`, `--accent`, `--border`
- Dark mode via `:root[data-theme='dark']` overrides
- No component library — all custom CSS
- State management: React hooks only (useState, useEffect, useCallback, useMemo) — no global store
- Persistence: `localStorage` with `better-gcp:` or `better-gcs:` key prefix

### Naming
- Functions as verbs: `listBuckets`, `formatBytes`, `openPipelineDetail`
- Types as nouns: `GcsBucket`, `PipelineJob`, `ListCustomJobsRequest`
- Booleans as predicates: `isPrefix`, `isDev`, `loading`
- Avoid abbreviations except universally understood ones (`req`, `res`, `err`)

### Code Quality
- Small, single-purpose functions
- No dead code — delete unused imports, variables, functions
- No comments that restate what code does — comments for *why* only
- No `any` — use `unknown` with type guards (exception: raw API response conversion in electron/ backend files)
- Error handling only at system boundaries (IPC handlers, user input)

## GCP API Notes

- **GCS & BigQuery**: Official `@google-cloud/*` client libraries (auto-authenticated)
- **Vertex AI (Jobs + Pipelines)**: Manual REST calls via `google-auth-library` `GoogleAuth.getClient()`
  - Endpoint pattern: `https://{region}-aiplatform.googleapis.com/v1/...`
  - Region extracted from resource name: `name.split('/')[3]`
- Supported regions: `us-west1`, `us-central1`, `us-east1`, `asia-northeast1`

## Before Pushing

1. `npm run typecheck` — must pass with zero errors
2. `npm run build` — must succeed
3. Smoke-test the changed tab with `npm run dev`
4. Update `README.md` if you added/changed user-facing features
5. Update `CHANGELOG.md` with a new entry under the appropriate version

## Releasing

1. Bump `version` in `package.json`
2. Update `README.md` (version badge, download link, feature list)
3. Add entry to `CHANGELOG.md`
4. Commit all changes
5. `npm run build && npm run package`
6. Create annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z - summary"`
7. Push: `git push origin main && git push origin vX.Y.Z`
8. Create GitHub release with packaged files:
   ```bash
   gh release create vX.Y.Z \
     "dist/Better GCP-X.Y.Z-arm64-mac.zip" \
     "dist/Better GCP-X.Y.Z-arm64.dmg" \
     --title "vX.Y.Z - Title" --notes "changelog"
   ```

## Git Conventions

Use **Conventional Commits**:

```
<type>(<scope>): <description>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructure (no behavior change)
- `style`: CSS / visual only
- `docs`: Documentation
- `chore`: Build, deps, config
- `perf`: Performance improvement

### Scopes
`gcs`, `bigquery`, `vertex-ai`, `pipelines`, `ui`, `electron`

### Rules
- Lowercase description, no period at end
- Subject line under 72 characters
- Body explains *what* and *why*, not *how*

### Examples
```
feat(pipelines): add DAG visualization with pan/zoom
fix(gcs): dark mode contrast for bucket list
refactor(vertex-ai): extract shared status emoji mapping
chore: bump version to 3.4.0
docs: update README with pipelines feature
```

## Don'ts

- Don't add dependencies without good reason (keep it lightweight)
- Don't add runtime telemetry or analytics (local-only app)
- Don't commit `dist/`, `dist-app/`, or `dist-electron/`
- Don't create separate CSS files — everything in `styles.css`
- Don't push without updating README and CHANGELOG for user-facing changes
