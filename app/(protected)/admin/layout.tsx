import type { ReactNode } from "react";

import { SuperAdminLayout } from "@/components/features/admin/SuperAdminLayout";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}
