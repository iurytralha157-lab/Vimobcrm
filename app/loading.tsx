import { VimobLoader } from "@/components/shared/loading";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <VimobLoader size="lg" label="Carregando Vimob..." />
    </div>
  );
}
