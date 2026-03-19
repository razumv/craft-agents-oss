# CLAUDE.md — Web Client (`apps/web/`)

## Purpose
PWA web client that reuses the Electron renderer UI for browser/mobile access.
Deployed at `craft.razumv.tech` via Caddy reverse proxy.

## Architecture

### Code Reuse
The web client has **zero duplicated UI code**. It reuses `apps/electron/src/renderer/` via Vite aliases:
```
@/ → apps/electron/src/renderer/
```
Web-specific files live only in `apps/web/src/`:
- `main.tsx` — entry point, WebSocket bootstrap, iOS keyboard fix
- `index.css` — Tailwind config + mobile overrides (imports `shared-styles.css`)
- `web-bootstrap.ts` — creates `window.electronAPI` shim over WebSocket
- `ConnectionSettings.tsx` — server URL input (shown when not connected)
- `index.html` — PWA meta tags, viewport-fit=cover

### Platform Detection
```ts
// apps/electron/src/renderer/lib/platform.ts
export const isWeb = !(window as any).electronAPI?.__isElectron
```
Use `isMobile && isWeb` for mobile-web-only behavior (not Electron tablet).

### Mobile Layout (PWA)
On mobile web, the layout differs from Electron:
- **TopBar**: `position: relative` (shrink-0 in flex-col), not `fixed`. Class `mobile-topbar-safe` handles safe-area-inset-top via CSS.
- **AppShell wrapper**: `mobile-web-shell` div (flex-col) wraps TopBar + layout. Added in AppShell.tsx return.
- **Layout div**: `mobile-web-layout` class. CSS overrides `height: 100%` → `height: auto` + `flex: 1` to fill remaining space below TopBar.
- **Safe areas**: All 4 edges handled — top (TopBar), bottom (FreeFormInput), left/right (landscape, via `mobile-web-shell` padding).
- **Scrollbars**: Hidden on mobile (`::-webkit-scrollbar { display: none }`), iOS uses native overlay.
- **bg-foreground-2**: Overridden to `var(--background)` on mobile to prevent seam artifacts.

### Key CSS Override Pattern
Mobile overrides are in `apps/web/src/index.css` under `@media (max-width: 767px)`.
They use `!important` to override Tailwind utility classes and inline styles set by JS.
This is intentional — the alternative would require modifying dozens of shared components.

## Commands
```bash
# Dev server
npx vite dev apps/web --port 5180

# Production build
npx vite build apps/web

# After build, symlink index.html (Vite root is src/)
ln -sf src/index.html apps/web/dist/index.html

# Type check (uses Electron's tsconfig with web aliases)
npx tsc --noEmit --project apps/web/tsconfig.json
```

## Deploy
Caddy serves from `apps/web/dist/` directly. After `vite build`:
1. Build outputs to `apps/web/dist/src/index.html` + `apps/web/dist/assets/`
2. Symlink: `ln -sf src/index.html apps/web/dist/index.html`
3. Caddy picks up new files automatically (no restart needed)
4. Non-asset paths have `Cache-Control: no-cache` headers
5. Bump `__CRAFT_BUILD__` in `main.tsx` to bust Cloudflare cache

## Hard Rules
- **Never break desktop Electron.** All mobile-web changes must be gated behind `isMobile && isWeb` or CSS `@media (max-width: 767px)`.
- **No component forks.** Modify the shared component with platform checks, don't copy it.
- **CSS overrides only for visual/layout.** Logic differences go in components via `isWeb`/`isMobile`.
- **Safe areas on all 4 edges.** Use `env(safe-area-inset-*)` — iPhone has Dynamic Island (top), home indicator (bottom), and landscape sensor housing (left/right).
- **16px minimum input font** on mobile — prevents iOS auto-zoom on focus.
- **TopBar is NOT fixed on mobile web** — it's a normal flow element. Don't add `position: fixed` back.

## Files Modified in Electron Renderer (for web support)
These files have `isWeb` / `isMobile` checks added:
- `AppShell.tsx` — `mobile-web-shell` wrapper div, `mobile-web-layout` class
- `TopBar.tsx` — `mobile-topbar-safe` class, relative positioning on mobile web
- `FreeFormInput.tsx` — mic button always visible (removed `!isProcessing` gate)
- `PanelStackContainer.tsx` — drawer header `min-h-[52px]` for safe area
- `platform.ts` — `isWeb` export
- `shared-styles.css` — extracted from `index.css` for cross-platform reuse
- `useIsMobile.ts` — responsive hook (768px breakpoint)
