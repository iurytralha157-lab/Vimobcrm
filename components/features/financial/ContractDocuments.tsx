'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CONTRACT_DOCUMENT_CONFIG } from '@/config/constants';
import { useToast } from '@/hooks/use-toast';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { financialAPI } from '@/lib/api/financial';
import type { ContractDocument } from '@/lib/validation';

interface ContractDocumentsProps {
  contractId: string;
  organizationId: string;
}

const CONTRACT_DOCUMENT_ACCEPT = Object.keys(CONTRACT_DOCUMENT_CONFIG.acceptedTypes).join(',');
const CONTRACT_DOCUMENT_FORMATS = 'PDF, DOC, DOCX, JPG, PNG, WEBP, XLS ou XLSX';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function validateContractDocument(file: File) {
  const fileName = file.name.trim();
  if (!fileName || fileName.length > 255 || /[\u0000-\u001F\u007F]/.test(fileName)) {
    return 'O nome do arquivo é inválido ou excede 255 caracteres.';
  }
  if (file.size <= 0) return 'O arquivo está vazio.';
  if (file.size > CONTRACT_DOCUMENT_CONFIG.maxBytes) return 'O arquivo deve ter no máximo 25 MB.';

  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : '';
  const acceptedTypes = CONTRACT_DOCUMENT_CONFIG.acceptedTypes as Record<string, string>;
  const expectedType = acceptedTypes[extension];

  if (!expectedType || file.type.toLowerCase() !== expectedType) {
    return `Formato não permitido. Envie um arquivo ${CONTRACT_DOCUMENT_FORMATS}.`;
  }

  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUploadedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleDateString('pt-BR');
}

export function ContractDocuments({ contractId, organizationId }: ContractDocumentsProps) {
  const { toast } = useToast();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<ContractDocument | null>(null);
  const hasDocumentContext = Boolean(contractId.trim() && organizationId.trim());
  const canManageDocuments = !permissionsLoading && hasPermission('financial_manage');
  const documentsQueryKey = ['contract-documents', organizationId, contractId] as const;
  const contractQueryKey = ['contract', organizationId, contractId] as const;

  const documentsQuery = useQuery({
    queryKey: documentsQueryKey,
    queryFn: () => financialAPI.listContractDocuments(contractId, organizationId),
    enabled: hasDocumentContext,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => financialAPI.uploadContractDocument(contractId, file, organizationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentsQueryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: contractQueryKey, exact: true }),
      ]);
      toast({ title: 'Documento anexado' });
    },
    onError: (error: unknown) => toast({
      title: 'Não foi possível anexar o documento',
      description: getErrorMessage(error, 'Tente novamente em instantes.'),
      variant: 'destructive',
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (document: ContractDocument) => (
      financialAPI.deleteContractDocument(contractId, document.path, organizationId)
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentsQueryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: contractQueryKey, exact: true }),
      ]);
      setDocumentToDelete(null);
      toast({ title: 'Documento removido' });
    },
    onError: (error: unknown) => toast({
      title: 'Não foi possível remover o documento',
      description: getErrorMessage(error, 'Tente novamente em instantes.'),
      variant: 'destructive',
    }),
  });

  const handleDownload = async (document: ContractDocument) => {
    if (downloadingPath) return;
    setDownloadingPath(document.path);

    try {
      const signedUrl = await financialAPI.contractDocumentSignedURL(
        contractId,
        document.path,
        organizationId,
      );
      const anchor = window.document.createElement('a');
      anchor.href = signedUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.download = document.name;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast({
        title: 'Não foi possível baixar o documento',
        description: getErrorMessage(error, 'Tente novamente em instantes.'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingPath(null);
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validationMessage = validateContractDocument(file);
    if (validationMessage) {
      toast({ title: 'Arquivo inválido', description: validationMessage, variant: 'destructive' });
      return;
    }

    uploadMutation.mutate(file);
  };

  const documents = documentsQuery.data ?? [];
  const showLoading = documentsQuery.isLoading || (documentsQuery.isFetching && !documentsQuery.data);
  const showError = !hasDocumentContext || documentsQuery.isError;
  const queryErrorMessage = !hasDocumentContext
    ? 'O contrato não possui um contexto de organização válido.'
    : getErrorMessage(documentsQuery.error, 'Tente carregar os documentos novamente.');

  return (
    <>
      <Card className="app-card shadow-none">
        <CardHeader className="flex flex-col gap-3 p-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-[14px] font-normal">Documentos do contrato</CardTitle>
            <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">
              Arquivos de até 25 MB em {CONTRACT_DOCUMENT_FORMATS}.
            </p>
          </div>

          {canManageDocuments && (
            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFile}
                accept={CONTRACT_DOCUMENT_ACCEPT}
                disabled={uploadMutation.isPending}
                aria-label="Selecionar documento do contrato"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
                disabled={uploadMutation.isPending}
                aria-busy={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {uploadMutation.isPending ? 'Anexando...' : 'Anexar'}
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="px-4 pb-4">
          {showLoading ? (
            <div
              className="flex min-h-28 items-center justify-center gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-4 text-[12px] font-light text-[var(--app-text-secondary)]"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando documentos...
            </div>
          ) : showError ? (
            <div
              className="flex min-h-32 flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-6 text-center"
              role="alert"
            >
              <FileText className="h-8 w-8 text-[var(--app-text-tertiary)]" aria-hidden="true" />
              <p className="mt-3 text-[13px] font-normal text-[var(--app-text-primary)]">
                Não foi possível carregar os documentos
              </p>
              <p className="mt-1 max-w-md text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                {queryErrorMessage}
              </p>
              {hasDocumentContext && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
                  disabled={documentsQuery.isFetching}
                  aria-busy={documentsQuery.isFetching}
                  onClick={() => void documentsQuery.refetch()}
                >
                  {documentsQuery.isFetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Tentar novamente
                </Button>
              )}
            </div>
          ) : documents.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-6 text-center">
              <FileText className="h-8 w-8 text-[var(--app-text-tertiary)]" aria-hidden="true" />
              <p className="mt-3 text-[13px] font-normal text-[var(--app-text-primary)]">
                Nenhum documento anexado
              </p>
              <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">
                {canManageDocuments
                  ? 'Use o botão Anexar para incluir o primeiro arquivo.'
                  : 'Ainda não há arquivos disponíveis neste contrato.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Documentos anexados ao contrato">
              {documents.map((document) => {
                const isDownloading = downloadingPath === document.path;
                const isDeleting = deleteMutation.isPending && documentToDelete?.path === document.path;

                return (
                  <li
                    key={document.path}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-primary">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-normal text-[var(--app-text-primary)]">
                          {document.name}
                        </p>
                        <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {formatBytes(document.size)} · {formatUploadedAt(document.uploaded_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-[6px] shadow-none"
                        disabled={Boolean(downloadingPath)}
                        aria-label={`Baixar ${document.name}`}
                        aria-busy={isDownloading}
                        onClick={() => void handleDownload(document)}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="h-4 w-4" aria-hidden="true" />
                        )}
                      </Button>
                      {canManageDocuments && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-[6px] text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          aria-label={`Excluir ${document.name}`}
                          aria-busy={isDeleting}
                          onClick={() => setDocumentToDelete(document)}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(documentToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDocumentToDelete(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] border-0 shadow-none sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-normal">Excluir documento?</AlertDialogTitle>
            <AlertDialogDescription className="break-words text-[12px] font-light leading-[18px]">
              O arquivo &quot;{documentToDelete?.name}&quot; será removido definitivamente do contrato. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-9 rounded-[6px] text-[12px] font-light shadow-none"
              disabled={deleteMutation.isPending}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive/90"
              disabled={deleteMutation.isPending || !documentToDelete}
              onClick={(event) => {
                event.preventDefault();
                if (documentToDelete) deleteMutation.mutate(documentToDelete);
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
