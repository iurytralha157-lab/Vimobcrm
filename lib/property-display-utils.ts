/**
 * Mapeia tipos de imóvel para exibição pública.
 * Ex: "Condomínio" → "Casa", "Sobrado" → "Casa"
 */
const displayTypeMap: Record<string, string> = {
  'Condomínio': 'Casa',
  'Sobrado': 'Casa',
  'Kitnet': 'Apartamento',
  'Flat': 'Apartamento',
  'Loft': 'Apartamento',
  'Studio': 'Apartamento',
  'Sala Comercial': 'Comercial',
  'Loja': 'Comercial',
  'Lote': 'Terreno',
  'Chácara': 'Sítio',
};

export function getDisplayPropertyType(tipo: string | null | undefined): string {
  if (!tipo) return '';
  return displayTypeMap[tipo] || tipo;
}
