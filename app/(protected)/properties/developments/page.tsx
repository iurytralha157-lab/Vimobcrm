import { redirect } from "next/navigation";

type PropertyDevelopmentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PropertyDevelopmentsPage({
  searchParams,
}: PropertyDevelopmentsPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      next.append(key, item);
    }
  }

  const nextSearch = next.toString();
  redirect(`/properties/launches${nextSearch ? `?${nextSearch}` : ""}`);
}
