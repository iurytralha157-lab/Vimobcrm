import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Download, Trash2, Loader2 } from 'lucide-react';
import { financialAPI } from '@/lib/api/financial';

interface ContractDocumentsProps {
  contractId: string;
  organizationId: string;
}

interface DocItem {
  name: string;
  path: string;
  size: number;
  uploaded_at: string;
}

export function ContractDocuments({ contractId, organizationId }: ContractDocumentsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ['contract-documents', contractId],
    queryFn: () => financialAPI.listContractDocuments<DocItem[]>(contractId, organizationId),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      await financialAPI.uploadContractDocument<DocItem>(contractId, file, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      toast({ title: 'Documento anexado' });
    },
    onError: (e: Error) => toast({ title: 'Erro no upload', description: e.message, variant: 'destructive' }),
    onSettled: () => setUploading(false),
  });

  const deleteMutation = useMutation({
    mutationFn: async (doc: DocItem) => {
      await financialAPI.deleteContractDocument(contractId, doc.path, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-documents', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      toast({ title: 'Documento removido' });
    },
    onError: (e: Error) => toast({ title: 'Erro ao remover', description: e.message, variant: 'destructive' }),
  });

  const handleDownload = async (doc: DocItem) => {
    const signedUrl = await financialAPI.contractDocumentSignedURL(contractId, doc.path, organizationId);
    if (!signedUrl) {
      toast({ title: 'Erro ao baixar', variant: 'destructive' });
      return;
    }
    window.open(signedUrl, '_blank');
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Máximo 25MB', variant: 'destructive' });
      return;
    }
    setUploading(true);
    uploadMutation.mutate(file);
    e.target.value = '';
  };

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Documentos do Contrato</CardTitle>
        <label>
          <input
            type="file"
            className="hidden"
            onChange={handleFile}
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
          />
          <Button asChild size="sm" disabled={uploading}>
            <span className="cursor-pointer">
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Anexar
            </span>
          </Button>
        </label>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : !docs || docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum documento anexado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.path}
                className="flex items-center justify-between p-3 bg-white/[0.035] rounded-lg hover:bg-white/[0.055] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(doc.size)} • {new Date(doc.uploaded_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => handleDownload(doc)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(doc)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
