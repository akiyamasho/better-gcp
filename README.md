# Better GCP

![Version](https://img.shields.io/badge/version-v3.2.1-blue)
![Release](https://img.shields.io/badge/release-stable-brightgreen)

Local-only Electron app for browsing Google Cloud Platform services with a Finder-like UI. All data stays on your machine. No telemetry, no cloud backend.

## Download

**[Download the latest DMG (Apple Silicon)](https://github.com/akiyamasho/better-gcp/releases/latest/download/Better.GCP-3.2.1-arm64.dmg)**

> **Note:** This app is not code-signed with an Apple Developer ID. macOS may show "damaged and can't be opened" after downloading. To fix, run in Terminal:
> ```bash
> xattr -d com.apple.quarantine "/Applications/Better GCP.app"
> ```

## Features

### Cloud Storage

- Finder-like browsing with breadcrumbs and directory tree
- Favorites and recents for fast bucket access
- Quick Open (`Cmd/Ctrl+Shift+O`) for already-loaded items
- Go to path (`Cmd/Ctrl+Shift+P`) for direct navigation
- Context menu actions: copy paths and gsutil commands
- Drag-and-drop upload and drag-out download
- Batch selection with download, delete, and select-all
- Create folders from the empty-space context menu

### Vertex AI Jobs

- Monitor Vertex AI Custom Jobs across multiple regions (us-west1, us-central1, us-east1, asia-northeast1)
- Jobs sorted by creation date (newest first) with region and state chip filters
- Color-coded status with emoji indicators (Running, Succeeded, Failed, Queued, etc.)
- Bulk cancel active jobs or delete completed jobs
- Click a job name to view full details: timestamps, worker pool specs, machine/accelerator config, container image, and environment variables
- Direct links to GCP Console and Cloud Logs for each job
- Pagination with per-region "Load more" buttons

### BigQuery

- Sidebar tree for projects, datasets, and tables with lazy loading
- Favorite projects and favorite tables pinned to the top
- Add projects manually with access validation
- Quick Jump (`Cmd/Ctrl+Shift+P`) with regex search across loaded tables and datasets
- Middle-truncated names in the sidebar with full name on hover
- Table preview on click (LIMIT 5 rows)
- Query editor with `Cmd/Ctrl+Enter` to run, showing row count, duration, and bytes processed
- Tab-based query management with independent results per tab
- Save and load queries across sessions
- Drag tables from the sidebar into the editor to insert the fully-qualified table ID
- Right-click context menu on tables: copy dataset ID, copy backtick-quoted ID, or insert into editor
- Excel-like results grid with cell/range selection, keyboard navigation, and `Cmd/Ctrl+C` to copy as TSV
- Smart cell rendering: image URLs show inline thumbnails, regular URLs open in your browser

## Screenshots

### Cloud Storage

![Cloud Storage Tab](./doc/01_gcs.png)

### BigQuery

![BigQuery Tab](./doc/02_bigquery.png)

### Vertex AI Jobs

![Vertex AI Jobs Tab](./doc/03_vertex-ai_custom-jobs.png)

---

## Getting Started

### Prerequisites

- Node.js (18+)
- `gcloud` (`brew install google-cloud-sdk`)
- `pnpm` (`brew install pnpm`)
- Application Default Credentials: `gcloud auth application-default login`

### Development (hot-reload)

```bash
make dev
```

Runs Vite dev server + TypeScript watcher + Electron with hot-reload. Works on Apple Silicon Macs.

### Package and run (macOS)

```bash
make run
```

### Build DMG (macOS)

```bash
make dmg
```

## Notes

- Quick Open / Quick Jump only search already-loaded items. Expand projects and datasets in the sidebar to load them.
- Drag a file from the GCS list to the desktop to download via a temp file.
- Drop local files or folders into the GCS list to upload to the current prefix.
- BigQuery queries run using your Application Default Credentials project unless a specific project is set on the query tab.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md)
