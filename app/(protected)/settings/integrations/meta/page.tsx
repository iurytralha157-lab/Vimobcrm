import { redirect } from "next/navigation";

type MetaSettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MetaSettingsPage({ searchParams }: MetaSettingsPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams({ tab: "meta" });
  const oauthData = params?.meta_oauth_data;
  const oauthStatus = params?.meta_oauth_status;
  const oauthFlowId = params?.meta_oauth_flow_id;
  const oauthError = params?.meta_oauth_error;
  const oauthPopup = params?.meta_oauth_popup;

  if (typeof oauthData === "string") {
    next.set("meta_oauth_data", oauthData);
  }

  if (typeof oauthStatus === "string") {
    next.set("meta_oauth_status", oauthStatus);
  }

  if (typeof oauthFlowId === "string") {
    next.set("meta_oauth_flow_id", oauthFlowId);
  }

  if (typeof oauthError === "string") {
    next.set("meta_oauth_error", oauthError);
  }

  if (typeof oauthPopup === "string") {
    next.set("meta_oauth_popup", oauthPopup);
  }

  redirect(`/settings?${next.toString()}`);
}
