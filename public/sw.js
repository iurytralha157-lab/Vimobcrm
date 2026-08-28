self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const MAX_PUSH_TARGET_LENGTH = 4096;
const PROTECTED_ROUTE_PREFIXES = [
  "/admin",
  "/agenda",
  "/attention",
  "/automations",
  "/crm",
  "/dashboard",
  "/financeiro",
  "/gamificacao",
  "/inicio",
  "/marketing",
  "/notifications",
  "/pipeline",
  "/properties",
  "/settings",
  "/suporte",
];

function matchesRoutePrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function getSafePushTarget(rawTarget, data) {
  const fallback = "/notifications";
  if (
    typeof rawTarget !== "string"
    || rawTarget.length === 0
    || rawTarget.length > MAX_PUSH_TARGET_LENGTH
    || rawTarget !== rawTarget.trim()
    || !rawTarget.startsWith("/")
    || rawTarget.startsWith("//")
    || rawTarget.includes("\\")
    || /[\u0000-\u001F\u007F]/.test(rawTarget)
  ) {
    return fallback;
  }

  try {
    const target = new URL(rawTarget, self.location.origin);
    if (target.origin !== self.location.origin) return fallback;

    if (target.pathname === "/leads") {
      const leadID = data && data.lead_id ? String(data.lead_id) : "";
      return leadID
        ? `/crm/pipelines?lead=${encodeURIComponent(leadID)}`
        : "/crm/pipelines";
    }

    if (!PROTECTED_ROUTE_PREFIXES.some((prefix) => matchesRoutePrefix(target.pathname, prefix))) {
      return fallback;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

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
  const notificationData = notification.data && typeof notification.data === "object"
    ? notification.data
    : {};
  const rawTarget = notificationData.target_url
    || notificationData.targetUrl
    || notificationData.url
    || notification.target_url
    || notification.url;
  const title = notification.title || "Vimob CRM";
  const options = {
    body: notification.body || notification.content || "Voce tem uma nova notificacao.",
    icon: "/icons/favicon-laranja.png",
    badge: "/icons/favicon-laranja.png",
    data: {
      ...notificationData,
      url: getSafePushTarget(rawTarget || "/notifications", notificationData),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const rawURL = data.target_url || data.targetUrl || data.url || "/notifications";
  const safeTarget = getSafePushTarget(rawURL, data);
  const targetURL = new URL(safeTarget, self.location.origin);
  const targetHref = targetURL.href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.startsWith(self.location.origin)) {
          const navigate = "navigate" in client
            ? Promise.resolve(client.navigate(targetHref)).catch(() => undefined)
            : Promise.resolve();
          return navigate.then(() => client.focus());
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetHref);
      }
      return undefined;
    }),
  );
});
