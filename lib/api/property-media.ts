import {
  PropertyMediaPersistenceError,
  persistStagedPropertyPhotosWithClient,
  type PropertyPhotoSelection,
} from '@/lib/property-media-persistence'

import { propertyWorkspaceAPI } from './property-workspace'
import type { PropertyMediaExecutionOptions } from '@/lib/property-media-execution'

export type { PropertyPhotoSelection } from '@/lib/property-media-persistence'
export { PropertyMediaPersistenceError }

export function persistStagedPropertyPhotos(
  organizationId: string,
  propertyId: string,
  selection: PropertyPhotoSelection,
  execution?: PropertyMediaExecutionOptions,
) {
  return persistStagedPropertyPhotosWithClient(
    organizationId,
    propertyId,
    selection,
    propertyWorkspaceAPI,
    execution,
  )
}
