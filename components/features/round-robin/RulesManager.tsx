import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Loader2,
  GripVertical,
  Filter,
  MessageSquare,
  Webhook,
  Globe,
  MapPin,
  Home,
  Megaphone,
  FileText,
} from 'lucide-react';
import {
  useRoundRobinRules,
  useCreateRoundRobinRule,
  useDeleteRoundRobinRule,
  RoundRobinRule,
} from '@/hooks/use-round-robin-rules';
import { useTags } from '@/hooks/use-tags';
import { useWebhooks } from '@/hooks/use-webhooks';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useProperties } from '@/hooks/use-properties';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { integrationsAPI } from '@/lib/api';

// Static label maps
const SOURCE_LABELS: Record<string, string> = {
  meta_ads: 'Meta Ads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  webhook: 'Webhook',
  website: 'Website',
  meta: 'Meta',
  manual: 'Manual',
  site: 'Site',
};

const CATEGORY_LABELS: Record<string, string> = {
  venda: 'Venda',
  locacao: 'Locação',
  lancamento: 'Lançamento',
};

type MetaFormConfigRow = {
  form_id: string;
  form_name: string | null;
};

function toMetaFormConfigRow(value: Record<string, unknown>): MetaFormConfigRow {
  return {
    form_id: typeof value.form_id === 'string' ? value.form_id : '',
    form_name: typeof value.form_name === 'string' ? value.form_name : null,
  };
}

function useAllMetaFormConfigs() {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ['meta-form-configs-all', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const configs = await integrationsAPI.listMetaFormConfigs(undefined, organizationId);
      return configs.map(toMetaFormConfigRow).filter((config) => config.form_id);
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

interface RulesManagerProps {
  roundRobinId: string;
  roundRobinName: string;
}

export function RulesManager({ roundRobinId }: RulesManagerProps) {
  const { data: rules = [], isLoading } = useRoundRobinRules(roundRobinId);
  const { data: tags = [] } = useTags();
  const { data: webhooks = [] } = useWebhooks();
  const { data: sessions = [] } = useWhatsAppSessions();
  const { data: metaFormConfigs = [] } = useAllMetaFormConfigs();
  const { data: properties = [] } = useProperties();

  const createRule = useCreateRoundRobinRule();
  const deleteRule = useDeleteRoundRobinRule();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);

  const handleCreateRule = async () => {
    await createRule.mutateAsync({
      round_robin_id: roundRobinId,
      match_type: 'source',
      match_value: 'meta',
    });
  };

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    await deleteRule.mutateAsync({ id: ruleToDelete, roundRobinId });
    setRuleToDelete(null);
    setDeleteDialogOpen(false);
  };

  const renderMatchDescription = (rule: RoundRobinRule) => {
    const rawValues = rule.match_value || '';
    const values = rawValues.split(',').map(v => v.trim()).filter(Boolean);

    switch (rule.match_type) {
      case 'source':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => (
              <Badge key={v} variant="outline" className="gap-1">
                <Globe className="h-3 w-3" />
                {SOURCE_LABELS[v] || v}
              </Badge>
            ))}
          </div>
        );

      case 'webhook':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const wh = webhooks.find(w => w.id === v);
              return (
                <Badge key={v} variant="outline" className="gap-1">
                  <Webhook className="h-3 w-3" />
                  {wh?.name || 'Webhook desconhecido'}
                </Badge>
              );
            })}
          </div>
        );

      case 'whatsapp_session':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const s = sessions.find(s => s.id === v);
              return (
                <Badge key={v} variant="outline" className="gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {s?.display_name || s?.phone_number || 'Sessão desconhecida'}
                </Badge>
              );
            })}
          </div>
        );

      case 'meta_form':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const f = metaFormConfigs.find(f => f.form_id === v);
              return (
                <Badge key={v} variant="outline" className="gap-1">
                  <FileText className="h-3 w-3" />
                  {f?.form_name || 'Formulário'}
                </Badge>
              );
            })}
          </div>
        );

      case 'tag':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const tag = tags.find(t => t.id === v);
              return tag ? (
                <Badge
                  key={v}
                  variant="outline"
                  className="gap-1"
                  style={{ borderColor: tag.color, color: tag.color }}
                >
                  🏷️ {tag.name}
                </Badge>
              ) : null;
            })}
          </div>
        );

      case 'interest_property':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const prop = properties.find(p => p.id === v);
              return (
                <Badge key={v} variant="outline" className="gap-1">
                  <Home className="h-3 w-3" />
                  {prop ? `${prop.code} - ${prop.title || prop.bairro}` : 'Imóvel'}
                </Badge>
              );
            })}
          </div>
        );

      case 'website_category':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => (
              <Badge key={v} variant="outline" className="gap-1">
                <Globe className="h-3 w-3" />
                {CATEGORY_LABELS[v] || v}
              </Badge>
            ))}
          </div>
        );

      case 'campaign_contains':
        return (
          <Badge variant="outline" className="gap-1">
            <Megaphone className="h-3 w-3" />
            Campanha contém: &quot;{rawValues}&quot;
          </Badge>
        );

      case 'city':
        return (
          <div className="flex flex-wrap gap-1">
            {values.map(v => (
              <Badge key={v} variant="outline" className="gap-1">
                <MapPin className="h-3 w-3" />
                {v}
              </Badge>
            ))}
          </div>
        );

      default:
        return (
          <Badge variant="outline">
            {rule.match_type}: {rawValues}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Regras de Entrada</h3>
          <p className="text-sm text-muted-foreground">
            Defina quando leads devem entrar nesta fila
          </p>
        </div>
        <Button onClick={handleCreateRule} size="sm" disabled={createRule.isPending}>
          {createRule.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Nova Regra
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Filter className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground mb-2">Nenhuma regra configurada</p>
            <p className="text-sm text-muted-foreground mb-4">
              Esta fila receberá leads apenas como fallback (genérico)
            </p>
            <Button variant="outline" onClick={handleCreateRule} size="sm" disabled={createRule.isPending}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Regra
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <Card key={rule.id}>
              <CardContent className="py-3">
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />

                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                    {index + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">Regra {index + 1}</span>
                    </div>
                    {renderMatchDescription(rule)}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          setRuleToDelete(rule.id);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A regra será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
