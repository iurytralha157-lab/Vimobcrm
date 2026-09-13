import {
  PropertyMediaPersistenceError,
  persistStagedPropertyPhotosWithClient,
  type PropertyPhotoSelection,
} from '@/lib/property-media-persistence'

import { propertyWorkspaceAPI } from './property-workspace'

export type { PropertyPhotoSelection } from '@/lib/property-media-persistence'
export { PropertyMediaPersistenceError }

export function persistStagedPropertyPhotos(
  organizationId: string,
  propertyId: string,
  selection: PropertyPhotoSelection,
) {
  return persistStagedPropertyPhotosWithClient(
    organizationId,
    propertyId,
    selection,
    propertyWorkspaceAPI,
  )
}
