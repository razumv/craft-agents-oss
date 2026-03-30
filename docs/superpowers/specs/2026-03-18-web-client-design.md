# Web Client for Craft Agent

**Date:** 2026-03-18
**Status:** Approved

## Goal

Build a web-based client that allows accessing the full Craft Agent interface from a mobile browser, connecting to the existing headless server.

## Architecture

The existing Electron thin-client architecture already separates UI from server logic via WebSocket RPC. The web client reuses the same React UI, replacing Electron-specific APIs with browser equivalents.

```
Browser (phone) → nginx (HTTPS + WSS) → Headless Server (port 9100)
                                       → Static SPA (apps/web/dist/)
```

## Key Design Decisions

1. **No additional auth layer** — Server URL, Bearer token, and workspace ID are entered manually in Settings and stored in localStorage. The existing WebSocket handshake validates the Bearer token.

2. **Shared codebase** — Same React components, same `buildClientApi` + `CHANNEL_MAP`, same `WsRpcClient`. Only the bootstrap layer differs.

3. **Electron API shims** — Minimal replacements:
   - `shell.openExternal` → `window.open(url, '_blank')`
   - `shell.openPath` → display path as text
   - `shell.showItemInFolder` → no-op
   - `dialog.showMessageBox` → `window.confirm()` or custom modal
   - `dialog.showOpenDialog` → `<input type="file">`
   - Menu events → keyboard shortcuts
   - Window management, auto-update, badge, dock → N/A

4. **OAuth for sources** — In Electron, OAuth uses a local callback server. In web, the headless server receives the redirect directly via a new HTTP endpoint (`/oauth/web-callback`), stores the code, and redirects back to the SPA.

5. **Mobile adaptation** — Responsive CSS for the existing UI, not a separate mobile design.

## New Components

| Component | Location | ~Lines |
|-----------|----------|--------|
| Vite config (web) | `apps/web/vite.config.ts` | 50 |
| Web bootstrap | `apps/web/src/web-bootstrap.ts` | 200 |
| Web entry HTML | `apps/web/index.html` | 20 |
| Electron API shims | `apps/web/src/shims/electron-api.ts` | 150 |
| Connection settings UI | `apps/web/src/components/ConnectionSettings.tsx` | 100 |
| OAuth web callback endpoint | `packages/server-core/src/handlers/http/oauth-callback.ts` | 80 |
| nginx config | `deploy/nginx/craft-agent.conf` | 40 |
| Mobile responsive CSS | `apps/web/src/styles/mobile.css` | 200 |

**Total new code:** ~840 lines

## What Is NOT Needed

- No separate auth system (no login page, no JWT, no Google OAuth)
- No new backend APIs (existing RPC channels cover everything)
- No separate UI components (reuse from `@craft-agent/ui`)
- No database (localStorage for connection settings)
