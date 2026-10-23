import { pendingPropertyAssetSchema, type PendingPropertyAsset } from '@/lib/validation/property-asset-recovery'
import type { PropertyAssetCreateInput, PropertyWorkspaceAsset } from '@/lib/validation/property-workspace'
import { assertPropertyMediaExecution, type PropertyMediaExecutionOptions } from '@/lib/property-media-execution'
import { PropertyMediaPersistenceError } from '@/lib/property-media-persistence'

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type RecoveryClient = {
  getWorkspace: (organizationId: string, propertyId: string, intent?: PropertyMediaExecutionOptions) => Promise<{ data: { assets: PropertyWorkspaceAsset[] } }>
  uploadAssetFile: (organizationId: string, propertyId: string, assetType: 'photo' | 'floor_plan' | 'document', file: File, execution?: PropertyMediaExecutionOptions) => Promise<{ storage_path: string }>
  createAsset: (organizationId: string, propertyId: string, input: PropertyAssetCreateInput, execution?: PropertyMediaExecutionOptions) => Promise<PropertyWorkspaceAsset>
  discardAssetUpload: (organizationId: string, propertyId: string, input: { storage_path: string }, execution?: PropertyMediaExecutionOptions) => Promise<unknown>
}

const inFlight = new Set<string>()
const preparing = new WeakMap<File, Set<string>>()

function recoveryStorage(): RecoveryStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* Refuse the POST if a durable attempt cannot be retained. */ }
  throw new Error('Não foi possível proteger este envio para nova tentativa. Confira o armazenamento do navegador antes de enviar o arquivo.')
}

function pendingKey(actorId: string, organizationId: string, propertyId: string, fingerprint: string) {
  return `property-asset-create:v1:${actorId}:${organizationId}:${propertyId}:${fingerprint}`
}

function readPending(storage: RecoveryStorage, key: string, scope: Omit<PendingPropertyAsset, 'input' | 'version'>) {
  const raw = storage.getItem(key)
  if (raw === null) return null
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new Error('O registro do envio pendente está inválido. Confira a mídia existente antes de tentar outro envio.') }
  const parsed = pendingPropertyAssetSchema.safeParse(decoded)
  if (!parsed.success || parsed.data.actorId !== scope.actorId || parsed.data.organizationId !== scope.organizationId
    || parsed.data.propertyId !== scope.propertyId || parsed.data.fingerprint !== scope.fingerprint) {
    throw new Error('O registro do envio pendente não corresponde a esta sessão e imóvel. Confira a mídia antes de continuar.')
  }
  return parsed.data
}

function forget(storage: RecoveryStorage, key: string) {
  try { storage.removeItem(key) } catch { /* A retained confirmed path reconciles safely next time. */ }
}

function definitiveRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]),
  )
  return value
}

function intentSignature(input: PropertyAssetCreateInput) {
  // The dialog derives order from refreshed asset counts; it is not a changed
  // operator intent. Privacy/type/text/metadata and file identity must match.
  return JSON.stringify(stableValue(JSON.parse(JSON.stringify({ ...input, sort_order: 0 }))))
}

type CreationOptions = {
  client: RecoveryClient
  organizationId: string
  propertyId: string
  input: Omit<PropertyAssetCreateInput, 'storage_path'>
  file?: File | null
  execution: PropertyMediaExecutionOptions
  storage?: RecoveryStorage
}

/** A retry reuses the original uploaded path and immutable POST, never new bytes. */
export async function createPropertyAssetWithRecovery(options: CreationOptions): Promise<PropertyWorkspaceAsset> {
  if (!options.file) return executeCreation(options)
  const scopeKey = `${options.execution.expectedUserId}:${options.organizationId}:${options.propertyId}`
  const active = preparing.get(options.file) ?? new Set<string>()
  if (active.has(scopeKey)) throw new Error('O envio deste arquivo ainda está aguardando confirmação.')
  active.add(scopeKey)
  preparing.set(options.file, active)
  try { return await executeCreation(options) } finally { active.delete(scopeKey) }
}

async function executeCreation(options: CreationOptions): Promise<PropertyWorkspaceAsset> {
  const { client, organizationId, propertyId, input, file, execution } = options
  assertPropertyMediaExecution(execution)
  if (!file) return client.createAsset(organizationId, propertyId, { ...input, storage_path: null }, execution)
  if (!['photo', 'floor_plan', 'document'].includes(input.asset_type)) throw new Error('Vídeos e tours virtuais devem usar uma URL externa')
  if (!execution.expectedUserId) throw new Error('Usuário não identificado para recuperar o envio')
  const storage = options.storage ?? recoveryStorage()
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  assertPropertyMediaExecution(execution)
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const scope = { actorId: execution.expectedUserId, organizationId, propertyId, fingerprint }
  const key = pendingKey(scope.actorId, organizationId, propertyId, fingerprint)
  if (inFlight.has(key)) throw new Error('O envio deste arquivo ainda está aguardando confirmação.')
  inFlight.add(key)
  try {
  let pending = readPending(storage, key, scope)
  const reconcile = async (attempt: PendingPropertyAsset) => {
    assertPropertyMediaExecution(execution)
    const workspace = await client.getWorkspace(organizationId, propertyId, execution)
    assertPropertyMediaExecution(execution)
    return workspace.data.assets.find(asset => asset.organization_id === organizationId && asset.property_id === propertyId
      && asset.storage_path === attempt.input.storage_path && asset.asset_type === attempt.input.asset_type) ?? null
  }
  if (pending) {
    const currentInput = pendingPropertyAssetSchema.parse({ version: 1, ...scope, input: {
      ...input, storage_path: pending.input.storage_path, external_url: null,
      file_name: file.name, mime_type: file.type || 'application/octet-stream', file_size_bytes: file.size,
    } }).input
    if (intentSignature(currentInput) !== intentSignature(pending.input)) {
      throw new Error('Este arquivo tem uma tentativa anterior com outros dados ou visibilidade. As novas alterações não foram aplicadas. Confira e edite a mídia existente antes de reenviar; para confirmar a tentativa pendente, mantenha os dados originais.')
    }
    const existing = await reconcile(pending)
    if (existing) { forget(storage, key); return existing }
  } else {
    let uploadedPath: string | null = null
    try {
      const uploaded = await client.uploadAssetFile(organizationId, propertyId,
        input.asset_type as 'photo' | 'floor_plan' | 'document', file, execution)
      uploadedPath = uploaded.storage_path
      assertPropertyMediaExecution(execution)
      pending = pendingPropertyAssetSchema.parse({ version: 1, ...scope, input: {
        ...input, storage_path: uploadedPath, external_url: null,
        file_name: file.name, mime_type: file.type || 'application/octet-stream', file_size_bytes: file.size,
      } })
      // No create POST is allowed until the original attempt is recoverable.
      storage.setItem(key, JSON.stringify(pending))
    } catch (error) {
      if (uploadedPath) {
        try {
          assertPropertyMediaExecution(execution)
          await client.discardAssetUpload(organizationId, propertyId, { storage_path: uploadedPath }, execution)
        } catch { throw new PropertyMediaPersistenceError(error, [], [uploadedPath]) }
      }
      throw error
    }
  }
  try {
    assertPropertyMediaExecution(execution)
    const asset = await client.createAsset(organizationId, propertyId, pending.input, execution)
    assertPropertyMediaExecution(execution)
    forget(storage, key)
    return asset
  } catch (error) {
    const path = pending.input.storage_path!
    try {
      const existing = await reconcile(pending)
      if (existing) { forget(storage, key); return existing }
      if (definitiveRejection(error)) {
        assertPropertyMediaExecution(execution)
        await client.discardAssetUpload(organizationId, propertyId, { storage_path: path }, execution)
        forget(storage, key)
        throw error
      }
    } catch (recoveryError) {
      if (recoveryError === error) throw error
    }
    // An absent row during timeout does not prove the POST cannot still commit.
    // Keep the immutable path/body for the next reconciliation or same-path retry.
    throw new PropertyMediaPersistenceError(error, [], [path])
  }
  } finally { inFlight.delete(key) }
}
