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

import type { LocationDeletionTarget } from './model'

type DeletionDialogProps = {
  target: LocationDeletionTarget | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeletionDialog({
  target,
  pending,
  onOpenChange,
  onConfirm,
}: DeletionDialogProps) {
  const isOwner = target?.type === 'owner'

  return (
    <AlertDialog
      open={Boolean(target)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onOpenChange(false)
      }}
    >
      <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-normal">
            {isOwner ? 'Desativar' : 'Excluir'} {target?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs font-light">
            {isOwner
              ? 'O proprietário sairá do cadastro ativo. A ação será impedida se ainda houver imóveis vinculados.'
              : 'Esta ação é permanente e pode ser impedida caso existam imóveis ou cadastros vinculados.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending}
            className="rounded-[6px] shadow-none"
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            className="rounded-[6px] bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {pending
              ? isOwner
                ? 'Desativando...'
                : 'Excluindo...'
              : isOwner
                ? 'Desativar'
                : 'Excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
