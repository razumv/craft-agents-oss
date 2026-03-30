/**
 * Browser pane RPC handlers — portable version.
 *
 * Works with any IBrowserPaneManager implementation (Electron or headless).
 * Registers the same RPC channels as the Electron-specific version in
 * apps/electron/src/main/handlers/browser.ts.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '../../transport/index'
import type { HandlerDeps } from '../handler-deps'
import type { BrowserScreenshotOptions } from '../browser-pane-manager-interface'

// These types mirror apps/electron/src/shared/types.ts — kept inline
// because the standalone server doesn't depend on the Electron app.
interface BrowserPaneCreateOptions {
  id?: string
  show?: boolean
  bindToSessionId?: string
}

interface BrowserEmptyStateLaunchPayload {
  route: string
  token?: string
}

export function registerBrowserHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { browserPaneManager, platform } = deps
  if (!browserPaneManager) return

  server.handle(RPC_CHANNELS.browserPane.CREATE, (_ctx, input?: string | BrowserPaneCreateOptions) => {
    if (typeof input === 'string') {
      return browserPaneManager.createInstance(input)
    }

    if (input?.bindToSessionId) {
      return browserPaneManager.createForSession(input.bindToSessionId, { show: input.show ?? false })
    }

    return browserPaneManager.createInstance(input?.id, { show: input?.show })
  })

  server.handle(RPC_CHANNELS.browserPane.DESTROY, (_ctx, id: string) => {
    browserPaneManager.destroyInstance(id)
  })

  server.handle(RPC_CHANNELS.browserPane.LIST, () => {
    return browserPaneManager.listInstances()
  })

  server.handle(RPC_CHANNELS.browserPane.NAVIGATE, async (_ctx, id: string, url: string) => {
    try {
      return await browserPaneManager.navigate(id, url)
    } catch (err) {
      platform.logger.error(`[browser-pane] navigate failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.GO_BACK, async (_ctx, id: string) => {
    try {
      return await browserPaneManager.goBack(id)
    } catch (err) {
      platform.logger.error(`[browser-pane] goBack failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.GO_FORWARD, async (_ctx, id: string) => {
    try {
      return await browserPaneManager.goForward(id)
    } catch (err) {
      platform.logger.error(`[browser-pane] goForward failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.RELOAD, (_ctx, id: string) => {
    browserPaneManager.reload(id)
  })

  server.handle(RPC_CHANNELS.browserPane.STOP, (_ctx, id: string) => {
    browserPaneManager.stop(id)
  })

  server.handle(RPC_CHANNELS.browserPane.FOCUS, (_ctx, id: string) => {
    browserPaneManager.focus(id)
  })

  server.handle(RPC_CHANNELS.browserPane.LAUNCH, async (_ctx, _payload: BrowserEmptyStateLaunchPayload) => {
    // Empty state launch is Electron-specific (opens a session with pre-filled prompt)
    return { launched: false, reason: 'headless' }
  })

  server.handle(RPC_CHANNELS.browserPane.SNAPSHOT, async (_ctx, id: string) => {
    try {
      return await browserPaneManager.getAccessibilitySnapshot(id)
    } catch (err) {
      platform.logger.error(`[browser-pane] snapshot failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.CLICK, async (_ctx, id: string, ref: string) => {
    try {
      return await browserPaneManager.clickElement(id, ref)
    } catch (err) {
      platform.logger.error(`[browser-pane] click failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.FILL, async (_ctx, id: string, ref: string, value: string) => {
    try {
      return await browserPaneManager.fillElement(id, ref, value)
    } catch (err) {
      platform.logger.error(`[browser-pane] fill failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.SELECT, async (_ctx, id: string, ref: string, value: string) => {
    try {
      return await browserPaneManager.selectOption(id, ref, value)
    } catch (err) {
      platform.logger.error(`[browser-pane] select failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.SCREENSHOT, async (_ctx, id: string, options?: BrowserScreenshotOptions) => {
    try {
      const result = await browserPaneManager.screenshot(id, options)
      return {
        base64: result.imageBuffer.toString('base64'),
        imageFormat: result.imageFormat,
        metadata: result.metadata,
      }
    } catch (err) {
      platform.logger.error(`[browser-pane] screenshot failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.EVALUATE, async (_ctx, id: string, expression: string) => {
    try {
      return await browserPaneManager.evaluate(id, expression)
    } catch (err) {
      platform.logger.error(`[browser-pane] evaluate failed for ${id}:`, err)
      throw err
    }
  })

  server.handle(RPC_CHANNELS.browserPane.SCROLL, async (_ctx, id: string, direction: string, amount?: number) => {
    const validDirections = ['up', 'down', 'left', 'right']
    if (!validDirections.includes(direction)) {
      throw new Error(`Invalid scroll direction: ${direction}`)
    }
    try {
      return await browserPaneManager.scroll(id, direction as 'up' | 'down' | 'left' | 'right', amount)
    } catch (err) {
      platform.logger.error(`[browser-pane] scroll failed for ${id}:`, err)
      throw err
    }
  })

  // Forward browser state changes to all clients
  browserPaneManager.onStateChange((info) => {
    pushTyped(server, RPC_CHANNELS.browserPane.STATE_CHANGED, { to: 'all' }, info)
  })

  browserPaneManager.onRemoved((id) => {
    pushTyped(server, RPC_CHANNELS.browserPane.REMOVED, { to: 'all' }, id)
  })

  browserPaneManager.onInteracted((id) => {
    pushTyped(server, RPC_CHANNELS.browserPane.INTERACTED, { to: 'all' }, id)
  })
}
