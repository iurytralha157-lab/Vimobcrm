import { useState, useEffect } from "react";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Settings2,
  RefreshCw,
  Users,
  Home,
  Tag,
} from "lucide-react";
import {
  useMetaFormConfigs,
  useFetchPageForms,
  useToggleFormConfig,
  MetaForm,
  MetaFormConfig,
} from "@/hooks/use-meta-forms";
import { MetaFormConfigDialog } from "./MetaFormConfigDialog";
import { MetaIntegration } from "@/hooks/use-meta-integration";

interface MetaFormManagerProps {
  integration: MetaIntegration;
}

export function MetaFormManager({ integration }: MetaFormManagerProps) {
  const [forms, setForms] = useState<MetaForm[]>([]);
  const [isLoadingForms, setIsLoadingForms] = useState(false);
  const [editingForm, setEditingForm] = useState<{ form: MetaForm; config?: MetaFormConfig } | null>(null);

  const { data: formConfigs, isLoading: loadingConfigs } = useMetaFormConfigs(integration.id);
  const { mutateAsync: fetchPageForms } = useFetchPageForms();
  const toggleForm = useToggleFormConfig();

  const loadForms = useCallback(async () => {
    if (!integration.page_id) return;

    setIsLoadingForms(true);
    try {
      const result = await fetchPageForms({
        pageId: integration.page_id,
      });
      setForms(result.forms || []);
    } catch (error) {
      console.error("Error loading forms:", error);
    } finally {
      setIsLoadingForms(false);
    }
  }, [fetchPageForms, integration.page_id]);

  useEffect(() => {
    if (!integration.page_id) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) void loadForms();
    });

    return () => {
      cancelled = true;
    };
  }, [integration.page_id, loadForms]);

  const getFormConfig = (formId: string): MetaFormConfig | undefined => {
    return formConfigs?.find(c => c.form_id === formId);
  };

  const handleToggleForm = (formId: string, isActive: boolean) => {
    toggleForm.mutate({
      formId,
      isActive,
      integrationId: integration.id,
    });
  };

  if (loadingConfigs || isLoadingForms) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const configuredForms = forms.filter(f => getFormConfig(f.id));
  const unconfiguredForms = forms.filter(f => !getFormConfig(f.id));

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Formulários da Página
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={loadForms} disabled={isLoadingForms}>
          <RefreshCw className={`h-3.5 w-3.5 ${isLoadingForms ? 'animate-spin' : ''}`} />
          <span className="ml-1">Atualizar</span>
        </Button>
      </div>

      {forms.length === 0 ? (
        <Card className="app-card">
          <CardContent className="py-6">
            <div className="text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs">Nenhum formulário encontrado nesta página</p>
              <p className="text-xs mt-0.5 opacity-70">
                Crie formulários no Gerenciador de Anúncios do Facebook
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...configuredForms, ...unconfiguredForms].map((form) => {
            const config = getFormConfig(form.id);
            return (
              <FormCard
                key={form.id}
                form={form}
                config={config}
                onToggle={(isActive) => handleToggleForm(form.id, isActive)}
                onEdit={() => setEditingForm({ form, config })}
              />
            );
          })}
        </div>
      )}

      <MetaFormConfigDialog
        open={!!editingForm}
        onOpenChange={(open) => !open && setEditingForm(null)}
        form={editingForm?.form || null}
        config={editingForm?.config}
        integrationId={integration.id}
        pageName={integration.page_name}
      />
    </div>
  );
}

interface FormCardProps {
  form: MetaForm;
  config?: MetaFormConfig;
  onToggle?: (isActive: boolean) => void;
  onEdit: () => void;
}

function FormCard({ form, config, onToggle, onEdit }: FormCardProps) {
  const isConfigured = !!config;
  const isActive = config?.is_active ?? false;

  return (
    <Card className={isConfigured ? "app-card" : "app-card border-dashed border-white/[0.08]"}>
      <CardContent className="p-3 space-y-2.5">
        {/* Row 1: Identity & Status */}
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg shrink-0 ${isConfigured ? 'bg-primary/10' : 'bg-white/[0.055]'}`}>
            <FileText className={`h-4 w-4 ${isConfigured ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate leading-tight">{form.name}</p>
          </div>
          {isConfigured ? (
            <Badge variant={isActive ? "default" : "secondary"} className="text-xs shrink-0">
              {isActive ? "Ativo" : "Inativo"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs shrink-0">
              Não config.
            </Badge>
          )}
        </div>

        {/* Row 2: Stats & Toggle */}
        <div className="flex items-center justify-between gap-2 py-1.5 border-y border-white/[0.045]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isConfigured && config ? (
              <>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3 shrink-0" />
                  <span>{config.leads_received || 0} leads</span>
                </div>
                {config.property_id && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Home className="h-3 w-3 shrink-0" />
                    <span>Imóvel</span>
                  </div>
                )}
                {config.auto_tags && config.auto_tags.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Tag className="h-3 w-3 shrink-0" />
                    <span>{config.auto_tags.length} tag(s)</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground truncate">
                Configure para receber leads
              </p>
            )}
          </div>
          {isConfigured && onToggle && (
            <Switch
              checked={isActive}
              onCheckedChange={onToggle}
              aria-label="Toggle form"
              className="shrink-0"
            />
          )}
        </div>

        {/* Row 3: Action Button */}
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs px-2" onClick={onEdit}>
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            <span>{isConfigured ? "Editar" : "Configurar"}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
