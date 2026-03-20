# Better GCP - Agent Guide

## What is this?

A local-only Electron + React + TypeScript app for browsing GCP services with a clean, Finder-like UI. No telemetry. All data stays on your machine. Auth via `gcloud auth application-default login`.

## Architecture Overview

```
src/                  # React frontend (one file per tab)
  App.tsx             # Tab switcher (ServiceTab union type + TAB_ORDER array + tab palette)
  GcsTab.tsx          # Cloud Storage browser (sidebar + file listing)
  BigQueryTab.tsx     # BigQuery editor + results
  VertexAITab.tsx     # AI Jobs (Vertex AI custom jobs)
  PipelinesTab.tsx    # AI Pipelines (Vertex AI Pipelines with DAG visualization)
  CloudRunTab.tsx     # Cloud Run services (multi-project, details, logs)
  styles.css          # ALL styling lives here (CSS variables, no component lib)

electron/             # Electron main process
  main.ts             # IPC handlers (ipcMain.handle)
  preload.ts          # Context bridge (exposes window.gcs, window.bq, etc.)
  renderer.d.ts       # TypeScript declarations for window.* APIs
  types.ts            # Backend types (canonical source, shared/types.ts mirrors these)
  gcs.ts              # GCS operations (@google-cloud/storage)
  bigquery.ts         # BigQuery operations (@google-cloud/bigquery)
  vertexai.ts         # Vertex AI custom jobs (REST via google-auth-library)
  vertexai-pipelines.ts # Vertex AI Pipelines (REST via google-auth-library)
  cloudrun.ts         # Cloud Run services (REST via Knative serving API)
  gcloud-env.ts       # Loads gcloud auth environment

shared/types.ts       # Frontend-visible types (must stay in sync with electron/types.ts)
```

## Key Patterns

### Adding a New Tab
1. Add to `ServiceTab` union and `TAB_ORDER` in `App.tsx`
2. Create `src/NewTab.tsx` (default export, optional `isActive` prop)
3. Add button + panel in `App.tsx` render
4. Add styles to `src/styles.css` (use `var(--accent)`, `var(--ink)`, etc.)

### Adding a New Backend API
1. Create `electron/new-service.ts` with exported functions
2. Add types to `electron/types.ts` AND `shared/types.ts` (keep in sync!)
3. Add IPC handlers in `electron/main.ts` (`ipcMain.handle('namespace:method', ...)`)
4. Expose in `electron/preload.ts` (`contextBridge.exposeInMainWorld('namespace', {...})`)
5. Add TypeScript declarations in `electron/renderer.d.ts`

### IPC Response Convention
```typescript
// For data responses:
{ ok: true, data: T } | { ok: false, error: string }

// For action responses:
{ ok: boolean, error?: string }
```

### Styling
- All CSS in one file: `src/styles.css`
- CSS variables for theming: `--ink`, `--muted`, `--bg`, `--panel`, `--accent`, `--border`, etc.
- Dark mode via `:root[data-theme='dark']` selector overrides
- Font: IBM Plex Sans / IBM Plex Mono
- No component library - all custom CSS

### State Management
- All local state with React hooks (`useState`, `useEffect`, `useCallback`, `useMemo`)
- No global state library
- Persistence via `localStorage` with `better-gcp:` or `better-gcs:` key prefix

## Commands

```bash
npm run dev          # Start dev server (Vite + Electron)
npm run build        # Build for production (vite build + tsc)
npm run typecheck    # Type-check both frontend and electron
npm run package      # Build + package as macOS app (electron-builder)
npm start            # Run the built Electron app
```

## Before Pushing

1. Run `npm run typecheck` - must pass with zero errors
2. Run `npm run build` - must succeed
3. Verify the app works: `npm run dev` and smoke-test the changed tab

## Releasing

1. Bump `version` in `package.json`
2. Update `README.md` with any new features
3. Update `CHANGELOG.md` with the new version entry
4. Commit, then `npm run build && npm run package`
5. Create annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z - summary"`
6. Push: `git push origin main && git push origin vX.Y.Z`
7. Create GitHub release with packaged files:
   ```bash
   gh release create vX.Y.Z "dist/Better GCP-X.Y.Z-arm64-mac.zip" "dist/Better GCP-X.Y.Z-arm64.dmg" \
     --title "vX.Y.Z - Title" --notes "changelog here"
   ```

## Commit Convention

Use conventional commits:

```
feat(<component>): <change>        # New feature
fix(<component>): <change>         # Bug fix
refactor(<component>): <change>    # Code restructure
style(<component>): <change>       # CSS / visual only
docs: <change>                     # Documentation
chore: <change>                    # Build, deps, config
```

Components: `gcs`, `bigquery`, `vertex-ai`, `pipelines`, `cloud-run`, `ui`, `electron`

Examples:
```
feat(pipelines): add DAG visualization with pan/zoom
fix(gcs): dark mode contrast for bucket list
refactor(vertex-ai): extract shared status emoji mapping
style(ui): improve tab hover transitions
```

## GCP API Notes

- **GCS & BigQuery**: Use official `@google-cloud/*` client libraries (auto-authenticated)
- **Vertex AI**: Manual REST calls via `google-auth-library` `GoogleAuth.getClient()`
  - Endpoint pattern: `https://{region}-aiplatform.googleapis.com/v1/...`
  - Region extracted from resource name: `name.split('/')[3]`
- **Cloud Run**: Knative serving REST API via `google-auth-library`
  - Endpoint pattern: `https://{region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/{projectId}/services`
- Supported regions: `us-west1`, `us-central1`, `us-east1`, `asia-northeast1`

## Don'ts

- Don't add new dependencies without good reason (keep the app lightweight)
- Don't create separate CSS files per component - everything goes in `styles.css`
- Don't use `interface` for types - use `type` (project convention)
- Don't add runtime telemetry or analytics (local-only app)
- Don't commit `dist/`, `dist-app/`, or `dist-electron/` directories
