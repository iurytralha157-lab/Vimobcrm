const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export function serveRetiredWhatsAppFunction(functionName: string): void {
  const denoRuntime = (globalThis as unknown as {
    Deno: { serve(handler: () => Response): void }
  }).Deno;

  denoRuntime.serve(() => new Response(
    JSON.stringify({
      ok: false,
      error: "whatsapp_edge_function_retired",
      function: functionName,
      canonical_service: "vimob_go_backend",
    }),
    { status: 410, headers: responseHeaders },
  ));
}
