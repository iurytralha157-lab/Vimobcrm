import DistributionQueueEditorScreen from "@/components/features/round-robin/DistributionQueueEditorScreen";

export default async function EditDistributionQueuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DistributionQueueEditorScreen mode="edit" queueId={id} />;
}
