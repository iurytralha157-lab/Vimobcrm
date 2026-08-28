import TeamEditorScreen from "@/components/features/teams/TeamEditorScreen";

export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeamEditorScreen mode="edit" teamId={id} />;
}
