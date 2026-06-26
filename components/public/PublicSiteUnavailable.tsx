export function PublicSiteUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md space-y-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Site indisponivel</p>
        <h1 className="text-2xl font-semibold">Este site esta temporariamente fora do ar</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Entre em contato com a imobiliaria responsavel para verificar o acesso.
        </p>
      </section>
    </main>
  );
}
