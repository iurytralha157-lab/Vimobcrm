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

interface PropertyAssetDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: PropertyWorkspaceAsset
  pending?: boolean
  onConfirm: () => Promise<void>
}

export function PropertyAssetDeleteDialog({
  open,
  onOpenChange,
  asset,
  pending = false,
  onConfirm,
}: PropertyAssetDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover mídia ou documento?</AlertDialogTitle>
          <AlertDialogDescription>
            {asset.title || asset.file_name || 'Este ativo'} deixará de fazer parte da ficha. Essa ação não pode ser desfeita pela interface.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              void onConfirm()
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
