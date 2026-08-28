export function PublicSiteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--public-background)] text-[var(--public-accent)]">
      <div
        aria-label="Carregando site"
        className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--public-border)] border-t-current"
        role="status"
      />
    </div>
  );
}
