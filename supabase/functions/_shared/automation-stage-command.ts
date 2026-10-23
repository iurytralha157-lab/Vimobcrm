type StageCommandIdentity = {
  organizationId: string;
  executionId: string;
  nodeKey: string;
  leaseToken: string;
  effectKey: string;
};

export class AutomationStageCommandError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "AutomationStageCommandError";
    this.code = code;
    this.retryable = retryable;
  }
}

function unavailable(): AutomationStageCommandError {
  return new AutomationStageCommandError("automation_command_unavailable", true);
}

export function stageCommandURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw unavailable();
  }
  return new URL("/v1/internal/automations/stage-command", url);
}

async function responseJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let source = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw unavailable();
      source += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(source + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw unavailable();
    return body as Record<string, unknown>;
  } catch { throw unavailable(); }
  finally { await reader.cancel().catch(() => undefined); }
}

// The API loads destination/reason from the immutable graph. No lead payload or
// browser-supplied capability crosses this boundary. The effect key survives an
// ambiguous timeout so its replay can return the original committed result.
export async function invokeAutomationStageCommand(
  identity: StageCommandIdentity,
  configuration: { apiURL: string; token: string },
  fetchImplementation: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!configuration.token.trim()) throw unavailable();
  const url = stageCommandURL(configuration.apiURL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Internal-Token": configuration.token },
        body: JSON.stringify(identity),
      });
    } catch { throw unavailable(); }
    if (response.status === 429 || response.status >= 500) throw unavailable();
    const data = await responseJSON(response);
    if (!response.ok) {
      const error = data.error as { code?: unknown } | undefined;
      const code = typeof error?.code === "string" && /^[a-z_]{1,100}$/.test(error.code)
        ? error.code : "automation_command_rejected";
      throw new AutomationStageCommandError(code, code === "automation_command_retryable");
    }
    if (data.ok !== true || data.status !== "succeeded" || typeof data.effect_id !== "string" ||
      !data.response || typeof data.response !== "object" || Array.isArray(data.response)) {
      throw unavailable();
    }
    return data;
  } finally { clearTimeout(timer); }
}

export async function deferAutomationStageCommand(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  identity: StageCommandIdentity,
  stepId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("defer_automation_stage_command", {
    p_organization_id: identity.organizationId, p_execution_id: identity.executionId,
    p_step_id: stepId, p_node_key: identity.nodeKey, p_lease_token: identity.leaseToken,
  });
  if (error) throw unavailable();
  const result = data as { ok?: unknown; status?: unknown } | null;
  return result?.ok === true && ["queued", "failed"].includes(String(result.status));
}
