import assert from "node:assert/strict";
import test from "node:test";
import {
  eligiblePublicPropertyIds,
  filterPublicSiteEligibleProperties,
} from "./public-property-eligibility.ts";

const organizationId = "organization-a";
const publicationId = "11111111-1111-4111-8111-111111111111";

function property(overrides: Record<string, unknown> = {}) {
  return {
    id: "property-a",
    organization_id: organizationId,
    status: "active",
    published_on_site: true,
    ...overrides,
  };
}

function publication(overrides: Record<string, unknown> = {}) {
  return {
    id: publicationId,
    organization_id: organizationId,
    property_id: "property-a",
    channel: "site",
    channel_account_key: "default",
    desired_state: "published",
    published_version: 3,
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    publication_id: publicationId,
    organization_id: organizationId,
    property_id: "property-a",
    channel: "site",
    channel_account_key: "default",
    version: 3,
    payload: {
      property: {
        id: "property-a",
        codigo: "PUBLIC-1",
        titulo: "Published title",
        status: "active",
        valor_venda: 500_000,
      },
    },
    ...overrides,
  };
}

test("canonical site publication needs the exact durable published version", () => {
  assert.deepEqual(
    [...eligiblePublicPropertyIds({
      organizationId,
      properties: [property()],
      publications: [publication()],
      versions: [version()],
    })],
    ["property-a"],
  );

  for (const versions of [
    [],
    [version({ version: 2 })],
    [version({ organization_id: "organization-b" })],
    [version({ property_id: "property-b" })],
    [version({ channel_account_key: "other" })],
    [version({ payload: {} })],
  ]) {
    assert.equal(
      eligiblePublicPropertyIds({
        organizationId,
        properties: [property()],
        publications: [publication()],
        versions,
      }).size,
      0,
    );
  }
});

test("canonical state is authoritative and never falls back to the legacy flag", () => {
  for (const canonical of [
    publication({ desired_state: "unpublished", published_version: null }),
    publication({ desired_state: "paused" }),
    publication({ published_version: null }),
    publication({ published_version: 0 }),
    publication({ published_version: 2.5 }),
  ]) {
    assert.equal(
      eligiblePublicPropertyIds({
        organizationId,
        properties: [property({ published_on_site: true })],
        publications: [canonical],
        versions: [version()],
      }).size,
      0,
    );
  }
});

test("legacy published_on_site is accepted only when no canonical row exists", () => {
  assert.deepEqual(
    [...eligiblePublicPropertyIds({
      organizationId,
      properties: [property()],
      publications: [],
      versions: [],
    })],
    ["property-a"],
  );
  assert.equal(
    eligiblePublicPropertyIds({
      organizationId,
      properties: [property({ published_on_site: false })],
      publications: [],
      versions: [],
    }).size,
    0,
  );
});

test("only active or ativo properties can be disclosed or counted", () => {
  for (const status of [
    "sold",
    "vendido",
    "rented",
    "locado",
    "alugado",
    "inactive",
    "inativo",
    "reserved",
    "draft",
    "",
    null,
  ]) {
    assert.equal(
      eligiblePublicPropertyIds({
        organizationId,
        properties: [property({ status })],
        publications: [publication()],
        versions: [version()],
      }).size,
      0,
      `status ${String(status)} must remain private`,
    );
  }

  for (const status of ["active", " ACTIVE ", "ativo", "ÁTIVO"]) {
    assert.deepEqual(
      [...eligiblePublicPropertyIds({
        organizationId,
        properties: [property({ status })],
        publications: [publication()],
        versions: [version()],
      })],
      ["property-a"],
    );
  }
});

test("cross-tenant and ambiguous canonical records fail closed", () => {
  assert.equal(
    eligiblePublicPropertyIds({
      organizationId,
      properties: [property({ organization_id: "organization-b" })],
      publications: [],
      versions: [],
    }).size,
    0,
  );
  assert.equal(
    eligiblePublicPropertyIds({
      organizationId,
      properties: [property()],
      publications: [
        publication(),
        publication({ id: "22222222-2222-4222-8222-222222222222" }),
      ],
      versions: [version()],
    }).size,
    0,
  );
});

type MockOptions = {
  rows?: Record<string, Array<Record<string, unknown>> | null>;
  errors?: Record<string, Error>;
};

function mockSupabase(options: MockOptions = {}) {
  const calls: Array<{ table: string; ids: string[] }> = [];
  const client = {
    calls,
    from(table: string) {
      const filters: Array<{ kind: "eq" | "in"; field: string; value: unknown }> = [];
      const query = {
        select(columns: string) {
          void columns;
          return query;
        },
        eq(field: string, value: unknown) {
          filters.push({ kind: "eq", field, value });
          return query;
        },
        in(field: string, values: string[]) {
          filters.push({ kind: "in", field, value: values });
          calls.push({ table, ids: [...values] });
          const error = options.errors?.[table] || null;
          const configuredRows = options.rows && table in options.rows
            ? options.rows[table]
            : [];
          const data = Array.isArray(configuredRows)
            ? configuredRows.filter((row) => filters.every((filter) => {
              if (filter.kind === "eq") return row[filter.field] === filter.value;
              return (filter.value as string[]).includes(String(row[filter.field]));
            }))
            : configuredRows;
          return Promise.resolve({ data, error });
        },
        or(filtersValue: string) {
          const ids = [...filtersValue.matchAll(/publication_id\.eq\.([^,)]+)/g)]
            .map((match) => match[1]);
          calls.push({ table, ids });
          const error = options.errors?.[table] || null;
          const configuredRows = options.rows && table in options.rows
            ? options.rows[table]
            : [];
          const data = Array.isArray(configuredRows)
            ? configuredRows.filter((row) => filters.every((filter) =>
              filter.kind === "eq" ? row[filter.field] === filter.value : true
            ))
            : configuredRows;
          return Promise.resolve({ data, error });
        },
      };
      return query;
    },
  };
  return client;
}

test("batched loader applies canonical state without per-property queries", async () => {
  const properties = Array.from({ length: 101 }, (_, index) =>
    property({ id: `property-${index}` })
  );
  const canonicalProperty = properties[100];
  const client = mockSupabase({
    rows: {
      property_channel_publications: [publication({
        property_id: canonicalProperty.id,
      })],
      property_channel_publication_versions: [version({
        property_id: canonicalProperty.id,
        payload: {
          property: {
            id: canonicalProperty.id,
            codigo: "PUBLIC-101",
            titulo: "Frozen public title",
            status: "active",
          },
        },
      })],
    },
  });

  const eligible = await filterPublicSiteEligibleProperties(
    client,
    organizationId,
    properties,
  );

  assert.equal(eligible.length, properties.length);
  assert.equal(eligible[100].code, "PUBLIC-101");
  assert.equal(eligible[100].title, "Frozen public title");
  assert.equal(
    client.calls.filter((call) => call.table === "property_channel_publications").length,
    3,
  );
  assert.equal(
    client.calls.filter((call) => call.table === "property_channel_publication_versions").length,
    1,
  );
});

test("canonical properties expose the frozen snapshot, never newer live values", async () => {
  const client = mockSupabase({
    rows: {
      property_channel_publications: [publication()],
      property_channel_publication_versions: [version()],
    },
  });
  const eligible = await filterPublicSiteEligibleProperties(
    client,
    organizationId,
    [property({
      code: "PRIVATE-DRAFT-CODE",
      title: "Unpublished edited title",
      preco: 999_999,
    })],
  );

  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].code, "PUBLIC-1");
  assert.equal(eligible[0].title, "Published title");
  assert.equal(eligible[0].preco, 500_000);
  assert.equal("created_at" in eligible[0], false);
});

test("publication and version lookup failures hide every candidate", async () => {
  const publicationFailure = mockSupabase({
    errors: { property_channel_publications: new Error("publication failure") },
  });
  assert.deepEqual(
    await filterPublicSiteEligibleProperties(
      publicationFailure,
      organizationId,
      [property()],
    ),
    [],
  );

  const versionFailure = mockSupabase({
    rows: { property_channel_publications: [publication()] },
    errors: { property_channel_publication_versions: new Error("version failure") },
  });
  assert.deepEqual(
    await filterPublicSiteEligibleProperties(
      versionFailure,
      organizationId,
      [property()],
    ),
    [],
  );

  const malformed = mockSupabase({
    rows: { property_channel_publications: null },
  });
  assert.deepEqual(
    await filterPublicSiteEligibleProperties(malformed, organizationId, [property()]),
    [],
  );
});
