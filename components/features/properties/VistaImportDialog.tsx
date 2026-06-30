import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useVistaIntegration,
  useSaveVistaIntegration,
  useTestVistaConnection,
  useSyncVistaProperties,
  useDeleteVistaIntegration,
} from '@/hooks/use-vista-integration';
import { Loader2, CheckCircle, XCircle, RefreshCw, Trash2, Plug, CloudDownload } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Desconhecido';
}

export function VistaImportDialog({ open, onOpenChange }: Props) {
  const { data: integration, isLoading } = useVistaIntegration();
  const saveIntegration = useSaveVistaIntegration();
  const testConnection = useTestVistaConnection();
  const syncProperties = useSyncVistaProperties();
  const deleteIntegration = useDeleteVistaIntegration();

  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const isConnected = !!integration;

  const handleSaveAndTest = async () => {
    if (!apiUrl.trim() || !apiKey.trim()) return;
    setTestResult(null);
    try {
      await saveIntegration.mutateAsync({ api_url: apiUrl.trim(), api_key: apiKey.trim() });
      const result = await testConnection.mutateAsync();
      setTestResult(result);
    } catch (error: unknown) {
      setTestResult({ success: false, error: 'Erro de comunicação com o servidor: ' + getErrorMessage(error) });
    }
  };

  const handleTestExisting = async () => {
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync();
      setTestResult(result);
    } catch (error: unknown) {
      setTestResult({ success: false, error: 'Erro de comunicação com o servidor: ' + getErrorMessage(error) });
    }
  };

  const handleSync = async () => {
    try {
      await syncProperties.mutateAsync();
    } catch {
      // The use-vista-integration hook already triggers a toast on error
    }
  };

  const handleDisconnect = async () => {
    try {
      await deleteIntegration.mutateAsync();
      setTestResult(null);
      setApiUrl('');
      setApiKey('');
    } catch {
      // Handled by hook error toast
    }
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Integração Vista Software</DialogTitle>
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
            Integração Vista Software
          </DialogTitle>
          <DialogDescription>
            Conecte sua conta Vista para importar imóveis automaticamente.
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          /* --- SETUP FORM --- */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vista-url">URL da API Vista</Label>
              <Input
                id="vista-url"
                placeholder="http://suaempresa.vistahost.com.br"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Ex: http://suaempresa.vistahost.com.br
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vista-key">Chave da API</Label>
              <Input
                id="vista-key"
                type="password"
                placeholder="Sua chave de acesso"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
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
              disabled={!apiUrl.trim() || !apiKey.trim() || saveIntegration.isPending || testConnection.isPending}
              className="w-full"
            >
              {(saveIntegration.isPending || testConnection.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Conectar e Testar
            </Button>
          </div>
        ) : (
          /* --- CONNECTED STATE --- */
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border-0 bg-[var(--app-surface-soft)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                <Badge variant="default" className="bg-success text-success-foreground">
                  Conectado
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">URL</span>
                <span className="text-sm font-mono truncate max-w-[200px]">{integration.api_url}</span>
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
                  <p className="text-muted-foreground">{syncProperties.data.skipped} ignorados (inativos)</p>
                )}
                {syncProperties.data.errors?.length > 0 && (
                  <div className="text-destructive mt-2 space-y-1">
                    <p>{syncProperties.data.errors.length} erros:</p>
                    <ul className="list-disc list-inside text-xs">
                      {syncProperties.data.errors.map((err: string, idx: number) => (
                        <li key={idx} className="break-words">{err}</li>
                      ))}
                    </ul>
                  </div>
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
