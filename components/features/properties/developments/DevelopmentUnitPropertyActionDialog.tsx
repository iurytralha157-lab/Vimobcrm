'use client'

import { useRef, useState, type MouseEvent } from 'react'
import { FilePlus2, Link2, Loader2, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import {
  PropertyPickerDialog,
  type PropertyPickerProperty,
} from '@/components/features/properties/PropertyPickerDialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useLinkPropertyDevelopmentUnit,
  usePromotePropertyDevelopmentUnit,
  useUnlinkPropertyDevelopmentUnit,
} from '@/hooks/properties'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useProperties } from '@/hooks/use-properties'
import type { PropertyDevelopmentUnit } from '@/lib/validation'

export type DevelopmentUnitPropertyAction = 'link' | 'promote' | 'unlink'

type DevelopmentUnitPropertyActionDialogProps = {
  developmentId: string
  developmentName: string
  unit: PropertyDevelopmentUnit
  action: DevelopmentUnitPropertyAction
  floorPlanPropertyType?: string | null
  onClose: () => void
}

function normalizedStatus(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function getPropertyLinkBlockedReason(property: PropertyPickerProperty) {
  switch (normalizedStatus(property.status)) {
    case 'reserved':
    case 'reservado':
      return 'Imóvel reservado não pode ser vinculado.'
    case 'sold':
    case 'vendido':
      return 'Imóvel vendido não pode ser vinculado.'
    case 'rented':
    case 'alugado':
    case 'locado':
      return 'Imóvel alugado não pode ser vinculado.'
    case 'archived':
    case 'arquivado':
      return 'Imóvel arquivado não pode ser vinculado.'
    default:
      return null
  }
}

export function DevelopmentUnitPropertyActionDialog({
  developmentId,
  developmentName,
  unit,
  action,
  floorPlanPropertyType,
  onClose,
}: DevelopmentUnitPropertyActionDialogProps) {
  const linkMutation = useLinkPropertyDevelopmentUnit(developmentId)
  const promoteMutation = usePromotePropertyDevelopmentUnit(developmentId)
  const unlinkMutation = useUnlinkPropertyDevelopmentUnit(developmentId)
  const [propertySearch, setPropertySearch] = useState('')
  const debouncedPropertySearch = useDebouncedValue(propertySearch.trim(), 300)
  const propertiesQuery = useProperties(
    debouncedPropertySearch,
    {},
    { enabled: action === 'link', limit: 100 },
  )
  const selectedInPicker = useRef(false)
  const [pickerOpen, setPickerOpen] = useState(action === 'link')
  const [confirmationOpen, setConfirmationOpen] = useState(action !== 'link')
  const [selectedProperty, setSelectedProperty] = useState<PropertyPickerProperty | null>(null)
  const [propertyType, setPropertyType] = useState(floorPlanPropertyType?.trim() || '')
  const [title, setTitle] = useState('')

  const pending = linkMutation.isPending || promoteMutation.isPending || unlinkMutation.isPending

  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    try {
      if (action === 'link') {
        if (!selectedProperty?.updated_at) {
          toast.error('Atualize a lista e selecione novamente o imóvel para confirmar a versão atual.')
          return
        }
        await linkMutation.mutateAsync({
          unitId: unit.id,
          input: {
            property_id: selectedProperty.id,
            expected_unit_updated_at: unit.updated_at,
            expected_property_updated_at: selectedProperty.updated_at,
          },
        })
      } else if (action === 'promote') {
        await promoteMutation.mutateAsync({
          unitId: unit.id,
          input: {
            expected_unit_updated_at: unit.updated_at,
            property_type: propertyType.trim(),
            title: title.trim() || undefined,
          },
        })
      } else {
        if (!unit.property_id) {
          toast.error('A unidade já não possui uma ficha vinculada.')
          return
        }
        await unlinkMutation.mutateAsync({
          unitId: unit.id,
          propertyId: unit.property_id,
          input: { expected_unit_updated_at: unit.updated_at },
        })
      }
      onClose()
    } catch {
      // Domain hooks keep the confirmation open and expose the actionable error.
    }
  }

  const actionTitle = action === 'link'
    ? 'Vincular imóvel existente'
    : action === 'promote'
      ? 'Criar ficha para esta unidade'
      : 'Desvincular ficha do imóvel'
  const ActionIcon = action === 'link' ? Link2 : action === 'promote' ? FilePlus2 : Unlink

  return (
    <>
      {action === 'link' && (
        <PropertyPickerDialog
          open={pickerOpen}
          onOpenChange={(nextOpen) => {
            setPickerOpen(nextOpen)
            if (!nextOpen) {
              if (selectedInPicker.current) {
                selectedInPicker.current = false
              } else if (!confirmationOpen) {
                onClose()
              }
            }
          }}
          properties={propertiesQuery.data ?? []}
          isLoading={propertiesQuery.isLoading || propertiesQuery.isFetching}
          onSearchChange={setPropertySearch}
          selectedPropertyId={selectedProperty?.id}
          getBlockedReason={getPropertyLinkBlockedReason}
          onSelect={(property) => {
            selectedInPicker.current = true
            setSelectedProperty(property)
            setPickerOpen(false)
            setConfirmationOpen(true)
          }}
          trigger={<span className="hidden" aria-hidden="true" />}
        />
      )}

      <AlertDialog
        open={confirmationOpen}
        onOpenChange={(nextOpen) => {
          if (!pending) {
            setConfirmationOpen(nextOpen)
            if (!nextOpen) onClose()
          }
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-24px)] max-w-[460px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader>
            <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
              <ActionIcon className="h-4 w-4" />
            </div>
            <AlertDialogTitle className="text-[14px] font-normal">
              {actionTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
              {action === 'link' && selectedProperty
                ? `A unidade ${unit.unit_number} será vinculada ao imóvel ${selectedProperty.code || selectedProperty.title || selectedProperty.id}.`
                : action === 'promote'
                  ? `Será criada uma ficha privada, com código oficial, para a unidade ${unit.unit_number} de ${developmentName}.`
                  : `A unidade ${unit.unit_number} deixará de apontar para a ficha atual. A ficha do imóvel não será excluída.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {action === 'promote' && (
            <div className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <div className="space-y-1.5">
                <Label htmlFor="promoted-property-type" className="text-[11px] font-light">
                  Tipo do imóvel *
                </Label>
                <Input
                  id="promoted-property-type"
                  value={propertyType}
                  onChange={(event) => setPropertyType(event.target.value)}
                  placeholder="Apartamento"
                  maxLength={120}
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] shadow-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promoted-property-title" className="text-[11px] font-light">
                  Título personalizado
                </Label>
                <Input
                  id="promoted-property-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={`${developmentName} - Unidade ${unit.unit_number}`}
                  maxLength={240}
                  className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] shadow-none"
                />
              </div>
            </div>
          )}

          {action === 'unlink' && (
            <p className="rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] font-light text-destructive">
              Por segurança, unidades reservadas ou vendidas e imóveis reservados, vendidos, alugados ou publicados não podem ser desvinculados.
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={pending}
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || (action === 'promote' && !propertyType.trim()) || (action === 'link' && !selectedProperty)}
              onClick={confirm}
              className={action === 'unlink'
                ? 'h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive/90'
                : 'h-9 rounded-[6px] text-[12px] font-light shadow-none'}
            >
              {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {pending ? 'Processando…' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
