self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}

  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {
      title: 'EspaçoOn Master',
      body: event.data ? event.data.text() : '',
    }
  }

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'EspaçoOn Master',
      {
        body: data.body || 'Você recebeu uma nova notificação.',
        tag: data.tag || 'espacoon-master-notification',
        renotify: true,
        data: {
          url: data.url || '/',
        },
      },
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = new URL(
    event.notification.data?.url || '/',
    self.location.origin,
  ).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }

      if (clients.openWindow) return clients.openWindow(targetUrl)
      return undefined
    }),
  )
})


self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
