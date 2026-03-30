/**
 * Web bootstrap — replaces the Electron preload for browser clients.
 *
 * 1. Reads connection settings from localStorage (serverUrl, token, workspaceId)
 * 2. Creates WsRpcClient → connects to remote headless server
 * 3. Builds the full ElectronAPI proxy via buildClientApi + CHANNEL_MAP
 * 4. Registers web-compatible capability handlers (shims for shell, dialog, etc.)
 * 5. Overrides OAuth flows for browser redirect-based approach
 * 6. Exposes as window.electronAPI (React code works unchanged)
 */

import { WsRpcClient, type TransportConnectionState } from '../../electron/src/transport/client'
import { buildClientApi } from '../../electron/src/transport/build-api'
import { CHANNEL_MAP } from '../../electron/src/transport/channel-map'
import {
  CLIENT_OPEN_EXTERNAL,
  CLIENT_OPEN_PATH,
  CLIENT_SHOW_IN_FOLDER,
  CLIENT_CONFIRM_DIALOG,
  CLIENT_OPEN_FILE_DIALOG,
} from '@craft-agent/server-core/transport'
import type { ConfirmDialogSpec, FileDialogSpec } from '@craft-agent/server-core/transport'

// ---------------------------------------------------------------------------
// Connection settings (localStorage)
// ---------------------------------------------------------------------------

export interface WebConnectionSettings {
  serverUrl: string
  token: string
  workspaceId: string
}

const STORAGE_KEY = 'craft-agent-connection'

export function getConnectionSettings(): WebConnectionSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.serverUrl && parsed.token && parsed.workspaceId) {
      return parsed as WebConnectionSettings
    }
    return null
  } catch {
    return null
  }
}

export function saveConnectionSettings(settings: WebConnectionSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearConnectionSettings(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ---------------------------------------------------------------------------
// Web client capabilities (browser replacements for Electron APIs)
// ---------------------------------------------------------------------------

const WEB_CLIENT_CAPABILITIES = [
  CLIENT_OPEN_EXTERNAL,
  CLIENT_CONFIRM_DIALOG,
  // Note: CLIENT_OPEN_PATH, CLIENT_SHOW_IN_FOLDER, CLIENT_OPEN_FILE_DIALOG
  // are not supported in browser — server handles gracefully when missing
]

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let _client: WsRpcClient | null = null
let _settings: WebConnectionSettings | null = null

export function getClient(): WsRpcClient | null {
  return _client
}

export function isConnected(): boolean {
  return _client !== null && _settings !== null
}

/**
 * Initialize WebSocket connection and build the ElectronAPI proxy.
 * Call this before rendering React — sets window.electronAPI.
 *
 * If no connection settings exist, installs a stub API that the
 * connection settings UI can detect.
 */
export function initializeWebClient(): { connected: boolean } {
  _settings = getConnectionSettings()

  if (!_settings) {
    // No settings yet — install a minimal stub so the app can render
    // the connection settings page without crashing
    installStubApi()
    return { connected: false }
  }

  // Security: block unencrypted ws:// to non-localhost servers
  const parsed = new URL(_settings.serverUrl)
  const isLocalhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1'
  if (parsed.protocol === 'ws:' && !isLocalhost) {
    console.error(
      'Refusing to connect to remote server over unencrypted ws://. Use wss:// for non-localhost connections.',
    )
    installStubApi()
    return { connected: false }
  }

  // Create WS client and connect
  _client = new WsRpcClient(_settings.serverUrl, {
    token: _settings.token,
    workspaceId: _settings.workspaceId,
    webContentsId: 1, // Virtual web contents ID
    autoReconnect: true,
    mode: 'remote',
    clientCapabilities: [...WEB_CLIENT_CAPABILITIES],
  })

  // Register web capability handlers
  _client.handleCapability(CLIENT_OPEN_EXTERNAL, (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  })

  _client.handleCapability(CLIENT_CONFIRM_DIALOG, async (spec: ConfirmDialogSpec) => {
    // Map Electron dialog to browser confirm()
    const message = spec.detail ? `${spec.message}\n\n${spec.detail}` : spec.message
    const confirmed = window.confirm(message)
    // Return button index: 0 = first button (usually OK/Yes), 1 = second (Cancel/No)
    return { response: confirmed ? (spec.defaultId ?? 0) : (spec.cancelId ?? 1) }
  })

  _client.connect()

  // Build the full API proxy (identical to Electron preload)
  const api = buildClientApi(_client, CHANNEL_MAP, (ch) => _client!.isChannelAvailable(ch))

  // Transport state methods
  ;(api as any).getTransportConnectionState = async () => _client!.getConnectionState()
  ;(api as any).onTransportConnectionStateChanged = (
    callback: (state: TransportConnectionState) => void,
  ) => {
    return _client!.onConnectionStateChanged(callback)
  }
  ;(api as any).reconnectTransport = async () => {
    _client!.reconnectNow()
  }

  // ── Web OAuth shims ─────────────────────────────────────────────────────
  // In browser we can't start a local callback server.
  // Instead: open auth URL in new tab, then rely on redirect back to our app.
  ;(api as any).performOAuth = async (args: {
    sourceSlug: string
    sessionId?: string
    authRequestId?: string
  }): Promise<{ success: boolean; error?: string; email?: string }> => {
    try {
      // Use current page's origin for the callback
      const callbackUrl = `${window.location.origin}/oauth/callback`

      // Ask server to prepare OAuth flow
      const startResult = await _client!.invoke('oauth:start', {
        sourceSlug: args.sourceSlug,
        callbackPort: 0, // Signal that we're a web client
        sessionId: args.sessionId,
        authRequestId: args.authRequestId,
        webCallbackUrl: callbackUrl,
      })

      // Open auth URL in new window/tab
      window.open(startResult.authUrl, '_blank', 'noopener')

      // The OAuth callback will redirect back to our app with code + state
      // The app handles this via URL parameters on load (see main.tsx)
      return {
        success: true,
        error: 'OAuth flow started — complete authorization in the new tab',
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OAuth flow failed',
      }
    }
  }

  ;(api as any).startClaudeOAuth = async (): Promise<{
    success: boolean
    authUrl?: string
    error?: string
  }> => {
    try {
      const result = await _client!.invoke('onboarding:startClaudeOAuth')
      if (result.success && result.authUrl) {
        window.open(result.authUrl, '_blank', 'noopener')
      }
      return result
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Claude OAuth failed',
      }
    }
  }

  ;(api as any).startChatGptOAuth = async (
    connectionSlug: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const startResult = await _client!.invoke('chatgpt:startOAuth', connectionSlug)
      window.open(startResult.authUrl, '_blank', 'noopener')
      return { success: true, error: 'OAuth flow started — complete authorization in the new tab' }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'ChatGPT OAuth flow failed',
      }
    }
  }

  // ── Web-specific overrides ──────────────────────────────────────────────

  // Shell operations — web equivalents
  ;(api as any).openUrl = async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  ;(api as any).openFile = async (_path: string) => {
    // Can't open server-side files from browser — no-op
  }
  ;(api as any).showInFolder = async (_path: string) => {
    // Can't show server-side folders from browser — no-op
  }

  // File dialog — use browser file picker
  ;(api as any).openFileDialog = async (): Promise<string[]> => {
    return new Promise<string[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = () => {
        const files = Array.from(input.files ?? [])
        resolve(files.map((f) => f.name))
      }
      input.oncancel = () => resolve([])
      input.click()
    })
  }

  // Folder dialog — not supported in browser
  ;(api as any).openFolderDialog = async (): Promise<string | null> => {
    return null
  }

  // Window management — no-ops for browser
  ;(api as any).closeWindow = async () => {}
  ;(api as any).confirmCloseWindow = async () => {}
  ;(api as any).cancelCloseWindow = async () => {}
  ;(api as any).onCloseRequested = () => () => {}
  ;(api as any).setTrafficLightsVisible = async () => {}
  ;(api as any).openSessionInNewWindow = async () => {}
  ;(api as any).menuQuit = async () => {}
  ;(api as any).menuNewWindow = async () => {}
  ;(api as any).menuMinimize = async () => {}
  ;(api as any).menuMaximize = async () => {}
  ;(api as any).menuZoomIn = async () => {}
  ;(api as any).menuZoomOut = async () => {}
  ;(api as any).menuZoomReset = async () => {}
  ;(api as any).menuToggleDevTools = async () => {}
  ;(api as any).menuUndo = async () => {}
  ;(api as any).menuRedo = async () => {}
  ;(api as any).menuCut = async () => {}
  ;(api as any).menuCopy = async () => {}
  ;(api as any).menuPaste = async () => {}
  ;(api as any).menuSelectAll = async () => {}

  // Menu event listeners — no-ops
  ;(api as any).onMenuNewChat = () => () => {}
  ;(api as any).onMenuOpenSettings = () => () => {}
  ;(api as any).onMenuKeyboardShortcuts = () => () => {}
  ;(api as any).onMenuToggleFocusMode = () => () => {}
  ;(api as any).onMenuToggleSidebar = () => () => {}
  ;(api as any).onDeepLinkNavigate = () => () => {}

  // Auto-update — not applicable for web
  ;(api as any).checkForUpdates = async () => ({ available: false })
  ;(api as any).getUpdateInfo = async () => ({ available: false })
  ;(api as any).installUpdate = async () => {}
  ;(api as any).dismissUpdate = async () => {}
  ;(api as any).getDismissedUpdateVersion = async () => null
  ;(api as any).onUpdateAvailable = () => () => {}
  ;(api as any).onUpdateDownloadProgress = () => () => {}
  ;(api as any).getReleaseNotes = async () => ''
  ;(api as any).getLatestReleaseVersion = async () => undefined

  // System info — web versions
  ;(api as any).getVersions = () => ({
    node: 'web',
    chrome: navigator.userAgent,
    electron: 'web',
  })
  ;(api as any).isDebugMode = async () => false

  // Badge/dock — not applicable
  ;(api as any).refreshBadge = async () => {}
  ;(api as any).setDockIconWithBadge = async () => {}
  ;(api as any).onBadgeDraw = () => () => {}
  ;(api as any).onBadgeDrawWindows = () => () => {}
  ;(api as any).getWindowFocusState = async () => document.hasFocus()
  ;(api as any).onWindowFocusChange = (callback: (focused: boolean) => void) => {
    const onFocus = () => callback(true)
    const onBlur = () => callback(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }
  ;(api as any).onNotificationNavigate = () => () => {}

  // Notifications — use ServiceWorker showNotification for iOS PWA support.
  // Plain `new Notification()` does NOT work in iOS standalone PWAs;
  // `registration.showNotification()` is required for lock-screen / notification center.
  ;(api as any).showNotification = async (
    title: string,
    body: string,
    _workspaceId: string,
    _sessionId: string,
  ) => {
    if (Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready
        if (reg) {
          await reg.showNotification(title, { body, icon: '/icon-192.png' })
        } else {
          new Notification(title, { body })
        }
      } catch {
        new Notification(title, { body })
      }
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        try {
          const reg = await navigator.serviceWorker?.ready
          if (reg) {
            await reg.showNotification(title, { body, icon: '/icon-192.png' })
          } else {
            new Notification(title, { body })
          }
        } catch {
          new Notification(title, { body })
        }
      }
    }
  }

  // Theme — detect from browser
  ;(api as any).getSystemTheme = async () => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  ;(api as any).onSystemThemeChange = (callback: (isDark: boolean) => void) => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => callback(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }

  // Logout confirmation — browser confirm
  ;(api as any).showLogoutConfirmation = async () => {
    return window.confirm('Are you sure you want to log out?')
  }
  ;(api as any).showDeleteSessionConfirmation = async (name: string) => {
    return window.confirm(`Delete session "${name}"?`)
  }

  // Skills — editor/finder not available in browser
  ;(api as any).openSkillInEditor = async () => {}
  ;(api as any).openSkillInFinder = async () => {}

  // Git Bash — not applicable
  ;(api as any).checkGitBash = async () => ({ available: false })
  ;(api as any).browseForGitBash = async () => null
  ;(api as any).setGitBashPath = async () => ({ success: false, error: 'Not available in web client' })

  // Power settings — not applicable
  ;(api as any).getKeepAwakeWhileRunning = async () => false
  ;(api as any).setKeepAwakeWhileRunning = async () => {}

  // Window mode — always main window
  ;(api as any).getWindowMode = async () => 'main'

  // Return configured workspace ID directly (server can't map webContentsId for web clients)
  ;(api as any).getWindowWorkspace = async () => _settings!.workspaceId

  // Expose globally — React code uses window.electronAPI
  ;(window as any).electronAPI = api

  return { connected: true }
}

// ---------------------------------------------------------------------------
// Stub API — installed when no connection settings exist
// ---------------------------------------------------------------------------

function installStubApi(): void {
  const noop = () => {}
  const asyncNoop = async () => {}
  const noopListener = () => () => {}

  const stub: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'getTransportConnectionState') {
          return async () => ({
            mode: 'remote' as const,
            status: 'disconnected' as const,
            url: '',
            attempt: 0,
            updatedAt: Date.now(),
          })
        }
        if (prop === 'onTransportConnectionStateChanged') return noopListener
        if (prop === 'reconnectTransport') return asyncNoop
        if (prop === 'isChannelAvailable') return () => false
        if (prop === 'getVersions') {
          return () => ({ node: 'web', chrome: navigator.userAgent, electron: 'web' })
        }
        if (prop === 'getWindowMode') return async () => 'main'
        if (prop === 'getWindowWorkspace') return async () => null
        if (prop === 'getWorkspaces') return async () => []
        if (prop === 'getSessions') return async () => []
        if (prop === 'getAuthState') {
          return async () => ({
            hasApiKey: true, // Pretend auth is OK so we skip onboarding
            hasOAuth: false,
            setupNeeds: { needsApiKey: false, needsOAuth: false },
          })
        }
        if (prop === 'getSetupNeeds') {
          return async () => ({ needsApiKey: false, needsOAuth: false })
        }
        if (prop === 'getCredentialHealth') {
          return async () => ({ healthy: true, issues: [] })
        }
        // Return appropriate defaults based on convention
        if (typeof prop === 'string' && prop.startsWith('on')) return noopListener
        if (typeof prop === 'string' && prop.startsWith('get')) return asyncNoop
        return asyncNoop
      },
    },
  )

  ;(window as any).electronAPI = stub
}

/**
 * Reconnect with new settings. Used when the user changes connection
 * settings at runtime. Destroys the old client and creates a new one.
 */
export function reconnectWithSettings(settings: WebConnectionSettings): void {
  saveConnectionSettings(settings)

  // Destroy existing client
  if (_client) {
    try {
      ;(_client as any).destroy?.()
    } catch {
      // ignore
    }
    _client = null
  }

  // Re-initialize — will pick up new settings from localStorage
  initializeWebClient()
}
