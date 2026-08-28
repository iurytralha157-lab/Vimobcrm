import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), ".env.local");
const shouldWrite = process.argv.includes("--write");

const sections = [
  [
    "Web (valores NEXT_PUBLIC_ ficam expostos no bundle)",
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_VIMOB_API_URL",
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_BILLING_ACCESS_BYPASS",
    ],
  ],
  [
    "Aplicação e API local",
    [
      "APP_PUBLIC_URL",
      "VIMOB_API_URL",
      "API_ENV",
      "API_HOST",
      "API_PORT",
      "API_LOG_LEVEL",
      "API_CORS_ALLOWED_ORIGINS",
      "API_TRUSTED_PROXY_CIDRS",
    ],
  ],
  [
    "Supabase e autenticação (somente servidor, exceto NEXT_PUBLIC_ acima)",
    [
      "SUPABASE_URL",
      "SUPABASE_PROJECT_URL",
      "SUPABASE_JWKS_URL",
      "SUPABASE_JWT_ISSUER",
      "SUPABASE_JWT_AUDIENCE",
      "SUPABASE_JWT_SECRET",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  ],
  [
    "Banco de dados",
    [
      "DATABASE_URL",
      "DATABASE_MAX_CONNS",
      "DATABASE_MIN_CONNS",
      "DATABASE_MAX_CONN_LIFETIME",
      "DATABASE_MAX_CONN_IDLE_TIME",
      "DATABASE_HEALTH_TIMEOUT",
      "DATABASE_STARTUP_RETRY_TIMEOUT",
      "DATABASE_STARTUP_RETRY_INTERVAL",
    ],
  ],
  [
    "E-mail",
    [
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "RESEND_REPLY_TO",
      "RESEND_WEBHOOK_SECRET",
      "EMAIL_ASSET_BASE_URL",
      "EMAIL_INTERNAL_SECRET",
      "SUPPORT_EMAIL",
      "PUBLIC_SIGNUP_RECOVERY_SECRET",
    ],
  ],
  [
    "OpenAI e IA",
    [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL",
      "OPENAI_TEXT_MODEL",
      "OPENAI_REALTIME_MODEL",
      "OPENAI_REALTIME_VOICE",
      "AI_AUTOREPLY_TOKEN",
    ],
  ],
  [
    "Asaas",
    [
      "ASAAS_API_KEY",
      "ASAAS_BASE_URL",
      "ASAAS_WEBHOOK_TOKEN",
      "ASAAS_RECONCILIATION_ENABLED",
    ],
  ],
  [
    "WhatsApp e Evolution Go",
    [
      "EVOLUTION_GO_API_URL",
      "EVOLUTION_GO_API_KEY",
      "EVOLUTION_GO_WEBHOOK_URL",
      "EVOLUTION_GO_BACKEND_WEBHOOK_URL",
      "WHATSAPP_WEBHOOK_PROCESSOR_MODE",
      "WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS",
    ],
  ],
  [
    "Web Push",
    [
      "WEB_PUSH_VAPID_PUBLIC_KEY",
      "WEB_PUSH_VAPID_PRIVATE_KEY",
      "WEB_PUSH_VAPID_SUBJECT",
    ],
  ],
  [
    "Workers locais (fail-closed)",
    [
      "NOTIFICATION_DISPATCH_WORKER_ENABLED",
      "AUTOMATION_RUNTIME_WORKER_ENABLED",
      "PROPERTY_DEVELOPMENT_RESERVATION_WORKER_ENABLED",
      "PROPERTY_PUBLICATION_WORKER_ENABLED",
      "GRUPO_OLX_IMPORT_REPORT_WORKER_ENABLED",
      "WHATSAPP_AI_WORKER_ENABLED",
      "WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED",
      "WHATSAPP_OUTBOX_WORKER_ENABLED",
      "WHATSAPP_WEBHOOK_WORKER_ENABLED",
      "WHATSAPP_SESSION_SUPERVISOR_ENABLED",
      "META_CONVERSION_FEEDBACK_WORKER_ENABLED",
      "META_WEBHOOK_WORKER_ENABLED",
    ],
  ],
];

function unquote(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      return value.slice(1, -1).replaceAll("\\$", "$");
    }
  }
  return value.replaceAll("\\$", "$");
}

function renderValue(rawValue) {
  const value = unquote(rawValue);
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("multiline_env_value_is_not_supported");
  }
  if (value.includes("$") && !value.includes("'")) {
    return `'${value.replaceAll("$", "\\$")}'`;
  }
  return rawValue.trim();
}

function readEntries(source) {
  const entries = new Map();
  const duplicates = [];

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) throw new Error(`invalid_env_line:${index + 1}`);

    const [, key, rawValue] = match;
    if (entries.has(key)) duplicates.push(key);
    entries.set(key, rawValue);
  }

  if (duplicates.length > 0) {
    throw new Error(`duplicate_env_keys:${[...new Set(duplicates)].sort().join(",")}`);
  }
  return entries;
}

const source = fs.readFileSync(target, "utf8");
const entries = readEntries(source);
const originalCount = entries.size;
const removedKeys = [];

function dropWhen(key, predicate) {
  if (!entries.has(key) || !predicate(entries.get(key))) return;
  entries.delete(key);
  removedKeys.push(key);
}

dropWhen("DIRECT_URL", () => true);
dropWhen("SUPABASE_PUBLISHABLE_KEY", (raw) =>
  entries.has("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
  unquote(raw) === unquote(entries.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
);
dropWhen("SUPABASE_SERVICE_ROLE_KEY", (raw) =>
  entries.has("SUPABASE_SECRET_KEY") &&
  unquote(raw).startsWith("sb_secret_") &&
  unquote(raw) === unquote(entries.get("SUPABASE_SECRET_KEY")),
);
dropWhen("SUPABASE_JWT_SECRET", (raw) => unquote(raw) === "");
dropWhen("NEXT_PUBLIC_VAPID_PUBLIC_KEY", (raw) =>
  entries.has("WEB_PUSH_VAPID_PUBLIC_KEY") &&
  unquote(raw) === unquote(entries.get("WEB_PUSH_VAPID_PUBLIC_KEY")),
);

const addedKeys = [];
if (!entries.has("NOTIFICATION_DISPATCH_WORKER_ENABLED")) {
  entries.set("NOTIFICATION_DISPATCH_WORKER_ENABLED", "false");
  addedKeys.push("NOTIFICATION_DISPATCH_WORKER_ENABLED");
}

const emitted = new Set();
const output = [
  "# Vimob CRM — ambiente local real",
  "# Arquivo sensível e ignorado pelo Git/Docker. Nunca copie para documentação.",
];
const quotedDollarKeys = [];

function emitEntry(key) {
  if (!entries.has(key)) return;
  const rawValue = entries.get(key);
  const renderedValue = renderValue(rawValue);
  if (renderedValue !== rawValue.trim() && unquote(rawValue).includes("$")) {
    quotedDollarKeys.push(key);
  }
  output.push(`${key}=${renderedValue}`);
  emitted.add(key);
}

for (const [title, keys] of sections) {
  const present = keys.filter((key) => entries.has(key));
  if (present.length === 0) continue;
  output.push("", `# ${title}`);
  for (const key of present) emitEntry(key);
}

const remaining = [...entries.keys()].filter((key) => !emitted.has(key)).sort();
if (remaining.length > 0) {
  output.push("", "# Outras integrações/configurações");
  for (const key of remaining) emitEntry(key);
}

const normalized = `${output.join("\n")}\n`;
if (shouldWrite) fs.writeFileSync(target, normalized, { encoding: "utf8", mode: 0o600 });

process.stdout.write(`${JSON.stringify({
  target: ".env.local",
  mode: shouldWrite ? "write" : "check",
  keysBefore: originalCount,
  keysAfter: entries.size,
  removedKeys: removedKeys.sort(),
  addedKeys: addedKeys.sort(),
  quotedDollarKeys: quotedDollarKeys.sort(),
  unclassifiedKeys: remaining,
})}\n`);
