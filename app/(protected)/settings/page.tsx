import { Suspense } from "react";
import { redirect } from "next/navigation";
import SettingsScreen from "@/components/features/settings/SettingsScreen";

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;

  if (params?.tab === "meta" || params?.integration === "meta") {
    const next = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (key === "tab" || key === "integration" || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        next.append(key, item);
      }
    }

    const nextSearch = next.toString();
    redirect(`/settings/integrations/meta${nextSearch ? `?${nextSearch}` : ""}`);
  }

  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  );
}
