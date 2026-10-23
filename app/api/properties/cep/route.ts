import { lookupPropertyCep } from "@/lib/api/property-cep";

export async function GET(request: Request) {
  const cep = new URL(request.url).searchParams.get("cep") ?? "";
  if (!/^\d{8}$/.test(cep)) {
    return Response.json({ error: "invalid_cep" }, { status: 400 });
  }

  const result = await lookupPropertyCep(cep, fetch, { signal: request.signal });
  if (result.kind === "cancelled") {
    return Response.json({ error: "cep_lookup_cancelled" }, { status: 499 });
  }
  if (result.kind === "not_found") {
    return Response.json({ error: "cep_not_found" }, { status: 404 });
  }
  if (result.kind === "unavailable") {
    return Response.json({ error: "cep_lookup_unavailable" }, { status: 503 });
  }

  return Response.json(result.address, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
