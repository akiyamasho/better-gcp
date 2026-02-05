# Better GCS Explorer

![Version](https://img.shields.io/badge/version-v1.1.0-blue)
![Release](https://img.shields.io/badge/release-stable-brightgreen)
[![Download DMG](https://img.shields.io/badge/Download-DMG-blue?logo=apple)](https://github.com/akiyamasho/better-gcs-explorer/releases/download/untagged-af0952ba3080c6c6b81e/Better.GCS.Explorer-1.1.0-arm64.dmg)

Local-only Electron app for browsing Google Cloud Storage with a Finder-like UI.

![Screenshot](./doc/screenshot.png)

## Features
- Finder-like browsing with breadcrumbs and directory tree.
- Favorites and recents for fast bucket access.
- Quick Open (Cmd/Ctrl+Shift+O) for already-loaded items.
- Go to path (Cmd/Ctrl+Shift+P) modal for direct navigation.
- Context menu actions: copy paths and gsutil commands.
- Drag-and-drop upload and drag-out download.
- Batch selection bar with download/delete actions and select-all toggle.
- Per-row download button and file-only delete actions.
- Quick Open keyboard navigation (up/down + enter).
- Create-folder action in empty-space context menu.

## Prereqs
- Node.js (18+)
- gcloud CLI
- Application Default Credentials: `gcloud auth application-default login`

## Package and run (macOS)
```bash
make run
```

NOTE: `make dev` for hot-reloading dev runs has an issue and is currently commented-out.

## Build DMG (macOS)
```bash
make dmg
```

## Notes
- Quick Open only searches already-loaded folders and files.
- Drag a file from the list to the desktop to download via a temp file.
- Drop local files or folders into the list to upload to the current prefix.

## Changelog
See `CHANGELOG.md`.
