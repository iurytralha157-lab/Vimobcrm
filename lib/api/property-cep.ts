import { z } from "zod";

export type PropertyCepAddress = {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
};

type LookupResult =
  | { kind: "found"; address: PropertyCepAddress }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "cancelled" };

const viaCepPayloadSchema = z.object({
  erro: z.boolean().optional(),
  logradouro: z.string().nullish(),
  bairro: z.string().nullish(),
  localidade: z.string().nullish(),
  uf: z.string().nullish(),
});

const brasilApiPayloadSchema = z.object({
  street: z.string().nullish(),
  neighborhood: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
});

async function readSource(
  url: string,
  provider: "viacep" | "brasilapi",
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<LookupResult> {
  try {
    const response = await fetcher(url, {
      signal,
      headers: { Accept: "application/json" },
      cache: "force-cache",
      next: { revalidate: 86_400 },
    });
    if (response.status === 400 || response.status === 404) {
      return { kind: "not_found" };
    }
    if (!response.ok) return { kind: "unavailable" };

    const payload: unknown = await response.json();
    if (provider === "viacep") {
      const parsed = viaCepPayloadSchema.safeParse(payload);
      if (!parsed.success) return { kind: "unavailable" };
      if (parsed.data.erro) return { kind: "not_found" };
      const localidade = parsed.data.localidade?.trim() ?? "";
      const uf = parsed.data.uf?.trim() ?? "";
      if (!localidade || !uf) return { kind: "unavailable" };
      return {
        kind: "found",
        address: {
          logradouro: parsed.data.logradouro?.trim() ?? "",
          bairro: parsed.data.bairro?.trim() ?? "",
          localidade,
          uf,
        },
      };
    }

    const parsed = brasilApiPayloadSchema.safeParse(payload);
    if (!parsed.success) return { kind: "unavailable" };
    const localidade = parsed.data.city?.trim() ?? "";
    const uf = parsed.data.state?.trim() ?? "";
    if (!localidade || !uf) return { kind: "unavailable" };
    return {
      kind: "found",
      address: {
        logradouro: parsed.data.street?.trim() ?? "",
        bairro: parsed.data.neighborhood?.trim() ?? "",
        localidade,
        uf,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export const PROPERTY_CEP_TIMEOUT_MS = 4_000;
export const PROPERTY_CEP_FALLBACK_DELAY_MS = 350;

export type PropertyCepLookupOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fallbackDelayMs?: number;
};

function completeAddress(result: LookupResult) {
  return result.kind === "found" && Boolean(result.address.bairro && result.address.logradouro);
}

function mergeSources(primary: LookupResult, fallback: LookupResult): LookupResult {
  if (primary.kind === "found") {
    if (fallback.kind === "found" &&
      primary.address.localidade.localeCompare(fallback.address.localidade, "pt-BR", { sensitivity: "base" }) === 0 &&
      primary.address.uf.toUpperCase() === fallback.address.uf.toUpperCase()) {
      return { kind: "found", address: {
        ...primary.address,
        logradouro: primary.address.logradouro || fallback.address.logradouro,
        bairro: primary.address.bairro || fallback.address.bairro,
      } };
    }
    return primary;
  }
  if (fallback.kind === "found") return fallback;
  return primary.kind === "not_found" && fallback.kind === "not_found"
    ? { kind: "not_found" } : { kind: "unavailable" };
}

/** One total budget, with an early fallback when the preferred provider stalls. */
export async function lookupPropertyCep(
  cep: string,
  fetcher: typeof fetch = fetch,
  options: PropertyCepLookupOptions = {},
): Promise<LookupResult> {
  if (!/^\d{8}$/.test(cep)) return { kind: "not_found" };
  if (options.signal?.aborted) return { kind: "cancelled" };
  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? PROPERTY_CEP_TIMEOUT_MS);
  const fallbackDelayMs = Math.max(0, options.fallbackDelayMs ?? PROPERTY_CEP_FALLBACK_DELAY_MS);
  let cancelled = false;
  const cancel = () => { cancelled = true; controller.abort(); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let latestPrimary: LookupResult | undefined;
  const aborted = new Promise<LookupResult>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(cancelled
      ? { kind: "cancelled" }
      : latestPrimary?.kind === "found" ? latestPrimary : { kind: "unavailable" }), { once: true });
  });
  const resolveProviders = async (): Promise<LookupResult> => {
    const primaryPromise = readSource(
      `https://viacep.com.br/ws/${cep}/json/`, "viacep", fetcher, controller.signal,
    ).then((result) => { latestPrimary = result; return result; });
    const start = await Promise.race([
      primaryPromise.then((result) => ({ source: "primary" as const, result })),
      new Promise<{ source: "hedge" }>((resolve) => {
        hedgeTimer = setTimeout(() => resolve({ source: "hedge" }), fallbackDelayMs);
      }),
    ]);
    if (hedgeTimer) clearTimeout(hedgeTimer);
    if (start.source === "primary" && completeAddress(start.result)) return start.result;
    if (controller.signal.aborted) return cancelled ? { kind: "cancelled" } : { kind: "unavailable" };
    const fallbackPromise = readSource(
      `https://brasilapi.com.br/api/cep/v1/${cep}`, "brasilapi", fetcher, controller.signal,
    );
    if (start.source === "primary") return mergeSources(start.result, await fallbackPromise);
    const first = await Promise.race([
      primaryPromise.then((result) => ({ source: "primary" as const, result })),
      fallbackPromise.then((result) => ({ source: "fallback" as const, result })),
    ]);
    if (first.source === "fallback" && first.result.kind === "found") return first.result;
    if (first.source === "primary" && completeAddress(first.result)) return first.result;
    return mergeSources(await primaryPromise, await fallbackPromise);
  };
  try {
    return await Promise.race([resolveProviders(), aborted]);
  } finally {
    clearTimeout(timeout);
    if (hedgeTimer) clearTimeout(hedgeTimer);
    options.signal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
