const defaultCallMediaHost = "evogo.vettercompany.com.br";

export function assertWhatsAppCallMediaDestination(
  url: string,
  configuredHost?: string,
  additionalHosts?: string,
): void {
  const destination = new URL(url);
  const primaryHost = configuredHost?.trim().toLowerCase() || defaultCallMediaHost;
  const allowedHosts = new Set([
    primaryHost,
    ...(additionalHosts ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
  ]);
  if (destination.protocol !== "wss:" || !allowedHosts.has(destination.hostname.toLowerCase())
    || (destination.port && destination.port !== "443") || destination.username || destination.password
    || destination.pathname !== "/call/media" || destination.hash
    || [...destination.searchParams.keys()].join(",") !== "token"
    || !destination.searchParams.get("token")) {
    throw new Error("Destino de áudio não autorizado");
  }
}
