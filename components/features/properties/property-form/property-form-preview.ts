import {
  getPropertyFormRules,
  parseLocaleNumber,
  type PropertyFormData,
} from "@/components/features/properties/property-form/property-form-model";

export type PropertyFormPublicPreview = {
  title: string;
  propertyType: string;
  dealType: string;
  address: string;
  description: string;
  images: string[];
  salePrice: number | null;
  rentalPrice: number | null;
  bedrooms: string;
  bathrooms: string;
  parkingSpaces: string;
  area: string;
  highlighted: boolean;
};

/** Only the explicitly public fields may cross into the draft preview. */
export function buildPropertyFormPublicPreview(
  formData: PropertyFormData,
): PropertyFormPublicPreview {
  const hiddenImages = new Set(formData.hidden_site_image_urls);
  const images = Array.from(new Set([
    formData.imagem_principal,
    ...formData.fotos,
  ])).filter((url) => url && !hiddenImages.has(url));
  const city = [formData.cidade, formData.uf].filter(Boolean);
  const addressParts = formData.public_address_visibility === "completo"
    ? [formData.endereco, formData.numero, formData.bairro, ...city, formData.cep]
    : formData.public_address_visibility === "parcial"
      ? [formData.bairro, ...city]
      : city;
  const { isSale, isRental } = getPropertyFormRules(formData);

  return {
    title: formData.title.trim(),
    propertyType: formData.tipo_de_imovel,
    dealType: formData.tipo_de_negocio,
    address: addressParts.filter(Boolean).join(", "),
    description: formData.descricao_site.trim(),
    images,
    salePrice: isSale ? parseLocaleNumber(formData.preco) : null,
    rentalPrice: isRental ? parseLocaleNumber(formData.valor_locacao) : null,
    bedrooms: formData.quartos,
    bathrooms: formData.banheiros,
    parkingSpaces: formData.vagas,
    area: formData.area_util || formData.area_total,
    highlighted: formData.destaque || formData.super_destaque,
  };
}
