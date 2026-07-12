import { VimobLoader } from "@/components/shared/loading";

export default function ProtectedLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <VimobLoader size="lg" label="Carregando ambiente..." />
    </div>
  );
}
