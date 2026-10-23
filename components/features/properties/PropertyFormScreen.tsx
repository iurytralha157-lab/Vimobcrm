"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { ImageUploader } from "@/components/features/properties/ImageUploader";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { FormWizardLayout } from "@/components/shared/forms/FormWizardLayout";
import { FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from "@/config/form-wizard";
import { PropertyHistoryDialog } from "@/components/features/properties/PropertyHistoryDialog";
import {
  Loader2,
  Save,
  User,
  MapPin,
  Home,
  Settings2,
  Image,
  Globe,
  DollarSign,
  Percent,
  Lock,
  Tag,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useProperty,
  useCreateProperty,
  useUpdateProperty,
} from "@/hooks/use-properties";
import {
  usePropertyTypes,
  useCreatePropertyType,
} from "@/hooks/use-property-types";
import {
  usePropertyFeatures,
  useCreatePropertyFeature,
  useSeedDefaultFeatures,
} from "@/hooks/use-property-features";
import {
  usePropertyProximities,
  useCreatePropertyProximity,
  useSeedDefaultProximities,
} from "@/hooks/use-property-proximities";
import {
  useCreateCity,
  useCreateCondominium,
  useCreateNeighborhood,
  usePropertyCities,
  usePropertyCondominiums,
  usePropertyNeighborhoods,
  type PropertyCity,
  type PropertyCondominium,
  type PropertyNeighborhood,
} from "@/hooks/use-property-locations";
import {
  useCreatePropertyOwner,
  type PropertyOwner,
} from "@/hooks/use-property-owners";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAssignProperties,
  canManageProperties,
  canViewPropertyOwnerContacts,
  isPropertyEditAccessReady,
} from "@/lib/access/properties";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PropertyMediaPersistenceError,
  persistStagedPropertyPhotos,
} from "@/lib/api/property-media";
import { propertyWorkspaceAPI } from "@/lib/api/property-workspace";
import { propertiesAPI } from "@/lib/api/properties";
import { requestAutomaticSitePublication, captureAutomaticSitePublicationAction, INITIAL_AUTOMATIC_SITE_PUBLICATION_ACTION, type AutomaticSitePublicationAction } from "@/lib/api/property-auto-publication";
import { stringifyErrorMessage as getErrorMessage } from "@/lib/api/vimob-error";
import { isPropertyWorkspaceConflict } from "@/lib/property-concurrency";
import { releaseStagedPropertyPhotos } from "@/lib/property-media-draft";
import { propertyUpdateInputSchema, propertyCreateInputSchema } from "@/lib/validation";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { getVimobAPIAccessTokenSessionId } from "@/lib/api/vimob-client";
import { getClientRateLimitMessage } from "@/lib/client-action-rate-limit";
import {
  readPropertyCreationIntent,
  preparePropertyCreationIntent,
  forgetPropertyCreationIntent,
  propertyCreationRejectionCanReset,
  preserveConfirmedPropertyCreation,
  type PropertyCreationIntent,
} from "@/lib/properties/property-creation-intent";
import { PropertyFormSubmission } from "@/lib/properties/property-form-submission";
import { readConfirmedPropertyReceipt, verifyConfirmedPropertyRecovery, type ConfirmedPropertyReceipt } from "@/lib/properties/property-creation-recovery";
import { usePropertyCepLookup } from "@/hooks/properties/use-property-cep-lookup";
import { usePropertyFormScope } from "@/hooks/properties/use-property-form-scope";
import { useTenantQueryAccessSignature } from "@/hooks/shared/use-tenant-query-access-signature";
import { selectPropertyOwner } from "@/components/features/properties/property-form/property-owner-selection";
import { propertySchemaIssuesToForm } from "@/components/features/properties/property-form/property-form-schema-issues";
import { propertyEditDraftKey, propertyEditDraftAccessSignature, savePropertyEditDraft, recoverPropertyEditDraft, clearPropertyEditDraft, getPropertyEditDraftStorage, hasPropertyEditDraft } from "@/components/features/properties/property-form/property-edit-draft";
import { PROPERTY_DRAFT_STORAGE_WARNING } from "@/components/features/properties/property-form/property-creation-draft";
import { capturePropertyFormAction, type PropertyFormAction } from "@/components/features/properties/property-form/property-form-session";
import {
  DEFAULT_DEAL_OPTIONS,
  DEFAULT_PURPOSE_OPTIONS,
  appendUniqueOption,
  buildPropertyMutationInput,
  clearDraft,
  getPropertyFormRules,
  getPropertyPublicationValidationIssues,
  getPropertyValidationIssues,
  initialFormData,
  isSaleType,
  normalize,
  onlyCepDigits,
  optionsWithCurrent,
  parseCurrencyInput,
  propertyDraftKey,
  readDraft,
  readDraftState,
  saveDraft,
  type PropertyFormData,
  type PropertyOwnership,
  type ValidationIssue,
} from "./property-form/property-form-model";
import { propertyToFormData } from "./property-form/property-form-mapping";
import {
  applyCepAddressToLocation,
  readBackPropertyLocation,
} from "./property-form/property-cep-location";
import {
  selectLocationCity,
  selectLocationCondominium,
  selectLocationNeighborhood,
  setManualLocationField,
} from "./property-form/property-location-selection";
import {
  arePropertySnapshotsEqualOutsideMedia,
  resolvePropertyFormRefetch,
  rebasePropertyFormMedia,
} from "./property-form/property-form-hydration";
import {
  catalogLocationIdForMutation,
  catalogLocationsOnly,
} from "./property-locations/model";
import { PropertyFormDialog } from "@/components/features/properties/property-form/PropertyFormDialog";
import { PropertyFormAside } from "@/components/features/properties/property-form/PropertyFormAside";
import { usePropertyFormNavigationGuard } from "@/hooks/properties/use-property-form-navigation-guard";
import {
  PropertyFormSectionsProvider,
  type PropertyFormSectionsContextValue,
} from "./property-form/PropertyFormSectionsContext";
import { OwnerSection } from "./property-form/sections/OwnerSection";
import { StructureSection } from "./property-form/sections/StructureSection";
import { LocationSection } from "./property-form/sections/LocationSection";
import { CharacteristicsSection } from "./property-form/sections/CharacteristicsSection";
import { ExtrasSection } from "./property-form/sections/ExtrasSection";
import { ValuesSection } from "./property-form/sections/ValuesSection";
import { MediaSection } from "./property-form/sections/MediaSection";
import { PublicationSection } from "./property-form/sections/PublicationSection";
import { CommissionsSection } from "./property-form/sections/CommissionsSection";
import { ConfidentialSection } from "./property-form/sections/ConfidentialSection";

type PropertyFormTab = {
  value: string;
  label: string;
  description: string;
  icon: typeof User;
};

type CreatedPropertyForMediaRetry = ConfirmedPropertyReceipt;

export default function PropertyForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const propertyId = Array.isArray(rawId)
    ? (rawId[0] ?? null)
    : (rawId ?? null);
  const isEditing = !!propertyId;
  const {
    activeOrganization,
    organization,
    user,
    profile,
    tenantContext,
    isSuperAdmin,
  } = useAuth();
  const draftKey = propertyDraftKey(
    activeOrganization.organizationId,
    user?.id ?? profile?.id,
  );
  const mediaRecoveryKey = `${draftKey}:created-property`;
  const creationIntentKey = `${draftKey}:creation-intent`;
  const editDraftKey = propertyEditDraftKey(activeOrganization.organizationId, user?.id, propertyId);
  const accessSignature = useTenantQueryAccessSignature();
  const { scope: formScope, isCurrent: isFormScopeCurrent } = usePropertyFormScope({
    actorId: user?.id, organizationId: activeOrganization.organizationId,
    resourceId: propertyId ?? "new", accessSignature,
  });

  const [formData, setFormDataState] = useState<PropertyFormData>(() => {
    if (!propertyId && typeof window !== "undefined") {
      try {
        return readDraft(draftKey) ?? initialFormData;
      } catch {
        // noop
      }
    }
    return initialFormData;
  });
  const propertyFormDirtyRef = useRef(false);
  const submission = useRef(new PropertyFormSubmission());
  const [isSaving, setIsSaving] = useState(false);
  const [isPreparingPhotos, setIsPreparingPhotos] = useState(false);
  const [schemaValidationIssues, setSchemaValidationIssues] = useState<ValidationIssue[]>([]);
  const [pendingCreation, setPendingCreation] = useState<PropertyCreationIntent | null>(null);
  const [creationRecoveryError, setCreationRecoveryError] = useState<string | null>(null);
  const [draftStorageWarning, setDraftStorageWarning] = useState<string | null>(null);
  const [confirmedRecoveryError, setConfirmedRecoveryError] = useState<string | null>(null);
  const [isCheckingCreatedProperty, setIsCheckingCreatedProperty] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasConcurrencyConflict, setHasConcurrencyConflict] = useState(false);
  const [editDraftRestored, setEditDraftRestored] = useState(false);
  const [isRecoveringEditDraft, setIsRecoveringEditDraft] = useState(() => isEditing && hasPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey));
  const hydratedPropertyIdRef = useRef<string | null>(null);
  const hydratedPropertyUpdatedAtRef = useRef<string | null>(null);
  const hydratedPropertySnapshotRef = useRef<Record<string, unknown> | null>(
    null,
  );
  const markPropertyFormPristine = useCallback(() => {
    propertyFormDirtyRef.current = false;
    setHasUnsavedChanges(false);
    setEditDraftRestored(false);
    setIsRecoveringEditDraft(false);
    clearPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey);
  }, [editDraftKey]);
  const confirmFormNavigation = usePropertyFormNavigationGuard({
    enabled: hasUnsavedChanges,
    onConfirmDiscard: markPropertyFormPristine,
  });
  const setFormData = useCallback<Dispatch<SetStateAction<PropertyFormData>>>(
    (nextFormData) => {
      if (!submission.current.canEdit() || pendingCreation || creationRecoveryError || confirmedRecoveryError || isCheckingCreatedProperty || isRecoveringEditDraft) return;
      propertyFormDirtyRef.current = true;
      setHasUnsavedChanges(true);
      setSchemaValidationIssues([]);
      setFormDataState(nextFormData);
    },
    [pendingCreation, creationRecoveryError, confirmedRecoveryError, isCheckingCreatedProperty, isRecoveringEditDraft],
  );
  const [hasDraft, setHasDraft] = useState(
    () => !propertyId && typeof window !== "undefined" && Boolean(readDraft(draftKey)),
  );
  const [activeTab, setActiveTab] = useState("owner");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [isPersistingMedia, setIsPersistingMedia] = useState(false);
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
  const [mediaUploadFailure, setMediaUploadFailure] = useState<string | null>(null);
  const [publicationSaveFeedback, setPublicationSaveFeedback] = useState<string | null>(null);
  const createdPropertyForMediaRetryRef =
    useRef<CreatedPropertyForMediaRetry | null>(null);
  const createdPropertyMediaCompleteRef = useRef(false);
  const stagedPhotoURLsRef = useRef<string[]>([]);
  const [purposeOptions, setPurposeOptions] = useState(DEFAULT_PURPOSE_OPTIONS);

  const checkConfirmedProperty = useCallback(async (receipt: CreatedPropertyForMediaRetry, action?: PropertyFormAction) => {
    const formAction = action ?? capturePropertyFormAction(() => isFormScopeCurrent(formScope), getVimobAPIAccessTokenSessionId);
    const assertCurrentScope = () => {
      formAction.assertCurrent();
      if (receipt.organizationId !== formScope.organizationId || receipt.actorId !== formScope.actorId) throw new Error("A sessão do cadastro mudou. Reabra o imóvel antes de continuar.");
    };
    assertCurrentScope();
    const result = await verifyConfirmedPropertyRecovery(receipt, async () => {
      const { data } = await propertiesAPI.getProperty(receipt.id, receipt.organizationId, {
        creationRecovery: true, expectedUserId: formScope.actorId, expectedSessionId: formAction.expectedSessionId, onRequestStart: assertCurrentScope,
      });
      return data;
    });
    assertCurrentScope();
    if (result === "removed") {
      // An ordinary 404/403 never reaches here. Keep the draft, and require a
      // separate explicit save before a new creation intent can be sent.
      localStorage.removeItem(mediaRecoveryKey);
      forgetPropertyCreationIntent(localStorage, creationIntentKey);
      createdPropertyForMediaRetryRef.current = null;
      createdPropertyMediaCompleteRef.current = false;
      setCreatedPropertyId(null);
      setPendingCreation(null);
      setMediaUploadFailure(null);
      toast.info("O cadastro anterior foi excluído. O rascunho foi preservado; revise os dados antes de salvar um novo imóvel.", { duration: 8000 });
    }
    setConfirmedRecoveryError(null);
    return result;
  }, [creationIntentKey, formScope, isFormScopeCurrent, mediaRecoveryKey]);

  useEffect(() => {
    // Memory belongs to this mount/scope. Durable receipts remain in their
    // original actor/tenant keys and will be checked by the recovery effect.
    createdPropertyForMediaRetryRef.current = null;
    createdPropertyMediaCompleteRef.current = false;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setPendingCreation(isEditing ? null : readPropertyCreationIntent(localStorage, creationIntentKey));
        setCreationRecoveryError(null);
      } catch (error) {
        setCreationRecoveryError(getErrorMessage(error));
      }
      setIsPreparingPhotos(false);
      setIsCheckingCreatedProperty(false);
      setConfirmedRecoveryError(null);
      setCreatedPropertyId(null);
      setMediaUploadFailure(null);
    });
    return () => { cancelled = true; };
  }, [creationIntentKey, formScope, isEditing]);

  useEffect(() => {
    document.getElementById(`property-tab-${activeTab}`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTab]);

  useEffect(() => {
    stagedPhotoURLsRef.current = [
      formData.imagem_principal,
      ...formData.fotos,
    ];
  }, [formData.fotos, formData.imagem_principal]);

  useEffect(
    () => () => releaseStagedPropertyPhotos(stagedPhotoURLsRef.current),
    [],
  );
  const [newPurposeName, setNewPurposeName] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [showAddPurpose, setShowAddPurpose] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [showAddCity, setShowAddCity] = useState(false);
  const [showAddNeighborhood, setShowAddNeighborhood] = useState(false);
  const [showAddCondominium, setShowAddCondominium] = useState(false);
  const [newCityName, setNewCityName] = useState("");
  const [newCityUf, setNewCityUf] = useState("");
  const [newNeighborhoodName, setNewNeighborhoodName] = useState("");
  const [newCondominiumName, setNewCondominiumName] = useState("");
  const [newCondominiumFee, setNewCondominiumFee] = useState("");
  const [newCondominiumPhoto, setNewCondominiumPhoto] = useState("");
  const [newCondominiumHasConcierge, setNewCondominiumHasConcierge] =
    useState(false);
  const [newCondominiumConciergeType, setNewCondominiumConciergeType] =
    useState("");

  useEffect(() => {
    if (
      isEditing ||
      createdPropertyId ||
      createdPropertyForMediaRetryRef.current ||
      typeof window === "undefined"
    ) {
      return;
    }

    let isActive = true;
    const { draft, warning } = readDraftState(draftKey);

    queueMicrotask(() => {
      if (!isActive || createdPropertyForMediaRetryRef.current) return;
      setFormDataState(draft ?? initialFormData);
      setHasDraft(!!draft);
      setDraftStorageWarning(warning);
    });

    return () => {
      isActive = false;
    };
  }, [createdPropertyId, draftKey, isEditing]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !activeOrganization.organizationId ||
      !(user?.id ?? profile?.id)
    ) {
      return;
    }
    // Editing is confirmed by its normal scoped read and can be allowed
    // without the management permission required to prove deletion.
    if (isEditing) return;
    let pending: CreatedPropertyForMediaRetry | null;
    try {
      pending = readConfirmedPropertyReceipt(localStorage, mediaRecoveryKey, formScope);
    } catch (error) {
      queueMicrotask(() => {
        if (isFormScopeCurrent(formScope)) setConfirmedRecoveryError(getErrorMessage(error));
      });
      return;
    }
    if (!pending || pending.organizationId !== activeOrganization.organizationId) {
      return;
    }
    // A reload loses the File objects. Resume on the existing property's edit
    // page so another click can never create a duplicate property.
    if (!isEditing && createdPropertyForMediaRetryRef.current?.id === pending.id) return;
    let cancelled = false;
    const recoveryAction = capturePropertyFormAction(() => isFormScopeCurrent(formScope), getVimobAPIAccessTokenSessionId);
    queueMicrotask(async () => {
      if (cancelled || !recoveryAction.isCurrent()) return;
      setIsCheckingCreatedProperty(true);
      try {
        const result = await checkConfirmedProperty(pending, recoveryAction);
        if (cancelled || !recoveryAction.isCurrent()) return;
        if (result === "existing") {
          router.replace(`/properties/${pending.id}/edit`);
        }
      } catch (error) {
        if (!cancelled && recoveryAction.isCurrent()) {
          setConfirmedRecoveryError("Não foi possível confirmar o cadastro anterior. " + getErrorMessage(error));
        }
      } finally {
        if (!cancelled && isFormScopeCurrent(formScope)) setIsCheckingCreatedProperty(false);
      }
    });
    return () => { cancelled = true; };
  }, [
    activeOrganization.organizationId,
    checkConfirmedProperty,
    formScope,
    isEditing,
    isFormScopeCurrent,
    mediaRecoveryKey,
    profile?.id,
    propertyId,
    router,
    recoveryAttempt,
    user?.id,
  ]);

  const propertyQuery = useProperty(propertyId);
  const {
    data: property,
    isLoading: loadingProperty,
    isError: propertyLoadFailed,
    error: propertyLoadError,
    refetch: refetchProperty,
  } = propertyQuery;
  const { data: propertyTypes = [] } = usePropertyTypes();
  const { data: features = [], isLoading: loadingFeatures } =
    usePropertyFeatures();
  const { data: proximities = [], isLoading: loadingProximities } =
    usePropertyProximities();
  const { data: cities = [] } = usePropertyCities();
  const catalogCities = useMemo(() => catalogLocationsOnly(cities), [cities]);
  const writableCityId = catalogLocationIdForMutation(
    cities,
    formData.city_id,
  );
  const { data: neighborhoods = [] } = usePropertyNeighborhoods(
    writableCityId || undefined,
  );
  const catalogNeighborhoods = useMemo(
    () => catalogLocationsOnly(neighborhoods),
    [neighborhoods],
  );
  const { data: condominiums = [] } = usePropertyCondominiums();
  const { data: users = [] } = useUsers();
  useEffect(() => {
    if (!isEditing || !property || property.id !== propertyId
      || property.organization_id !== formScope.organizationId || !isFormScopeCurrent(formScope)) return;
    try {
      const receipt = readConfirmedPropertyReceipt(localStorage, mediaRecoveryKey, formScope);
      if (receipt?.id === property.id) {
        localStorage.removeItem(mediaRecoveryKey);
        forgetPropertyCreationIntent(localStorage, creationIntentKey);
      }
    } catch {
      // Editing this confirmed existing ID is safe even when browser storage
      // cannot be cleared. A later create still checks the durable marker.
    }
  }, [creationIntentKey, formScope, isEditing, isFormScopeCurrent, mediaRecoveryKey, property, propertyId]);
  const createPropertyType = useCreatePropertyType();
  const createProperty = useCreateProperty({ showSuccessToast: false });
  const updateProperty = useUpdateProperty({ showSuccessToast: false });
  const createFeature = useCreatePropertyFeature();
  const createProximity = useCreatePropertyProximity();
  const createCity = useCreateCity();
  const createNeighborhood = useCreateNeighborhood();
  const createCondominium = useCreateCondominium();
  const createPropertyOwner = useCreatePropertyOwner();
  const { mutate: seedDefaultFeatures } = useSeedDefaultFeatures();
  const { mutate: seedDefaultProximities } = useSeedDefaultProximities();

  const activeOrganizationId =
    property?.organization_id ||
    activeOrganization.organizationId ||
    undefined;
  const isPropertyAccessReady = isPropertyEditAccessReady({
    isEditing,
    propertyOrganizationId: property?.organization_id,
    activeOrganizationId: activeOrganization.organizationId,
    loadedOrganizationId: organization?.id,
    tenantOrganizationId: tenantContext?.organizationId,
    propertyEditPolicy: organization?.property_edit_policy,
  });
  const propertyAccessContext = {
    userId: user?.id,
    organizationId: activeOrganizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
    propertyEditPolicy: organization?.property_edit_policy,
    propertyOwnerContactVisibility:
      organization?.property_owner_contact_visibility,
  };
  const propertyOwnership = property as PropertyOwnership | undefined;
  const canManagePropertyCatalogs = canManageProperties(propertyAccessContext);
  const canAssignProperty = canAssignProperties(propertyAccessContext);
  const canEditOwnerDetails =
    !isEditing ||
    (isPropertyAccessReady &&
      canViewPropertyOwnerContacts(propertyAccessContext));
  const canEdit =
    !isEditing ||
    (isPropertyAccessReady && propertyOwnership?.can_edit === true);
  const propertyModuleEnabled = Boolean(tenantContext?.enabledModules.some(module => module.trim().toLowerCase() === "properties"));
  const isPropertyDraftAccessReady = isPropertyAccessReady && activeOrganization.status === "ready" && tenantContext?.userId === user?.id;
  const editDraftAccessSignature = propertyEditDraftAccessSignature({
    permissions: tenantContext?.permissions,
    moduleEnabled: propertyModuleEnabled,
    canEdit, canManage: canManagePropertyCatalogs, canAssign: canAssignProperty, canEditOwnerDetails,
    editPolicy: organization?.property_edit_policy,
    ownerContactVisibility: organization?.property_owner_contact_visibility,
  });
  const editDraftScope = useMemo(() => ({
    actorId: user?.id ?? "", organizationId: activeOrganization.organizationId ?? "",
    propertyId: propertyId ?? "", accessSignature: editDraftAccessSignature,
  }), [user?.id, activeOrganization.organizationId, propertyId, editDraftAccessSignature]);
  const editDraftCapabilities = useQuery({
    queryKey: ["property-edit-draft-capabilities", editDraftScope.organizationId, propertyId, accessSignature],
    enabled: isRecoveringEditDraft && isPropertyDraftAccessReady && canEdit && propertyModuleEnabled && propertyQuery.isFetchedAfterMount,
    queryFn: async () => {
      const response = await propertyWorkspaceAPI.getWorkspace(editDraftScope.organizationId, editDraftScope.propertyId, {
        expectedUserId: formScope.actorId,
        canContinue: () => isFormScopeCurrent(formScope),
      });
      if (response.data.property.id !== editDraftScope.propertyId || response.data.property.organization_id !== editDraftScope.organizationId) throw new Error("O acesso ao imóvel mudou.");
      return response.meta;
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always",
  });

  const { lookupCep, invalidateCepLookup, isCepLoading } = usePropertyCepLookup({
    scopeKey: `${draftKey}:${propertyId ?? "new"}`,
    onAddress: (cep, address) => {
      if (!isFormScopeCurrent(formScope)) return;
      const matchedCity = catalogCities.find((city) =>
        normalize(city.name) === normalize(address.localidade)
        && city.uf?.toUpperCase() === address.uf.toUpperCase(),
      );
      const matchedNeighborhood = matchedCity ? catalogNeighborhoods.find((neighborhood) =>
        normalize(neighborhood.name) === normalize(address.bairro)
        && neighborhood.city_id === matchedCity.id,
      ) : undefined;
      setFormData((previous) => onlyCepDigits(previous.cep) === cep
        ? applyCepAddressToLocation(previous, address, {
            cityId: matchedCity?.id, neighborhoodId: matchedNeighborhood?.id,
          })
        : previous);
    },
  });

  const set = <K extends keyof PropertyFormData>(
    field: K,
    value: PropertyFormData[K],
  ) => {
    if (field === "endereco") {
      if (!submission.current.canEdit()) return;
      invalidateCepLookup();
    }
    if (
      field === "cep" || field === "uf" || field === "cidade" ||
      field === "bairro" || field === "city_id" || field === "neighborhood_id"
    ) {
      if (!submission.current.canEdit()) return;
      invalidateCepLookup();
      setFormData((prev) => setManualLocationField(prev, field, String(value)));
      return;
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const applyCity = (city: PropertyCity | null) => {
    if (!submission.current.canEdit() || isCheckingCreatedProperty) return;
    invalidateCepLookup();
    if (city) setFormData((prev) => selectLocationCity(prev, city));
  };

  const applyNeighborhood = (neighborhood: PropertyNeighborhood | null) => {
    if (!submission.current.canEdit()) return;
    invalidateCepLookup();
    if (neighborhood) {
      setFormData((prev) => selectLocationNeighborhood(prev, neighborhood));
    }
  };

  const applyCondominium = (condominium: PropertyCondominium | null) => {
    if (!submission.current.canEdit()) return;
    invalidateCepLookup();
    setFormData((prev) => selectLocationCondominium(prev, condominium));
  };

  const applyOwner = (owner: PropertyOwner | null) => {
    setFormData((previous) => selectPropertyOwner(previous, owner));
  };

  useEffect(() => {
    if (
      isEditing &&
      property &&
      !loadingProperty &&
      isPropertyAccessReady &&
      !canEdit
    ) {
      toast.error("Você não tem permissão para editar este imóvel.");
      router.push("/properties");
    }
  }, [
    isEditing,
    property,
    loadingProperty,
    isPropertyAccessReady,
    canEdit,
    router,
  ]);

  useEffect(() => {
    if (
      canManagePropertyCatalogs &&
      !loadingFeatures &&
      features.length === 0
    ) {
      seedDefaultFeatures();
    }
  }, [
    canManagePropertyCatalogs,
    loadingFeatures,
    features.length,
    seedDefaultFeatures,
  ]);

  useEffect(() => {
    if (
      canManagePropertyCatalogs &&
      !loadingProximities &&
      proximities.length === 0
    ) {
      seedDefaultProximities();
    }
  }, [
    canManagePropertyCatalogs,
    loadingProximities,
    proximities.length,
    seedDefaultProximities,
  ]);

  // Auto-set cadastrado_por to current user for new properties
  useEffect(() => {
    if (!isEditing && user?.id && !formData.cadastrado_por) {
      const currentUserId = user.id;
      queueMicrotask(() => {
        setFormDataState((prev) =>
          prev.cadastrado_por
            ? prev
            : { ...prev, cadastrado_por: currentUserId },
        );
      });
    }
  }, [formData.cadastrado_por, isEditing, user?.id]);

  // Auto-save draft for new properties
  useEffect(() => {
    if (!isEditing && !createdPropertyId && hasUnsavedChanges) {
      const timer = setTimeout(() => {
        const saved = saveDraft(draftKey, formData);
        setDraftStorageWarning(saved ? null : PROPERTY_DRAFT_STORAGE_WARNING);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [createdPropertyId, draftKey, formData, hasUnsavedChanges, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      hydratedPropertyIdRef.current = null;
      hydratedPropertyUpdatedAtRef.current = null;
      hydratedPropertySnapshotRef.current = null;
      propertyFormDirtyRef.current = false;
      return;
    }
    if (!property) return;
    if (!isPropertyDraftAccessReady || property.id !== propertyId || property.organization_id !== formScope.organizationId) return;
    // Cached query data alone cannot authorize restoring a previous mount's edit.
    if (hasPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey) && !propertyQuery.isFetchedAfterMount) {
      if (!propertyQuery.isFetching) void refetchProperty();
      return;
    }
    if (hasPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey) && canEdit && propertyModuleEnabled
      && (editDraftCapabilities.isError || !editDraftCapabilities.isFetchedAfterMount || !editDraftCapabilities.data)) return;
    // Keep the recovered CAS base until the user explicitly reloads a conflict.
    if (hasConcurrencyConflict && propertyFormDirtyRef.current && hydratedPropertyIdRef.current === property.id) return;
    const nextPropertySnapshot = property as unknown as Record<string, unknown>;
    const refetchDecision = resolvePropertyFormRefetch({
      hydratedPropertyId: hydratedPropertyIdRef.current,
      hydratedUpdatedAt: hydratedPropertyUpdatedAtRef.current,
      nextPropertyId: property.id,
      nextUpdatedAt: property.updated_at,
      hasLocalChanges: propertyFormDirtyRef.current,
      serverChangesAreMediaOnly: arePropertySnapshotsEqualOutsideMedia(
        hydratedPropertySnapshotRef.current,
        nextPropertySnapshot,
      ),
    });
    if (refetchDecision.action === "preserve-and-rebase") {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        hydratedPropertyUpdatedAtRef.current = refetchDecision.expectedUpdatedAt;
        hydratedPropertySnapshotRef.current = nextPropertySnapshot;
        setFormDataState((previous) => rebasePropertyFormMedia(previous, propertyToFormData(property)));
      });
      return () => { cancelled = true; };
    }
    if (refetchDecision.action === "preserve") {
      return;
    }

    const serverFormData = propertyToFormData(property);
    const recoveredDraft = editDraftKey && hydratedPropertyIdRef.current !== property.id
      ? recoverPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey, editDraftScope, {
        canEdit: canEdit && propertyModuleEnabled,
        canManage: editDraftCapabilities.data?.can_manage === true,
        canEditOwnerDetails: editDraftCapabilities.data?.can_view_owner_contacts === true,
        updatedAt: property.updated_at, formData: serverFormData,
      })
      : null;
    const nextFormData = recoveredDraft?.formData ?? serverFormData;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      hydratedPropertyIdRef.current = property.id;
      hydratedPropertyUpdatedAtRef.current = recoveredDraft?.expectedUpdatedAt ?? refetchDecision.expectedUpdatedAt;
      hydratedPropertySnapshotRef.current = nextPropertySnapshot;
      if (recoveredDraft) {
        propertyFormDirtyRef.current = true;
        setHasUnsavedChanges(true);
        setEditDraftRestored(true);
      } else markPropertyFormPristine();
      setHasConcurrencyConflict(recoveredDraft?.hasConflict ?? false);
      setIsRecoveringEditDraft(false);
      setFormDataState(nextFormData);
    });
    return () => {
      cancelled = true;
    };
  }, [property, isEditing, markPropertyFormPristine, isPropertyDraftAccessReady, propertyId, formScope.organizationId, hasConcurrencyConflict, editDraftKey, editDraftScope, canEdit, propertyModuleEnabled, propertyQuery.isFetchedAfterMount, propertyQuery.isFetching, refetchProperty, editDraftCapabilities.data, editDraftCapabilities.isError, editDraftCapabilities.isFetchedAfterMount]);

  useLayoutEffect(() => {
    if (!isEditing || !editDraftKey || !property || !isPropertyDraftAccessReady
      || property.id !== propertyId || property.organization_id !== editDraftScope.organizationId) return;
    if (!canEdit || !propertyModuleEnabled) {
      clearPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey);
      queueMicrotask(() => { if (isFormScopeCurrent(formScope)) setIsRecoveringEditDraft(false); });
      return;
    }
    if (propertyFormDirtyRef.current && hydratedPropertyIdRef.current === property.id && hydratedPropertyUpdatedAtRef.current) {
      savePropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey, editDraftScope, hydratedPropertyUpdatedAtRef.current, formData);
    }
  }, [isEditing, editDraftKey, property, isPropertyDraftAccessReady, propertyId, editDraftScope, canEdit, propertyModuleEnabled, formData, formScope, isFormScopeCurrent]);

  useEffect(() => {
    if (!isEditing || !editDraftKey || activeOrganization.status !== "ready" || tenantContext?.userId !== user?.id) return;
    const canReadProperties = canManagePropertyCatalogs || tenantContext?.permissions.some(permission => permission === "*" || permission === "property_view");
    if (!propertyModuleEnabled || !canReadProperties || (propertyLoadError instanceof VimobAPIError && [403, 404].includes(propertyLoadError.status))) {
      clearPropertyEditDraft(getPropertyEditDraftStorage(), editDraftKey);
      queueMicrotask(() => { if (isFormScopeCurrent(formScope)) setIsRecoveringEditDraft(false); });
    }
  }, [isEditing, editDraftKey, activeOrganization.status, tenantContext?.userId, tenantContext?.permissions, user?.id, propertyModuleEnabled, canManagePropertyCatalogs, propertyLoadError, formScope, isFormScopeCurrent]);

  const {
    isLand,
    isRental,
    isSale,
    supportsRentalContractTerms,
    supportsSaleTerms,
  } = getPropertyFormRules(formData);
  const displayedPurposeOptions = optionsWithCurrent(
    purposeOptions,
    formData.finalidade,
  );
  const displayedDealOptions = optionsWithCurrent(
    DEFAULT_DEAL_OPTIONS,
    formData.tipo_de_negocio,
  );
  const selectedCity = cities.find((city) => city.id === formData.city_id);
  const selectedNeighborhood = neighborhoods.find(
    (neighborhood) => neighborhood.id === formData.neighborhood_id,
  );
  const selectedCondominium = condominiums.find(
    (condominium) => condominium.id === formData.condominium_id,
  );
  const primaryValuesGridClass = cn(
    "grid min-w-0 grid-cols-1 gap-3 @[480px]:grid-cols-2",
    isSale && isRental
      ? "@[960px]:grid-cols-5"
      : "@[760px]:grid-cols-4",
  );
  const statusOptions = [
    { value: "ativo", label: "Ativo" },
    { value: "reservado", label: "Reservado" },
    ...(isSale ? [{ value: "vendido", label: "Vendido" }] : []),
    ...(isRental ? [{ value: "alugado", label: "Alugado" }] : []),
    { value: "inativo", label: "Inativo" },
    { value: "rascunho", label: "Rascunho" },
    { value: "arquivado", label: "Arquivado" },
  ];
  const validationIssues = getPropertyValidationIssues(formData, {
    isEditing,
    canEditOwnerDetails,
  });
  const publicationValidationIssues = getPropertyPublicationValidationIssues(formData, { isEditing });
  const visibleValidationIssues = hasTriedSubmit ? [...validationIssues, ...schemaValidationIssues] : [];

  const focusValidationIssue = (issue: (typeof validationIssues)[number]) => {
    setActiveTab(issue.tab);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = issue.fieldId
          ? document.getElementById(issue.fieldId)
          : document.getElementById(`property-tab-${issue.tab}`);
        target?.focus();
      });
    });
  };

  const navigateAfterSave = (savedPropertyId: string, formAction: PropertyFormAction) => {
    if (!formAction.isCurrent()) return;
    router.push(`/properties/${savedPropertyId}?tab=publication`);
  };

  const handleCancel = () => {
    if (isSaving || createProperty.isPending || updateProperty.isPending || isPersistingMedia) return;
    if (!confirmFormNavigation()) return;
    releaseStagedPropertyPhotos([
      formData.imagem_principal,
      ...formData.fotos,
    ]);
    if (!pendingCreation && !creationRecoveryError) clearDraft(draftKey, { isEditing });
    router.push("/properties");
  };

  const confirmSavedPropertyPublication = async (
    organizationId: string,
    savedPropertyId: string,
    action: AutomaticSitePublicationAction,
    formAction: PropertyFormAction,
  ) => {
    if (!formAction.isCurrent() || organizationId !== formScope.organizationId) return;
    setPublicationSaveFeedback(null);
    try {
      const outcome = await requestAutomaticSitePublication(organizationId, savedPropertyId, undefined, undefined, {
        expectedUserId: formScope.actorId,
        expectedSessionId: formAction.expectedSessionId,
        canContinue: formAction.isCurrent,
        action,
      });
      if (!formAction.isCurrent()) return;
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["property-publications", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
        queryClient.invalidateQueries({ queryKey: ["properties-infinite"] }),
      ]);
      if (!formAction.isCurrent()) return;
      if (outcome.kind === "blocked") {
        if (!formAction.isCurrent()) return;
        const reason = outcome.reasons.slice(0, 3).join(" ");
        const message = `Imóvel salvo; esta versão não foi enviada ao Site. ${reason}`;
        setPublicationSaveFeedback(message);
        toast.error(message, { duration: 8000 });
        const firstIssue = publicationValidationIssues[0];
        if (outcome.fixableInForm && isEditing) {
          if (firstIssue) focusValidationIssue(firstIssue);
          else setActiveTab("publication");
          return;
        }
        if (outcome.fixableInForm && !isEditing) {
          router.replace(`/properties/${savedPropertyId}/edit`);
          return;
        }
      } else if (outcome.kind === "already-published") {
        toast.success("Imóvel salvo e versão atual publicada no site.");
      } else if (outcome.kind === "processing") {
        toast.info("Imóvel salvo. A publicação já está em processamento.");
      } else {
        toast.success("Imóvel salvo. Publicação enviada para processamento.");
      }
    } catch {
      const message = "Imóvel salvo, mas não foi possível confirmar a solicitação de publicação. Confira o estado na Central.";
      if (!formAction.isCurrent()) return;
      setPublicationSaveFeedback(message);
      toast.error(message, { duration: 8000 });
    }
    navigateAfterSave(savedPropertyId, formAction);
  };

  const persistCreatedPropertyMedia = async (
    created: CreatedPropertyForMediaRetry,
    isRetry: boolean,
    formAction: PropertyFormAction,
  ) => {
    if (!formAction.isCurrent() || created.organizationId !== formScope.organizationId) return;
    setIsPersistingMedia(true);
    try {
      if (!created.organizationId) {
        throw new Error(
          "Organização do imóvel não identificada para salvar as fotos.",
        );
      }
      if (isRetry) {
        // A failed compensation may have left a photo behind. Never replay the
        // whole selection over an existing canonical photo set.
        const current = await propertyWorkspaceAPI.getWorkspace(
          created.organizationId,
          created.id,
          { expectedUserId: formScope.actorId, expectedSessionId: formAction.expectedSessionId, canContinue: formAction.isCurrent },
        );
        if (!formAction.isCurrent()) return;
        if (current.data.assets.some((asset) => asset.asset_type === "photo")) {
          const message =
            "O imóvel já possui fotos gravadas. Confira a ficha em outra aba e remova as fotos parciais antes de reenviar esta seleção.";
          setMediaUploadFailure(message);
          toast.error(message);
          return;
        }
      }
      await persistStagedPropertyPhotos(created.organizationId, created.id, {
        mainImage: formData.imagem_principal,
        galleryImages: formData.fotos,
        hiddenSiteImages: formData.hidden_site_image_urls,
      }, {
        expectedUserId: formScope.actorId,
        expectedSessionId: formAction.expectedSessionId,
        canContinue: formAction.isCurrent,
      });
      if (!formAction.isCurrent()) return;
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: ["property-workspace", created.organizationId],
        }),
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
        queryClient.invalidateQueries({ queryKey: ["properties-infinite"] }),
      ]);
      if (!formAction.isCurrent()) return;
      createdPropertyMediaCompleteRef.current = true;
      setMediaUploadFailure(null);
      markPropertyFormPristine();
      setHasConcurrencyConflict(false);
      try {
        clearDraft(draftKey);
      } catch {
        // The saved property and photos remain authoritative if browser storage
        // is unavailable.
      }
      try {
        forgetPropertyCreationIntent(localStorage, creationIntentKey);
        localStorage.removeItem(mediaRecoveryKey);
      } catch {
        // The saved property and photos remain authoritative if browser storage
        // is unavailable.
      }
      try {
        const { matches } = await readBackPropertyLocation(formData, async () => {
          const { data } = await propertiesAPI.getProperty(created.id, created.organizationId, {
            expectedUserId: formScope.actorId, expectedSessionId: formAction.expectedSessionId, onRequestStart: formAction.assertCurrent,
          });
          return data;
        });
        if (!matches) {
          if (!formAction.isCurrent()) return;
          const message = "Imóvel e fotos salvos, mas bairro, cidade ou UF não permaneceram gravados. Corrija o endereço antes de publicar.";
          setPublicationSaveFeedback(message);
          toast.error(message, { duration: 8000 });
          router.replace(`/properties/${created.id}/edit`);
          return;
        }
      } catch {
        const message = "Imóvel e fotos salvos, mas não foi possível confirmar o endereço. A publicação não foi solicitada.";
        if (!formAction.isCurrent()) return;
        setPublicationSaveFeedback(message);
        toast.error(message, { duration: 8000 });
        navigateAfterSave(created.id, formAction);
        return;
      }
      await confirmSavedPropertyPublication(created.organizationId, created.id, INITIAL_AUTOMATIC_SITE_PUBLICATION_ACTION, formAction);
    } catch (error: unknown) {
      if (!formAction.isCurrent()) return;
      const rollbackIncomplete =
        error instanceof PropertyMediaPersistenceError && error.rollbackIncomplete;
      const message =
        "O imóvel foi criado, mas o envio das fotos não foi confirmado. " +
        (rollbackIncomplete
          ? "Algumas fotos podem ter permanecido; confira a ficha antes de reenviar. "
          : "Os arquivos continuam selecionados nesta aba para uma nova tentativa. ") +
        getErrorMessage(error);
      setMediaUploadFailure(message);
      propertyFormDirtyRef.current = true;
      setHasUnsavedChanges(true);
      toast.error(message);
    } finally {
      setIsPersistingMedia(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormScopeCurrent(formScope) || !formScope.actorId) return;
    // Pin the originating session before recovery/publication preflight yields.
    // A new explicit retry captures its own session; no session is persisted.
    const formAction = capturePropertyFormAction(() => isFormScopeCurrent(formScope), getVimobAPIAccessTokenSessionId);
    if (!formAction.isCurrent()) {
      toast.error("A sessão do formulário mudou. Reabra o cadastro antes de salvar.");
      return;
    }
    if (isRecoveringEditDraft) return;
    if (!submission.current.canEdit()) return;
    if (isCepLoading) {
      toast.error("Aguarde a consulta do CEP antes de salvar o imóvel.");
      return;
    }
    if (isPreparingPhotos) {
      toast.info("Aguarde a preparação das fotos antes de salvar.");
      return;
    }
    const submissionSequence = submission.current.begin();
    if (submissionSequence === null) return;
    setIsSaving(true);
    try {
      const createdForRetry = createdPropertyForMediaRetryRef.current;
      if (!isEditing && createdForRetry) {
        if (await checkConfirmedProperty(createdForRetry, formAction) === "removed") return;
        if (!formAction.isCurrent()) return;
        if (createdPropertyMediaCompleteRef.current) {
          await confirmSavedPropertyPublication(createdForRetry.organizationId, createdForRetry.id, INITIAL_AUTOMATIC_SITE_PUBLICATION_ACTION, formAction);
          return;
        }
        await persistCreatedPropertyMedia(createdForRetry, true, formAction);
        return;
      }
      if (!isEditing) {
        const recovered = readConfirmedPropertyReceipt(localStorage, mediaRecoveryKey, formScope);
        if (recovered && recovered.organizationId === activeOrganizationId) {
          if (await checkConfirmedProperty(recovered, formAction) === "removed") return;
          if (!formAction.isCurrent()) return;
          router.replace(`/properties/${recovered.id}/edit`);
          return;
        }
      }
      setHasTriedSubmit(true);

      if (creationRecoveryError) {
        toast.error(creationRecoveryError);
        return;
      }
      if (!pendingCreation && validationIssues.length > 0) {
        const firstIssue = validationIssues[0];
        focusValidationIssue(firstIssue);
        toast.error(
          `Preencha: ${validationIssues
            .slice(0, 4)
            .map((issue) => issue.label)
            .join(", ")}${validationIssues.length > 4 ? "..." : ""}`,
        );
        return;
      }

      const propertyData = buildPropertyMutationInput(
        {
          ...formData,
          city_id: catalogLocationIdForMutation(cities, formData.city_id),
          neighborhood_id: catalogLocationIdForMutation(
            neighborhoods,
            formData.neighborhood_id,
          ),
        },
        {
          isEditing,
          canAssignProperty,
          canManagePropertyCatalogs,
          canEditOwnerDetails,
        },
      );

      try {
        if (isEditing && propertyId && property) {
          if (!activeOrganizationId) {
            toast.error("Organização do imóvel não identificada para confirmar o endereço.");
            return;
          }
          const expectedUpdatedAt = hydratedPropertyUpdatedAtRef.current;
          if (!expectedUpdatedAt) {
            toast.error(
              "A versão original do imóvel ainda não foi carregada. Tente novamente.",
            );
            return;
          }
          const parsedUpdate = propertyUpdateInputSchema.safeParse({
            ...propertyData,
            title: propertyData.title ?? undefined,
            expected_updated_at: expectedUpdatedAt,
          });
          if (!parsedUpdate.success) {
            const issues = propertySchemaIssuesToForm(parsedUpdate.error.issues);
            setSchemaValidationIssues(issues);
            if (issues[0]) focusValidationIssue(issues[0]);
            toast.error(`Revise os valores informados: ${issues.map((issue) => issue.label).join(", ")}.`);
            return;
          }
          const updateInput = parsedUpdate.data;
          let publicationAction: AutomaticSitePublicationAction;
          try {
            publicationAction = await captureAutomaticSitePublicationAction(activeOrganizationId, propertyId, undefined, {
              expectedUserId: formScope.actorId,
              expectedSessionId: formAction.expectedSessionId,
              canContinue: formAction.isCurrent,
            });
          } catch {
            if (formAction.isCurrent()) toast.error("Não foi possível confirmar a publicação antes de salvar. Suas alterações continuam neste formulário; tente novamente.");
            return;
          }
          if (!formAction.isCurrent()) return;
          const patchedProperty = await updateProperty.mutateAsync({
            id: propertyId,
            ...updateInput,
            expected_updated_at: expectedUpdatedAt,
            requestIntent: {
              expectedUserId: formScope.actorId,
              expectedSessionId: formAction.expectedSessionId,
              onRequestStart: formAction.assertCurrent,
            },
          });
          if (!formAction.isCurrent()) return;
          hydratedPropertyUpdatedAtRef.current = patchedProperty.updated_at;
          hydratedPropertySnapshotRef.current =
            patchedProperty as unknown as Record<string, unknown>;
          let savedProperty;
          let locationMatches = false;
          try {
            ({ savedProperty, matches: locationMatches } =
              await readBackPropertyLocation(formData, async () => {
                const { data } = await propertiesAPI.getProperty(
                  propertyId,
                  activeOrganizationId,
                  { expectedUserId: formScope.actorId, expectedSessionId: formAction.expectedSessionId, onRequestStart: formAction.assertCurrent },
                );
                return data;
              }));
            if (!formAction.isCurrent()) return;
          } catch {
            if (!formAction.isCurrent()) return;
            toast.error(
              "A alteração foi enviada, mas não foi possível confirmar o endereço gravado. Mantenha esta edição aberta e confira antes de publicar.",
            );
            return;
          }
          if (!locationMatches) {
            hydratedPropertyUpdatedAtRef.current = savedProperty.updated_at;
            hydratedPropertySnapshotRef.current =
              savedProperty as unknown as Record<string, unknown>;
            toast.error(
              "O imóvel foi salvo, mas o endereço não permaneceu gravado. Revise o bairro, cidade e UF antes de publicar.",
            );
            return;
          }
          markPropertyFormPristine();
          setHasConcurrencyConflict(false);
          try {
            clearDraft(draftKey, { isEditing });
          } catch {
            // Browser storage is optional after the saved property was confirmed.
          }
          await confirmSavedPropertyPublication(activeOrganizationId, propertyId, publicationAction, formAction);
          return;
        } else {
          const parsedCreate = propertyCreateInputSchema.safeParse(propertyData);
          if (!pendingCreation && !parsedCreate.success) {
            const issues = propertySchemaIssuesToForm(parsedCreate.error.issues);
            setSchemaValidationIssues(issues);
            if (issues[0]) focusValidationIssue(issues[0]);
            toast.error(`Revise os valores informados: ${issues.map((issue) => issue.label).join(", ")}.`);
            return;
          }
          let intent: PropertyCreationIntent;
          let wasRetry = Boolean(pendingCreation);
          try {
            const persistedIntent = readPropertyCreationIntent(localStorage, creationIntentKey);
            wasRetry = wasRetry || Boolean(persistedIntent);
            if (pendingCreation || persistedIntent) {
              intent = pendingCreation || persistedIntent!;
            } else if (parsedCreate.success) {
              intent = preparePropertyCreationIntent(localStorage, creationIntentKey, parsedCreate.data);
            } else {
              return;
            }
          } catch {
            const message = "Não foi possível preservar a confirmação do cadastro neste navegador. Confira a carteira antes de tentar novamente.";
            setCreationRecoveryError(message);
            toast.error(message);
            return;
          }
          setPendingCreation(intent);
          let createdProperty;
          try {
            createdProperty = await createProperty.mutateAsync({
              ...intent.body, idempotencyKey: intent.key,
              requestIntent: {
                expectedUserId: formScope.actorId,
                expectedSessionId: formAction.expectedSessionId,
                onRequestStart: formAction.assertCurrent,
              },
            });
          } catch (error) {
            if (!formAction.isCurrent()) return;
            // A definitive rejected request can be corrected. A timeout/network
            // failure keeps the exact intent frozen for a safe retry or reload.
            if (propertyCreationRejectionCanReset({
              wasRetry,
              clientRejected: Boolean(getClientRateLimitMessage(error)),
              status: error instanceof VimobAPIError ? error.status : undefined,
              code: error instanceof VimobAPIError ? error.code : undefined,
            })) {
              try {
                forgetPropertyCreationIntent(localStorage, creationIntentKey);
                setPendingCreation(null);
              } catch {
                setCreationRecoveryError("O cadastro foi recusado, mas a confirmação local não pôde ser liberada. Confira a carteira antes de tentar novamente.");
              }
            }
            throw error;
          }
          if (!formAction.isCurrent()) return;
          const organizationId =
            createdProperty.organization_id || activeOrganizationId;
          const createdForMedia = {
            id: createdProperty.id,
            organizationId: organizationId || "",
            actorId: formScope.actorId,
          };
          createdPropertyForMediaRetryRef.current = createdForMedia;
          setCreatedPropertyId(createdProperty.id);
          setPendingCreation(null);
          propertyFormDirtyRef.current = true;
          setHasUnsavedChanges(true);
          try {
            if (organizationId) {
              preserveConfirmedPropertyCreation(localStorage, creationIntentKey, mediaRecoveryKey, createdForMedia);
            }
          } catch {
            // The immutable creation intent is still durable if saving the ID failed.
          }
          if (!formData.imagem_principal && formData.fotos.length === 0) {
            toast.info("Cadastro confirmado. Continue pela edição do imóvel.");
            router.replace(`/properties/${createdProperty.id}/edit`);
            return;
          }
          await persistCreatedPropertyMedia(createdForMedia, wasRetry, formAction);
          return;
        }
      } catch (error) {
        if (!formAction.isCurrent()) return;
        if (isPropertyWorkspaceConflict(error)) {
          setHasConcurrencyConflict(true);
        }
        // Transport errors are reported by the mutation hook; validation above
        // is reported here because no request has been sent yet.
      }
    } catch (error) {
      if (formAction.isCurrent()) toast.error(getErrorMessage(error));
    } finally {
      submission.current.finish(submissionSequence);
      setIsSaving(false);
    }
  };

  const handleReloadAfterConflict = async () => {
    if (!propertyId) return;
    if (
      !window.confirm(
        "Recarregar substituirá as alterações locais pela versão mais recente do imóvel. Deseja continuar?",
      )
    ) {
      return;
    }

    try {
      const result = await refetchProperty();
      if (result.error) throw result.error;
      if (!result.data) {
        throw new Error("A versão atual do imóvel não foi encontrada.");
      }

      releaseStagedPropertyPhotos([
        formData.imagem_principal,
        ...formData.fotos,
      ]);
      const latestProperty = result.data;
      const latestSnapshot = latestProperty as unknown as Record<string, unknown>;
      hydratedPropertyIdRef.current = latestProperty.id;
      hydratedPropertyUpdatedAtRef.current = latestProperty.updated_at;
      hydratedPropertySnapshotRef.current = latestSnapshot;
      setFormDataState(propertyToFormData(latestProperty));
      markPropertyFormPristine();
      setHasConcurrencyConflict(false);
      toast.success("Dados mais recentes carregados. Revise e salve novamente.");
    } catch (error) {
      toast.error(
        "Não foi possível recarregar o imóvel: " + getErrorMessage(error),
      );
    }
  };

  const handleImagesChange = (images: string[], mainImage: string) => {
    if (!isFormScopeCurrent(formScope)) {
      releaseStagedPropertyPhotos([mainImage, ...images]);
      return;
    }
    setFormData((prev) => ({
      ...prev,
      fotos: images,
      imagem_principal: mainImage,
    }));
  };
  const handlePreparingPhotosChange = (preparing: boolean) => {
    if (isFormScopeCurrent(formScope)) setIsPreparingPhotos(preparing);
  };

  const handleAddPurpose = () => {
    const name = newPurposeName.trim();
    if (!name) return;
    setPurposeOptions((prev) => appendUniqueOption(prev, name));
    set("finalidade", name);
    setNewPurposeName("");
    setShowAddPurpose(false);
  };

  const handleAddPropertyType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    await createPropertyType.mutateAsync(name);
    set("tipo_de_imovel", name);
    setNewTypeName("");
    setShowAddType(false);
  };

  const handleDealTypeChange = (value: string) => {
    const supportsTerms = isSaleType(value);
    const isSeasonal = normalize(value) === "temporada";

    setFormData((prev) => ({
      ...prev,
      tipo_de_negocio: value,
      financing_mode: supportsTerms ? prev.financing_mode || "sim" : "nao",
      aceita_financiamento: supportsTerms
        ? prev.financing_mode !== "nao"
        : false,
      aceita_permuta: supportsTerms ? prev.aceita_permuta : false,
      iptu_isento: isSeasonal ? true : prev.iptu_isento,
    }));
  };

  const handleCreateCity = async () => {
    if (!canManagePropertyCatalogs) return;
    const name = (newCityName || formData.cidade).trim();
    const uf = (newCityUf || formData.uf).trim().toUpperCase();
    if (!name) {
      toast.error("Informe o nome da cidade.");
      return;
    }
    const city = await createCity.mutateAsync({ name, uf });
    applyCity(city);
    setNewCityName("");
    setNewCityUf("");
    setShowAddCity(false);
  };

  const handleCreateNeighborhood = async () => {
    if (!canManagePropertyCatalogs) return;
    const name = (newNeighborhoodName || formData.bairro).trim();
    if (!formData.city_id) {
      toast.error("Selecione ou cadastre a cidade antes do bairro.");
      return;
    }
    if (!name) {
      toast.error("Informe o nome do bairro.");
      return;
    }
    const neighborhood = await createNeighborhood.mutateAsync({
      name,
      city_id: formData.city_id,
    });
    applyNeighborhood(neighborhood);
    setNewNeighborhoodName("");
    setShowAddNeighborhood(false);
  };

  const handleCreateCondominium = async () => {
    if (!canManagePropertyCatalogs) return;
    const name = newCondominiumName.trim();
    if (!name) {
      toast.error("Informe o nome do condomínio.");
      return;
    }
    const fee = newCondominiumFee
      ? Number(parseCurrencyInput(newCondominiumFee))
      : undefined;
    const condominium = await createCondominium.mutateAsync({
      name,
      city_id: formData.city_id || undefined,
      neighborhood_id: formData.neighborhood_id || undefined,
      address: formData.endereco || undefined,
      cep: formData.cep || undefined,
      number: formData.numero || undefined,
      complement: formData.complemento || undefined,
      photo_url: newCondominiumPhoto || undefined,
      default_condominium_fee: Number.isFinite(fee) ? fee : undefined,
      has_concierge: newCondominiumHasConcierge,
      concierge_type: newCondominiumConciergeType || undefined,
    });
    applyCondominium(condominium);
    setNewCondominiumName("");
    setNewCondominiumFee("");
    setNewCondominiumPhoto("");
    setNewCondominiumHasConcierge(false);
    setNewCondominiumConciergeType("");
    setShowAddCondominium(false);
  };

  const handleCreateOwner = async () => {
    if (!canManagePropertyCatalogs || !canEditOwnerDetails) return;
    if (!formData.owner_name.trim()) {
      toast.error("Informe o nome do proprietário.");
      return;
    }
    const owner = await createPropertyOwner.mutateAsync({
      name: formData.owner_name,
      phone_residential: formData.owner_phone_residential || undefined,
      phone_commercial: formData.owner_phone_commercial || undefined,
      cellphone: formData.owner_cellphone || undefined,
      email: formData.owner_email || undefined,
      media_source: formData.owner_media_source || undefined,
      notify_email: formData.owner_notify_email,
    });
    applyOwner(owner);
  };

  if (isEditing && loadingProperty) {
    return (
      <AppLayout title="Carregando...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (isEditing && (propertyLoadFailed || !property)) {
    const status =
      propertyLoadError &&
      typeof propertyLoadError === "object" &&
      "status" in propertyLoadError &&
      typeof propertyLoadError.status === "number"
        ? propertyLoadError.status
        : null;
    const notFound = status === 404;

    return (
      <AppLayout title={notFound ? "Imóvel não encontrado" : "Falha ao carregar imóvel"}>
        <div
          role="alert"
          aria-live="assertive"
          className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-[8px] bg-[var(--app-surface-solid)] p-8 text-center"
        >
          <AlertTriangle aria-hidden="true" className="h-8 w-8 text-primary" />
          <div className="space-y-1">
            <h1 className="text-lg font-medium">
              {notFound ? "Este imóvel não existe ou não está mais disponível." : "Não foi possível carregar este imóvel."}
            </h1>
            <p className="text-sm text-muted-foreground">
              {notFound
                ? "Confira o endereço acessado ou volte para a carteira de imóveis."
                : "Tente novamente. Seus dados não foram alterados."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {!notFound && (
              <Button type="button" onClick={() => void refetchProperty()}>
                Tentar novamente
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => router.push("/properties")}>
              Voltar para imóveis
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isEditing && !isPropertyAccessReady) {
    return (
      <AppLayout title="Carregando permissões...">
        <div className="flex h-64 items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="sr-only">Carregando permissões do imóvel</span>
        </div>
      </AppLayout>
    );
  }

  const showManagerOnlySections = !isEditing || canManagePropertyCatalogs;
  const tabs: PropertyFormTab[] = [
    {
      value: "owner",
      label: "Proprietário",
      description: "Proprietário e responsável interno",
      icon: User,
    },
    {
      value: "structure",
      label: "Dados do imóvel",
      description: "Título, tipo e modalidade",
      icon: Home,
    },
    {
      value: "location",
      label: "Localização",
      description: "Endereço e visibilidade pública",
      icon: MapPin,
    },
    {
      value: "values",
      label: "Valores",
      description: "Venda, locação e encargos",
      icon: DollarSign,
    },
    {
      value: "characteristics",
      label: "Características",
      description: "Cômodos, áreas e condições",
      icon: Settings2,
    },
    {
      value: "extras",
      label: "Extras",
      description: "Diferenciais e proximidades",
      icon: Tag,
    },
    {
      value: "media",
      label: "Mídia e descrições",
      description: "Fotos, vídeo e textos",
      icon: Image,
    },
    {
      value: "publication",
      label: "Publicação",
      description: "Destaques e site público",
      icon: Globe,
    },
    ...(showManagerOnlySections
      ? [
          {
            value: "commissions",
            label: "Comissões",
            description: "Corretor e condição comercial",
            icon: Percent,
          },
          {
            value: "confidential",
            label: "Confidencial",
            description: "Documentação e dados internos",
            icon: Lock,
          },
        ]
      : []),
  ];

  const sectionContext: PropertyFormSectionsContextValue = {
    formData,
    isSaving: isSaving || isCheckingCreatedProperty || isRecoveringEditDraft || Boolean(pendingCreation) || Boolean(creationRecoveryError) || Boolean(confirmedRecoveryError),
    onPreparingPhotosChange: handlePreparingPhotosChange,
    canContinuePhotos: () => isFormScopeCurrent(formScope),
    isPreparingPhotos,
    set,
    user,
    profile,
    users,
    property,
    propertyId,
    isEditing,
    router,
    activeOrganizationId,
    canManagePropertyCatalogs,
    canAssignProperty,
    canEditOwnerDetails,
    applyOwner,
    handleCreateOwner,
    createPropertyOwner,
    displayedPurposeOptions,
    displayedDealOptions,
    statusOptions,
    propertyTypes,
    newPurposeName,
    setNewPurposeName,
    newTypeName,
    setNewTypeName,
    showAddPurpose,
    setShowAddPurpose,
    showAddType,
    setShowAddType,
    handleAddPurpose,
    handleAddPropertyType,
    handleDealTypeChange,
    createPropertyType,
    cities: catalogCities,
    neighborhoods: catalogNeighborhoods,
    condominiums,
    selectedCity,
    selectedNeighborhood,
    selectedCondominium,
    applyCity,
    applyNeighborhood,
    applyCondominium,
    lookupCep,
    isCepLoading,
    newCityName,
    setNewCityName,
    newCityUf,
    setNewCityUf,
    newNeighborhoodName,
    setNewNeighborhoodName,
    newCondominiumName,
    setNewCondominiumName,
    newCondominiumFee,
    setNewCondominiumFee,
    newCondominiumPhoto,
    setNewCondominiumPhoto,
    newCondominiumHasConcierge,
    setNewCondominiumHasConcierge,
    newCondominiumConciergeType,
    setNewCondominiumConciergeType,
    showAddCity,
    setShowAddCity,
    showAddNeighborhood,
    setShowAddNeighborhood,
    showAddCondominium,
    setShowAddCondominium,
    handleCreateCity,
    handleCreateNeighborhood,
    handleCreateCondominium,
    createCity,
    createNeighborhood,
    createCondominium,
    isLand,
    isSale,
    isRental,
    supportsRentalContractTerms,
    supportsSaleTerms,
    primaryValuesGridClass,
    features,
    proximities,
    loadingFeatures,
    loadingProximities,
    createFeature,
    createProximity,
    handleImagesChange,
  };
  const isBusy = isSaving || isCheckingCreatedProperty || isRecoveringEditDraft || createProperty.isPending || updateProperty.isPending || isPersistingMedia;
  const activeStepIndex = tabs.findIndex((tab) => tab.value === activeTab);
  const isLastStep = activeStepIndex === tabs.length - 1;
  const handleNextStep = () => {
    const issue = validationIssues.find((item) => item.tab === activeTab);
    if (issue) {
      setHasTriedSubmit(true);
      focusValidationIssue(issue);
      toast.error(`Preencha: ${issue.label}`);
      return;
    }
    const nextStep = tabs[activeStepIndex + 1];
    if (nextStep) setActiveTab(nextStep.value);
  };
  const formFeedback = (
    <>
        {isRecoveringEditDraft && (editDraftCapabilities.isError ? (
          <div role="alert" className="app-card-soft space-y-2 p-3 text-sm">
            <p>Não foi possível confirmar o acesso para recuperar sua edição. Ela continua preservada neste navegador.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={editDraftCapabilities.isFetching} onClick={() => void editDraftCapabilities.refetch()}>Tentar recuperar</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => router.push("/properties")}>Abrir carteira</Button>
            </div>
          </div>
        ) : <p role="status" className="text-xs text-muted-foreground">Confirmando acesso para recuperar sua edição…</p>)}
        {editDraftRestored && <p role="status" className="text-xs text-muted-foreground">Sua edição não salva foi recuperada neste navegador. Revise antes de salvar.</p>}
        {!isEditing && draftStorageWarning && <p role="status" className="app-card-soft p-3 text-sm text-muted-foreground">{draftStorageWarning}</p>}
        {confirmedRecoveryError && (
          <div role="alert" className="app-card-soft space-y-2 border-0 p-3 text-sm">
            <p>{confirmedRecoveryError}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => setRecoveryAttempt(value => value + 1)}>Conferir novamente</Button>
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => router.push("/properties")}>Abrir carteira</Button>
            </div>
          </div>
        )}
        {!isEditing && (pendingCreation || creationRecoveryError) && (
          <div role="alert" data-testid="property-create-recovery" className="app-card-soft space-y-2 border-0 p-3 text-sm">
            <p className="font-medium">{creationRecoveryError ? "Confira o cadastro pendente" : "Aguardando confirmação do cadastro"}</p>
            <p className="text-muted-foreground">
              {creationRecoveryError || "Os dados enviados estão preservados. Use Confirmar cadastro para recuperar o mesmo imóvel; você poderá editar os campos depois da confirmação."}
            </p>
            <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => router.push("/properties")}>Abrir carteira</Button>
          </div>
        )}
        {((isEditing && property) || (hasDraft && !isEditing)) && (
          <div className="text-sm text-muted-foreground flex-shrink-0 flex items-center gap-2">
            {isEditing && property && (
              <span>
                Código:{" "}
                <span className="font-mono font-medium text-foreground">
                  {property.code}
                </span>
              </span>
            )}
            {hasDraft && !isEditing && (
              <span className="text-xs text-muted-foreground/80 bg-[var(--app-surface-soft)] px-2 py-0.5 rounded">
                Rascunho restaurado
              </span>
            )}
          </div>
        )}

        {hasConcurrencyConflict && (
          <div
            role="alert"
            aria-live="assertive"
            className="app-card-soft flex flex-col gap-3 border-0 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Este imóvel foi alterado em outra sessão.</p>
                <p className="text-muted-foreground">
                  Suas mudanças continuam neste formulário. Recarregue os dados
                  atualizados antes de tentar salvar novamente.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleReloadAfterConflict()}
              disabled={propertyQuery.isFetching}
            >
              {propertyQuery.isFetching && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Recarregar dados atualizados
            </Button>
          </div>
        )}

        {publicationSaveFeedback && (
          <div
            role="alert"
            data-testid="property-save-publication-feedback"
            className="app-card-soft flex flex-col gap-2 border-0 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{publicationSaveFeedback}</span>
            {propertyId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push(`/properties/${propertyId}?tab=publication`)}
              >
                Ver estado na Central
              </Button>
            )}
          </div>
        )}

        {visibleValidationIssues.length > 0 && (
          <div
            id="property-form-validation-summary"
            role="alert"
            aria-live="assertive"
            className="app-card-soft flex flex-col gap-3 border-0 p-4 text-sm sm:flex-row sm:items-start"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 space-y-2">
              <p className="font-medium">
                Faltam alguns dados obrigatórios para salvar este imóvel.
              </p>
              <p className="text-muted-foreground">
                Preencha:{" "}
                {visibleValidationIssues
                  .slice(0, 6)
                  .map((issue) => issue.label)
                  .join(", ")}
                {visibleValidationIssues.length > 6
                  ? ` e mais ${visibleValidationIssues.length - 6}`
                  : ""}
                .
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => focusValidationIssue(visibleValidationIssues[0])}
              >
                Ir para primeiro campo pendente
              </Button>
            </div>
          </div>
        )}

    </>
  );
  if (mediaUploadFailure && createdPropertyId) {
    return (
      <PropertyFormDialog title="Fotos pendentes" onClose={handleCancel} busy={isBusy}>
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto p-6"
        >
          <div role="alert" className="app-card space-y-2 p-4">
            <h1 className="text-base font-medium">Imóvel cadastrado; fotos pendentes</h1>
            <p className="text-sm text-muted-foreground">{mediaUploadFailure}</p>
            <p className="text-sm text-muted-foreground">
              Os dados do imóvel já foram gravados. A próxima tentativa enviará
              somente as fotos para o mesmo imóvel. Mantenha esta aba aberta para
              preservar os arquivos selecionados. Se recarregar a página, abra a
              edição do imóvel e selecione os arquivos novamente.
            </p>
          </div>
          <div className="app-card space-y-4 p-4">
            <ImageUploader
              key={`${formScope.actorId}:${formScope.organizationId}:${formScope.resourceId}:${formScope.accessSignature}`}
              disabled={isBusy}
              onPreparingChange={handlePreparingPhotosChange}
              canContinue={() => isFormScopeCurrent(formScope)}
              images={formData.fotos}
              mainImage={formData.imagem_principal}
              onImagesChange={handleImagesChange}
              hiddenSiteImages={formData.hidden_site_image_urls}
              onHiddenSiteImagesChange={(images) =>
                set("hidden_site_image_urls", images)
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={isBusy || isPreparingPhotos}>
                {isPersistingMedia && <Loader2 className="animate-spin" />}
                Reenviar fotos
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/properties/${createdPropertyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Conferir ficha em outra aba
                </a>
              </Button>
            </div>
          </div>
        </form>
      </PropertyFormDialog>
    );
  }
  return (
    <PropertyFormDialog
      title={isEditing ? "Editar Imóvel" : "Novo Imóvel"}
      onClose={handleCancel}
      busy={isBusy}
    >
      <form
        data-tour="property-form"
        onSubmit={handleSubmit}
        aria-describedby={
          visibleValidationIssues.length > 0
            ? "property-form-validation-summary"
            : undefined
        }
        className="property-form-surface min-h-0 flex flex-1 flex-col gap-3 text-[12px] font-light [&_.app-card]:rounded-[8px] [&_.app-card-soft]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light [&_input]:rounded-[6px] [&_input]:text-[12px] [&_input]:font-light [&_label]:text-[12px] [&_label]:font-light [&_textarea]:rounded-[6px] [&_textarea]:text-[12px] [&_textarea]:font-light [&_[role=combobox]]:rounded-[6px] [&_[role=combobox]]:text-[12px] [&_[role=combobox]]:font-light"
      >
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <FormWizardLayout
            steps={tabs.map((tab) => ({ id: tab.value, label: tab.label, icon: tab.icon, buttonId: `property-tab-${tab.value}`, panelId: `property-panel-${tab.value}`, tourId: `property-tab-${tab.value}` }))}
            navTourId="property-form-tabs"
            activeStep={activeTab}
            onStepChange={setActiveTab}
            contentClassName="@container space-y-4"
            asideTitle={isEditing ? "Histórico do imóvel" : "Prévia pública"}
            aside={
              <PropertyFormAside property={isEditing ? property : null} formData={formData} onOpenHistory={() => setHistoryOpen(true)} />
            }
            footer={
              <>
                <Button type="button" variant="ghost" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={isBusy} onClick={handleCancel}>Cancelar</Button>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" variant="ghost" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={isBusy || activeStepIndex <= 0} onClick={() => setActiveTab(tabs[activeStepIndex - 1].value)}>
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Voltar
                  </Button>
                  {!isLastStep && (
                    <Button type="button" className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={isBusy || isCepLoading} onClick={handleNextStep}>
                      Avançar<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button data-tour="property-save-button" type="submit" className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={isBusy || isCepLoading || isPreparingPhotos || hasConcurrencyConflict || Boolean(creationRecoveryError) || !canEdit}>
                    {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {isEditing ? "Salvar" : pendingCreation ? "Confirmar cadastro" : "Cadastrar"}
                  </Button>
                </div>
              </>
            }
          >
            {formFeedback}
            <PropertyFormSectionsProvider key={`${formScope.actorId}:${formScope.organizationId}:${formScope.resourceId}:${formScope.accessSignature}`} value={sectionContext}>
              <OwnerSection />
              <StructureSection />
              <LocationSection />
              <CharacteristicsSection />
              <ExtrasSection />
              <ValuesSection />
              <MediaSection />
              <PublicationSection />
              {showManagerOnlySections && <CommissionsSection />}
              {showManagerOnlySections && <ConfidentialSection />}
            </PropertyFormSectionsProvider>
            <details className="app-card-soft p-3 sm:hidden">
              <summary className="cursor-pointer text-[12px] font-normal">{isEditing ? "Histórico do imóvel" : "Prévia pública"}</summary>
              <div className="mt-3">
                <PropertyFormAside property={isEditing ? property : null} formData={formData} onOpenHistory={() => setHistoryOpen(true)} />
              </div>
            </details>
          </FormWizardLayout>
        </Tabs>
      </form>
      {isEditing && property && <PropertyHistoryDialog property={property} open={historyOpen} onOpenChange={setHistoryOpen} />}
    </PropertyFormDialog>
  );
}
