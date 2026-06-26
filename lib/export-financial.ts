import ExcelJS from 'exceljs';

interface ExportData {
  [key: string]: string | number | boolean | null | undefined;
}

type NamedRelation = {
  name?: string | null;
};

type FinancialEntryExportRow = {
  description?: string | null;
  type?: string | null;
  category?: string | NamedRelation | null;
  amount?: number | null;
  due_date?: string | null;
  status?: string | null;
  paid_value?: number | null;
  paid_amount?: number | null;
  paid_date?: string | null;
  installment_number?: number | null;
  total_installments?: number | null;
};

type CommissionExportRow = {
  user?: NamedRelation | null;
  contract?: { contract_number?: string | null } | null;
  property?: { code?: string | null } | null;
  base_value?: number | null;
  percentage?: number | null;
  calculated_value?: number | null;
  status?: string | null;
  forecast_date?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
};

type ContractExportRow = {
  contract_number?: string | null;
  client_name?: string | null;
  type?: string | null;
  property?: { code?: string | null } | null;
  total_value?: number | null;
  down_payment?: number | null;
  installments?: number | string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  signing_date?: string | null;
};

export async function exportToExcel(data: ExportData[], filename: string, sheetName = 'Dados') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length === 0) return;

  // Set columns from data keys
  const keys = Object.keys(data[0]);
  worksheet.columns = keys.map(key => ({
    header: key,
    key: key,
    width: Math.min(Math.max(key.length + 2, 12), 40),
  }));

  // Add rows
  data.forEach(row => worksheet.addRow(row));

  // Style header row
  worksheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(buffer, `${filename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export async function exportToCSV(data: ExportData[], filename: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Data');

  if (data.length === 0) return;

  const keys = Object.keys(data[0]);
  worksheet.columns = keys.map(key => ({ header: key, key: key }));
  data.forEach(row => worksheet.addRow(row));

  const buffer = await workbook.csv.writeBuffer();
  downloadFile(buffer, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

function downloadFile(buffer: ExcelJS.Buffer, filename: string, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pt-BR');
}

export function getStatusLabel(status: string): string {
  const statusMap: Record<string, string> = {
    pending: 'Pendente',
    paid: 'Pago',
    overdue: 'Vencido',
    cancelled: 'Cancelado',
    forecast: 'Prevista',
    approved: 'Aprovada',
    draft: 'Rascunho',
    active: 'Ativo',
    finished: 'Encerrado',
  };
  return statusMap[status] || status;
}

export function prepareFinancialEntriesExport(entries: FinancialEntryExportRow[]): ExportData[] {
  return entries.map((entry) => ({
    Descrição: entry.description,
    Tipo: entry.type === 'receivable' ? 'A Receber' : 'A Pagar',
    Categoria: typeof entry.category === 'string' ? entry.category : entry.category?.name || '-',
    Valor: formatCurrency(entry.amount),
    Vencimento: formatDate(entry.due_date),
    Status: entry.status ? getStatusLabel(entry.status) : '-',
    'Valor Pago': formatCurrency(entry.paid_value ?? entry.paid_amount),
    'Data Pagamento': formatDate(entry.paid_date),
    Parcela: entry.installment_number && entry.total_installments
      ? `${entry.installment_number}/${entry.total_installments}`
      : '-',
  }));
}

export function prepareCommissionsExport(commissions: CommissionExportRow[]): ExportData[] {
  return commissions.map((c) => ({
    Corretor: c.user?.name || '-',
    Contrato: c.contract?.contract_number || '-',
    Imóvel: c.property?.code || '-',
    'Valor Base': formatCurrency(c.base_value),
    Percentual: c.percentage ? `${c.percentage}%` : '-',
    'Valor Calculado': formatCurrency(c.calculated_value),
    Status: c.status ? getStatusLabel(c.status) : '-',
    'Data Previsão': formatDate(c.forecast_date),
    'Data Aprovação': formatDate(c.approved_at),
    'Data Pagamento': formatDate(c.paid_at),
  }));
}

export function prepareContractsExport(contracts: ContractExportRow[]): ExportData[] {
  return contracts.map((c) => ({
    Número: c.contract_number,
    Cliente: c.client_name,
    Tipo: c.type === 'sale' ? 'Venda' : c.type === 'rent' ? 'Locação' : 'Serviço',
    Imóvel: c.property?.code || '-',
    'Valor Total': formatCurrency(c.total_value),
    Entrada: formatCurrency(c.down_payment),
    Parcelas: c.installments || '-',
    Status: c.status ? getStatusLabel(c.status) : '-',
    'Data Início': formatDate(c.start_date),
    'Data Fim': formatDate(c.end_date),
    'Data Assinatura': formatDate(c.signing_date),
  }));
}
