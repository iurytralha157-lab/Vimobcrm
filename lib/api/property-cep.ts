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
  | { kind: "unavailable" };

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
): Promise<LookupResult> {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(5_000),
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

export async function lookupPropertyCep(
  cep: string,
  fetcher: typeof fetch = fetch,
): Promise<LookupResult> {
  if (!/^\d{8}$/.test(cep)) return { kind: "not_found" };

  const primary = await readSource(
    `https://viacep.com.br/ws/${cep}/json/`,
    "viacep",
    fetcher,
  );
  if (
    primary.kind === "found" &&
    primary.address.bairro &&
    primary.address.logradouro
  ) {
    return primary;
  }

  const fallback = await readSource(
    `https://brasilapi.com.br/api/cep/v1/${cep}`,
    "brasilapi",
    fetcher,
  );
  if (primary.kind === "found") {
    if (
      fallback.kind === "found" &&
      primary.address.localidade.localeCompare(fallback.address.localidade, "pt-BR", {
        sensitivity: "base",
      }) === 0 &&
      primary.address.uf.toUpperCase() === fallback.address.uf.toUpperCase()
    ) {
      return {
        kind: "found",
        address: {
          ...primary.address,
          logradouro:
            primary.address.logradouro || fallback.address.logradouro,
          bairro: primary.address.bairro || fallback.address.bairro,
        },
      };
    }
    return primary;
  }
  if (fallback.kind === "found") return fallback;
  if (primary.kind === "not_found" && fallback.kind === "not_found") {
    return { kind: "not_found" };
  }
  return { kind: "unavailable" };
}
