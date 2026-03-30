/**
 * Minimal Service Worker for Craft Agent PWA.
 *
 * Purpose: enable ServiceWorkerRegistration.showNotification()
 * which is required for notifications on iOS PWA (16.4+).
 *
 * The SW itself does NOT intercept fetch (no offline caching) —
 * it only handles notification click to focus the app window.
 */

// Activate immediately, skip waiting
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// When the user taps a notification, focus the app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if any
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow('/')
    })
  )
})
