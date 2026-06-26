import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AlertTriangle, Copy, ExternalLink, Key, RefreshCw, ShieldCheck } from 'lucide-react';
import { settingsAPI, type OrganizationApiKey } from '@/lib/api/settings';

const formatApiKeyDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('pt-BR') : 'sem data';

export function APITab() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');

  const { data: apiKeys, isLoading } = useQuery<OrganizationApiKey[]>({
    queryKey: ['api-keys', profile?.organization_id],
    queryFn: () => settingsAPI.listApiKeys(profile?.organization_id),
    enabled: !!profile?.organization_id,
  });

  const generateKeyMutation = useMutation<string, Error>({
    mutationFn: async () => {
      if (!profile?.organization_id) throw new Error('Organizacao nao encontrada');
      const result = await settingsAPI.createApiKey(
        { name: keyName || 'Chave Padrao' },
        profile.organization_id,
      );
      if (!result.apiKey) throw new Error('Resposta invalida da geracao de chave');
      return result.apiKey;
    },
    onSuccess: (apiKey) => {
      setNewKey(apiKey);
      setKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Chave de API gerada com sucesso!');
    },
    onError: (error) => {
      console.error('Error generating API key:', error);
      toast.error(error.message || 'Erro ao gerar chave de API');
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await settingsAPI.deleteApiKey(id, profile?.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Chave de API removida');
    },
  });

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
              A chave da acesso aos imoveis desta organizacao. Nunca a coloque no frontend
              publico (HTML, JS do navegador, repositorios publicos). Use sempre a partir
              do seu backend.
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
                Use estas chaves para autenticar suas requisicoes na API publica e puxar
                os imoveis cadastrados nesta organizacao.
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
                Esta e a <strong>unica vez</strong> que voce vera a chave completa. Copie e
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
                  className="app-card-soft flex items-center justify-between p-4 transition-colors hover:bg-white/[0.055]"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{key.name}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs bg-white/[0.06] px-1.5 py-0.5 rounded">
                        {key.key_prefix ?? key.id.slice(0, 8)}...
                      </code>
                      <span className="text-xs text-muted-foreground">
                        Criada em {formatApiKeyDate(key.created_at)}
                      </span>
                      {key.last_used_at && (
                        <span className="text-xs text-muted-foreground">
                          - Ultimo uso {formatApiKeyDate(key.last_used_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm(`Remover a chave "${key.name}"? Sistemas que a usam pararao de funcionar imediatamente.`)) {
                        deleteKeyMutation.mutate(key.id);
                      }
                    }}
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
          <CardTitle className="text-lg">Documentacao da API</CardTitle>
          <CardDescription>
            Aprenda como integrar seus imoveis em sites e outros sistemas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="app-card-soft flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 gap-4">
            <div className="space-y-1">
              <p className="font-medium">Guia de Integracao</p>
              <p className="text-sm text-muted-foreground">
                Endpoints, parametros, exemplos em curl/JavaScript e formato de resposta.
              </p>
            </div>
            <Button variant="outline" asChild>
              <a href="/docs/api" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Ver Documentacao
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
