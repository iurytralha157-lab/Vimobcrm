"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AutomationList } from "@/components/features/automations/AutomationList";
import { FollowUpTemplates, FollowUpTemplate } from "@/components/features/automations/FollowUpTemplates";
import { FollowUpBuilder } from "@/components/features/automations/FollowUpBuilder";
import { FollowUpBuilderEdit } from "@/components/features/automations/FollowUpBuilderEdit";
import { ExecutionHistory } from "@/components/features/automations/ExecutionHistory";
import { useHasPermission } from "@/hooks/use-organization-roles";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";

type ViewMode = "list" | "build-followup" | "edit-existing";
type AutomationTab = "automations" | "templates" | "history";

export default function Automations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { setCollapsed } = useSidebar();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FollowUpTemplate | null>(null);
  const [historyAutomationId, setHistoryAutomationId] = useState<string | undefined>(undefined);
  const { data: canEditAutomations = false } = useHasPermission("automations_edit");

  const requestedTab = searchParams.get("tab");
  const activeTab: AutomationTab =
    isMobile
      ? "automations"
      : requestedTab === "templates" && canEditAutomations
      ? "templates"
      : requestedTab === "history"
        ? "history"
        : "automations";

  useEffect(() => {
    if (!isMobile && viewMode !== "list") setCollapsed(true);
  }, [isMobile, setCollapsed, viewMode]);

  const navigateToTab = (value: AutomationTab) => {
    if (isMobile && value !== "automations") return;
    if (value !== "history") setHistoryAutomationId(undefined);
    router.replace(`/automations?tab=${value}`, { scroll: false });
  };

  const handleEditAutomation = (automationId: string) => {
    if (!canEditAutomations || isMobile) return;
    setEditingAutomationId(automationId);
    setViewMode("edit-existing");
  };

  const handleSelectTemplate = (template: FollowUpTemplate | null) => {
    if (!canEditAutomations || isMobile) return;
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
    if (isMobile) return;
    setHistoryAutomationId(automationId);
    navigateToTab("history");
  };

  if (!isMobile && viewMode === "build-followup") {
    return (
      <AppLayout disableMainScroll>
        <div className="absolute inset-0 p-1.5 pt-0">
          <FollowUpBuilder initialTemplate={selectedTemplate} onBack={handleBack} onComplete={handleComplete} />
        </div>
      </AppLayout>
    );
  }

  if (!isMobile && viewMode === "edit-existing" && editingAutomationId) {
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden items-center rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface)] p-1 sm:flex">
            {([
              ["automations", "Automações"],
              ["templates", "Modelos"],
              ["history", "Histórico"],
            ] as Array<[AutomationTab, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => navigateToTab(value)}
                disabled={value === "templates" && !canEditAutomations}
                className={cn(
                  "h-9 px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                  activeTab === value && "bg-[var(--app-background)] text-foreground shadow-sm",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {canEditAutomations && !isMobile && (
            <Button className="gap-2 self-start sm:self-auto" onClick={() => handleSelectTemplate(null)}>
              <Plus className="h-4 w-4" />
              Nova automação
            </Button>
          )}
        </div>

        <Tabs value={activeTab} className="w-full">
          <TabsContent value="automations" className="mt-0">
            <AutomationList
              onEdit={handleEditAutomation}
              onCreate={() => handleSelectTemplate(null)}
              onViewHistory={handleViewHistory}
              canManage={canEditAutomations}
              canCreate={canEditAutomations}
              allowEditing={!isMobile}
            />
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
