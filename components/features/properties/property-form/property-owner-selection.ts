import type { PropertyFormData } from "@/components/features/properties/property-form/property-form-model";

type SelectedOwner = {
  id: string;
  name: string;
  phone_residential?: string | null;
  phone_commercial?: string | null;
  cellphone?: string | null;
  email?: string | null;
  media_source?: string | null;
  notify_email?: boolean | null;
};

export function selectPropertyOwner(previous: PropertyFormData, owner: SelectedOwner | null): PropertyFormData {
  if (!owner && !previous.owner_id) return previous;
  return {
    ...previous,
    owner_id: owner?.id ?? "",
    owner_name: owner?.name ?? "",
    owner_phone_residential: owner?.phone_residential ?? "",
    owner_phone_commercial: owner?.phone_commercial ?? "",
    owner_cellphone: owner?.cellphone ?? "",
    owner_email: owner?.email ?? "",
    owner_media_source: owner?.media_source ?? "",
    owner_notify_email: owner?.notify_email ?? false,
  };
}
