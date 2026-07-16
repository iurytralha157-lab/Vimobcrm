"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, ShieldOff } from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AutomationList } from "@/components/features/automations/AutomationList";
import { FollowUpTemplates, FollowUpTemplate } from "@/components/features/automations/FollowUpTemplates";
import { FollowUpBuilder } from "@/components/features/automations/FollowUpBuilder";
import { FollowUpBuilderEdit } from "@/components/features/automations/FollowUpBuilderEdit";
import { ExecutionHistory } from "@/components/features/automations/ExecutionHistory";
import { AutomationRuntimeHealth } from "@/components/features/automations/AutomationRuntimeHealth";
import { useHasPermission } from "@/hooks/use-organization-roles";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";
import { useOrganizationModules } from "@/hooks/use-organization-modules";

type ViewMode = "list" | "build-followup" | "edit-existing";
type AutomationTab = "automations" | "templates" | "history" | "health";

export default function Automations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { setCollapsed } = useSidebar();
  const {
    error: modulesError,
    isLoading: modulesLoading,
    hasModule,
    refetch: refetchModules,
  } = useOrganizationModules();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<FollowUpTemplate | null>(null);
  const [historyAutomationId, setHistoryAutomationId] = useState<string | undefined>(undefined);
  const { data: canEditAutomations = false } = useHasPermission("automations_manage");

  const requestedTab = searchParams.get("tab");
  const activeTab: AutomationTab =
    requestedTab === "templates"
      ? "templates"
      : requestedTab === "history"
        ? "history"
        : requestedTab === "health"
          ? "health"
          : "automations";

  useEffect(() => {
    if (!isMobile && viewMode !== "list") setCollapsed(true);
  }, [isMobile, setCollapsed, viewMode]);

  const navigateToTab = (value: AutomationTab) => {
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
    if (!window.confirm("Descartar as alterações não salvas deste fluxo?")) return;
    setViewMode("list");
    setEditingAutomationId(null);
    setSelectedTemplate(null);
  };

  const handleViewHistory = (automationId: string) => {
    setHistoryAutomationId(automationId);
    navigateToTab("history");
  };

  if (modulesLoading) {
    return (
      <AppLayout title="Automações">
        <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Verificando acesso ao módulo...
        </div>
      </AppLayout>
    );
  }

  if (modulesError) {
    return (
      <AppLayout title="Automações">
        <div className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center" role="alert">
          <ShieldOff className="mb-3 h-9 w-9 text-destructive" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Não foi possível verificar o acesso às automações</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            O estado do módulo não pôde ser consultado. Tente novamente antes de continuar.
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => void refetchModules()}>
            Tentar novamente
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!hasModule("automations")) {
    return (
      <AppLayout title="Automações">
        <div className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
          <ShieldOff className="mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Módulo de automações indisponível</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Este módulo não está habilitado para a organização selecionada. Solicite a ativação ao administrador da conta.
          </p>
        </div>
      </AppLayout>
    );
  }

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
          <div
            data-tour="automations-tabs"
            role="tablist"
            aria-label="Seções de automações"
            className="flex max-w-full items-center overflow-x-auto rounded-[8px] bg-[var(--app-surface)] p-1"
          >
            {([
              ["automations", "Automações"],
              ["templates", "Modelos"],
              ["history", "Histórico"],
              ["health", "Saúde"],
            ] as Array<[AutomationTab, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={activeTab === value}
                onClick={() => navigateToTab(value)}
                className={cn(
                  "h-9 px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                  activeTab === value && "bg-[var(--app-background)] text-foreground shadow-none",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {canEditAutomations && !isMobile && (
            <Button data-tour="automations-new" className="gap-2 self-start sm:self-auto" onClick={() => handleSelectTemplate(null)}>
              <Plus className="h-4 w-4" />
              Nova automação
            </Button>
          )}
        </div>

        {isMobile && activeTab === "templates" && (
          <div className="rounded-[8px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200" role="note">
            Os modelos podem ser consultados no celular. Para montar ou editar o fluxo visual, abra esta página em um computador.
          </div>
        )}

        <Tabs value={activeTab} className="w-full">
          <TabsContent data-tour="automations-list" value="automations" className="mt-0">
            <AutomationList
              onEdit={handleEditAutomation}
              onCreate={() => handleSelectTemplate(null)}
              onViewHistory={handleViewHistory}
              canManage={canEditAutomations}
              canCreate={canEditAutomations}
              allowEditing={!isMobile}
            />
          </TabsContent>

          <TabsContent data-tour="automations-templates" value="templates" className="mt-0">
            <FollowUpTemplates
              onSelectTemplate={handleSelectTemplate}
              canCreate={canEditAutomations}
              interactive={!isMobile}
            />
          </TabsContent>

          <TabsContent data-tour="automations-history" value="history" className="mt-0">
            <ExecutionHistory
              key={historyAutomationId ?? "all"}
              automationId={historyAutomationId}
              canManage={canEditAutomations}
            />
          </TabsContent>

          <TabsContent data-tour="automations-health" value="health" className="mt-0">
            <AutomationRuntimeHealth canManage={canEditAutomations} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
