"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AutomationList } from "@/components/features/automations/AutomationList";
import { FollowUpTemplates, FollowUpTemplate } from "@/components/features/automations/FollowUpTemplates";
import { FollowUpBuilder } from "@/components/features/automations/FollowUpBuilder";
import { FollowUpBuilderEdit } from "@/components/features/automations/FollowUpBuilderEdit";
import { ExecutionHistory } from "@/components/features/automations/ExecutionHistory";
import { useHasPermission } from "@/hooks/use-organization-roles";

type ViewMode = "list" | "build-followup" | "edit-existing";
type AutomationTab = "automations" | "templates" | "history";

export default function Automations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FollowUpTemplate | null>(null);
  const [historyAutomationId, setHistoryAutomationId] = useState<string | undefined>(undefined);
  const { data: canEditAutomations = false } = useHasPermission("automations_edit");

  const requestedTab = searchParams.get("tab");
  const activeTab: AutomationTab =
    requestedTab === "templates" && canEditAutomations
      ? "templates"
      : requestedTab === "history"
        ? "history"
        : "automations";

  const navigateToTab = (value: AutomationTab) => {
    if (value !== "history") setHistoryAutomationId(undefined);
    router.replace(`/automations?tab=${value}`, { scroll: false });
  };

  const handleEditAutomation = (automationId: string) => {
    if (!canEditAutomations) return;
    setEditingAutomationId(automationId);
    setViewMode("edit-existing");
  };

  const handleSelectTemplate = (template: FollowUpTemplate | null) => {
    if (!canEditAutomations) return;
    setSelectedTemplate(template);
    setViewMode("build-followup");
  };

  const handleComplete = () => {
    setViewMode("list");
    navigateToTab("automations");
    setSelectedTemplate(null);
    setEditingAutomationId(null);
  };

  const handleBack = () => {
    setViewMode("list");
    setEditingAutomationId(null);
    setSelectedTemplate(null);
  };

  const handleViewHistory = (automationId: string) => {
    setHistoryAutomationId(automationId);
    navigateToTab("history");
  };

  if (viewMode === "build-followup") {
    return (
      <AppLayout disableMainScroll>
        <div className="absolute inset-0 p-1.5 pt-0">
          <FollowUpBuilder initialTemplate={selectedTemplate} onBack={handleBack} onComplete={handleComplete} />
        </div>
      </AppLayout>
    );
  }

  if (viewMode === "edit-existing" && editingAutomationId) {
    return (
      <AppLayout disableMainScroll>
        <div className="absolute inset-0 p-1.5 pt-0">
          <FollowUpBuilderEdit automationId={editingAutomationId} onBack={handleBack} onComplete={handleComplete} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Automações">
      <div className="space-y-6 animate-in">
        <Tabs value={activeTab} className="w-full">
          <TabsContent value="automations" className="mt-0">
            <AutomationList onEdit={handleEditAutomation} onViewHistory={handleViewHistory} canManage={canEditAutomations} />
          </TabsContent>

          <TabsContent value="templates" className="mt-0">
            <FollowUpTemplates onSelectTemplate={handleSelectTemplate} canCreate={canEditAutomations} />
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <ExecutionHistory automationId={historyAutomationId} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
