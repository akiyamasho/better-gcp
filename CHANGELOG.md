# Changelog

All notable changes to this project will be documented in this file.

## [3.0.1] - 2026-03-07

### Changed
- Updated screenshot assets for all service tabs.

### Screenshots
![Cloud Storage Tab](./doc/01_gcs.png)
![BigQuery Tab](./doc/02_bigquery.png)
![Vertex AI Jobs Tab](./doc/03_vertex-ai_custom-jobs.png)

## [3.0.0] - 2026-03-07

### Added
- **Vertex AI Jobs tab** for monitoring Custom Jobs across supported regions.
- Region and job-state filters with newest-first sorting.
- Bulk actions to cancel active jobs and delete completed jobs.
- Job detail pane with worker pool specs, machine/accelerator config, container image, and environment variables.
- Quick links to GCP Console and Cloud Logs per job.
- Pagination with per-region "Load more" controls.

## [2.0.1] - 2026-02-25

### Fixed
- Detect active `gcloud` project ID in packaged macOS app.

## [2.0.0] - 2026-02-25

### Added
- **BigQuery tab** with sidebar tree for browsing projects, datasets, and tables.
- Query editor with tab management, `Cmd/Ctrl+Enter` to run, save/load queries.
- Table preview (LIMIT 5) on click.
- Quick Jump (`Cmd/Ctrl+Shift+P`) with regex search across loaded tables and datasets.
- Favorite projects and favorite tables, pinned to the top of the sidebar.
- Manually add projects with access validation (shows error if inaccessible).
- Drag-and-drop tables from sidebar into query editor to insert fully-qualified table ID.
- Right-click context menu on tables: copy dataset ID, copy backtick-quoted ID, insert into editor.
- Excel-like results grid with cell selection (click, shift-click, drag), keyboard navigation (arrow keys, Tab), copy (`Cmd/Ctrl+C` as TSV), and select all (`Cmd/Ctrl+A`).
- Smart cell rendering: image URLs display as inline thumbnails, regular URLs as clickable links opening in system browser.
- Service tab switcher at the top to switch between Cloud Storage and BigQuery.

### Changed
- Renamed project from "Better GCS Explorer" to "Better GCP".
- Sidebar is now independently scrollable with long dataset/table names middle-truncated (start...end) and full name on hover.

### Fixed
- `make dev` now works on Apple Silicon Macs (fixed `ELECTRON_RUN_AS_NODE` env var leak and IPv4/IPv6 localhost mismatch).

## [1.1.0] - 2026-02-05
### Added
- Batch selection bar with download/delete actions and select-all toggle.
- Per-row download button and file-only delete actions.
- Quick Open keyboard navigation (up/down + enter).
- Create-folder action in empty-space context menu.

## [1.0.0] - 2026-02-05
### Added
- Finder-like GCS browsing with breadcrumbs and directory tree.
- Favorites, recents, quick open, and go-to-path modal.
- Context menu actions for path/gsutil commands.
- Drag-and-drop upload and drag-out download.
- Local packaging and GitHub Actions release workflow.
