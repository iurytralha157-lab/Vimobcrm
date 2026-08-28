const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function retiredUserMutation(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "endpoint_retired",
      error: "Esta rota foi desativada. Use o fluxo atual do Vimob.",
    }),
    { status: 410, headers: retiredHeaders },
  );
}
