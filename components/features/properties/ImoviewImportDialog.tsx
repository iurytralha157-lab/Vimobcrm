import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useImoviewIntegration,
  useSaveImoviewIntegration,
  useTestImoviewConnection,
  useSyncImoviewProperties,
  useDeleteImoviewIntegration,
} from '@/hooks/use-imoview-integration';
import { Loader2, CheckCircle, XCircle, RefreshCw, Trash2, Plug, CloudDownload } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImoviewImportDialog({ open, onOpenChange }: Props) {
  const { data: integration, isLoading } = useImoviewIntegration();
  const saveIntegration = useSaveImoviewIntegration();
  const testConnection = useTestImoviewConnection();
  const syncProperties = useSyncImoviewProperties();
  const deleteIntegration = useDeleteImoviewIntegration();
  const syncErrorCount = syncProperties.data?.errors?.length ?? 0;

  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const isConnected = !!integration;

  const handleSaveAndTest = async () => {
    if (!apiKey.trim()) return;
    setTestResult(null);
    await saveIntegration.mutateAsync({ api_key: apiKey.trim() });
    const result = await testConnection.mutateAsync();
    setTestResult(result);
  };

  const handleTestExisting = async () => {
    setTestResult(null);
    const result = await testConnection.mutateAsync();
    setTestResult(result);
  };

  const handleSync = async () => {
    await syncProperties.mutateAsync();
  };

  const handleDisconnect = async () => {
    await deleteIntegration.mutateAsync();
    setTestResult(null);
    setApiKey('');
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Integração Imoview</DialogTitle>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Integração Imoview
          </DialogTitle>
          <DialogDescription>
            Conecte sua conta Imoview para importar imóveis automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="imoview-key">Chave da API Imoview</Label>
              <Input
                id="imoview-key"
                type="password"
                placeholder="Sua chave de acesso fornecida pela Universal Software"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A chave é fornecida pela Universal Software. Entre em contato com suporte@unsoft.com.br caso não possua.
              </p>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {testResult.success ? 'Conexão válida!' : testResult.error || 'Erro na conexão'}
              </div>
            )}

            <Button
              onClick={handleSaveAndTest}
              disabled={!apiKey.trim() || saveIntegration.isPending || testConnection.isPending}
              className="w-full"
            >
              {(saveIntegration.isPending || testConnection.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Conectar e Testar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-lg border border-white/[0.055] bg-white/[0.045] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                <Badge variant="default" className="bg-success text-success-foreground">
                  Conectado
                </Badge>
              </div>
              {integration.last_sync_at && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Última sincronização</span>
                  <span className="text-sm">
                    {format(new Date(integration.last_sync_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Imóveis importados</span>
                <span className="text-sm font-bold">{integration.total_synced || 0}</span>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {testResult.success ? 'Conexão válida!' : testResult.error || 'Erro na conexão'}
              </div>
            )}

            {syncProperties.data && !syncProperties.isPending && (
              <div className="p-3 rounded-lg bg-primary/10 text-sm">
                <p className="font-medium">{syncProperties.data.synced} imóveis sincronizados</p>
                {syncProperties.data.skipped > 0 && (
                  <p className="text-muted-foreground">{syncProperties.data.skipped} ignorados</p>
                )}
                {syncErrorCount > 0 && (
                  <p className="text-destructive">{syncErrorCount} erros</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSync}
                disabled={syncProperties.isPending}
                className="flex-1"
              >
                {syncProperties.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CloudDownload className="h-4 w-4 mr-2" />
                )}
                {syncProperties.isPending ? 'Sincronizando...' : 'Sincronizar Imóveis'}
              </Button>
              <Button variant="outline" size="icon" onClick={handleTestExisting} disabled={testConnection.isPending}>
                {testConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={handleDisconnect} disabled={deleteIntegration.isPending}>
                {deleteIntegration.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
