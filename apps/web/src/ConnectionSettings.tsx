/**
 * Connection settings page — shown when no server connection is configured.
 * Three fields: Server URL, Token, Workspace ID.
 */

import React, { useState } from 'react'
import {
  saveConnectionSettings,
  reconnectWithSettings,
  type WebConnectionSettings,
} from './web-bootstrap'

interface Props {
  onConnect: (settings: WebConnectionSettings) => void
}

export function ConnectionSettings({ onConnect }: Props) {
  const [serverUrl, setServerUrl] = useState('')
  const [token, setToken] = useState('')
  const [workspaceId, setWorkspaceId] = useState('default')
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const handleConnect = async () => {
    setError(null)

    // Validate URL
    let url = serverUrl.trim()
    if (!url) {
      setError('Server URL is required')
      return
    }

    // Auto-prepend wss:// if missing
    // Normalize protocol: convert http(s) to ws(s), auto-prepend wss if missing
    if (url.startsWith('https://')) {
      url = `wss://${url.slice(8)}`
    } else if (url.startsWith('http://')) {
      url = `ws://${url.slice(7)}`
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `wss://${url}`
    }

    try {
      new URL(url)
    } catch {
      setError('Invalid URL format')
      return
    }

    if (!token.trim()) {
      setError('Token is required')
      return
    }

    const settings: WebConnectionSettings = {
      serverUrl: url,
      token: token.trim(),
      workspaceId: workspaceId.trim() || 'default',
    }

    setConnecting(true)

    // Save and trigger reconnection
    reconnectWithSettings(settings)
    onConnect(settings)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div className="w-full max-w-md">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white">Craft Agent</h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Connect to your headless server
          </p>
        </div>

        {/* Form */}
        <div className="rounded-2xl p-6 space-y-4"
          style={{
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Server URL */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Server URL
            </label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="wss://craft.yourdomain.com/ws"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder:text-white/30 outline-none transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.25)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
              autoFocus
            />
          </div>

          {/* Token */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Bearer token from server"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder:text-white/30 outline-none transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.25)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          {/* Workspace ID */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Workspace ID
            </label>
            <input
              type="text"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="default"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder:text-white/30 outline-none transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.25)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs px-1" style={{ color: '#ef4444' }}>
              {error}
            </p>
          )}

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        {/* Help text */}
        <p className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Start the headless server with <code className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>bun run server:start</code>
          <br />to get the URL and token
        </p>
      </div>
    </div>
  )
}
