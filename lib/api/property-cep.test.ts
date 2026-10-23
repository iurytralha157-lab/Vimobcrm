import assert from "node:assert/strict";
import test from "node:test";

const propertyCepPath = "./property-cep.ts";
const { lookupPropertyCep } = (await import(propertyCepPath)) as typeof import("./property-cep");

test("CEP conhecido usa o endereço do ViaCEP sem consultar a fonte reserva", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({
      logradouro: "Praça da Sé",
      bairro: "Sé",
      localidade: "São Paulo",
      uf: "SP",
    });
  }) as typeof fetch;

  assert.deepEqual(await lookupPropertyCep("01001000", fetcher), {
    kind: "found",
    address: {
      logradouro: "Praça da Sé",
      bairro: "Sé",
      localidade: "São Paulo",
      uf: "SP",
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /viacep\.com\.br/);
});

test("falha do ViaCEP usa BrasilAPI e mantém o formato da ficha", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (calls.length === 1) throw new Error("provider offline");
    return Response.json({
      street: "Praça da Sé",
      neighborhood: "Sé",
      city: "São Paulo",
      state: "SP",
    });
  }) as typeof fetch;

  assert.deepEqual(await lookupPropertyCep("01001000", fetcher), {
    kind: "found",
    address: {
      logradouro: "Praça da Sé",
      bairro: "Sé",
      localidade: "São Paulo",
      uf: "SP",
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /brasilapi\.com\.br/);
});

test("bairro ausente no ViaCEP usa BrasilAPI da mesma cidade e UF", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return String(input).includes("viacep")
      ? Response.json({
          logradouro: "Rua Curitiba",
          bairro: "",
          localidade: "Macaé",
          uf: "RJ",
        })
      : Response.json({
          street: "Rua Curitiba",
          neighborhood: "Riviera Fluminense",
          city: "Macaé",
          state: "RJ",
        });
  }) as typeof fetch;

  assert.deepEqual(await lookupPropertyCep("27935320", fetcher), {
    kind: "found",
    address: {
      logradouro: "Rua Curitiba",
      bairro: "Riviera Fluminense",
      localidade: "Macaé",
      uf: "RJ",
    },
  });
  assert.equal(calls.length, 2);
});

test("bairro ausente nas duas fontes não herda bairro de outro CEP", async () => {
  const fetcher = (async (input: RequestInfo | URL) =>
    String(input).includes("viacep")
      ? Response.json({
          logradouro: null,
          bairro: null,
          localidade: "Macaé",
          uf: "RJ",
        })
      : Response.json({
          street: null,
          neighborhood: null,
          city: "Macaé",
          state: "RJ",
        })) as typeof fetch;

  assert.deepEqual(await lookupPropertyCep("27935320", fetcher), {
    kind: "found",
    address: { logradouro: "", bairro: "", localidade: "Macaé", uf: "RJ" },
  });
});

test("fontes divergentes não misturam bairros de cidades diferentes", async () => {
  const fetcher = (async (input: RequestInfo | URL) =>
    String(input).includes("viacep")
      ? Response.json({ bairro: "", localidade: "Macaé", uf: "RJ" })
      : Response.json({
          neighborhood: "Centro",
          city: "Niterói",
          state: "RJ",
        })) as typeof fetch;

  assert.deepEqual(await lookupPropertyCep("27935320", fetcher), {
    kind: "found",
    address: { logradouro: "", bairro: "", localidade: "Macaé", uf: "RJ" },
  });
});

test("CEP ausente nas duas fontes é distinto de indisponibilidade", async () => {
  const absentFetcher = (async (input: RequestInfo | URL) =>
    String(input).includes("viacep")
      ? Response.json({ erro: true })
      : new Response(null, { status: 404 })) as typeof fetch;
  assert.deepEqual(await lookupPropertyCep("99999999", absentFetcher), {
    kind: "not_found",
  });

  const unavailableFetcher = (async () =>
    new Response(null, { status: 503 })) as typeof fetch;
  assert.deepEqual(await lookupPropertyCep("01001000", unavailableFetcher), {
    kind: "unavailable",
  });
});

test("CEP inválido não chama provedores externos", async () => {
  const fetcher = (async () => {
    throw new Error("unexpected request");
  }) as typeof fetch;
  assert.deepEqual(await lookupPropertyCep("01001-000", fetcher), {
    kind: "not_found",
  });
});

test("fonte reserva responde sem esperar o timeout do ViaCEP", async () => {
  const calls: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    if (String(input).includes("viacep")) return new Promise<Response>(() => {});
    return Promise.resolve(Response.json({ street: "Rua A", neighborhood: "Centro", city: "Cidade", state: "SP" }));
  }) as typeof fetch;
  const result = await lookupPropertyCep("01001000", fetcher, { timeoutMs: 200, fallbackDelayMs: 1 });
  assert.equal(result.kind, "found");
  assert.equal(calls.length, 2);
});

test("orçamento total limita provedores que não atendem o AbortSignal", async () => {
  const fetcher = (() => new Promise<Response>(() => {})) as typeof fetch;
  assert.deepEqual(await lookupPropertyCep("01001000", fetcher, { timeoutMs: 15, fallbackDelayMs: 1 }), { kind: "unavailable" });
});

test("cancelamento do usuário é distinto de CEP ausente ou provedor indisponível", async () => {
  const controller = new AbortController();
  const fetcher = (() => new Promise<Response>(() => {})) as typeof fetch;
  const lookup = lookupPropertyCep("01001000", fetcher, { signal: controller.signal, fallbackDelayMs: 1 });
  controller.abort();
  assert.deepEqual(await lookup, { kind: "cancelled" });
});
