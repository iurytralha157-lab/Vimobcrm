import { createClient } from "npm:@supabase/supabase-js@2";

type ClaimedNotification = {
  notification_id: string;
  claim_token: string;
  recipient: string;
  organization_id?: string;
  notification_title: string;
  notification_content: string;
  notification_metadata: Record<string, unknown> | null;
};

type NotificationTemplate = {
  organization_id: string | null;
  event_key: string | null;
  slug: string | null;
  channel: string | null;
  channels: string[] | null;
  title: string | null;
  message: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type FormattedMessage = {
  eventKey: string;
  source:
    | "pre_rendered"
    | "database_template"
    | "event_default"
    | "generic_fallback";
  text: string;
};

const jsonHeaders = { "Content-Type": "application/json" };
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) || url.username ||
    url.password || url.search || url.hash
  ) {
    throw new Error("provider_url_invalid");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const stringValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
function textValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function first(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return "";
}

function notificationVariables(metadata: Record<string, unknown>) {
  const variables: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      [
        "dispatch",
        "whatsapp_dispatch",
        "push_dispatch",
        "email_dispatch",
        "variables",
      ].includes(key)
    ) {
      continue;
    }
    variables[key] = value;
  }
  const nested = metadata.variables;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    Object.assign(variables, nested as Record<string, unknown>);
  }
  return variables;
}

function formatNotificationDate(value: unknown) {
  const raw = textValue(value);
  if (!raw) return "";

  let date: Date;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    const milliseconds = Math.abs(numeric) >= 100_000_000_000
      ? numeric
      : numeric * 1000;
    date = new Date(milliseconds);
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;

  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.day}/${values.month}/${values.year} | ${values.hour}:${values.minute}`;
}

function scheduleEventTypeLabel(...values: unknown[]) {
  const eventType = first(...values).toLowerCase();
  const labels: Record<string, string> = {
    call: "Ligação",
    email: "E-mail",
    meeting: "Reunião",
    task: "Tarefa",
    message: "Mensagem",
    visit: "Visita ao imóvel",
  };
  return labels[eventType] || first(...values);
}

function schedulePropertyText(variables: Record<string, unknown>) {
  const title = first(variables.property_title);
  const code = first(variables.property_code);
  if (title && code) return `${title} (${code})`;
  if (title || code) return first(title, code);
  return first(variables.property_id) ? "Imóvel vinculado" : "";
}

function notificationTemplateValues(variables: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (!key.startsWith("__")) values[key] = textValue(value);
  }

  const createdDate = first(
    values.lead_created_at,
    values.created_time,
    values.created_at,
    values.date,
  );
  if (createdDate) {
    const formatted = formatNotificationDate(createdDate);
    values.lead_created_at = formatted;
    values.created_time = formatted;
    values.created_at = formatted;
    values.date = formatted;
  }

  const scheduleDate = first(
    values.schedule_time,
    values.schedule_start_time,
    values.start_time,
    values.scheduled_at,
  );
  if (scheduleDate) {
    const formatted = formatNotificationDate(scheduleDate);
    values.schedule_time = formatted;
    values.schedule_start_time = formatted;
    values.start_time = formatted;
    values.scheduled_at = formatted;
    if (!values.date) values.date = formatted;
  }
  if (!values.schedule_event_type_label) {
    values.schedule_event_type_label = scheduleEventTypeLabel(
      values.schedule_event_type,
      values.event_type,
    );
  }
  if (!values.property_name) {
    values.property_name = schedulePropertyText(variables);
  }
  return values;
}

export function renderNotificationTemplate(
  template: unknown,
  variables: Record<string, unknown>,
) {
  const raw = stringValue(template);
  if (!raw) return "";
  const values = notificationTemplateValues(variables);
  const placeholder = /\{\{?\s*([A-Za-z0-9_.-]+)\s*\}\}?/g;
  const lines: string[] = [];
  for (const sourceLine of raw.split("\n")) {
    const hadPlaceholder = placeholder.test(sourceLine);
    placeholder.lastIndex = 0;
    const line = sourceLine.replace(
      placeholder,
      (_match, key: string) => values[key] || "",
    ).trim();
    placeholder.lastIndex = 0;
    if (!line || (hadPlaceholder && line.endsWith(":"))) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

function templateSupportsWhatsApp(template: NotificationTemplate) {
  return stringValue(template.channel) === "whatsapp" ||
    (Array.isArray(template.channels) &&
      template.channels.includes("whatsapp"));
}

function findNotificationTemplate(
  templates: NotificationTemplate[],
  organizationId: string,
  eventKey: string,
) {
  return templates
    .filter((template) =>
      templateSupportsWhatsApp(template) &&
      (stringValue(template.event_key) === eventKey ||
        stringValue(template.slug) === eventKey) &&
      (template.organization_id === null ||
        template.organization_id === organizationId)
    )
    .sort((left, right) => {
      const leftScope =
        organizationId && left.organization_id === organizationId ? 0 : 1;
      const rightScope =
        organizationId && right.organization_id === organizationId ? 0 : 1;
      if (leftScope !== rightScope) return leftScope - rightScope;
      const leftUpdated = Date.parse(first(left.updated_at, left.created_at)) ||
        0;
      const rightUpdated =
        Date.parse(first(right.updated_at, right.created_at)) || 0;
      return rightUpdated - leftUpdated;
    })[0];
}

function buildEventDefault(
  eventKey: string,
  title: string,
  content: string,
  variables: Record<string, unknown>,
) {
  const leadName = first(
    variables.lead_name,
    variables.leadName,
    variables.name,
  );
  const source = first(variables.source, variables.origin);
  const campaign = first(
    variables.campaign_name,
    variables.campaign,
    variables.campaignName,
  );
  const formName = first(
    variables.form_name,
    variables.formName,
    variables.form,
  );
  const pipeline = first(
    variables.pipeline_name,
    variables.pipelineName,
    variables.pipeline,
  );
  const stage = first(
    variables.stage_name,
    variables.stageName,
    variables.stage,
  );
  const actor = first(variables.actor_name, variables.actorName);
  const value = first(
    variables.valor_interesse,
    variables.interest_value,
    variables.value,
  );
  const date = formatNotificationDate(first(
    variables.created_time,
    variables.created_at,
    variables.date,
  ));
  const scheduleDate = formatNotificationDate(first(
    variables.schedule_time,
    variables.schedule_start_time,
    variables.start_time,
    variables.scheduled_at,
  ));
  const scheduleType = first(
    variables.schedule_event_type_label,
    scheduleEventTypeLabel(variables.schedule_event_type, variables.event_type),
  );
  const scheduleLead = first(
    variables.lead_name,
    variables.leadName,
    first(variables.lead_id) ? "Lead vinculado" : "",
  );
  const propertyName = schedulePropertyText(variables);
  const timeout = first(variables.timeout_minutes);
  const warning = first(variables.warning_minutes, variables.timeout_minutes);

  const lines: string[] = [];
  const appendField = (icon: string, label: string, fieldValue: unknown) => {
    const text = first(fieldValue);
    if (text) lines.push(`${icon} ${label}: ${text}`);
  };
  const appendAction = (action: string) => appendField("✅", "Ação", action);
  const appendLead = () => appendField("👤", "Nome", first(leadName, "Lead"));
  const appendPipeline = () => {
    if (pipeline && stage) {
      appendField("📌", "Pipeline", `${pipeline} / ${stage}`);
    } else appendField("📌", "Pipeline", first(pipeline, stage));
  };

  switch (eventKey) {
    case "new_lead_received":
      lines.push("🔔 NOVO LEAD");
      appendLead();
      appendField("📱", "Origem", source);
      appendField("🎯", "Campanha", campaign);
      appendField("📅", "Data", date);
      break;
    case "lead_reentry":
      lines.push("🔁 *LEAD REENTROU*");
      appendLead();
      appendField("📲", "Origem", source);
      appendField("🎯", "Campanha", campaign);
      appendField("📅", "Data", date);
      appendAction("acesse o CRM para acompanhar");
      break;
    case "lead_duplicate_existing":
      lines.push("⚠️ *LEAD JÁ EXISTIA*");
      appendLead();
      appendField(
        "👥",
        "Responsável atual",
        first(variables.assignee_name, variables.assigned_user_name),
      );
      appendField("📲", "Origem", source);
      appendAction("verifique o lead no CRM");
      break;
    case "lead_transferred":
      lines.push("🔄 *LEAD TRANSFERIDO*");
      appendLead();
      appendPipeline();
      appendField(
        "🧑‍💼",
        "Transferido de",
        first(
          variables.from_user_name,
          variables.previous_user_name,
          actor,
        ),
      );
      appendAction("acesse o CRM para atender");
      break;
    case "lead_stage_changed":
      lines.push("📌 *ETAPA ALTERADA*");
      appendLead();
      appendField(
        "➡️",
        "Etapa",
        first(stage, variables.new_stage_name, content),
      );
      appendAction("acompanhe no CRM");
      break;
    case "deal_won":
      lines.push("🏆 *LEAD GANHO*");
      appendLead();
      appendField("🤝", "Responsável", actor);
      appendField("💰", "Valor", value);
      appendAction("confira o fechamento no CRM");
      break;
    case "lead_redistribution_warning":
      lines.push("⏳ *LEAD QUASE REDISTRIBUÍDO*");
      appendLead();
      appendField("⏱️", "Prazo", warning ? `${warning} min` : "");
      appendAction("atenda antes da redistribuição");
      break;
    case "lead_redistributed_received":
      lines.push("🔄 *LEAD REDISTRIBUÍDO*");
      appendLead();
      appendField("⏱️", "Parado há", timeout ? `${timeout} min` : "");
      appendAction("acesse o CRM para atender");
      break;
    case "lead_redistributed_away": {
      lines.push("🔄 *LEAD REDISTRIBUÍDO*");
      appendLead();
      const reason = leadName && timeout
        ? `${leadName} foi redistribuído após ${timeout} minuto(s) sem atendimento.`
        : first(content, "sem atendimento no prazo");
      appendField("⏱️", "Motivo", reason);
      break;
    }
    case "whatsapp_disconnected":
      lines.push("⚠️ *WHATSAPP DESCONECTADO*");
      appendField(
        "📱",
        "Conexão",
        first(
          variables.session_name,
          variables.display_name,
          leadName,
          "WhatsApp",
        ),
      );
      appendAction("acesse Integrações para reconectar");
      break;
    case "schedule_reminder":
      lines.push("⏰ *LEMBRETE DE AGENDA*");
      appendField(
        "📌",
        "Atividade",
        first(variables.schedule_title, variables.title, title),
      );
      appendField("🧭", "Tipo", scheduleType);
      appendField("📅", "Horário", scheduleDate);
      appendField("👤", "Lead", scheduleLead);
      appendField("🏠", "Imóvel", propertyName);
      appendAction("acesse a agenda");
      break;
    case "test_push":
      lines.push("🧪 *TESTE DE NOTIFICAÇÃO*");
      lines.push(first(content, "Dispatcher do backend funcionando."));
      break;
    default:
      return "";
  }

  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

export function formatMessage(
  item: ClaimedNotification,
  templates: NotificationTemplate[],
): FormattedMessage {
  const metadata = item.notification_metadata || {};
  const variables = notificationVariables(metadata);
  const eventKey = first(metadata.event_key, "notification");
  const rendered = first(
    variables.__rendered_whatsapp_message,
    metadata.__rendered_whatsapp_message,
  );
  if (rendered) {
    return { eventKey, source: "pre_rendered", text: rendered.slice(0, 4000) };
  }

  const template = findNotificationTemplate(
    templates,
    first(item.organization_id),
    eventKey,
  );
  if (template) {
    const message = renderNotificationTemplate(template.message, variables);
    if (message) {
      return {
        eventKey,
        source: "database_template",
        text: message.slice(0, 4000),
      };
    }
  }

  const title = first(
    template ? renderNotificationTemplate(template.title, variables) : "",
    item.notification_title,
  );
  const content = stringValue(item.notification_content);
  const eventDefault = buildEventDefault(eventKey, title, content, variables);
  if (eventDefault) {
    return {
      eventKey,
      source: "event_default",
      text: eventDefault.slice(0, 4000),
    };
  }

  const generic = title && content
    ? `🔔 *${title}*\n${content}`
    : title
    ? `🔔 *${title}*`
    : first(content, "Você tem uma nova notificação no Vimob.");
  return { eventKey, source: "generic_fallback", text: generic.slice(0, 4000) };
}

function buildMessage(
  item: ClaimedNotification,
  templates: NotificationTemplate[],
) {
  return formatMessage(item, templates).text;
}

function safeProviderError(raw: string, status: number) {
  let candidate: unknown = raw;
  try {
    const data = JSON.parse(raw);
    const messages = data?.response?.message;
    if (
      Array.isArray(messages) &&
      messages.some((item: unknown) =>
        typeof item === "object" && item !== null &&
        (item as Record<string, unknown>).exists === false
      )
    ) return "recipient_not_registered";
    candidate = data?.message ?? data?.error ?? data?.response ?? raw;
  } catch {
    candidate = raw;
  }
  const text = typeof candidate === "string"
    ? candidate
    : JSON.stringify(candidate);
  const sanitized = (text || `provider_http_${status}`)
    .replace(/[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}/gi, "[id]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, 200) || `provider_http_${status}`;
}

if (Deno.env.get("NOTIFICATION_FORMAT_TEST") !== "1") {
  Deno.serve(async (req) => {
    if (req.method !== "POST") {
      return reply({ success: false, error: "method_not_allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const providerUrlRaw = Deno.env.get("EVOLUTION_API_URL") || "";
    const providerKey = Deno.env.get("EVOLUTION_API_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return reply({ success: false, error: "supabase_not_configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const internalToken = req.headers.get("x-failover-token") || "";
    const { data: validToken, error: tokenError } = await supabase.rpc(
      "validate_notification_evolution_failover_token",
      { p_token: internalToken },
    );
    if (tokenError || validToken !== true) {
      return reply({ success: false, error: "forbidden" }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { data: setting, error: settingError } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "notifications")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingError) {
      return reply({ success: false, error: "settings_unavailable" }, 503);
    }

    const whatsapp = setting?.value?.notification_dispatch?.whatsapp || {};
    const failover = whatsapp.standard_failover || {};
    const smokeTest = body.smoke_test === true;
    if (failover.enabled !== true && !smokeTest) {
      return reply({ success: true, enabled: false, claimed: 0 });
    }
    if (!providerUrlRaw || !providerKey) {
      return reply({ success: false, error: "provider_not_configured" }, 503);
    }

    let providerBase: string;
    let requestedBase: string;
    try {
      providerBase = normalizeBaseUrl(providerUrlRaw);
      requestedBase = normalizeBaseUrl(String(failover.base_url || ""));
    } catch {
      return reply({ success: false, error: "provider_url_invalid" }, 503);
    }
    if (providerBase !== requestedBase) {
      return reply({ success: false, error: "provider_url_mismatch" }, 503);
    }

    const instanceName = stringValue(failover.instance_name);
    if (!instanceName) {
      return reply({ success: false, error: "instance_missing" }, 503);
    }

    let state = "";
    try {
      const stateResponse = await fetch(
        `${providerBase}/instance/connectionState/${
          encodeURIComponent(instanceName)
        }`,
        {
          headers: { apikey: providerKey },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      const stateData = await stateResponse.json().catch(() => ({}));
      state = first(stateData?.instance?.state, stateData?.state);
      if (!stateResponse.ok || state !== "open") {
        return reply({
          success: false,
          error: "instance_not_connected",
          instance_state: state || "unknown",
        }, 503);
      }
    } catch {
      return reply({ success: false, error: "instance_probe_failed" }, 503);
    }

    const { data: templateRows, error: templateError } = await supabase
      .from("notification_templates")
      .select(
        "organization_id,event_key,slug,channel,channels,title,message,created_at,updated_at",
      )
      .or("is_active.eq.true,is_active.is.null")
      .limit(1000);
    if (templateError) {
      console.error("notification_failover_template_load_failed");
    }
    const templates = (templateRows || []) as NotificationTemplate[];

    if (smokeTest) {
      const notificationId = stringValue(body.notification_id);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(notificationId)
      ) {
        return reply(
          { success: false, error: "smoke_notification_invalid" },
          400,
        );
      }

      const { data: notification, error: notificationError } = await supabase
        .from("notifications")
        .select("user_id,organization_id,title,content,body,metadata")
        .eq("id", notificationId)
        .maybeSingle();
      if (notificationError || !notification?.user_id) {
        return reply({
          success: false,
          error: "smoke_notification_unavailable",
        }, 404);
      }

      const { data: recipientUser, error: recipientError } = await supabase
        .from("users")
        .select("whatsapp")
        .eq("id", notification.user_id)
        .maybeSingle();
      const recipient = stringValue(recipientUser?.whatsapp).replace(/\D/g, "");
      if (recipientError || recipient.length < 10 || recipient.length > 15) {
        return reply({ success: false, error: "smoke_recipient_invalid" }, 400);
      }

      const smokeItem: ClaimedNotification = {
        notification_id: notificationId,
        claim_token: "smoke_test",
        recipient,
        organization_id: first(notification.organization_id),
        notification_title: first(notification.title),
        notification_content: first(notification.content, notification.body),
        notification_metadata: notification.metadata || null,
      };
      const formattedSmoke = formatMessage(smokeItem, templates);
      if (body.preview_only === true) {
        return reply({
          success: true,
          smoke_test: true,
          preview_only: true,
          event_key: formattedSmoke.eventKey,
          template_source: formattedSmoke.source,
          message: formattedSmoke.text,
        });
      }

      try {
        const sendResponse = await fetch(
          `${providerBase}/message/sendText/${
            encodeURIComponent(instanceName)
          }`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: providerKey,
            },
            body: JSON.stringify({
              number: recipient,
              text: formattedSmoke.text,
            }),
            signal: AbortSignal.timeout(15000),
            redirect: "error",
          },
        );
        const responseText = await sendResponse.text();
        if (!sendResponse.ok) {
          return reply({
            success: false,
            smoke_test: true,
            provider: "evolution_v2",
            instance_state: state,
            http_status: sendResponse.status,
            error: safeProviderError(responseText, sendResponse.status),
          }, 502);
        }
        return reply({
          success: true,
          smoke_test: true,
          provider: "evolution_v2",
          instance_state: state,
          http_status: sendResponse.status,
        });
      } catch {
        return reply({
          success: false,
          smoke_test: true,
          provider: "evolution_v2",
          instance_state: state,
          error: "delivery_outcome_unknown",
        }, 502);
      }
    }

    if (body.probe_only === true) {
      return reply({
        success: true,
        enabled: true,
        provider: "evolution_v2",
        instance_state: state,
      });
    }

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_notification_evolution_failover",
      { p_limit: 10 },
    );
    if (claimError) {
      return reply({ success: false, error: "claim_failed" }, 500);
    }

    const items = (claimed || []) as ClaimedNotification[];
    if (items.length > 0) {
      const notificationIds = items.map((item) => item.notification_id);
      const { data: contexts, error: contextError } = await supabase
        .from("notifications")
        .select("id,organization_id")
        .in("id", notificationIds);
      if (contextError) {
        console.error("notification_failover_context_load_failed");
      } else {
        const organizations = new Map(
          (contexts || []).map((
            context,
          ) => [stringValue(context.id), stringValue(context.organization_id)]),
        );
        for (const item of items) {
          item.organization_id = organizations.get(item.notification_id) || "";
        }
      }
    }
    let sent = 0;
    let failed = 0;
    let retrying = 0;
    const errors: string[] = [];

    for (let offset = 0; offset < items.length; offset += 2) {
      const batch = items.slice(offset, offset + 2);
      await Promise.all(batch.map(async (item) => {
        let ok = false;
        let status = 0;
        let retryable = false;
        let errorCode = "";
        try {
          const sendResponse = await fetch(
            `${providerBase}/message/sendText/${
              encodeURIComponent(instanceName)
            }`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: providerKey,
              },
              body: JSON.stringify({
                number: item.recipient.replace(/\D/g, ""),
                text: buildMessage(item, templates),
              }),
              signal: AbortSignal.timeout(15000),
              redirect: "error",
            },
          );
          status = sendResponse.status;
          ok = sendResponse.ok;
          const responseText = await sendResponse.text();
          if (!ok) {
            retryable = status === 429;
            errorCode = status === 429
              ? "provider_rate_limited"
              : safeProviderError(responseText, status);
            errors.push(errorCode);
          }
        } catch {
          errorCode = "delivery_outcome_unknown";
          errors.push(errorCode);
        }

        const { error: markError } = await supabase.rpc(
          "mark_notification_evolution_failover_result",
          {
            p_notification_id: item.notification_id,
            p_claim_token: item.claim_token,
            p_success: ok,
            p_http_status: status,
            p_error: errorCode,
            p_retryable: retryable,
            p_instance_name: instanceName,
          },
        );

        if (markError) {
          console.error(
            "notification_failover_mark_failed",
            item.notification_id,
          );
          failed++;
        } else if (ok) {
          sent++;
        } else if (retryable) {
          retrying++;
        } else {
          failed++;
        }
      }));
    }

    return reply({
      success: failed === 0,
      enabled: true,
      claimed: items.length,
      sent,
      failed,
      retrying,
      errors: [...new Set(errors)].slice(0, 5),
    });
  });
}
