self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : "",
    };
  }

  const notification = payload.notification || payload;
  const title = notification.title || "Vimob CRM";
  const options = {
    body: notification.body || notification.content || "Voce tem uma nova notificacao.",
    icon: notification.icon || "/icons/favicon-laranja.png",
    badge: notification.badge || "/icons/favicon-laranja.png",
    data: {
      url: notification.url || notification.target_url || "/notifications",
      ...(notification.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawURL = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/notifications";
  const targetURL = new URL(rawURL, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.startsWith(self.location.origin)) {
          client.navigate(targetURL);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetURL);
      }
      return undefined;
    }),
  );
});
