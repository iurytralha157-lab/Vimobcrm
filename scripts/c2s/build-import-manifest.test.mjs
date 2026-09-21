import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildImportManifest,
  canonicalStringify,
  classifyAgainstSnapshot,
  createSnapshotIndex,
  deterministicEntityId,
  parseSourceDate,
  sha256Canonical,
  uuidV5,
} from "./build-import-manifest.mjs";

const ORG_ID = "002c6b70-239d-4d32-a270-0dec3fbb6b17";
const PIPELINE_ID = "decb1128-a678-4886-bb6b-5b94f6ebca20";
const NEW_STAGE_ID = "6512ec17-0fa6-4b36-8a12-2a6a13320376";
const OWNER_A_ID = "838ad6e5-e895-426d-a41d-0a0e0079d756";
const OWNER_B_ID = "d0ae545a-fc22-498c-8e0d-fc42fc1327c2";

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeNdjson(file, values) {
  await writeFile(file, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sealFixture(root) {
  const requiredPaths = [
    "mappings/owners.json",
    "mappings/status.json",
    "normalized/leads.ndjson",
    "normalized/events.ndjson",
    "normalized/chat.ndjson",
  ];
  const files = [];
  for (const relativePath of requiredPaths) {
    const value = await readFile(path.join(root, ...relativePath.split("/")));
    files.push({ path: relativePath, bytes: value.length, sha256: sha256(value) });
  }
  const manifestText = `${JSON.stringify({
    schema_version: 1,
    sealed_at_utc: "2026-09-21T11:03:52.631038+00:00",
    files,
  }, null, 2)}\n`;
  await writeFile(path.join(root, "manifest.json"), manifestText, "utf8");
  await writeFile(
    path.join(root, "manifest.sha256"),
    `${sha256(Buffer.from(manifestText, "utf8"))}  manifest.json\n`,
    "utf8",
  );
}

function sourceLead({ id, owner, name, phone }) {
  const externalKey = `contact2sale:Atmos Gestora Imobiliaria:lead:${id}`;
  return {
    schema_version: 1,
    external_key: externalKey,
    source_system: "contact2sale",
    source_company: "Atmos Gestora Imobiliaria",
    source_lead_id: id,
    source_presence: "xlsx_and_ui",
    history_chunk: "raw/test.json",
    xlsx_primary_row: 1,
    xlsx_associations: [
      {
        row_number: 1,
        team: "Atmos Gestora Imobiliaria",
        owner,
        status: "Novo",
        updated_at: "03/04/2025 15:45:31",
      },
    ],
    current: {
      name,
      email: `${id}@example.invalid`,
      phone,
      phone2: "",
      city: "Cidade",
      neighbourhood: "Bairro",
      source: "Planilha",
      channel: "Planilha",
      owner_source: owner,
      team_source: "Atmos Gestora Imobiliaria",
      status_source: "Novo",
      observation: `Observacao ${id}`,
      created_at_source: "02/04/2025 14:44:31",
      received_at_raw: "Recebido em 02 de Abril, 14:44 de 2025",
      interacted_at_raw: "Interagido em 02 de Abril, 16:01 de 2025",
      interest_raw: "Interesse",
      tags_source: [],
    },
    target: {
      organization_id: ORG_ID,
      pipeline_id: PIPELINE_ID,
    },
    counts: { action_log: 1, chat: 1 },
    extraction: { fetched_at: "2026-09-21T10:34:26.231Z" },
  };
}

function sourceEvent(id, sequence = 1) {
  return {
    schema_version: 1,
    external_key: `contact2sale:Atmos Gestora Imobiliaria:history:${id}:event-${sequence}`,
    identity_confidence: "derived",
    source_lead_id: id,
    sequence,
    author_source: "Operador",
    time_raw: "20/09 10:11:12",
    message: `Evento ${id}`,
    raw_text: `Evento bruto ${id}`,
    payload_sha256: "a".repeat(64),
  };
}

function sourceChat(id, sequence = 1) {
  return {
    schema_version: 1,
    external_key: `contact2sale:Atmos Gestora Imobiliaria:chat:${id}:chat-${sequence}`,
    identity_confidence: "derived",
    source_lead_id: id,
    sequence,
    direction: "inbound",
    author_source: "Contato",
    time_raw: "14:44 02/04/25",
    message: `Mensagem ${id}`,
    media: [],
    payload_sha256: "b".repeat(64),
  };
}

async function createFixture(root) {
  await mkdir(path.join(root, "mappings"), { recursive: true });
  await mkdir(path.join(root, "normalized"), { recursive: true });
  await writeJson(path.join(root, "mappings", "owners.json"), [
    {
      source_owner: "Dono Exato",
      target_id: OWNER_A_ID,
      target_name: "Dono Exato",
      mapping_status: "EXACT",
      confidence: "exact",
    },
    {
      source_owner: "Alias Proposto",
      target_id: OWNER_B_ID,
      target_name: "Dono Dois",
      mapping_status: "PROPOSED_ALIAS",
      confidence: "probable",
    },
    {
      source_owner: "Sem Dono",
      target_id: null,
      target_name: null,
      mapping_status: "UNRESOLVED",
      confidence: "none",
    },
  ]);
  await writeJson(path.join(root, "mappings", "status.json"), {
    Novo: {
      target_stage_id: NEW_STAGE_ID,
      target_stage: "Novo",
      target_deal_status: "open",
      status: "READY",
    },
  });
  await writeNdjson(path.join(root, "normalized", "leads.ndjson"), [
    sourceLead({ id: "100", owner: "Dono Exato", name: "Pessoa Um", phone: "(27) 99999-0000" }),
    sourceLead({ id: "200", owner: "Alias Proposto", name: "Pessoa Dois", phone: "(27) 99999-0000" }),
    sourceLead({ id: "400", owner: "Dono Exato", name: "Pessoa Quatro", phone: "(27) 97777-0000" }),
    sourceLead({ id: "300", owner: "Sem Dono", name: "Pessoa Tres", phone: "(27) 98888-0000" }),
  ]);
  await writeNdjson(path.join(root, "normalized", "events.ndjson"), [
    sourceEvent("100"),
    sourceEvent("200"),
    { ...sourceEvent("400"), message: "O status foi alterado para Novo por Operador" },
    sourceEvent("300"),
  ]);
  await writeNdjson(path.join(root, "normalized", "chat.ndjson"), [
    sourceChat("100"),
    sourceChat("200"),
    { ...sourceChat("400"), message: "" },
    sourceChat("300"),
  ]);
  await sealFixture(root);
}

test("canonical JSON and UUIDv5 are stable", () => {
  assert.equal(
    canonicalStringify({ z: 1, a: { y: 2, x: 3 } }),
    '{"a":{"x":3,"y":2},"z":1}',
  );
  assert.equal(
    sha256Canonical({ b: 2, a: 1 }),
    sha256Canonical({ a: 1, b: 2 }),
  );
  assert.equal(
    uuidV5("www.widgets.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
    "21f7f8de-8051-5b89-8680-0195ef798b6a",
  );
  assert.equal(
    deterministicEntityId(ORG_ID, "contact2sale:lead:1"),
    deterministicEntityId(ORG_ID, "contact2sale:lead:1"),
  );
  assert.notEqual(
    deterministicEntityId(ORG_ID, "contact2sale:lead:1"),
    deterministicEntityId(ORG_ID, "contact2sale:lead:2"),
  );
});

test("source dates retain raw values and document inference", () => {
  const explicit = parseSourceDate("25/04/25 23:52:22", {
    extractedAt: "2026-09-21T10:00:00Z",
    sourceField: "time_raw",
  });
  assert.equal(explicit.value, "2025-04-25T23:52:22-03:00");
  assert.equal(explicit.method, "explicit_two_digit_year");
  assert.equal(explicit.raw, "25/04/25 23:52:22");

  const inferred = parseSourceDate("20/09 10:11:12", {
    extractedAt: "2026-09-21T10:00:00Z",
    sourceField: "time_raw",
  });
  assert.equal(inferred.value, "2026-09-20T10:11:12-03:00");
  assert.equal(inferred.method, "year_inferred_from_extraction_calendar");
  assert.equal(inferred.inferred_year, 2026);
  assert.equal(inferred.raw, "20/09 10:11:12");

  const priorYear = parseSourceDate("31/12 10:11:12", {
    extractedAt: "2026-09-21T10:00:00Z",
  });
  assert.equal(priorYear.value, "2025-12-31T10:11:12-03:00");
});

test("destination comparison yields CREATE, NOOP, DRIFT and CONFLICT", () => {
  const base = {
    entity_type: "lead",
    target_id: deterministicEntityId(ORG_ID, "lead:1"),
    external_key: "lead:1",
    payload_sha256: sha256Canonical({ name: "A" }),
  };
  assert.equal(classifyAgainstSnapshot(base, createSnapshotIndex([])).action, "CREATE");
  assert.equal(
    classifyAgainstSnapshot(
      base,
      createSnapshotIndex([{ ...base, id: base.target_id }]),
    ).action,
    "NOOP",
  );
  assert.equal(
    classifyAgainstSnapshot(
      base,
      createSnapshotIndex([{ ...base, id: base.target_id, payload_sha256: "0".repeat(64) }]),
    ).action,
    "DRIFT",
  );
  assert.equal(
    classifyAgainstSnapshot(
      base,
      createSnapshotIndex([{ ...base, id: OWNER_A_ID }]),
    ).action,
    "CONFLICT",
  );
});

test("builder excludes unresolved owners and preserves same-phone cards and selected history", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-builder-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const input = path.join(temporaryRoot, "input");
  const output = path.join(temporaryRoot, "output");
  const repeatedOutput = path.join(temporaryRoot, "output-repeat");
  await createFixture(input);

  const result = await buildImportManifest({
    inputDir: input,
    outputDir: output,
    batchRecordLimit: 1,
    batchByteLimit: 128 * 1024,
    expected: { selectedLeads: 3, excludedLeads: 1, events: 3, chat: 3 },
  });

  assert.equal(result.report.state, "READY");
  assert.deepEqual(result.report.selected_counts, { leads: 3, events: 3, chat: 3 });
  assert.equal(result.report.source_counts.excluded_unresolved, 1);
  assert.equal(result.report.owner_mapping_counts.PROPOSED_ALIAS, 1);
  assert.equal(result.report.phone_identity_audit.duplicate_phone_groups, 1);
  assert.equal(result.report.phone_identity_audit.leads_in_duplicate_phone_groups, 2);
  assert.equal(result.report.phone_identity_audit.distinct_source_lead_ids_preserved, true);
  assert.equal(result.report.canary.state, "READY");
  assert.deepEqual(result.report.canary.observed_counts, { lead: 1, event: 1, chat: 1 });
  assert.ok(result.report.canary.selection.event_count >= 1);
  assert.ok(result.report.canary.selection.chat_count >= 1);
  assert.deepEqual(result.report.entity_reports.lead.actions, {
    CREATE: 3,
    NOOP: 0,
    DRIFT: 0,
    CONFLICT: 0,
  });
  assert.deepEqual(result.report.timestamp_audit.resolution_counts, {
    latest_matching_status_event: 1,
    xlsx_primary_updated_at_matching_current_status_fallback: 2,
  });
  assert.equal(result.report.timestamp_audit.fields.updated_at.resolved, 3);
  assert.equal(
    result.report.entity_reports.chat.issue_counts.EMPTY_CHAT_CONTENT_PLACEHOLDER_APPLIED,
    1,
  );

  const leadBatchFiles = result.manifest.batches.filter((entry) => entry.entity_type === "lead");
  assert.equal(leadBatchFiles.length, 3);
  const leadRecords = [];
  for (const batch of leadBatchFiles) {
    assert.ok(batch.records <= 1);
    assert.ok(batch.bytes <= 128 * 1024);
    const document = JSON.parse(await readFile(path.join(output, batch.path), "utf8"));
    leadRecords.push(...document.records);
  }
  const repeatedPhoneRecords = leadRecords.filter(
    (record) => record.payload.phone === "+5527999990000",
  );
  assert.equal(repeatedPhoneRecords.length, 2);
  assert.notEqual(repeatedPhoneRecords[0].target_id, repeatedPhoneRecords[1].target_id);
  assert.equal(leadRecords.every((record) => record.validation.ok), true);
  assert.equal(leadRecords.every((record) => record.payload.notification_policy === "suppress_all"), true);
  assert.equal(leadRecords.every((record) => record.payload.historical_import === true), true);
  assert.equal(
    leadRecords.every((record) => record.payload.updated_at === "2026-09-20T10:11:12-03:00"),
    true,
  );
  const eventBackedLead = leadRecords.find((record) => record.payload.source_lead_id === "400");
  const xlsxBackedLead = leadRecords.find((record) => record.payload.source_lead_id === "100");
  assert.equal(eventBackedLead.payload.stage_entered_at, "2026-09-20T10:11:12-03:00");
  assert.equal(
    eventBackedLead.payload.metadata.timestamp_provenance.stage_entered_at.rule,
    "latest_matching_status_event",
  );
  assert.equal(xlsxBackedLead.payload.stage_entered_at, "2025-04-03T15:45:31-03:00");
  assert.equal(
    xlsxBackedLead.payload.metadata.timestamp_provenance.stage_entered_at.rule,
    "xlsx_primary_updated_at_matching_current_status_fallback",
  );

  const chatRecords = [];
  for (const batch of result.manifest.batches.filter((entry) => entry.entity_type === "chat")) {
    const document = JSON.parse(await readFile(path.join(output, batch.path), "utf8"));
    chatRecords.push(...document.records);
  }
  const emptySourceChat = chatRecords.find((record) => record.payload.source_lead_id === "400");
  assert.equal(emptySourceChat.payload.message, "[Mensagem sem conteúdo no C2S]");
  assert.equal(emptySourceChat.payload.metadata.source_message_empty, true);
  assert.equal(emptySourceChat.payload.metadata.source_message_raw, "");
  assert.equal(emptySourceChat.validation.state, "READY");

  const eventBatch = result.manifest.batches.find((entry) => entry.entity_type === "event");
  const eventDocument = JSON.parse(await readFile(path.join(output, eventBatch.path), "utf8"));
  assert.equal(eventDocument.records[0].payload.event_at, "2026-09-20T10:11:12-03:00");
  assert.equal(eventDocument.records[0].payload.time_raw, "20/09 10:11:12");
  assert.equal(
    eventDocument.records[0].payload.metadata.event_at_resolution.method,
    "year_inferred_from_extraction_calendar",
  );

  const reportText = await readFile(path.join(output, "dry-run-report.json"), "utf8");
  for (const privateValue of [
    "Pessoa Um",
    "Pessoa Dois",
    "(27) 99999-0000",
    "100@example.invalid",
    "200@example.invalid",
  ]) {
    assert.equal(reportText.includes(privateValue), false, privateValue);
  }

  await buildImportManifest({
    inputDir: input,
    outputDir: repeatedOutput,
    batchRecordLimit: 1,
    batchByteLimit: 128 * 1024,
    expected: { selectedLeads: 3, excludedLeads: 1, events: 3, chat: 3 },
  });
  assert.equal(
    await readFile(path.join(output, "manifest.json"), "utf8"),
    await readFile(path.join(repeatedOutput, "manifest.json"), "utf8"),
  );
});

test("approved data-quality policy preserves raw values without inventing personal identity", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vimob-c2s-quality-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const input = path.join(temporaryRoot, "input");
  const output = path.join(temporaryRoot, "output");
  await createFixture(input);
  await writeNdjson(path.join(input, "normalized", "leads.ndjson"), [
    sourceLead({ id: "100", owner: "Dono Exato", name: "", phone: "(27) 99999-0000" }),
    sourceLead({ id: "200", owner: "Alias Proposto", name: "X", phone: "999999999" }),
    sourceLead({ id: "300", owner: "Sem Dono", name: "Pessoa Tres", phone: "(27) 98888-0000" }),
  ]);
  await sealFixture(input);

  const result = await buildImportManifest({
    inputDir: input,
    outputDir: output,
    applyApprovedDataQualityPolicy: true,
    expected: { selectedLeads: 2, excludedLeads: 1, events: 2, chat: 2 },
  });
  assert.equal(result.report.state, "READY");
  assert.equal(result.report.entity_reports.lead.blocked, 0);
  assert.equal(result.report.entity_reports.lead.issue_counts.EMPTY_NAME_NEUTRAL_LABEL_APPLIED, 1);
  assert.equal(result.report.entity_reports.lead.issue_counts.ONE_CHARACTER_NAME_PRESERVED, 1);
  assert.equal(result.report.entity_reports.lead.issue_counts.INVALID_PHONE_STORED_AS_RAW_ONLY, 1);

  const records = [];
  for (const batch of result.manifest.batches.filter((entry) => entry.entity_type === "lead")) {
    const document = JSON.parse(await readFile(path.join(output, batch.path), "utf8"));
    records.push(...document.records);
  }
  const neutral = records.find((record) => record.payload.source_lead_id === "100");
  const preserved = records.find((record) => record.payload.source_lead_id === "200");
  assert.equal(neutral.payload.name, "Sem nome (C2S 100)");
  assert.equal(neutral.payload.metadata.name_raw, "");
  assert.equal(preserved.payload.name, "X");
  assert.equal(preserved.payload.phone, null);
  assert.equal(preserved.payload.metadata.phone_raw, "999999999");
  assert.equal(neutral.payload.metadata.data_quality_warning, true);
  assert.equal(preserved.payload.metadata.data_quality_warning, true);
});
