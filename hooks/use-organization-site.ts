import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { siteAPI, type OrganizationSite, type SiteAssetType } from '@/lib/api/site'
import { toast } from 'sonner'

export type { OrganizationSite }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useOrganizationSite() {
  const { organization } = useAuth()

  return useQuery({
    queryKey: ['organization-site', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null
      return siteAPI.getSite(organization.id)
    },
    enabled: !!organization?.id,
  })
}

export function useCreateOrganizationSite() {
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  return useMutation({
    mutationFn: async (data: Partial<OrganizationSite>) => {
      if (!organization?.id) throw new Error('No organization')
      return siteAPI.createSite(data, organization.id)
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['organization-site'] })
      queryClient.invalidateQueries({ queryKey: ['site-menu-items'] })
      queryClient.invalidateQueries({ queryKey: ['site-search-filters'] })
      toast.success('Site criado com sucesso!')
    },
    onError: (error) => {
      console.error('Error creating site:', error)
      toast.error('Erro ao criar site')
    },
  })
}

export function useUpdateOrganizationSite() {
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  return useMutation({
    mutationFn: async (data: Partial<OrganizationSite>) => {
      if (!organization?.id) throw new Error('No organization')
      return siteAPI.updateSite(data, organization.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-site'] })
      toast.success('Site atualizado com sucesso!')
    },
    onError: (error) => {
      console.error('Error updating site:', error)
      toast.error('Erro ao atualizar site')
    },
  })
}

export function useUploadSiteAsset() {
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  return useMutation({
    mutationFn: async ({ file, type }: { file: File; type: SiteAssetType }) => {
      if (!organization?.id) throw new Error('No organization')

      const maxSize = type === 'favicon' ? 1 : 10
      if (file.size > maxSize * 1024 * 1024) {
        throw new Error(`Arquivo muito grande. O limite e ${maxSize}MB.`)
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
      if (!allowedTypes.includes(file.type)) {
        throw new Error(`Tipo de arquivo nao permitido: ${file.type}`)
      }

      return siteAPI.uploadAsset({ file, type }, organization.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-site'] })
    },
    onError: (error: unknown) => {
      console.error('Error uploading asset:', error)
      toast.error('Erro ao fazer upload: ' + getErrorMessage(error))
    },
  })
}
