import { AdminScreen } from "@/components/features/admin/AdminScreen";

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminScreen section="organization-detail" organizationId={id} />;
}
