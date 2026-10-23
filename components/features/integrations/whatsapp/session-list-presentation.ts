import type {
  WhatsAppSession,
  WhatsAppSessionStatusSummary,
} from "@/lib/api/whatsapp";

export const WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME =
  "@min-[840px]:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.8fr)_136px_146px]";

export const WHATSAPP_SESSION_LIST_ROW_CLASS_NAME =
  `grid min-w-0 grid-cols-[minmax(0,1fr)_146px] items-center gap-x-2.5 gap-y-2 border-0 bg-[var(--app-surface-solid)] px-2.5 py-2.5 transition-colors hover:bg-[var(--app-surface-hover)] ${WHATSAPP_SESSION_LIST_COLUMNS_CLASS_NAME}`;

export const WHATSAPP_SESSION_LIST_ROW_STYLE = {
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, var(--app-border) 42%, transparent)",
};

function asReadOnlyStatusRow(
  session: WhatsAppSession,
): WhatsAppSessionStatusSummary {
  return {
    id: session.id,
    display_name: session.display_name || session.instance_name,
    status: session.status,
    phone_number: session.phone_number,
    profile_name: session.profile_name,
    last_connected_at: session.last_connected_at ?? null,
    updated_at: session.updated_at,
    owner: {
      id: session.owner?.id || session.owner_user_id,
      name: session.owner?.name || "Usuário",
      avatar_url: null,
    },
    capabilities: {
      can_manage: false,
      can_set_notification_sender: false,
    },
  };
}

export function getUnifiedWhatsAppStatusRows(
  statusRows: readonly WhatsAppSessionStatusSummary[],
  additionalSessions: readonly WhatsAppSession[] = [],
  viewerUserId?: string,
): WhatsAppSessionStatusSummary[] {
  const rowsById = new Map<string, WhatsAppSessionStatusSummary>();
  for (const row of statusRows) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, row);
  }
  for (const session of additionalSessions) {
    if (!rowsById.has(session.id)) {
      rowsById.set(session.id, asReadOnlyStatusRow(session));
    }
  }

  const rows = Array.from(rowsById.values());
  if (!viewerUserId) return rows;

  return [
    ...rows.filter((row) => row.owner.id === viewerUserId),
    ...rows.filter((row) => row.owner.id !== viewerUserId),
  ];
}
