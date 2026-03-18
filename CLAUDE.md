# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is mangetout

A DaisyDisk-inspired disk usage analyzer: Rust backend with parallel filesystem scanning, serving an embedded single-page web UI with sunburst chart visualization.

## Build & Run Commands

```bash
cargo build                      # Debug build
cargo build --release            # Release build (LTO, opt-level 3, stripped)
cargo run -- /path/to/scan       # Build and run
cargo run -- --port 9000 --no-open /tmp  # Custom port, skip browser auto-open

cargo fmt                        # Format Rust code
cargo clippy                     # Lint
cargo test                       # Run tests (none currently exist)
cargo deb                        # Build .deb package
```

## Architecture

**Single binary** — static frontend files are embedded via `rust-embed`, no external assets needed at runtime.

### Backend (Rust/Axum)

- **`src/main.rs`** — CLI parsing (clap), shared state setup (`Arc<RwLock<DirTree>>`), Axum router, auto-opens browser
- **`src/scanner.rs`** — Parallel filesystem walker using `jwalk`. Batches entries (1000) into the tree, propagates sizes every 500ms. Detects cross-device mounts to avoid recursing into other filesystems.
- **`src/tree.rs`** — In-memory directory tree (`DirTree`/`DirNode`/`FileEntry`). Incrementally built during scan, supports path resolution, bottom-up size propagation, and mtime tracking.
- **`src/api.rs`** — REST API handlers: scan control, tree navigation, search (name-based, size-ranked), smart cleanup detection (caches, node_modules, build dirs, logs), file type aggregation, safe delete (path traversal prevention), disk info (statvfs), SSE progress stream.
- **`src/embedded.rs`** — Static file serving with SPA fallback (non-API routes serve index.html).

### Frontend (Vanilla JS)

All in `static/` — no build step, no framework.

- **`static/app.js`** — IIFE SPA: two-column browser, interactive canvas sunburst chart, SSE progress listener, keyboard shortcuts (Ctrl+K search, S smart cleanup, F file types, R rescan, T theme, ? help).
- **`static/style.css`** — CSS custom properties for light/dark theming.
- **`static/index.html`** — Shell template.

### API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/scan` | Start scan |
| GET | `/api/status` | Scan progress |
| GET | `/api/tree` | Directory children |
| GET | `/api/events` | SSE progress stream |
| GET | `/api/search` | Search files/folders |
| GET | `/api/smart` | Smart cleanup suggestions |
| GET | `/api/types` | File type stats |
| POST | `/api/delete` | Delete file/folder |
| GET | `/api/diskinfo` | Disk usage (statvfs) |
| GET | `/api/open` | Open in file manager |
| GET | `/api/errors` | Scan errors |

### Key Design Decisions

- **Shared state**: `DirTree` wrapped in `Arc<RwLock<>>`, passed to all API handlers via Axum state extraction.
- **Scanner runs as a spawned blocking task** (`tokio::task::spawn_blocking`) since jwalk is synchronous.
- **No database** — everything is in-memory for the duration of the scan session.
- **Release process**: Push a `v*` tag to trigger GitHub Actions CI that builds Linux, Windows, and .deb artifacts.
