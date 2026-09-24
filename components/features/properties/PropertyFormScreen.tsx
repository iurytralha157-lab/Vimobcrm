"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { ImageUploader } from "@/components/features/properties/ImageUploader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { stringifyErrorMessage as getErrorMessage } from "@/lib/api/vimob-error";
import { isPropertyWorkspaceConflict } from "@/lib/property-concurrency";
import { releaseStagedPropertyPhotos } from "@/lib/property-media-draft";
import { propertyUpdateInputSchema } from "@/lib/validation";
import {
  DEFAULT_DEAL_OPTIONS,
  DEFAULT_PURPOSE_OPTIONS,
  appendUniqueOption,
  buildPropertyMutationInput,
  clearDraft,
  formatCep,
  getPropertyFormRules,
  getPropertyValidationIssues,
  initialFormData,
  isSaleType,
  normalize,
  onlyCepDigits,
  optionsWithCurrent,
  parseCurrencyInput,
  propertyDraftKey,
  readDraft,
  saveDraft,
  type PropertyFormData,
  type PropertyOwnership,
} from "./property-form/property-form-model";
import { propertyToFormData } from "./property-form/property-form-mapping";
import {
  arePropertySnapshotsEqualOutsideMedia,
  resolvePropertyFormRefetch,
} from "./property-form/property-form-hydration";
import {
  catalogLocationIdForMutation,
  catalogLocationsOnly,
} from "./property-locations/model";
import { propertyFormTabTriggerClass } from "./property-form/PropertyFormFields";
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

type CreatedPropertyForMediaRetry = {
  id: string;
  organizationId: string;
};

const propertyIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCreatedPropertyForMediaRetry(
  key: string,
): CreatedPropertyForMediaRetry | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      !("organizationId" in value) ||
      typeof value.id !== "string" ||
      typeof value.organizationId !== "string" ||
      !propertyIdPattern.test(value.id) ||
      !propertyIdPattern.test(value.organizationId)
    ) {
      return null;
    }
    return { id: value.id, organizationId: value.organizationId };
  } catch {
    return null;
  }
}

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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasConcurrencyConflict, setHasConcurrencyConflict] = useState(false);
  const hydratedPropertyIdRef = useRef<string | null>(null);
  const hydratedPropertyUpdatedAtRef = useRef<string | null>(null);
  const hydratedPropertySnapshotRef = useRef<Record<string, unknown> | null>(
    null,
  );
  const markPropertyFormPristine = useCallback(() => {
    propertyFormDirtyRef.current = false;
    setHasUnsavedChanges(false);
  }, []);
  const confirmFormNavigation = usePropertyFormNavigationGuard({
    enabled: hasUnsavedChanges,
    onConfirmDiscard: markPropertyFormPristine,
  });
  const setFormData = useCallback<Dispatch<SetStateAction<PropertyFormData>>>(
    (nextFormData) => {
      propertyFormDirtyRef.current = true;
      setHasUnsavedChanges(true);
      setFormDataState(nextFormData);
    },
    [],
  );
  const [hasDraft, setHasDraft] = useState(
    () =>
      !propertyId &&
      typeof window !== "undefined" &&
      !!localStorage.getItem(draftKey),
  );
  const [activeTab, setActiveTab] = useState("owner");
  const propertyTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [isPersistingMedia, setIsPersistingMedia] = useState(false);
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
  const [mediaUploadFailure, setMediaUploadFailure] = useState<string | null>(null);
  const createdPropertyForMediaRetryRef =
    useRef<CreatedPropertyForMediaRetry | null>(null);
  const createdPropertyMediaCompleteRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const stagedPhotoURLsRef = useRef<string[]>([]);
  const [purposeOptions, setPurposeOptions] = useState(DEFAULT_PURPOSE_OPTIONS);

  useEffect(() => {
    propertyTabRefs.current[activeTab]?.scrollIntoView({
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
  const [isCepLoading, setIsCepLoading] = useState(false);
  const lastCepLookupRef = useRef("");
  const cepLookupAbortRef = useRef<AbortController | null>(null);
  const cepLookupSequenceRef = useRef(0);

  useEffect(
    () => () => {
      cepLookupSequenceRef.current += 1;
      cepLookupAbortRef.current?.abort();
    },
    [],
  );

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
    let draft: PropertyFormData | null = null;
    try {
      draft = readDraft(draftKey);
    } catch {
      draft = null;
    }

    queueMicrotask(() => {
      if (!isActive || createdPropertyForMediaRetryRef.current) return;
      setFormDataState(draft ?? initialFormData);
      setHasDraft(!!draft);
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
    const pending = readCreatedPropertyForMediaRetry(mediaRecoveryKey);
    if (!pending || pending.organizationId !== activeOrganization.organizationId) {
      return;
    }
    if (isEditing) {
      if (propertyId === pending.id) {
        try {
          localStorage.removeItem(mediaRecoveryKey);
        } catch {
          // Browser storage may be unavailable; editing still uses this ID.
        }
      }
      return;
    }
    // A reload loses the File objects. Resume on the existing property's edit
    // page so another click can never create a duplicate property.
    if (createdPropertyForMediaRetryRef.current?.id !== pending.id) {
      router.replace(`/properties/${pending.id}/edit`);
    }
  }, [
    activeOrganization.organizationId,
    isEditing,
    mediaRecoveryKey,
    profile?.id,
    propertyId,
    router,
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
  const createPropertyType = useCreatePropertyType();
  const createProperty = useCreateProperty({ showSuccessToast: false });
  const updateProperty = useUpdateProperty();
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

  const set = <K extends keyof PropertyFormData>(
    field: K,
    value: PropertyFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const applyCity = (city: PropertyCity | null) => {
    setFormData((prev) => ({
      ...prev,
      city_id: city?.id || "",
      cidade: city?.name || prev.cidade,
      uf: city?.uf || prev.uf,
      neighborhood_id: city?.id === prev.city_id ? prev.neighborhood_id : "",
      condominium_id: city?.id === prev.city_id ? prev.condominium_id : "",
    }));
  };

  const applyNeighborhood = (neighborhood: PropertyNeighborhood | null) => {
    setFormData((prev) => ({
      ...prev,
      neighborhood_id: neighborhood?.id || "",
      bairro: neighborhood?.name || prev.bairro,
      city_id: neighborhood?.city?.id || prev.city_id,
      cidade: neighborhood?.city?.name || prev.cidade,
      uf: neighborhood?.city?.uf || prev.uf,
      condominium_id:
        neighborhood?.id === prev.neighborhood_id ? prev.condominium_id : "",
    }));
  };

  const applyCondominium = (condominium: PropertyCondominium | null) => {
    setFormData((prev) => ({
      ...prev,
      condominium_id: condominium?.id || "",
      city_id: condominium?.city?.id || prev.city_id,
      neighborhood_id: condominium?.neighborhood?.id || prev.neighborhood_id,
      cidade: condominium?.city?.name || prev.cidade,
      uf: condominium?.city?.uf || prev.uf,
      bairro: condominium?.neighborhood?.name || prev.bairro,
      endereco: condominium?.address || prev.endereco,
      cep: condominium?.cep ? formatCep(condominium.cep) : prev.cep,
      condominio:
        condominium?.default_condominium_fee != null
          ? String(Math.round(Number(condominium.default_condominium_fee)))
          : prev.condominio,
    }));
  };

  const applyOwner = (owner: PropertyOwner | null) => {
    setFormData((prev) => ({
      ...prev,
      owner_id: owner?.id || "",
      owner_name: owner?.name || prev.owner_name,
      owner_phone_residential:
        owner?.phone_residential || prev.owner_phone_residential,
      owner_phone_commercial:
        owner?.phone_commercial || prev.owner_phone_commercial,
      owner_cellphone: owner?.cellphone || prev.owner_cellphone,
      owner_email: owner?.email || prev.owner_email,
      owner_media_source: owner?.media_source || prev.owner_media_source,
      owner_notify_email: owner?.notify_email ?? prev.owner_notify_email,
    }));
  };

  const lookupCep = async (rawCep: string) => {
    const cep = onlyCepDigits(rawCep);
    if (cep.length !== 8) {
      cepLookupSequenceRef.current += 1;
      cepLookupAbortRef.current?.abort();
      cepLookupAbortRef.current = null;
      lastCepLookupRef.current = "";
      setIsCepLoading(false);
      return;
    }
    if (lastCepLookupRef.current === cep) return;

    cepLookupAbortRef.current?.abort();
    const controller = new AbortController();
    const requestSequence = cepLookupSequenceRef.current + 1;
    cepLookupSequenceRef.current = requestSequence;
    cepLookupAbortRef.current = controller;
    lastCepLookupRef.current = cep;
    setIsCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("cep_lookup_failed");

      const data = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };

      if (
        controller.signal.aborted ||
        requestSequence !== cepLookupSequenceRef.current
      ) {
        return;
      }

      if (data.erro) {
        toast.error("CEP não encontrado.");
        return;
      }

      const matchedCity = cities.find(
        (city) =>
          normalize(city.name) === normalize(data.localidade || "") &&
          (!data.uf ||
            !city.uf ||
            city.uf.toUpperCase() === data.uf.toUpperCase()),
      );
      const matchedNeighborhood = neighborhoods.find(
        (neighborhood) =>
          normalize(neighborhood.name) === normalize(data.bairro || "") &&
          (!matchedCity ||
            !neighborhood.city_id ||
            neighborhood.city_id === matchedCity.id),
      );
      const cepHasCity = Boolean(data.localidade);
      const cepHasNeighborhood = Boolean(data.bairro);

      setFormData((prev) => ({
        ...prev,
        endereco: data.logradouro || prev.endereco,
        bairro: data.bairro || prev.bairro,
        cidade: data.localidade || prev.cidade,
        uf: data.uf || prev.uf,
        city_id: matchedCity?.id || (cepHasCity ? "" : prev.city_id),
        neighborhood_id:
          matchedNeighborhood?.id ||
          (cepHasNeighborhood ? "" : prev.neighborhood_id),
        condominium_id:
          cepHasCity || cepHasNeighborhood ? "" : prev.condominium_id,
      }));
    } catch {
      if (
        controller.signal.aborted ||
        requestSequence !== cepLookupSequenceRef.current
      ) {
        return;
      }
      lastCepLookupRef.current = "";
      toast.error("Não foi possível preencher o endereço pelo CEP agora.");
    } finally {
      if (requestSequence === cepLookupSequenceRef.current) {
        cepLookupAbortRef.current = null;
        setIsCepLoading(false);
      }
    }
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
    if (!isEditing && !createdPropertyId) {
      const timer = setTimeout(() => saveDraft(draftKey, formData), 2000);
      return () => clearTimeout(timer);
    }
  }, [createdPropertyId, draftKey, formData, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      hydratedPropertyIdRef.current = null;
      hydratedPropertyUpdatedAtRef.current = null;
      hydratedPropertySnapshotRef.current = null;
      propertyFormDirtyRef.current = false;
      return;
    }
    if (!property) return;
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
      hydratedPropertyUpdatedAtRef.current = refetchDecision.expectedUpdatedAt;
      hydratedPropertySnapshotRef.current = nextPropertySnapshot;
      return;
    }
    if (refetchDecision.action === "preserve") {
      return;
    }

    const nextFormData = propertyToFormData(property);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      hydratedPropertyIdRef.current = property.id;
      hydratedPropertyUpdatedAtRef.current = refetchDecision.expectedUpdatedAt;
      hydratedPropertySnapshotRef.current = nextPropertySnapshot;
      markPropertyFormPristine();
      setHasConcurrencyConflict(false);
      setFormDataState(nextFormData);
    });
    return () => {
      cancelled = true;
    };
  }, [property, isEditing, markPropertyFormPristine]);

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
    "grid grid-cols-1 gap-3 md:grid-cols-2",
    isSale && isRental
      ? "lg:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(180px,1.15fr)_minmax(160px,1fr)_minmax(150px,.95fr)]"
      : "lg:grid-cols-[minmax(190px,1fr)_minmax(220px,1.18fr)_minmax(200px,1.05fr)_minmax(180px,.95fr)]",
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
  const visibleValidationIssues = hasTriedSubmit ? validationIssues : [];

  const focusValidationIssue = (issue: (typeof validationIssues)[number]) => {
    setActiveTab(issue.tab);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = issue.fieldId
          ? document.getElementById(issue.fieldId)
          : propertyTabRefs.current[issue.tab];
        target?.focus();
      });
    });
  };

  const persistCreatedPropertyMedia = async (
    created: CreatedPropertyForMediaRetry,
    isRetry: boolean,
  ) => {
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
        );
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
      });
      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: ["property-workspace", created.organizationId],
        }),
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
        queryClient.invalidateQueries({ queryKey: ["properties-infinite"] }),
      ]);
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
        localStorage.removeItem(mediaRecoveryKey);
      } catch {
        // The saved property and photos remain authoritative if browser storage
        // is unavailable.
      }
      toast.success("Imóvel e fotos cadastrados com sucesso!");
      router.push("/properties");
    } catch (error: unknown) {
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
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      const createdForRetry = createdPropertyForMediaRetryRef.current;
      if (!isEditing && createdForRetry) {
        if (createdPropertyMediaCompleteRef.current) {
          router.push("/properties");
          return;
        }
        await persistCreatedPropertyMedia(createdForRetry, true);
        return;
      }
      if (!isEditing) {
        const recovered = readCreatedPropertyForMediaRetry(mediaRecoveryKey);
        if (recovered && recovered.organizationId === activeOrganizationId) {
          router.replace(`/properties/${recovered.id}/edit`);
          return;
        }
      }
      setHasTriedSubmit(true);

      if (validationIssues.length > 0) {
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
          const expectedUpdatedAt = hydratedPropertyUpdatedAtRef.current;
          if (!expectedUpdatedAt) {
            toast.error(
              "A versão original do imóvel ainda não foi carregada. Tente novamente.",
            );
            return;
          }
          const updateInput = propertyUpdateInputSchema.parse({
            ...propertyData,
            title: propertyData.title ?? undefined,
            expected_updated_at: expectedUpdatedAt,
          });
          await updateProperty.mutateAsync({
            id: propertyId,
            ...updateInput,
            expected_updated_at: expectedUpdatedAt,
          });
        } else {
          const createdProperty = await createProperty.mutateAsync(propertyData);
          const organizationId =
            createdProperty.organization_id || activeOrganizationId;
          const createdForMedia = {
            id: createdProperty.id,
            organizationId: organizationId || "",
          };
          createdPropertyForMediaRetryRef.current = createdForMedia;
          setCreatedPropertyId(createdProperty.id);
          propertyFormDirtyRef.current = true;
          setHasUnsavedChanges(true);
          try {
            if (organizationId) {
              localStorage.setItem(
                mediaRecoveryKey,
                JSON.stringify(createdForMedia),
              );
            }
          } catch {
            // The in-memory retry remains available in this tab.
          }
          await persistCreatedPropertyMedia(createdForMedia, false);
          return;
        }
        markPropertyFormPristine();
        setHasConcurrencyConflict(false);
        clearDraft(draftKey);
        router.push("/properties");
      } catch (error) {
        if (isPropertyWorkspaceConflict(error)) {
          setHasConcurrencyConflict(true);
        }
        // Other errors are handled by the mutation hook.
      }
    } finally {
      submitInFlightRef.current = false;
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
    setFormData((prev) => ({
      ...prev,
      fotos: images,
      imagem_principal: mainImage,
    }));
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
  if (mediaUploadFailure && createdPropertyId) {
    return (
      <AppLayout title="Fotos pendentes">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-4xl flex-col gap-4"
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
              images={formData.fotos}
              mainImage={formData.imagem_principal}
              onImagesChange={handleImagesChange}
              hiddenSiteImages={formData.hidden_site_image_urls}
              onHiddenSiteImagesChange={(images) =>
                set("hidden_site_image_urls", images)
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isPersistingMedia}>
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
      </AppLayout>
    );
  }
  return (
    <AppLayout
      title={isEditing ? "Editar Imóvel" : "Novo Imóvel"}
      disableMainScroll
    >
      <form
        data-tour="property-form"
        onSubmit={handleSubmit}
        aria-describedby={
          visibleValidationIssues.length > 0
            ? "property-form-validation-summary"
            : undefined
        }
        className="property-form-surface h-full min-h-0 flex flex-col gap-3 text-[12px] font-light animate-in [&_.app-card]:rounded-[8px] [&_.app-card-soft]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light [&_input]:rounded-[6px] [&_input]:text-[12px] [&_input]:font-light [&_label]:text-[12px] [&_label]:font-light [&_textarea]:rounded-[6px] [&_textarea]:text-[12px] [&_textarea]:font-light [&_[role=combobox]]:rounded-[6px] [&_[role=combobox]]:text-[12px] [&_[role=combobox]]:font-light"
      >
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

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col gap-3"
        >
          <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
            <div
              data-collapse="compact"
              className="app-responsive-tab-list property-form-tabs-icon-only min-w-0 flex-1"
            >
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                <TabsList
                  data-tour="property-form-tabs"
                  data-responsive-tab-scroll
                  aria-label="Etapas do formulário do imóvel"
                  className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const tabHasIssue = visibleValidationIssues.some(
                      (issue) => issue.tab === tab.value,
                    );

                    return (
                      <Tooltip key={tab.value}>
                        <TooltipTrigger asChild>
                          <TabsTrigger
                            ref={(node) => {
                              propertyTabRefs.current[tab.value] = node;
                            }}
                            value={tab.value}
                            id={`property-tab-${tab.value}`}
                            type="button"
                            data-responsive-tab
                            data-tour={`property-tab-${tab.value}`}
                            aria-label={tab.label}
                            className={propertyFormTabTriggerClass}
                          >
                            <Icon aria-hidden="true" className="h-3 w-3" />
                            {tabHasIssue && (
                              <span
                                data-responsive-tab-badge
                                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary"
                              />
                            )}
                          </TabsTrigger>
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          className="text-xs"
                          data-testid={`property-tab-tooltip-${tab.value}`}
                        >
                          {tab.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TabsList>
              </TooltipProvider>
            </div>
            <div className="ml-auto grid w-auto flex-shrink-0 grid-cols-2 items-center gap-2 sm:flex">
              <Button
                type="button"
                variant="ghost"
                disabled={createProperty.isPending || isPersistingMedia}
                className="h-9 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() => {
                  if (!confirmFormNavigation()) return;
                  releaseStagedPropertyPhotos([
                    formData.imagem_principal,
                    ...formData.fotos,
                  ]);
                  clearDraft(draftKey);
                  router.push("/properties");
                }}
              >
                Cancelar
              </Button>
              <Button
                data-tour="property-save-button"
                type="submit"
                className="h-9 min-w-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                disabled={
                  createProperty.isPending ||
                  updateProperty.isPending ||
                  isPersistingMedia ||
                  hasConcurrencyConflict ||
                  !canEdit
                }
              >
                {(createProperty.isPending ||
                  updateProperty.isPending ||
                  isPersistingMedia) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Save className="mr-2 h-4 w-4" />
                {isEditing ? "Salvar" : "Cadastrar"}
              </Button>
            </div>
          </div>
          <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
            <PropertyFormSectionsProvider value={sectionContext}>
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
          </div>
        </Tabs>
      </form>
    </AppLayout>
  );
}
