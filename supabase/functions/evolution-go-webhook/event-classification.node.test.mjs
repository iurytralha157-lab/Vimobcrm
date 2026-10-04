import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

function extractFunction(startName, endName) {
  const start = source.indexOf(`function ${startName}(`);
  const end = source.indexOf(`function ${endName}(`, start);
  assert.ok(start >= 0 && end > start, `${startName} source boundary is missing`);
  return stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });
}

const buttonChoice = new Function(
  "firstPresent",
  `${extractFunction("extractButtonChoice", "extractContent")}\nreturn extractButtonChoice;`,
)(firstPresent);
const extractContent = new Function(
  "firstPresent",
  "extractButtonChoice",
  `${extractFunction("extractContent", "extractDeletedMessageId")}\nreturn extractContent;`,
)(firstPresent, buttonChoice);
const ignoreReason = new Function(
  "extractMessages",
  "normalizeMessage",
  "extractButtonChoice",
  "getMessageNode",
  `${extractFunction("technicalEvolutionIgnoreReason", "getMessageNode")}\nreturn technicalEvolutionIgnoreReason;`,
)(
  (payload) => payload.data ? [{ rawMessage: payload.data, envelope: null }] : [],
  (raw) => raw.jid ? { fromMe: raw.fromMe === true, isGroup: false, messageType: "text" } : null,
  buttonChoice,
  (raw) => raw.message || raw,
);
const normalizeStatus = new Function(
  "firstPresent",
  "extractQr",
  `${extractFunction("normalizeStatus", "extractQr")}\nreturn normalizeStatus;`,
)(firstPresent, () => null);

test("technical receipt and empty button callbacks have no customer message", () => {
  assert.equal(ignoreReason({ event: "ReadSelf" }, "readself"), "technical_read_self");
  assert.equal(ignoreReason({ data: { jid: "5511999991111@s.whatsapp.net" } }, "buttonclick"), "technical_button_click");
  assert.equal(ignoreReason({ data: { jid: "5511999991111@s.whatsapp.net", fromMe: true, buttonText: "Suporte" } }, "buttonclick"), "technical_button_click");
});

test("customer ButtonClick text or id is stored as message content", () => {
  for (const choice of [{ buttonText: "Suporte tecnico" }, { buttonId: "support" }]) {
    const raw = { jid: "5511999991111@s.whatsapp.net", fromMe: false, ...choice };
    assert.equal(ignoreReason({ data: raw }, "buttonclick"), null);
    assert.equal(extractContent(raw, raw, {}), Object.values(choice)[0]);
  }
  assert.equal(buttonChoice({ selectedDisplayText: "Visita" }, {}), "Visita");
});

test("loggedout state is a disconnection", () => {
  assert.equal(normalizeStatus({ data: { state: "loggedout" } }), "disconnected");
  assert.ok(source.includes(String.raw`event.replace(/[.\s_-]/g, "") === "loggedout"`));
});
