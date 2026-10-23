import { z } from "zod";

const propertyCepResponseSchema = z.object({
  logradouro: z.string().default(""),
  bairro: z.string().default(""),
  localidade: z.string().trim().min(1),
  uf: z.string().trim().length(2),
});

export type PropertyCepClientAddress = z.infer<typeof propertyCepResponseSchema>;

export async function fetchPropertyCepAddress(cep: string, signal: AbortSignal) {
  if (!/^\d{8}$/.test(cep)) throw new Error("CEP inválido.");
  const response = await fetch(`/api/properties/cep?cep=${cep}`, { signal });
  if (response.status === 404) throw new Error("CEP não encontrado. Preencha o endereço manualmente.");
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora. Preencha o endereço manualmente.");
  return propertyCepResponseSchema.parse(await response.json());
}
