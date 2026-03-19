/**
 * Web client entry point.
 *
 * 1. Runs web-bootstrap to set up window.electronAPI
 * 2. If connected → renders the full App (same as Electron renderer)
 * 3. If not connected → renders the ConnectionSettings page
 * 4. If connection fails → shows error with option to reconfigure
 */

import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
import {
  initializeWebClient,
  getConnectionSettings,
  getClient,
  clearConnectionSettings,
  type WebConnectionSettings,
} from './web-bootstrap'
import { ThemeProvider } from '@/context/ThemeContext'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { ConnectionSettings } from './ConnectionSettings'
import './index.css'

// Initialize the web client before React renders
const { connected: initiallyConnected } = initializeWebClient()

// Expose build version for debugging and cache verification
;(window as any).__CRAFT_BUILD__ = '20260319-v8'

// iOS PWA keyboard dismiss fix: when the virtual keyboard closes,
// the page may remain scrolled, leaving an empty gap at the bottom.
// Snap back to top whenever the viewport height increases (keyboard closing).
if (window.visualViewport) {
  let prevHeight = window.visualViewport.height
  window.visualViewport.addEventListener('resize', () => {
    const currentHeight = window.visualViewport!.height
    if (currentHeight > prevHeight) {
      // Keyboard closing — snap page back
      window.scrollTo(0, 0)
    }
    prevHeight = currentHeight
  })
}

/**
 * Crash fallback UI
 */
function CrashFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">Something went wrong</p>
      <p className="text-[13px]">Please reload the page.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
      >
        Reload
      </button>
    </div>
  )
}

/**
 * Connection status overlay — shown while connecting or when connection fails
 */
function ConnectionStatusOverlay({ onDisconnect }: { onDisconnect: () => void }) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'failed'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const settings = getConnectionSettings()

  useEffect(() => {
    const client = getClient()
    if (!client) {
      setStatus('failed')
      setError('No client initialized')
      return
    }

    const unsub = client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') {
        setStatus('connected')
        setError(null)
      } else if (state.status === 'failed') {
        setStatus('failed')
        setError(state.lastError?.message ?? state.lastClose?.reason ?? 'Connection failed')
      } else if (state.status === 'reconnecting') {
        setStatus('connecting')
        setAttempt(state.attempt)
        if (state.lastError) {
          setError(state.lastError.message)
        }
      }
    })

    // Check current state (synchronous method)
    const currentState = client.getConnectionState()
    if (currentState.status === 'connected') setStatus('connected')
    else if (currentState.status === 'failed') {
      setStatus('failed')
      setError(currentState.lastError?.message ?? 'Connection failed')
    }

    return unsub
  }, [])

  // If connected, don't show overlay
  if (status === 'connected') return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div className="text-center space-y-4 max-w-md px-6">
        {status === 'connecting' && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full mx-auto" />
            <p className="text-white/80 text-sm">
              Connecting to {settings?.serverUrl}...
              {attempt > 1 && <span className="text-white/40 block mt-1">Attempt {attempt}</span>}
            </p>
            {error && <p className="text-red-400/80 text-xs">{error}</p>}
            <button
              onClick={onDisconnect}
              className="mt-4 px-4 py-2 rounded-lg text-sm text-white/60 cursor-pointer transition-colors"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              Change Settings
            </button>
          </>
        )}
        {status === 'failed' && (
          <>
            <div className="w-12 h-12 mx-auto rounded-full flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <p className="text-white/90 text-sm font-medium">Connection Failed</p>
            <p className="text-white/50 text-xs">{settings?.serverUrl}</p>
            {error && <p className="text-red-400/70 text-xs">{error}</p>}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg text-sm text-white/80 cursor-pointer transition-colors"
                style={{ background: 'rgba(255,255,255,0.1)' }}
              >
                Retry
              </button>
              <button
                onClick={onDisconnect}
                className="px-4 py-2 rounded-lg text-sm text-white cursor-pointer transition-colors"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                Change Settings
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Root component — renders App when connected, ConnectionSettings when not
 */
function Root() {
  const [isConnected, setIsConnected] = useState(initiallyConnected)
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)

  const handleConnect = useCallback((_settings: WebConnectionSettings) => {
    window.location.reload()
  }, [])

  const handleDisconnect = useCallback(() => {
    clearConnectionSettings()
    window.location.reload()
  }, [])

  if (!isConnected) {
    return <ConnectionSettings onConnect={handleConnect} />
  }

  // Lazy-load App to avoid importing Electron-specific code before bootstrap
  const App = React.lazy(() => import('@/App'))

  return (
    <>
      <ConnectionStatusOverlay onDisconnect={handleDisconnect} />
      <ThemeProvider activeWorkspaceId={workspaceId}>
        <React.Suspense
          fallback={
            <div className="flex items-center justify-center h-screen" style={{ background: '#0f0f23' }}>
              <div className="animate-spin w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full" />
            </div>
          }
        >
          <App />
        </React.Suspense>
        <Toaster />
      </ThemeProvider>
    </>
  )
}

/**
 * Error boundary for the entire app
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App crash:', error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<CrashFallback />}>
      <JotaiProvider>
        <Root />
      </JotaiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
/* build 1773935574 */
