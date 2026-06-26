type AsaasCustomer = {
  id: string;
};

type EnsureAsaasCustomerInput = {
  existingCustomerId?: string | null;
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
};

type EnsureAsaasCustomerResult = {
  ok: boolean;
  customerId?: string;
  skipped?: boolean;
  message?: string;
};

function onlyDigits(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

function normalizeAsaasPhone(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.startsWith("55") && digits.length > 11) {
    return digits.slice(2);
  }

  return digits;
}

async function asaasRequest<T>(path: string, init: RequestInit = {}) {
  const apiKey = process.env.ASAAS_API_KEY;
  const baseUrl = process.env.ASAAS_BASE_URL || "https://api.asaas.com/v3";

  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      message: "ASAAS_API_KEY nao configurada.",
    } as const;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.description ||
      payload?.message ||
      `ASAAS retornou status ${response.status}.`;

    throw new Error(message);
  }

  return { ok: true, data: payload as T } as const;
}

export async function ensureAsaasCustomer(
  input: EnsureAsaasCustomerInput,
): Promise<EnsureAsaasCustomerResult> {
  const payload = {
    name: input.name,
    email: input.email,
    cpfCnpj: onlyDigits(input.cpfCnpj),
    mobilePhone: normalizeAsaasPhone(input.phone),
    notificationDisabled: true,
  };

  const response = await asaasRequest<AsaasCustomer>(
    input.existingCustomerId ? `/customers/${input.existingCustomerId}` : "/customers",
    {
      method: input.existingCustomerId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return response;
  }

  return {
    ok: true,
    customerId: input.existingCustomerId || response.data.id,
  };
}
