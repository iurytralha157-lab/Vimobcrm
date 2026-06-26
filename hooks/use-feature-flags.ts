import { useSystemSettings } from './use-system-settings';

export function useFeatureFlags(): Record<string, boolean> {
  const { data: settings } = useSystemSettings();
  return (settings?.feature_flags as Record<string, boolean>) || {};
}
