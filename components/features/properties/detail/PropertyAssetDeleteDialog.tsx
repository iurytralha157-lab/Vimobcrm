'use client'

import { Loader2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PropertyWorkspaceAsset } from '@/lib/validation'

export function PropertyAssetDeleteDialog({
  open,
  onOpenChange,
  asset,
  pending = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: PropertyWorkspaceAsset
  pending?: boolean
  onConfirm: () => Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-[8px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Remover mídia ou documento?</AlertDialogTitle>
          <AlertDialogDescription>
            {asset.title || asset.file_name || 'Este ativo'} será removido da ficha e do armazenamento protegido. Uma versão já publicada precisa ser despublicada antes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm().catch(() => undefined)
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
