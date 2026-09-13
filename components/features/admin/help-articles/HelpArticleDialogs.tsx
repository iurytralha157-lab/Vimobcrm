'use client';

import { Eye, Loader2 } from 'lucide-react';

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { HelpArticle } from '@/hooks/use-help-articles';

import { HelpArticlePreview } from './HelpArticlePreview';

export function HelpArticlePreviewDialog({
  article,
  onClose,
}: {
  article: HelpArticle | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(article)} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-hidden rounded-[8px] p-0 shadow-none">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-primary" />
            Prévia do artigo
          </DialogTitle>
          <DialogDescription className="sr-only">
            Visualização do artigo como será apresentado na Central de Ajuda.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(92dvh-74px)]">
          <div className="px-5 pb-6">
            {article ? <HelpArticlePreview article={article} /> : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function HelpArticleDeleteDialog({
  article,
  isDeleting,
  onClose,
  onConfirm,
}: {
  article: HelpArticle | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(article)} onOpenChange={(open) => {
      if (!open && isDeleting) return;
      if (!open) onClose();
    }}>
      <AlertDialogContent className="rounded-[8px] shadow-none" aria-busy={isDeleting}>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
          <AlertDialogDescription>
            “{article?.title}” será removido da Central de Ajuda e deixará de aparecer nas buscas. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Excluir artigo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
