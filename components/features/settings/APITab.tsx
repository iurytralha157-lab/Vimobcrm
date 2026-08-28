import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AlertTriangle, Copy, ExternalLink, Key, RefreshCw, ShieldCheck } from 'lucide-react';
import { settingsAPI, type OrganizationApiKey } from '@/lib/api/settings';

const formatApiKeyDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('pt-BR') : 'sem data';

export function APITab() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyToDelete, setKeyToDelete] = useState<OrganizationApiKey | null>(null);

  const { data: apiKeys, isLoading } = useQuery<OrganizationApiKey[]>({
    queryKey: ['api-keys', organizationId],
    queryFn: () => settingsAPI.listApiKeys(organizationId),
    enabled: !!organizationId,
  });

  const generateKeyMutation = useMutation<string, Error>({
    mutationFn: async () => {
      if (!organizationId) throw new Error('Organização não encontrada');
      const result = await settingsAPI.createApiKey(
        { name: keyName || 'Chave Padrao' },
        organizationId,
      );
      if (!result.apiKey) throw new Error('Resposta invalida da geracao de chave');
      return result.apiKey;
    },
    onSuccess: (apiKey) => {
      setNewKey(apiKey);
      setKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys', organizationId] });
      toast.success('Chave de API gerada com sucesso!');
    },
    onError: (error) => {
      console.error('Error generating API key:', error);
      toast.error(error.message || 'Erro ao gerar chave de API');
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await settingsAPI.deleteApiKey(id, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', organizationId] });
      toast.success('Chave de API removida');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Não foi possível remover a chave de API');
    },
  });

  const handleDeleteKey = async () => {
    if (!keyToDelete) return;

    try {
      await deleteKeyMutation.mutateAsync(keyToDelete.id);
      setKeyToDelete(null);
    } catch {
      // The mutation displays the error and the dialog remains open for retry.
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado para a area de transferencia!');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Card className="app-card border-amber-500/20 bg-amber-500/5">
        <CardContent className="pt-6 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Mantenha sua chave em segredo</p>
            <p className="text-muted-foreground">
              Estas credenciais são reservadas às integrações liberadas pela Vimob. Elas não
              substituem o login nem tornam públicos os endpoints internos do CRM. Nunca
              coloque uma chave no frontend ou em um repositório público.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="app-card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Chaves de API
              </CardTitle>
              <CardDescription>
                Gerencie credenciais emitidas para integrações habilitadas na sua organização.
                Consulte o guia antes de iniciar qualquer desenvolvimento.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 items-end">
            <div className="flex-1 space-y-1.5 w-full">
              <Label htmlFor="key-name">Apelido da chave (opcional)</Label>
              <Input
                id="key-name"
                placeholder="Ex.: Site institucional"
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                maxLength={80}
              />
            </div>
            <Button
              onClick={() => generateKeyMutation.mutate()}
              disabled={generateKeyMutation.isPending}
            >
              {generateKeyMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Gerar Nova Chave
            </Button>
          </div>

          {newKey && (
            <div className="app-card-soft p-4 border-primary/20 space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2 text-primary font-medium">
                <ShieldCheck className="h-4 w-4" />
                Sua nova chave de API
              </div>
              <p className="text-sm text-muted-foreground">
                Esta é a <strong>única vez</strong> que você verá a chave completa. Copie e
                guarde em local seguro agora; depois so restara o prefixo identificador.
              </p>
              <div className="flex gap-2">
                <Input value={newKey} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copyToClipboard(newKey)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
                Ja salvei, ocultar
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {isLoading ? (
              <div className="h-20 flex items-center justify-center text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                Carregando chaves...
              </div>
            ) : apiKeys?.length === 0 ? (
              <div className="app-card-soft text-center py-8 text-muted-foreground border-dashed">
                Nenhuma chave de API gerada.
              </div>
            ) : (
              apiKeys?.map((key) => (
                <div
                  key={key.id}
                  className="app-card-soft flex items-center justify-between p-4 transition-colors hover:bg-[var(--app-surface-hover)]"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{key.name}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-xs">
                        {key.key_prefix ?? key.id.slice(0, 8)}...
                      </code>
                      <span className="text-xs text-muted-foreground">
                        Criada em {formatApiKeyDate(key.created_at)}
                      </span>
                      {key.last_used_at && (
                        <span className="text-xs text-muted-foreground">
                          - Último uso {formatApiKeyDate(key.last_used_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setKeyToDelete(key)}
                  >
                    Remover
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-lg">Guia de integracoes e webhooks</CardTitle>
          <CardDescription>
            Entenda o escopo atual antes de conectar sistemas externos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="app-card-soft flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 gap-4">
            <div className="space-y-1">
              <p className="font-medium">Credenciais e webhooks</p>
              <p className="text-sm text-muted-foreground">
                Boas práticas, limites atuais e o caminho correto para configurar a integração.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/suporte/como-criar-chave-de-api-e-configurar-webhooks">
                <ExternalLink className="h-4 w-4 mr-2" />
                Ver guia de integracao
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={keyToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteKeyMutation.isPending) setKeyToDelete(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-24px)] max-w-[440px] gap-3 rounded-[8px] p-4 sm:p-5">
          <AlertDialogHeader className="space-y-1.5 text-left">
            <AlertDialogTitle className="text-[14px] font-normal">
              Remover chave de API
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
              A chave “{keyToDelete?.name ?? ''}” será invalidada imediatamente. Integrações que
              ainda a utilizam deixarão de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel
              disabled={deleteKeyMutation.isPending}
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={deleteKeyMutation.isPending}
              onClick={() => void handleDeleteKey()}
              className="h-9 rounded-[6px] bg-destructive px-3 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive/90"
            >
              {deleteKeyMutation.isPending && (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Remover chave
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
