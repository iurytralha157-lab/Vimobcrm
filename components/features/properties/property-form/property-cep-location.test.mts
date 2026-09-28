import assert from "node:assert/strict";
import test from "node:test";

const cepLocationPath = "./property-cep-location.ts";
const {
  applyCepAddressToLocation,
  persistedLocationMatchesForm,
  readBackPropertyLocation,
} =
  await import(cepLocationPath);

const previous = {
  cep: "27935-320",
  endereco: "Rua Curitiba",
  bairro: "Maringá",
  cidade: "Macaé",
  uf: "RJ",
  city_id: "city-macae",
  neighborhood_id: "neighborhood-maringa",
  condominium_id: "condominium-maringa",
};

test("CEP 27935-320 corrige o bairro anterior na edição do imóvel", () => {
  const result = applyCepAddressToLocation(
    previous,
    {
      logradouro: "Rua Curitiba",
      bairro: "Riviera Fluminense",
      localidade: "Macaé",
      uf: "RJ",
    },
    { cityId: "city-macae" },
  );

  assert.equal(result.cep, "27935-320");
  assert.equal(result.bairro, "Riviera Fluminense");
  assert.equal(result.city_id, "city-macae");
  assert.equal(result.neighborhood_id, "");
  assert.equal(result.condominium_id, "");
});

test("resposta sem bairro limpa o bairro e o catálogo antigos", () => {
  const result = applyCepAddressToLocation(
    previous,
    { logradouro: "Rua Curitiba", bairro: "", localidade: "Macaé", uf: "RJ" },
    { cityId: "city-macae" },
  );

  assert.equal(result.bairro, "");
  assert.equal(result.neighborhood_id, "");
  assert.equal(result.condominium_id, "");
});

test("reconsulta do mesmo endereço preserva seleção válida de catálogo", () => {
  const selected = {
    ...previous,
    bairro: "Riviera Fluminense",
    neighborhood_id: "neighborhood-riviera",
    condominium_id: "condominium-riviera",
  };
  const result = applyCepAddressToLocation(
    selected,
    {
      logradouro: "Rua Curitiba",
      bairro: "Riviera Fluminense",
      localidade: "Macaé",
      uf: "RJ",
    },
    {},
  );

  assert.equal(result.city_id, "city-macae");
  assert.equal(result.neighborhood_id, "neighborhood-riviera");
  assert.equal(result.condominium_id, "condominium-riviera");
});

test("mudança de cidade não mantém associações da localização anterior", () => {
  const result = applyCepAddressToLocation(
    previous,
    { logradouro: "", bairro: "Centro", localidade: "Niterói", uf: "RJ" },
    {},
  );

  assert.equal(result.cidade, "Niterói");
  assert.equal(result.bairro, "Centro");
  assert.equal(result.city_id, "");
  assert.equal(result.neighborhood_id, "");
  assert.equal(result.condominium_id, "");
});

test("leitura após salvar detecta bairro removido pelo banco", () => {
  const expected = {
    cep: "27935-320",
    endereco: "Rua Curitiba",
    bairro: "Riviera Fluminense",
    cidade: "Macaé",
    uf: "RJ",
  };
  assert.equal(
    persistedLocationMatchesForm(expected, { ...expected, bairro: null }),
    false,
  );
  assert.equal(
    persistedLocationMatchesForm(expected, { ...expected, cep: "27935320" }),
    true,
  );
});

test("edição só confirma localização depois de leitura do imóvel gravado", async () => {
  const expected = {
    cep: "27935-320",
    endereco: "Rua Curitiba",
    bairro: "Riviera Fluminense",
    cidade: "Macaé",
    uf: "RJ",
  };
  let reads = 0;
  const result = await readBackPropertyLocation(expected, async () => {
    reads += 1;
    return { ...expected, bairro: null, updated_at: "2026-09-28T12:00:00Z" };
  });

  assert.equal(reads, 1);
  assert.equal(result.matches, false);
  assert.equal(result.savedProperty.updated_at, "2026-09-28T12:00:00Z");
});
