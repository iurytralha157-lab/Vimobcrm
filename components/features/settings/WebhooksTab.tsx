import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Webhook,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  Loader2,
  Code,
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
} from 'lucide-react';
import { useWebhooks, useCreateWebhook, useUpdateWebhook, useDeleteWebhook, useToggleWebhook, useRegenerateToken } from '@/hooks/use-webhooks';
import type { WebhookIntegration } from '@/hooks/use-webhooks';
import { useProperties } from '@/hooks/use-properties';
import { InlineTagSelector } from '@/components/ui/tag-selector';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

type WebhookInterestType = '' | 'property';
type WebhookFormData = {
  name: string;
  type: 'incoming' | 'outgoing';
  target_tag_ids: string[];
  interest_type: WebhookInterestType;
  interest_property_id: string;
};

type WebhookCreatePayload = {
  name: string;
  type: 'incoming' | 'outgoing';
  target_tag_ids?: string[];
  field_mapping?: Record<string, string>;
};

type WebhookUpdatePayload = {
  id: string;
  name: string;
  target_tag_ids: string[];
  field_mapping: Record<string, string>;
};

const DEFAULT_WEBHOOK_API_URL = 'http://localhost:8081';

export function WebhooksTab() {
  const { data: webhooks = [], isLoading } = useWebhooks();
  const { data: properties = [] } = useProperties();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const toggleWebhook = useToggleWebhook();
  const regenerateToken = useRegenerateToken();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookIntegration | null>(null);
  const [formData, setFormData] = useState<WebhookFormData>({
    name: '',
    type: 'incoming',
    target_tag_ids: [],
    interest_type: '',
    interest_property_id: '',
  });

  const webhookUrl = `${getWebhookAPIBaseURL()}/v1/public/webhooks/generic`;

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Informe o nome do webhook');
      return;
    }

    const webhookData: WebhookCreatePayload = {
      name: formData.name.trim(),
      type: formData.type,
      target_tag_ids: formData.target_tag_ids.length > 0 ? formData.target_tag_ids : undefined,
    };

    // Store interest in field_mapping so the public webhook endpoint can apply it
    if (formData.interest_type === 'property' && formData.interest_property_id) {
      webhookData.field_mapping = { interest_property_id: formData.interest_property_id };
    }

    await createWebhook.mutateAsync(webhookData);

    setDialogOpen(false);
    resetForm();
  };

  const handleUpdate = async () => {
    if (!selectedWebhook) return;

    const updates: WebhookUpdatePayload = {
      id: selectedWebhook.id,
      name: formData.name.trim(),
      target_tag_ids: formData.target_tag_ids,
      field_mapping: {},
    };

    // Update interest in field_mapping
    if (formData.interest_type === 'property' && formData.interest_property_id) {
      updates.field_mapping = { interest_property_id: formData.interest_property_id };
    } else {
      updates.field_mapping = {};
    }

    await updateWebhook.mutateAsync(updates);

    setDialogOpen(false);
    setSelectedWebhook(null);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'incoming',
      target_tag_ids: [],
      interest_type: '',
      interest_property_id: '',
    });
  };

  const openEditDialog = (webhook: WebhookIntegration) => {
    setSelectedWebhook(webhook);

    // Parse interest from field_mapping
    const fieldMapping = webhook.field_mapping || {};
    let interestType: '' | 'property' = '';
    let interestPropertyId = '';

    if (fieldMapping.interest_property_id) {
      interestType = 'property';
      interestPropertyId = fieldMapping.interest_property_id;
    }

    setFormData({
      name: webhook.name,
      type: webhook.type,
      target_tag_ids: webhook.target_tag_ids || [],
      interest_type: interestType,
      interest_property_id: interestPropertyId,
    });
    setDialogOpen(true);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este webhook?')) return;
    await deleteWebhook.mutateAsync(id);
  };

  const handleRegenerateToken = async (id: string) => {
    if (!confirm('Isso invalidará o token atual. Continuar?')) return;
    await regenerateToken.mutateAsync(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="app-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Webhooks
            </CardTitle>
            <CardDescription>
              Receba leads de sistemas externos através de webhooks
            </CardDescription>
          </div>
          <Button onClick={() => { resetForm(); setSelectedWebhook(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Webhook
          </Button>
        </CardHeader>
        <CardContent className="px-4 md:px-6 pb-4 space-y-4">
          {webhooks.length === 0 ? (
            <div className="app-card-soft text-center py-12">
              <Webhook className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhum webhook configurado</p>
              <Button variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar primeiro webhook
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {webhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className="app-card-soft p-4 transition-colors hover:bg-white/[0.055]"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Info */}
                    <div className="flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${webhook.type === 'incoming' ? 'bg-primary/10' : 'bg-warning/10'}`}>
                        {webhook.type === 'incoming' ? (
                          <ArrowDownToLine className="h-5 w-5 text-primary" />
                        ) : (
                          <ArrowUpFromLine className="h-5 w-5 text-warning" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium">{webhook.name}</h4>
                          <Badge variant={webhook.is_active ? 'default' : 'secondary'}>
                            {webhook.is_active ? 'Ativo' : 'Inativo'}
                          </Badge>
                          <Badge variant="outline">
                            {webhook.type === 'incoming' ? 'Entrada' : 'Saída'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span>{webhook.leads_received || 0} leads recebidos</span>
                          {webhook.last_lead_at && (
                            <span>
                              Último: {formatDistanceToNow(new Date(webhook.last_lead_at), { addSuffix: true, locale: ptBR })}
                            </span>
                          )}
                        </div>
                        {/* Show interest info */}
                        {webhook.field_mapping?.interest_property_id && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                              <Building2 className="h-3 w-3 mr-1" />
                              Imóvel configurado
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Switch
                        checked={webhook.is_active}
                        onCheckedChange={(checked) => toggleWebhook.mutate({ id: webhook.id, is_active: checked })}
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(webhook)}>
                        <Code className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(webhook.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Expandable details */}
                  {webhook.type === 'incoming' && (
                    <Accordion type="single" collapsible className="mt-4">
                      <AccordionItem value="details" className="border-none">
                        <AccordionTrigger className="py-2 text-sm">
                          Ver configuração
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-4 pt-2">
                            {/* URL */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">URL do Webhook</Label>
                              <div className="flex gap-2">
                                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                                <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl, 'URL')}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            {/* Token */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Token de autenticação</Label>
                              <div className="flex gap-2">
                                <Input
                                  value={webhook.api_token}
                                  readOnly
                                  type="password"
                                  className="font-mono text-xs"
                                />
                                <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhook.api_token, 'Token')}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => handleRegenerateToken(webhook.id)}>
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            {/* Example */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Exemplo de requisição</Label>
                            <div className="app-card-soft p-3 font-mono text-xs overflow-x-auto">
                                <pre>{`curl -X POST "${webhookUrl}" \\
  -H "Authorization: Bearer ${webhook.api_token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "João Silva",
    "phone": "11999999999",
    "email": "joao@email.com",
    "message": "Interesse no imóvel",
    "property_id": "uuid-do-imovel",

    "campaign_id": "123456789",
    "campaign_name": "Black Friday 2026",
    "adset_id": "987654321",
    "adset_name": "Leads Quentes - SP",
    "ad_id": "456789123",
    "ad_name": "Carrossel Imóveis",
    "form_name": "Formulário Landing Page",

    "utm_source": "facebook",
    "utm_medium": "cpc",
    "utm_campaign": "black_friday_2026",
    "utm_content": "carrousel_v2",
    "utm_term": "apartamento zona sul",

    "contact_notes": "Lead interessado em financiamento"
  }'`}</pre>
                              </div>
                            </div>

                            {/* Field mapping */}
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Mapeamento de Campos</Label>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {Object.entries(webhook.field_mapping || {}).map(([target, source]) => (
                                  <div key={target} className="flex items-center gap-2 bg-white/[0.045] rounded px-2 py-1">
                                    <span className="text-muted-foreground">{String(source)}</span>
                                    <span>→</span>
                                    <span className="font-medium">{target}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documentation Card */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Code className="h-5 w-5" />
            Documentação
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6 pb-5 space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium">Como usar webhooks</h4>
            <p className="text-sm text-muted-foreground">
              Webhooks permitem que sistemas externos enviem leads automaticamente para o CRM.
              Configure um webhook de entrada, copie a URL e o token, e configure seu sistema para enviar requisições POST.
            </p>
          </div>
          <Separator />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="font-medium">Campos aceitos</h4>
              <p className="text-xs text-muted-foreground mb-3">Campos básicos do lead</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { field: 'name', required: true },
                  { field: 'phone', required: false },
                  { field: 'email', required: false },
                  { field: 'message', required: false },
                  { field: 'property_id', required: false },
                ].map(({ field, required }) => (
                  <div key={field} className="app-card-soft px-3 py-2 text-sm font-mono">
                    {field}{required && <span className="text-destructive">*</span>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">* Campo obrigatório</p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Campos de rastreamento (opcionais)</h4>
              <p className="text-xs text-muted-foreground mb-3">Dados de campanha, anúncio e UTM</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  'campaign_id',
                  'campaign_name',
                  'adset_id',
                  'adset_name',
                  'ad_id',
                  'ad_name',
                  'form_name',
                  'utm_source',
                  'utm_medium',
                  'utm_campaign',
                  'utm_content',
                  'utm_term',
                  'contact_notes',
                ].map((field) => (
                  <div key={field} className="app-card-soft border-primary/10 bg-primary/5 px-3 py-2 text-sm font-mono text-primary">
                    {field}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Esses campos são salvos automaticamente e exibidos na aba &quot;Contato&quot; do lead.
              </p>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <h4 className="font-medium">Respostas da API</h4>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-success">200</Badge>
                <span className="text-muted-foreground">Lead criado com sucesso</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-warning">400</Badge>
                <span className="text-muted-foreground">Campo obrigatório faltando</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-destructive">401</Badge>
                <span className="text-muted-foreground">Token inválido ou inativo</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Sheet open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setSelectedWebhook(null); resetForm(); } }}>
        <SheetContent side="right" className="app-card w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedWebhook ? 'Editar Webhook' : 'Novo Webhook'}</SheetTitle>
            <SheetDescription>
              {selectedWebhook ? 'Altere as configurações do webhook' : 'Configure um novo webhook para receber leads'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Nome do Webhook</Label>
              <Input
                placeholder="Ex: Leads do Site"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {!selectedWebhook && (
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, type: v as 'incoming' | 'outgoing' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incoming">Entrada (receber leads)</SelectItem>
                    <SelectItem value="outgoing" disabled>Saída (em breve)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags automáticas</Label>
              <InlineTagSelector
                selectedTagIds={formData.target_tag_ids}
                onToggleTag={(tagId) => {
                  setFormData(prev => ({
                    ...prev,
                    target_tag_ids: prev.target_tag_ids.includes(tagId)
                      ? prev.target_tag_ids.filter(id => id !== tagId)
                      : [...prev.target_tag_ids, tagId]
                  }));
                }}
              />
              <p className="text-xs text-muted-foreground">
                Clique nas tags para selecioná-las. Serão aplicadas automaticamente aos leads recebidos.
              </p>
            </div>

            <Separator />

            {/* Interest Selection */}
            <div className="space-y-3">
              <Label>Interesse do Lead</Label>
              <p className="text-xs text-muted-foreground">
                Defina o interesse padrão para leads recebidos por este webhook.
                A distribuição (pipeline, estágio) é configurada nas filas de distribuição.
              </p>

              <Select
                value={formData.interest_type || "__none__"}
                onValueChange={(v) => setFormData(prev => ({
                  ...prev,
                  interest_type: v === "__none__" ? '' : v as '' | 'property',
                  interest_property_id: '',
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sem interesse definido" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem interesse definido</SelectItem>
                  <SelectItem value="property">Imóvel</SelectItem>
                </SelectContent>
              </Select>

              {formData.interest_type === 'property' && (
                <Select
                  value={formData.interest_property_id || "__none__"}
                  onValueChange={(v) => setFormData(prev => ({
                    ...prev,
                    interest_property_id: v === "__none__" ? '' : v
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o imóvel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhum imóvel</SelectItem>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span>
                          {p.code}
                          {p.preco && (
                            <span className="ml-2 text-emerald-600">
                              R${p.preco.toLocaleString('pt-BR')}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={selectedWebhook ? handleUpdate : handleCreate}
                disabled={createWebhook.isPending || updateWebhook.isPending}
              >
                {(createWebhook.isPending || updateWebhook.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {selectedWebhook ? 'Salvar' : 'Criar Webhook'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function getWebhookAPIBaseURL() {
  return (process.env.NEXT_PUBLIC_VIMOB_API_URL || DEFAULT_WEBHOOK_API_URL).replace(/\/+$/, '');
}
