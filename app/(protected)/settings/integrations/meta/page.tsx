import { redirect } from "next/navigation";

type MetaSettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MetaSettingsPage({ searchParams }: MetaSettingsPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams({ tab: "meta" });
  const oauthData = params?.meta_oauth_data;

  if (typeof oauthData === "string") {
    next.set("meta_oauth_data", oauthData);
  }

  redirect(`/settings?${next.toString()}`);
}
