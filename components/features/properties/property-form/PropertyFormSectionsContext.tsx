"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { useRouter } from "next/navigation";
import type { useAuth } from "@/contexts/AuthContext";
import type {
  Property,
} from "@/hooks/use-properties";
import type {
  useCreatePropertyType,
} from "@/hooks/use-property-types";
import type {
  PropertyFeature,
  useCreatePropertyFeature,
} from "@/hooks/use-property-features";
import type {
  PropertyProximity,
  useCreatePropertyProximity,
} from "@/hooks/use-property-proximities";
import type {
  PropertyCity,
  PropertyCondominium,
  PropertyNeighborhood,
  useCreateCity,
  useCreateCondominium,
  useCreateNeighborhood,
} from "@/hooks/use-property-locations";
import type {
  PropertyOwner,
  useCreatePropertyOwner,
} from "@/hooks/use-property-owners";
import type { User as OrganizationUser } from "@/hooks/use-users";
import type {
  PropertyFormData,
  PropertyFormSetField,
} from "./property-form-model";

type AuthContextValue = ReturnType<typeof useAuth>;

export type PropertyFormSectionsContextValue = {
  formData: PropertyFormData;
  set: PropertyFormSetField;
  user: AuthContextValue["user"];
  profile: AuthContextValue["profile"];
  users: OrganizationUser[];
  property?: Property | null;
  propertyId: string | null;
  isEditing: boolean;
  router: ReturnType<typeof useRouter>;
  activeOrganizationId?: string;

  canManagePropertyCatalogs: boolean;
  canAssignProperty: boolean;
  canEditOwnerDetails: boolean;
  applyOwner: (owner: PropertyOwner | null) => void;
  handleCreateOwner: () => Promise<void>;
  createPropertyOwner: ReturnType<typeof useCreatePropertyOwner>;

  displayedPurposeOptions: string[];
  displayedDealOptions: string[];
  statusOptions: Array<{ value: string; label: string }>;
  propertyTypes: string[];
  newPurposeName: string;
  setNewPurposeName: Dispatch<SetStateAction<string>>;
  newTypeName: string;
  setNewTypeName: Dispatch<SetStateAction<string>>;
  showAddPurpose: boolean;
  setShowAddPurpose: Dispatch<SetStateAction<boolean>>;
  showAddType: boolean;
  setShowAddType: Dispatch<SetStateAction<boolean>>;
  handleAddPurpose: () => void;
  handleAddPropertyType: () => Promise<void>;
  handleDealTypeChange: (value: string) => void;
  createPropertyType: ReturnType<typeof useCreatePropertyType>;

  cities: PropertyCity[];
  neighborhoods: PropertyNeighborhood[];
  condominiums: PropertyCondominium[];
  selectedCity?: PropertyCity;
  selectedNeighborhood?: PropertyNeighborhood;
  selectedCondominium?: PropertyCondominium;
  applyCity: (city: PropertyCity | null) => void;
  applyNeighborhood: (neighborhood: PropertyNeighborhood | null) => void;
  applyCondominium: (condominium: PropertyCondominium | null) => void;
  lookupCep: (rawCep: string) => Promise<void>;
  isCepLoading: boolean;
  newCityName: string;
  setNewCityName: Dispatch<SetStateAction<string>>;
  newCityUf: string;
  setNewCityUf: Dispatch<SetStateAction<string>>;
  newNeighborhoodName: string;
  setNewNeighborhoodName: Dispatch<SetStateAction<string>>;
  newCondominiumName: string;
  setNewCondominiumName: Dispatch<SetStateAction<string>>;
  newCondominiumFee: string;
  setNewCondominiumFee: Dispatch<SetStateAction<string>>;
  newCondominiumPhoto: string;
  setNewCondominiumPhoto: Dispatch<SetStateAction<string>>;
  newCondominiumHasConcierge: boolean;
  setNewCondominiumHasConcierge: Dispatch<SetStateAction<boolean>>;
  newCondominiumConciergeType: string;
  setNewCondominiumConciergeType: Dispatch<SetStateAction<string>>;
  showAddCity: boolean;
  setShowAddCity: Dispatch<SetStateAction<boolean>>;
  showAddNeighborhood: boolean;
  setShowAddNeighborhood: Dispatch<SetStateAction<boolean>>;
  showAddCondominium: boolean;
  setShowAddCondominium: Dispatch<SetStateAction<boolean>>;
  handleCreateCity: () => Promise<void>;
  handleCreateNeighborhood: () => Promise<void>;
  handleCreateCondominium: () => Promise<void>;
  createCity: ReturnType<typeof useCreateCity>;
  createNeighborhood: ReturnType<typeof useCreateNeighborhood>;
  createCondominium: ReturnType<typeof useCreateCondominium>;

  isLand: boolean;
  isSale: boolean;
  isRental: boolean;
  supportsRentalContractTerms: boolean;
  supportsSaleTerms: boolean;
  primaryValuesGridClass: string;
  features: PropertyFeature[];
  proximities: PropertyProximity[];
  loadingFeatures: boolean;
  loadingProximities: boolean;
  createFeature: ReturnType<typeof useCreatePropertyFeature>;
  createProximity: ReturnType<typeof useCreatePropertyProximity>;
  handleImagesChange: (images: string[], mainImage: string) => void;
};

const PropertyFormSectionsContext =
  createContext<PropertyFormSectionsContextValue | null>(null);

export function PropertyFormSectionsProvider({
  value,
  children,
}: {
  value: PropertyFormSectionsContextValue;
  children: ReactNode;
}) {
  return (
    <PropertyFormSectionsContext.Provider value={value}>
      {children}
    </PropertyFormSectionsContext.Provider>
  );
}

export function usePropertyFormSections() {
  const context = useContext(PropertyFormSectionsContext);
  if (!context) {
    throw new Error(
      "usePropertyFormSections must be used inside PropertyFormSectionsProvider",
    );
  }
  return context;
}
