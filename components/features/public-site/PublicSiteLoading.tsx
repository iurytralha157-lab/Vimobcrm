export function PublicSiteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111312] text-[var(--site-primary,#ff3f2f)]">
      <div
        aria-label="Carregando site"
        className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-current"
        role="status"
      />
    </div>
  );
}
