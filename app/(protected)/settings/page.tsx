import { Suspense } from "react";
import SettingsScreen from "@/components/features/settings/SettingsScreen";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  );
}
