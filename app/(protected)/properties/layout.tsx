import type { ReactNode } from 'react';

import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary';

export default function PropertiesLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionBoundary title="Imoveis" anyOf={["property_view", "property_manage"]}>
      {children}
    </PermissionBoundary>
  );
}
