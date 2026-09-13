"use client";

import type { AdminSection } from "@/components/features/admin/admin-navigation";
import { AdminDashboardContent } from "@/components/features/admin/AdminDashboardContent";
import {
  AdminOrganizationsContent,
} from "@/components/features/admin/AdminOrganizationsContent";
import { OrganizationDetailManagementContent } from "@/components/features/admin/AdminOrganizationDetailContent";
import { AdminPlansContent } from "@/components/features/admin/AdminPlansContent";
import {
  AdminAiContent,
  AdminDatabaseContent,
  AdminGenericTableContent,
} from "@/components/features/admin/AdminSystemContent";
import { AdminSettingsContent } from "@/components/features/admin/AdminNotificationSettingsContent";
import { AdminUsersContent } from "@/components/features/admin/AdminUsersContent";
import { AnnouncementsContent } from "@/components/features/admin/AnnouncementsContent";
import { ErrorEventsContent } from "@/components/features/admin/ErrorEventsContent";
import { HelpArticlesContent } from "@/components/features/admin/HelpArticlesContent";

type AdminScreenProps = {
  section: AdminSection;
  organizationId?: string;
};

function renderAdminContent(section: AdminSection, organizationId?: string) {
  switch (section) {
    case "dashboard":
      return <AdminDashboardContent />;
    case "organizations":
      return <AdminOrganizationsContent />;
    case "organization-detail":
      return <OrganizationDetailManagementContent organizationId={organizationId} />;
    case "users":
      return <AdminUsersContent />;
    case "plans":
      return <AdminPlansContent />;
    case "announcements":
      return <AnnouncementsContent />;
    case "database":
      return <AdminDatabaseContent />;
    case "error-logs":
      return <ErrorEventsContent />;
    case "help":
      return <HelpArticlesContent />;
    case "ai":
      return <AdminAiContent />;
    case "settings":
      return <AdminSettingsContent />;
    case "system-settings":
      return <AdminSettingsContent technical />;
    default:
      return <AdminGenericTableContent section={section} />;
  }
}

export function AdminScreen({ section, organizationId }: AdminScreenProps) {
  return (
    <div className="space-y-4">
      {renderAdminContent(section, organizationId)}
    </div>
  );
}

export { OrganizationDetailContent } from "@/components/features/admin/AdminOrganizationsContent";
export { OrganizationDetailManagementContent } from "@/components/features/admin/AdminOrganizationDetailContent";
