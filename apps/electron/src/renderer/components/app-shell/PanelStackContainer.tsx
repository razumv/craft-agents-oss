/**
 * PanelStackContainer
 *
 * Horizontal layout container for ALL panels:
 * Sidebar → Navigator → Content Panel(s) with resize sashes.
 *
 * Content panels use CSS flex-grow with their proportions as weights:
 * - Each panel gets `flex: <proportion> 1 0px` with `min-width: PANEL_MIN_WIDTH`
 * - Flex distributes available space proportionally — panels fill the viewport
 * - When panels hit min-width, overflow-x: auto kicks in naturally
 *
 * Sidebar and Navigator are NOT part of the proportional layout —
 * they have their own fixed/user-resizable widths managed by AppShell.
 * They just reduce the available width for content panels and scroll with everything else.
 *
 * The right sidebar stays OUTSIDE this container.
 */

import { useRef, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { panelStackAtom, focusedPanelIdAtom } from '@/atoms/panel-stack'
import { PanelSlot } from './PanelSlot'
import { PanelResizeSash } from './PanelResizeSash'
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './panel-constants'

/** Spring transition matching AppShell's sidebar/navigator animation */
const PANEL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

interface PanelStackContainerProps {
  sidebarSlot: React.ReactNode
  sidebarWidth: number
  navigatorSlot: React.ReactNode
  navigatorWidth: number
  isSidebarAndNavigatorHidden: boolean
  isRightSidebarVisible?: boolean
  isResizing?: boolean
  /** Mobile layout mode — sidebar+navigator render as fixed overlay */
  isMobile?: boolean
  /** Whether the mobile sidebar drawer is open */
  mobileSidebarOpen?: boolean
  /** Callback to close the mobile drawer */
  onCloseMobileDrawer?: () => void
}

export function PanelStackContainer({
  sidebarSlot,
  sidebarWidth,
  navigatorSlot,
  navigatorWidth,
  isSidebarAndNavigatorHidden,
  isRightSidebarVisible,
  isResizing,
  isMobile,
  mobileSidebarOpen,
  onCloseMobileDrawer,
}: PanelStackContainerProps) {
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)

  const contentPanels = panelStack

  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(contentPanels.length)

  const hasSidebar = !isMobile && sidebarWidth > 0
  const hasNavigator = !isMobile && navigatorWidth > 0
  const isMultiPanel = contentPanels.length > 1
  const isLeftEdge = !hasSidebar && !hasNavigator

  // Auto-scroll to newly pushed content panel
  useEffect(() => {
    if (contentPanels.length > prevCountRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          left: scrollRef.current.scrollWidth,
          behavior: 'smooth',
        })
      })
    }
    prevCountRef.current = contentPanels.length
  }, [contentPanels.length])

  const transition = isResizing ? { duration: 0 } : PANEL_SPRING

  // Mobile: navigator (session list) rendered as a fixed-position drawer (85vw width).
  // Includes a header with close button for clear escape affordance (§9 modal-escape).
  const mobileDrawer = isMobile ? (
    <div
      className="mobile-sidebar-drawer"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '85vw',
        maxWidth: '360px',
        zIndex: 200,
        transform: mobileSidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background)',
        boxShadow: mobileSidebarOpen ? '4px 0 24px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      {/* Drawer Header — Sessions title + close button */}
      <div className="mobile-drawer-header flex items-center justify-between shrink-0 min-h-[52px] px-4" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <span className="text-sm font-semibold text-foreground/90">Sessions</span>
        <button
          onClick={onCloseMobileDrawer}
          aria-label="Close drawer"
          className="flex items-center justify-center h-[44px] w-[44px] -mr-2 rounded-lg active:bg-foreground/10 transition-colors"
        >
          <X className="h-5 w-5 text-foreground/60" />
        </button>
      </div>
      {/* Sidebar nav items */}
      <div className="shrink-0 border-b border-border/30 overflow-hidden">
        {sidebarSlot}
      </div>
      {/* Navigator — session list */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {navigatorSlot}
      </div>
    </div>
  ) : null

  return (
    <>
    {mobileDrawer}
    <div
      ref={scrollRef}
      className="flex-1 min-w-0 flex relative z-panel panel-scroll"
      style={{
        overflowX: isMobile ? 'hidden' : 'auto',
        overflowY: 'hidden',
        // Extra vertical space for box-shadows (collapsed back with negative margin)
        ...(isMobile ? {} : {
          paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
          marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
          // Extend to window bottom so scrollbar sits at the very edge
          marginBottom: -6,
          paddingBottom: 6,
          // Extra horizontal space for last panel's box-shadow
          paddingRight: 8,
          marginRight: -8,
        }),
      }}
    >
      {/* Inner flex container — flex-grow: 1 fills viewport, content can overflow for scroll.
           Animated paddingLeft provides window-edge spacing when sidebar/navigator are hidden.
           Hidden slots use marginRight: -PANEL_GAP to cancel their trailing flex gap. */}
      <motion.div
        className="flex h-full"
        initial={false}
        animate={{ paddingLeft: isMobile ? 0 : (!hasSidebar ? PANEL_EDGE_INSET : 0) }}
        transition={transition}
        style={{ gap: isMobile ? 0 : PANEL_GAP, flexGrow: 1, minWidth: 0 }}
      >
        {/* === SIDEBAR SLOT === */}
        <motion.div
          initial={false}
          animate={{
            width: hasSidebar ? sidebarWidth : 0,
            marginRight: hasSidebar ? 0 : -PANEL_GAP,
            opacity: hasSidebar ? 1 : 0,
          }}
          transition={transition}
          className="h-full relative shrink-0"
          style={{ overflowX: 'clip', overflowY: 'visible' }}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>
            {sidebarSlot}
          </div>
        </motion.div>

        {/* === NAVIGATOR SLOT === */}
        <motion.div
          initial={false}
          animate={{
            width: hasNavigator ? navigatorWidth : 0,
            marginRight: hasNavigator ? 0 : -PANEL_GAP,
            opacity: hasNavigator ? 1 : 0,
          }}
          transition={transition}
          className={cn(
            'h-full overflow-hidden relative shrink-0 z-[2]',
            'bg-background shadow-middle',
          )}
          style={{
            borderTopLeftRadius: RADIUS_INNER,
            borderBottomLeftRadius: !hasSidebar ? RADIUS_EDGE : RADIUS_INNER,
            borderTopRightRadius: RADIUS_INNER,
            borderBottomRightRadius: RADIUS_INNER,
          }}
        >
          <div className="h-full" style={{ width: navigatorWidth }}>
            {navigatorSlot}
          </div>
        </motion.div>

        {/* === CONTENT PANELS WITH SASHES === */}
        {contentPanels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center" />
        ) : (
          contentPanels.map((entry, index) => (
            <PanelSlot
              key={entry.id}
              entry={entry}
              isOnly={contentPanels.length === 1}
              isFocusedPanel={isMultiPanel ? entry.id === focusedPanelId : true}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
              isAtLeftEdge={index === 0 && isLeftEdge}
              isAtRightEdge={index === contentPanels.length - 1 && !isRightSidebarVisible}
              proportion={entry.proportion}
              isMobile={isMobile}
              sash={index > 0 ? (
                <PanelResizeSash
                  leftIndex={index - 1}
                  rightIndex={index}
                />
              ) : undefined}
            />
          ))
        )}
      </motion.div>
    </div>
    </>
  )
}
