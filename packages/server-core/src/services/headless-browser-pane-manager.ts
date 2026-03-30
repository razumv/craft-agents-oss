/**
 * HeadlessBrowserPaneManager
 *
 * Implements IBrowserPaneManager using Playwright instead of Electron APIs.
 * Used by the standalone headless server to provide browser pane functionality
 * that the desktop Electron app handles via BrowserWindow/BrowserView.
 */

import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright'
import type {
  IBrowserPaneManager,
  BrowserScreenshotOptions,
  BrowserScreenshotResult,
  BrowserScreenshotRegionTarget,
  BrowserConsoleOptions,
  BrowserConsoleEntry,
  BrowserNetworkOptions,
  BrowserNetworkEntry,
  BrowserWaitArgs,
  BrowserWaitResult,
  BrowserKeyArgs,
  BrowserDownloadOptions,
  BrowserDownloadEntry,
  AccessibilitySnapshot,
  AccessibilityNode,
  BrowserInstanceSnapshot,
} from '../handlers/browser-pane-manager-interface'
import type { BrowserInstanceInfo } from '@craft-agent/shared/protocol'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONSOLE_LOG_ENTRIES = 500
const MAX_NETWORK_LOG_ENTRIES = 500
const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const DEFAULT_WAIT_POLL_MS = 100
const MAX_AX_SNAPSHOT_NODES = 500

// Interactive roles for accessibility filtering
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'treeitem', 'row', 'cell', 'columnheader',
  'rowheader', 'gridcell',
])

const CONTENT_ROLES = new Set([
  'heading', 'img', 'table', 'list', 'listitem',
  'paragraph', 'blockquote', 'article', 'main',
  'navigation', 'complementary', 'contentinfo', 'banner',
  'form', 'region', 'alert', 'dialog', 'alertdialog',
  'status', 'progressbar', 'meter', 'timer',
])

const EXCLUDED_ROLES = new Set(['none', 'generic', 'rootwebarea', 'webarea', 'InlineTextBox', 'StaticText'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeadlessInstance {
  id: string
  page: Page
  cdp: CDPSession | null
  currentUrl: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  isVisible: boolean
  agentControlActive: boolean
  consoleLogs: BrowserConsoleEntry[]
  networkLogs: BrowserNetworkEntry[]
  navigationHistory: string[]
  historyIndex: number
  refCounter: number
}

type StateChangeCallback = (info: BrowserInstanceInfo) => void
type RemovedCallback = (id: string) => void
type InteractedCallback = (id: string) => void

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

let instanceCounter = 0

export class HeadlessBrowserPaneManager implements IBrowserPaneManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private instances = new Map<string, HeadlessInstance>()
  private stateChangeCallbacks: StateChangeCallback[] = []
  private removedCallbacks: RemovedCallback[] = []
  private interactedCallbacks: InteractedCallback[] = []
  private sessionPathResolver: ((sessionId: string) => string | null) | null = null
  private launching = false

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async ensureBrowser(): Promise<BrowserContext> {
    if (this.context) return this.context
    if (this.launching) {
      // Wait for the other caller to finish launching
      while (this.launching) {
        await new Promise(r => setTimeout(r, 50))
      }
      if (this.context) return this.context
    }
    this.launching = true
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      })
      return this.context
    } finally {
      this.launching = false
    }
  }

  async destroyAll(): Promise<void> {
    for (const [id] of this.instances) {
      this.destroyInstance(id)
    }
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }

  // -------------------------------------------------------------------------
  // Event emitters
  // -------------------------------------------------------------------------

  onStateChange(cb: StateChangeCallback): void {
    this.stateChangeCallbacks.push(cb)
  }

  onRemoved(cb: RemovedCallback): void {
    this.removedCallbacks.push(cb)
  }

  onInteracted(cb: InteractedCallback): void {
    this.interactedCallbacks.push(cb)
  }

  private emitStateChange(inst: HeadlessInstance): void {
    const info = this.toInfo(inst)
    for (const cb of this.stateChangeCallbacks) {
      try { cb(info) } catch { /* swallow */ }
    }
  }

  private emitRemoved(id: string): void {
    for (const cb of this.removedCallbacks) {
      try { cb(id) } catch { /* swallow */ }
    }
  }

  private emitInteracted(id: string): void {
    for (const cb of this.interactedCallbacks) {
      try { cb(id) } catch { /* swallow */ }
    }
  }

  // -------------------------------------------------------------------------
  // Instance info
  // -------------------------------------------------------------------------

  private toInfo(inst: HeadlessInstance): BrowserInstanceInfo {
    return {
      id: inst.id,
      url: inst.currentUrl,
      title: inst.title,
      favicon: null,
      isLoading: inst.isLoading,
      canGoBack: inst.canGoBack,
      canGoForward: inst.canGoForward,
      boundSessionId: inst.boundSessionId,
      ownerType: inst.ownerType,
      ownerSessionId: inst.ownerSessionId,
      isVisible: inst.isVisible,
      agentControlActive: inst.agentControlActive,
      themeColor: null,
    }
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Session lifecycle
  // -------------------------------------------------------------------------

  setSessionPathResolver(fn: (sessionId: string) => string | null): void {
    this.sessionPathResolver = fn
  }

  destroyForSession(sessionId: string): void {
    for (const [id, inst] of this.instances) {
      if (inst.boundSessionId === sessionId || inst.ownerSessionId === sessionId) {
        this.destroyInstance(id)
      }
    }
  }

  async clearVisualsForSession(_sessionId: string): Promise<void> {
    // No native overlays in headless mode
  }

  unbindAllForSession(sessionId: string): void {
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId) {
        inst.boundSessionId = null
        this.emitStateChange(inst)
      }
    }
  }

  getOrCreateForSession(sessionId: string): string {
    // Find existing bound instance
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId) return inst.id
    }
    return this.createForSession(sessionId)
  }

  setAgentControl(sessionId: string, meta: { displayName?: string; intent?: string }): void {
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId) {
        inst.agentControlActive = true
        this.emitStateChange(inst)
      }
    }
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Instance management
  // -------------------------------------------------------------------------

  createInstance(id?: string, options?: { show?: boolean; ownerType?: 'session' | 'manual'; ownerSessionId?: string | null }): string {
    const instanceId = id || `browser-${++instanceCounter}`

    if (this.instances.has(instanceId)) {
      return instanceId
    }

    const inst: HeadlessInstance = {
      id: instanceId,
      page: null as any, // Will be set asynchronously
      cdp: null,
      currentUrl: 'about:blank',
      title: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      boundSessionId: options?.ownerType === 'session' ? (options?.ownerSessionId ?? null) : null,
      ownerType: options?.ownerType ?? 'manual',
      ownerSessionId: options?.ownerType === 'session' ? (options?.ownerSessionId ?? null) : null,
      isVisible: options?.show ?? true,
      agentControlActive: false,
      consoleLogs: [],
      networkLogs: [],
      navigationHistory: [],
      historyIndex: -1,
      refCounter: 0,
    }

    this.instances.set(instanceId, inst)

    // Create page asynchronously
    this.initPage(inst).catch(err => {
      console.error(`[headless-browser] Failed to create page for ${instanceId}:`, err)
    })

    return instanceId
  }

  private async initPage(inst: HeadlessInstance): Promise<void> {
    const ctx = await this.ensureBrowser()
    const page = await ctx.newPage()
    inst.page = page

    // Track navigation
    page.on('load', () => {
      inst.currentUrl = page.url()
      inst.title = ''
      page.title().then(t => { inst.title = t }).catch(() => {})
      inst.isLoading = false
      this.updateNavState(inst)
      this.emitStateChange(inst)
    })

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        inst.currentUrl = page.url()
        page.title().then(t => {
          inst.title = t
          this.emitStateChange(inst)
        }).catch(() => {})
        this.updateNavState(inst)
      }
    })

    // Console logs
    page.on('console', msg => {
      if (inst.consoleLogs.length >= MAX_CONSOLE_LOG_ENTRIES) {
        inst.consoleLogs.shift()
      }
      inst.consoleLogs.push({
        timestamp: Date.now(),
        level: msg.type() === 'warning' ? 'warn' : (msg.type() as 'log' | 'info' | 'warn' | 'error'),
        message: msg.text(),
      })
    })

    // Network logs
    page.on('response', response => {
      if (inst.networkLogs.length >= MAX_NETWORK_LOG_ENTRIES) {
        inst.networkLogs.shift()
      }
      const request = response.request()
      inst.networkLogs.push({
        timestamp: Date.now(),
        method: request.method(),
        url: request.url(),
        status: response.status(),
        resourceType: request.resourceType(),
        ok: response.ok(),
      })
    })

    // Emit initial state
    this.emitStateChange(inst)
  }

  private updateNavState(inst: HeadlessInstance): void {
    const url = inst.currentUrl
    if (url && url !== 'about:blank') {
      const idx = inst.navigationHistory.indexOf(url)
      if (idx === -1) {
        // New URL
        inst.navigationHistory = inst.navigationHistory.slice(0, inst.historyIndex + 1)
        inst.navigationHistory.push(url)
        inst.historyIndex = inst.navigationHistory.length - 1
      } else {
        inst.historyIndex = idx
      }
    }
    inst.canGoBack = inst.historyIndex > 0
    inst.canGoForward = inst.historyIndex < inst.navigationHistory.length - 1
  }

  createForSession(sessionId: string, options?: { show?: boolean }): string {
    // Check for existing bound instance
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId) return inst.id
    }
    return this.createInstance(undefined, {
      show: options?.show ?? false,
      ownerType: 'session',
      ownerSessionId: sessionId,
    })
  }

  getInstance(id: string): BrowserInstanceSnapshot | undefined {
    const inst = this.instances.get(id)
    if (!inst) return undefined
    return {
      ownerType: inst.ownerType,
      ownerSessionId: inst.ownerSessionId,
      isVisible: inst.isVisible,
      title: inst.title,
      currentUrl: inst.currentUrl,
    }
  }

  listInstances(): BrowserInstanceInfo[] {
    return Array.from(this.instances.values()).map(inst => this.toInfo(inst))
  }

  focusBoundForSession(sessionId: string): string {
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId) {
        inst.isVisible = true
        this.emitStateChange(inst)
        return inst.id
      }
    }
    return this.createForSession(sessionId, { show: true })
  }

  bindSession(id: string, sessionId: string): void {
    const inst = this.instances.get(id)
    if (!inst) return
    inst.boundSessionId = sessionId
    inst.ownerType = 'session'
    inst.ownerSessionId = sessionId
    this.emitStateChange(inst)
  }

  focus(id: string): void {
    const inst = this.instances.get(id)
    if (!inst) return
    inst.isVisible = true
    this.emitStateChange(inst)
    this.emitInteracted(id)
  }

  destroyInstance(id: string): void {
    const inst = this.instances.get(id)
    if (!inst) return
    this.instances.delete(id)
    if (inst.page) {
      inst.page.close().catch(() => {})
    }
    this.emitRemoved(id)
  }

  hide(id: string): void {
    const inst = this.instances.get(id)
    if (!inst) return
    inst.isVisible = false
    this.emitStateChange(inst)
  }

  clearAgentControl(sessionId: string): void {
    for (const inst of this.instances.values()) {
      if (inst.boundSessionId === sessionId && inst.agentControlActive) {
        inst.agentControlActive = false
        this.emitStateChange(inst)
      }
    }
  }

  clearAgentControlForInstance(instanceId: string, _sessionId?: string): { released: boolean; reason?: string } {
    const inst = this.instances.get(instanceId)
    if (!inst) return { released: false, reason: 'not found' }
    inst.agentControlActive = false
    this.emitStateChange(inst)
    return { released: true }
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Navigation
  // -------------------------------------------------------------------------

  private async ensurePage(id: string): Promise<Page> {
    const inst = this.instances.get(id)
    if (!inst) throw new Error(`Browser instance not found: ${id}`)
    // Wait for page to be initialized
    let attempts = 0
    while (!inst.page && attempts < 50) {
      await new Promise(r => setTimeout(r, 100))
      attempts++
    }
    if (!inst.page) throw new Error(`Browser page not ready for: ${id}`)
    return inst.page
  }

  private getInst(id: string): HeadlessInstance {
    const inst = this.instances.get(id)
    if (!inst) throw new Error(`Browser instance not found: ${id}`)
    return inst
  }

  async navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    const inst = this.getInst(id)
    const page = await this.ensurePage(id)

    // Normalize URL
    let normalizedUrl = url.trim()
    if (!/^https?:\/\//i.test(normalizedUrl) && !normalizedUrl.startsWith('about:')) {
      if (/^[\w.-]+\.\w{2,}(\/|$)/.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`
      } else {
        normalizedUrl = `https://duckduckgo.com/?q=${encodeURIComponent(normalizedUrl)}`
      }
    }

    inst.isLoading = true
    this.emitStateChange(inst)

    try {
      await page.goto(normalizedUrl, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    } catch (err: any) {
      if (!err.message?.includes('net::ERR_ABORTED')) {
        throw err
      }
    }

    inst.currentUrl = page.url()
    inst.title = await page.title().catch(() => '')
    inst.isLoading = false
    this.updateNavState(inst)
    this.emitStateChange(inst)

    return { url: inst.currentUrl, title: inst.title }
  }

  async goBack(id: string): Promise<void> {
    const page = await this.ensurePage(id)
    await page.goBack({ timeout: 10_000 }).catch(() => {})
    const inst = this.getInst(id)
    inst.currentUrl = page.url()
    inst.title = await page.title().catch(() => '')
    this.updateNavState(inst)
    this.emitStateChange(inst)
  }

  async goForward(id: string): Promise<void> {
    const page = await this.ensurePage(id)
    await page.goForward({ timeout: 10_000 }).catch(() => {})
    const inst = this.getInst(id)
    inst.currentUrl = page.url()
    inst.title = await page.title().catch(() => '')
    this.updateNavState(inst)
    this.emitStateChange(inst)
  }

  reload(id: string): void {
    const inst = this.getInst(id)
    if (!inst.page) return
    inst.isLoading = true
    this.emitStateChange(inst)
    inst.page.reload({ timeout: 30_000 }).catch(() => {}).finally(() => {
      inst.isLoading = false
      inst.currentUrl = inst.page?.url() ?? inst.currentUrl
      inst.page?.title().then(t => { inst.title = t }).catch(() => {})
      this.emitStateChange(inst)
    })
  }

  stop(id: string): void {
    const inst = this.getInst(id)
    if (!inst.page) return
    // Playwright doesn't have a direct stop method — route through evaluate
    inst.page.evaluate('window.stop()').catch(() => {})
    inst.isLoading = false
    this.emitStateChange(inst)
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Interaction
  // -------------------------------------------------------------------------

  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)

    // Use CDP to get accessibility tree (page.accessibility was removed in Playwright 1.42+)
    const cdp = await this.ensureCdp(inst)
    const result = await cdp.send('Accessibility.getFullAXTree') as any
    const axNodes = result?.nodes

    const nodes: AccessibilityNode[] = []
    inst.refCounter = 0

    if (axNodes) {
      for (const rawNode of axNodes) {
        if (nodes.length >= MAX_AX_SNAPSHOT_NODES) break
        const n = rawNode as any
        const role = (n.role?.value || '').toLowerCase()
        const name = (n.name?.value || '').trim()

        const isInteractive = INTERACTIVE_ROLES.has(role)
        const isContent = CONTENT_ROLES.has(role)
        const isExcluded = EXCLUDED_ROLES.has(role)

        if (!isExcluded && (isInteractive || (isContent && name))) {
          inst.refCounter++
          const ref = `@e${inst.refCounter}`
          const axNode: AccessibilityNode = { ref, role, name }
          if (n.value?.value !== undefined && n.value?.value !== '') axNode.value = String(n.value.value)
          if (n.description?.value) axNode.description = String(n.description.value)
          if (n.focused?.value) axNode.focused = true
          if (n.checked?.value !== undefined) axNode.checked = n.checked.value === 'checked' || n.checked.value === true
          if (n.disabled?.value) axNode.disabled = true
          nodes.push(axNode)
        }
      }
    }

    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      nodes,
    }
  }

  private async ensureCdp(inst: HeadlessInstance): Promise<CDPSession> {
    if (inst.cdp) return inst.cdp
    inst.cdp = await inst.page.context().newCDPSession(inst.page)
    return inst.cdp
  }

  private async getAxNodesForRef(inst: HeadlessInstance, refIndex: number): Promise<{ role: string; name: string; backendNodeId?: number } | null> {
    const cdp = await this.ensureCdp(inst)
    const result = await cdp.send('Accessibility.getFullAXTree') as any
    const axNodes = result?.nodes
    if (!axNodes) return null

    let counter = 0
    for (const n of axNodes) {
      const role = (n.role?.value || '').toLowerCase()
      const name = (n.name?.value || '').trim()
      const isInteractive = INTERACTIVE_ROLES.has(role)
      const isContent = CONTENT_ROLES.has(role)
      const isExcluded = EXCLUDED_ROLES.has(role)
      if (!isExcluded && (isInteractive || (isContent && name))) {
        counter++
        if (counter === refIndex) {
          return { role, name, backendNodeId: n.backendDOMNodeId }
        }
      }
    }
    return null
  }

  async clickElement(id: string, ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }): Promise<void> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)
    const refIndex = parseInt(ref.replace('@e', ''), 10)

    const target = await this.getAxNodesForRef(inst, refIndex)
    if (!target) throw new Error(`Element ${ref} not found`)

    if (target.backendNodeId) {
      // Click via CDP using backendNodeId for precision
      const cdp = await this.ensureCdp(inst)
      const boxResult = await cdp.send('DOM.getBoxModel', { backendNodeId: target.backendNodeId }) as any
      if (boxResult?.model) {
        const [x1, y1, x2, , , , x4, y4] = boxResult.model.content as number[]
        const cx = (x1 + x2) / 2
        const cy = (y1 + y4) / 2
        await page.mouse.click(cx, cy)
      } else {
        // Fallback to role+name locator
        await this.clickByRoleName(page, target.role, target.name)
      }
    } else {
      await this.clickByRoleName(page, target.role, target.name)
    }

    if (options?.waitFor === 'navigation') {
      await page.waitForURL(/.*/, { timeout: options.timeoutMs ?? 10_000 }).catch(() => {})
    } else if (options?.waitFor === 'network-idle') {
      await page.waitForLoadState('networkidle', { timeout: options.timeoutMs ?? 10_000 }).catch(() => {})
    }

    inst.currentUrl = page.url()
    inst.title = await page.title().catch(() => '')
    this.updateNavState(inst)
    this.emitStateChange(inst)
    this.emitInteracted(id)
  }

  private async clickByRoleName(page: Page, role: string, name: string): Promise<void> {
    try {
      if (name) {
        await page.getByRole(role as any, { name, exact: false }).first().click({ timeout: 5000 })
      } else {
        await page.getByRole(role as any).first().click({ timeout: 5000 })
      }
    } catch {
      if (name) {
        await page.getByText(name, { exact: false }).first().click({ timeout: 5000 })
      } else {
        throw new Error(`Could not click element (${role}: ${name})`)
      }
    }
  }

  async clickAtCoordinates(id: string, x: number, y: number): Promise<void> {
    const page = await this.ensurePage(id)
    await page.mouse.click(x, y)
    this.emitInteracted(id)
  }

  async drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const page = await this.ensurePage(id)
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    // Smooth drag with steps
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
    }
    await page.mouse.up()
    this.emitInteracted(id)
  }

  async fillElement(id: string, ref: string, value: string): Promise<void> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)
    const refIndex = parseInt(ref.replace('@e', ''), 10)

    const target = await this.getAxNodesForRef(inst, refIndex)
    if (!target) throw new Error(`Element ${ref} not found`)

    try {
      if (target.name) {
        await page.getByRole(target.role as any, { name: target.name, exact: false }).first().fill(value, { timeout: 5000 })
      } else {
        await page.getByRole(target.role as any).first().fill(value, { timeout: 5000 })
      }
    } catch {
      if (target.name) {
        await page.getByLabel(target.name, { exact: false }).first().fill(value, { timeout: 5000 })
      } else {
        throw new Error(`Could not fill element ${ref}`)
      }
    }

    this.emitInteracted(id)
  }

  async typeText(id: string, text: string): Promise<void> {
    const page = await this.ensurePage(id)
    await page.keyboard.type(text, { delay: 20 })
    this.emitInteracted(id)
  }

  async selectOption(id: string, ref: string, value: string): Promise<void> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)
    const refIndex = parseInt(ref.replace('@e', ''), 10)

    const target = await this.getAxNodesForRef(inst, refIndex)
    if (!target) throw new Error(`Element ${ref} not found`)

    try {
      if (target.name) {
        await page.getByRole('combobox', { name: target.name, exact: false }).first().selectOption(value, { timeout: 5000 })
      } else {
        await page.getByRole('combobox').first().selectOption(value, { timeout: 5000 })
      }
    } catch {
      if (target.name) {
        await page.getByLabel(target.name).first().selectOption(value, { timeout: 5000 })
      } else {
        throw new Error(`Could not select option on ${ref}`)
      }
    }

    this.emitInteracted(id)
  }

  async setClipboard(id: string, text: string): Promise<void> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)
    const cdp = await this.ensureCdp(inst)
    // Grant clipboard permissions for headless
    await cdp.send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch(() => {})
    await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)})`).catch(() => {})
  }

  async getClipboard(id: string): Promise<string> {
    const page = await this.ensurePage(id)
    const inst = this.getInst(id)
    const cdp = await this.ensureCdp(inst)
    await cdp.send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite'],
    }).catch(() => {})
    return await page.evaluate('navigator.clipboard.readText()').catch(() => '') as string
  }

  async scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    const page = await this.ensurePage(id)
    const px = amount ?? 400
    const map: Record<string, [number, number]> = {
      up: [0, -px],
      down: [0, px],
      left: [-px, 0],
      right: [px, 0],
    }
    const [x, y] = map[direction]
    await page.evaluate(`window.scrollBy(${x}, ${y})`)
  }

  async sendKey(id: string, args: BrowserKeyArgs): Promise<void> {
    const page = await this.ensurePage(id)
    const modifiers = args.modifiers ?? []
    for (const mod of modifiers) {
      await page.keyboard.down(mod === 'meta' ? 'Meta' : mod === 'control' ? 'Control' : mod === 'alt' ? 'Alt' : 'Shift')
    }
    await page.keyboard.press(args.key)
    for (const mod of modifiers.reverse()) {
      await page.keyboard.up(mod === 'meta' ? 'Meta' : mod === 'control' ? 'Control' : mod === 'alt' ? 'Alt' : 'Shift')
    }
    this.emitInteracted(id)
  }

  async uploadFile(id: string, ref: string, filePaths: string[]): Promise<unknown> {
    const page = await this.ensurePage(id)
    // Use file chooser approach
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
      this.clickElement(id, ref).catch(() => {}),
    ])
    if (fileChooser) {
      await fileChooser.setFiles(filePaths)
    }
    return { success: !!fileChooser }
  }

  async evaluate(id: string, expression: string): Promise<unknown> {
    const page = await this.ensurePage(id)
    return await page.evaluate(expression)
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Screenshot
  // -------------------------------------------------------------------------

  async screenshot(id: string, options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
    const page = await this.ensurePage(id)
    const format = options?.format ?? 'png'
    const buffer = await page.screenshot({
      type: format,
      quality: format === 'jpeg' ? (options?.jpegQuality ?? 80) : undefined,
      fullPage: false,
    })

    return {
      imageBuffer: Buffer.from(buffer),
      imageFormat: format,
      metadata: options?.includeMetadata ? {
        url: page.url(),
        title: await page.title().catch(() => ''),
        viewport: page.viewportSize(),
      } : undefined,
    }
  }

  async screenshotRegion(id: string, target: BrowserScreenshotRegionTarget): Promise<BrowserScreenshotResult> {
    const page = await this.ensurePage(id)
    const format = target.format ?? 'png'

    let clip: { x: number; y: number; width: number; height: number } | undefined

    if (target.x !== undefined && target.y !== undefined && target.width !== undefined && target.height !== undefined) {
      clip = { x: target.x, y: target.y, width: target.width, height: target.height }
    } else if (target.selector) {
      const el = await page.$(target.selector)
      if (el) {
        const box = await el.boundingBox()
        if (box) {
          const pad = target.padding ?? 0
          clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
        }
      }
    }

    const buffer = await page.screenshot({
      type: format,
      quality: format === 'jpeg' ? (target.jpegQuality ?? 80) : undefined,
      clip,
    })

    return {
      imageBuffer: Buffer.from(buffer),
      imageFormat: format,
    }
  }

  // -------------------------------------------------------------------------
  // IBrowserPaneManager — Monitoring
  // -------------------------------------------------------------------------

  getConsoleLogs(id: string, options?: BrowserConsoleOptions): BrowserConsoleEntry[] {
    const inst = this.getInst(id)
    let logs = [...inst.consoleLogs]
    if (options?.level && options.level !== 'all') {
      logs = logs.filter(e => e.level === options.level)
    }
    const limit = options?.limit ?? 50
    return logs.slice(-limit)
  }

  windowResize(id: string, width: number, height: number): { width: number; height: number } {
    const inst = this.getInst(id)
    if (inst.page) {
      inst.page.setViewportSize({ width, height }).catch(() => {})
    }
    return { width, height }
  }

  getNetworkLogs(id: string, options?: BrowserNetworkOptions): BrowserNetworkEntry[] {
    const inst = this.getInst(id)
    let logs = [...inst.networkLogs]
    if (options?.status && options.status !== 'all') {
      logs = logs.filter(e => {
        if (options.status === 'failed') return !e.ok
        if (options.status === '2xx') return e.status >= 200 && e.status < 300
        if (options.status === '3xx') return e.status >= 300 && e.status < 400
        if (options.status === '4xx') return e.status >= 400 && e.status < 500
        if (options.status === '5xx') return e.status >= 500
        return true
      })
    }
    if (options?.method) {
      logs = logs.filter(e => e.method.toUpperCase() === options.method!.toUpperCase())
    }
    if (options?.resourceType) {
      logs = logs.filter(e => e.resourceType === options.resourceType)
    }
    const limit = options?.limit ?? 50
    return logs.slice(-limit)
  }

  async waitFor(id: string, args: BrowserWaitArgs): Promise<BrowserWaitResult> {
    const page = await this.ensurePage(id)
    const timeout = args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    const start = Date.now()

    switch (args.kind) {
      case 'selector':
        await page.waitForSelector(args.value!, { timeout })
        return { ok: true, kind: 'selector', elapsedMs: Date.now() - start, detail: `Found: ${args.value}` }

      case 'text':
        await page.waitForFunction(
          `document.body.innerText.includes(${JSON.stringify(args.value)})`,
          undefined,
          { timeout },
        )
        return { ok: true, kind: 'text', elapsedMs: Date.now() - start, detail: `Found text: ${args.value}` }

      case 'url':
        await page.waitForURL(`**${args.value}**`, { timeout })
        return { ok: true, kind: 'url', elapsedMs: Date.now() - start, detail: `URL matches: ${args.value}` }

      case 'network-idle':
        await page.waitForLoadState('networkidle', { timeout })
        return { ok: true, kind: 'network-idle', elapsedMs: Date.now() - start, detail: 'Network idle' }

      default:
        throw new Error(`Unknown wait kind: ${args.kind}`)
    }
  }

  async getDownloads(id: string, _options?: BrowserDownloadOptions): Promise<BrowserDownloadEntry[]> {
    // Playwright downloads need explicit handling. Return empty for now.
    return []
  }

  async detectSecurityChallenge(id: string): Promise<{ detected: boolean; provider: string; signals: string[] }> {
    const page = await this.ensurePage(id)
    const signals: string[] = []

    const title = await page.title().catch(() => '')
    if (title.includes('Just a moment')) {
      signals.push('title:cloudflare-challenge')
    }

    const url = page.url()
    if (url.includes('/cdn-cgi/challenge-platform')) {
      signals.push('url:cloudflare-challenge')
    }

    const hasTurnstile = await page.evaluate(
      '!!document.querySelector(".cf-turnstile, #turnstile-wrapper, [data-sitekey]")'
    ).catch(() => false)
    if (hasTurnstile) {
      signals.push('dom:turnstile-widget')
    }

    const detected = signals.length > 0
    return {
      detected,
      provider: detected ? 'cloudflare' : 'none',
      signals,
    }
  }

  // -------------------------------------------------------------------------
  // Electron-only methods — stubs for interface compatibility
  // -------------------------------------------------------------------------

  handleEmptyStateLaunchFromRenderer(_webContentsId: number, _payload: any): Promise<any> {
    return Promise.resolve({ launched: false, reason: 'headless' })
  }
}
