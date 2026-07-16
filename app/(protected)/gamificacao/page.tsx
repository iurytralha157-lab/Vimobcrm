import { GamificationScreen } from '@/components/features/gamification';
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary';

export default function GamificacaoPage() {
  return (
    <PermissionBoundary title="Gamificacao" anyOf={["gamification_view", "gamification_manage"]}>
      <GamificationScreen />
    </PermissionBoundary>
  );
}
