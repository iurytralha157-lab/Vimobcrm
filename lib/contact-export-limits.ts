export const CONTACT_EXPORT_MAX_EXPANDED_COLUMNS = 20_000;
export const CONTACT_EXPORT_MAX_CELLS = 2_000_000;
export const CONTACT_EXPORT_MAX_JSON_NODES = 1_000_000;
export const CONTACT_EXPORT_MAX_JSON_CHARACTERS = 64_000_000;
export const CONTACT_EXPORT_MAX_JSON_DEPTH = 64;
export const CONTACT_EXPORT_XLSX_MAX_COLUMNS = 16_384;
export const CONTACT_EXPORT_XLSX_MAX_CONTACTS = 1_048_575;
export const CONTACT_EXPORT_XLSX_MAX_CELL_CHARACTERS = 32_767;

export class ContactExportExpansionError extends Error {
  constructor() {
    super('Os campos expandidos excedem o limite de processamento deste relatório. Desmarque a expansão e selecione Metadados JSON, Meta Payload JSON e Meta Raw Payload JSON, ou reduza os filtros. Nenhum campo foi cortado e nenhum arquivo foi gerado.');
    this.name = 'ContactExportExpansionError';
  }
}

export function validateContactExportLayout(format: 'csv' | 'xlsx', contacts: number, columns: number) {
  if (format === 'xlsx' && columns > CONTACT_EXPORT_XLSX_MAX_COLUMNS) {
    throw new Error('A expansão ultrapassa 16.384 colunas, o limite do Excel. Escolha CSV ou desmarque os campos expandidos e selecione as colunas JSON. Nenhum arquivo foi gerado.');
  }
  if (format === 'xlsx' && contacts > CONTACT_EXPORT_XLSX_MAX_CONTACTS) {
    throw new Error('O relatório ultrapassa o limite de linhas do Excel. Reduza os filtros para exportar em partes. Nenhum arquivo foi gerado.');
  }
  if ((contacts + 1) * columns > CONTACT_EXPORT_MAX_CELLS) {
    throw new Error('O relatório excede o limite de processamento no navegador. Reduza os filtros ou as colunas; se necessário, desmarque a expansão e selecione as colunas JSON. Nenhum arquivo foi gerado.');
  }
}

export function validateContactExportXLSXCell(value: unknown) {
  if (typeof value === 'string' && value.length > CONTACT_EXPORT_XLSX_MAX_CELL_CHARACTERS) {
    throw new Error('Uma célula ultrapassa 32.767 caracteres, o limite do Excel. Escolha CSV ou remova essa coluna. Nenhum conteúdo foi cortado e nenhum arquivo foi gerado.');
  }
}
