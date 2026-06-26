import ExcelJS from 'exceljs';
import { Contract } from '@/hooks/use-contracts';
import { format as formatDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ExportOptions {
  contracts: Contract[];
  filename?: string;
  exportFormat?: 'xlsx' | 'csv';
}

const typeLabels: Record<string, string> = {
  sale: 'Venda',
  rental: 'Locação',
  service: 'Serviço',
};

const statusLabels: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDateSafe(date: string | null | undefined): string {
  if (!date) return '-';
  try {
    return formatDate(new Date(date), 'dd/MM/yyyy', { locale: ptBR });
  } catch {
    return '-';
  }
}

export async function exportContracts({ contracts, filename = 'contratos', exportFormat = 'xlsx' }: ExportOptions) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Contratos');

  // Define headers
  worksheet.columns = [
    { header: 'Número', key: 'numero', width: 15 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Imóvel', key: 'imovel', width: 15 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Comissão %', key: 'comissao_pct', width: 12 },
    { header: 'Valor Comissão', key: 'comissao_valor', width: 18 },
    { header: 'Data Assinatura', key: 'assinatura', width: 16 },
    { header: 'Data Fechamento', key: 'fechamento', width: 16 },
    { header: 'Lead', key: 'lead', width: 20 },
    { header: 'Observações', key: 'observacoes', width: 30 },
    { header: 'Criado em', key: 'criado', width: 14 },
  ];

  // Add data rows
  contracts.forEach(contract => {
    worksheet.addRow({
      numero: contract.contract_number || '',
      tipo: contract.contract_type ? (typeLabels[contract.contract_type] || contract.contract_type) : '',
      status: contract.status ? (statusLabels[contract.status] || contract.status) : '',
      imovel: contract.property?.code || '',
      valor: formatCurrency(contract.value),
      comissao_pct: contract.commission_percentage || '',
      comissao_valor: formatCurrency(contract.commission_value),
      assinatura: formatDateSafe(contract.signing_date),
      fechamento: formatDateSafe(contract.closing_date),
      lead: contract.lead?.name || '',
      observacoes: contract.notes || '',
      criado: formatDateSafe(contract.created_at),
    });
  });

  // Style header row
  worksheet.getRow(1).font = { bold: true };

  // Generate and download file
  if (exportFormat === 'csv') {
    const buffer = await workbook.csv.writeBuffer();
    downloadFile(buffer, `${filename}.csv`, 'text/csv;charset=utf-8;');
  } else {
    const buffer = await workbook.xlsx.writeBuffer();
    downloadFile(buffer, `${filename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
}

function downloadFile(buffer: ExcelJS.Buffer, filename: string, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
