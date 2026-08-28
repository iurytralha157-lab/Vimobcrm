import ConversationsScreen from "@/components/features/whatsapp/ConversationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

type ConversationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const firstSearchParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const params = await searchParams;

  return (
    <PermissionBoundary module="whatsapp" title="Conversas" permission="whatsapp_view">
      <ConversationsScreen
        initialConversationId={firstSearchParam(params.conversation)}
        initialLeadId={firstSearchParam(params.lead)}
      />
    </PermissionBoundary>
  );
}
