import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { financialAPI } from '@/lib/api/financial';
import { subMonths, format } from 'date-fns';

interface DREAccountGroup {
  id: string;
  organization_id: string;
  name: string;
  group_type: string;
  display_order: number;
  parent_id: string | null;
  is_system: boolean;
  created_at: string;
}

interface DREAccountMapping {
  id: string;
  organization_id: string;
  group_id: string;
  category: string;
  entry_type: string;
  created_at: string;
  group?: DREAccountGroup | null;
}

interface DREEntry {
  id: string;
  amount: number;
  category: string | null;
  type: string;
  status: string;
  due_date?: string | null;
  paid_date?: string | null;
}

interface DREInputData {
  groups: DREAccountGroup[];
  mappings: DREAccountMapping[];
  entries: DREEntry[];
  previousEntries: DREEntry[];
}

export interface DRELine {
  id: string;
  name: string;
  value: number;
  previousValue?: number;
  percentage?: number;
  variation?: number;
  children?: DRELine[];
  isTotal?: boolean;
  type?: string;
  level?: number;
}

export interface DREData {
  period: { start: string; end: string };
  previousPeriod?: { start: string; end: string };
  lines: DRELine[];
  totals: {
    grossRevenue: number;
    netRevenue: number;
    grossProfit: number;
    operatingResult: number;
    netResult: number;
  };
}

interface UseDREParams {
  startDate: Date;
  endDate: Date;
  regime: 'cash' | 'accrual';
  compareWithPrevious?: boolean;
}

export function useDRE({ startDate, endDate, regime, compareWithPrevious = false }: UseDREParams) {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ['dre', organizationId, startDate.toISOString(), endDate.toISOString(), regime, compareWithPrevious],
    queryFn: async (): Promise<DREData> => {
      if (!organizationId) throw new Error('No organization');

      const monthsDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
      const prevStart = subMonths(startDate, monthsDiff || 1);
      const prevEnd = subMonths(endDate, monthsDiff || 1);
      const dreInput = await financialAPI.dreInput<DREInputData>({
        startDate: format(startDate, 'yyyy-MM-dd'),
        endDate: format(endDate, 'yyyy-MM-dd'),
        previousStartDate: compareWithPrevious ? format(prevStart, 'yyyy-MM-dd') : undefined,
        previousEndDate: compareWithPrevious ? format(prevEnd, 'yyyy-MM-dd') : undefined,
        regime,
      }, organizationId);

      const groups = dreInput.groups || [];
      const mappings = dreInput.mappings || [];
      const entries = dreInput.entries || [];
      const previousEntries = dreInput.previousEntries || [];
      const groupValues = calculateGroupValues(groups, mappings, entries);
      const prevGroupValues = calculateGroupValues(groups, mappings, previousEntries);
      const sumByType = (type: string, values: Record<string, number>) =>
        groups
          .filter((group) => group.group_type === type && !group.parent_id)
          .reduce((sum, group) => sum + (values[group.id] || 0), 0);

      const grossRevenue = sumByType('revenue', groupValues);
      const deductions = sumByType('deduction', groupValues);
      const netRevenue = grossRevenue - deductions;
      const costs = sumByType('cost', groupValues);
      const grossProfit = netRevenue - costs;
      const expenses = sumByType('expense', groupValues);
      const operatingResult = grossProfit - expenses;
      const financialExpenses = sumByType('financial_expense', groupValues);
      const financialRevenues = sumByType('financial_revenue', groupValues);
      const taxes = sumByType('tax', groupValues);
      const netResult = operatingResult - financialExpenses + financialRevenues - taxes;

      const prevGrossRevenue = sumByType('revenue', prevGroupValues);
      const prevDeductions = sumByType('deduction', prevGroupValues);
      const prevNetRevenue = prevGrossRevenue - prevDeductions;
      const prevCosts = sumByType('cost', prevGroupValues);
      const prevGrossProfit = prevNetRevenue - prevCosts;
      const prevExpenses = sumByType('expense', prevGroupValues);
      const prevOperatingResult = prevGrossProfit - prevExpenses;
      const prevFinancialExpenses = sumByType('financial_expense', prevGroupValues);
      const prevFinancialRevenues = sumByType('financial_revenue', prevGroupValues);
      const prevTaxes = sumByType('tax', prevGroupValues);

      const createLine = (
        id: string,
        name: string,
        value: number,
        previousValue: number,
        isTotal = false,
        type?: string,
        level = 0,
      ): DRELine => ({
        id,
        name,
        value,
        previousValue: compareWithPrevious ? previousValue : undefined,
        percentage: grossRevenue > 0 ? (value / grossRevenue) * 100 : 0,
        variation: compareWithPrevious ? calculateVariation(value, previousValue) : undefined,
        isTotal,
        type,
        level,
      });

      const groupLines = (type: string) =>
        groups
          .filter((group) => group.group_type === type && !group.parent_id)
          .map((group) => createLine(group.id, group.name, groupValues[group.id] || 0, prevGroupValues[group.id] || 0, false, type, 1));

      const lines: DRELine[] = [
        createLine('header_revenue', '(+) RECEITA OPERACIONAL BRUTA', grossRevenue, prevGrossRevenue, true, 'revenue'),
        ...groupLines('revenue'),
        createLine('header_deduction', '(-) DEDUCOES DA RECEITA', deductions, prevDeductions, true, 'deduction'),
        ...groupLines('deduction'),
        createLine('total_net_revenue', '(=) RECEITA LIQUIDA', netRevenue, prevNetRevenue, true, 'total'),
        createLine('header_costs', '(-) CUSTOS OPERACIONAIS', costs, prevCosts, true, 'cost'),
        ...groupLines('cost'),
        createLine('total_gross_profit', '(=) LUCRO BRUTO', grossProfit, prevGrossProfit, true, 'total'),
        createLine('header_expenses', '(-) DESPESAS OPERACIONAIS', expenses, prevExpenses, true, 'expense'),
        ...groupLines('expense'),
        createLine('total_ebitda', '(=) RESULTADO OPERACIONAL (EBITDA)', operatingResult, prevOperatingResult, true, 'total'),
        createLine('header_fin_exp', '(-) DESPESAS FINANCEIRAS', financialExpenses, prevFinancialExpenses, true, 'financial_expense'),
        ...groupLines('financial_expense'),
        createLine('header_fin_rev', '(+) RECEITAS FINANCEIRAS', financialRevenues, prevFinancialRevenues, true, 'financial_revenue'),
        ...groupLines('financial_revenue'),
        createLine('total_before_taxes', '(=) RESULTADO ANTES IR/CS', operatingResult - financialExpenses + financialRevenues, prevOperatingResult - prevFinancialExpenses + prevFinancialRevenues, true, 'total'),
        createLine('header_taxes', '(-) IMPOSTOS SOBRE LUCRO', taxes, prevTaxes, true, 'tax'),
        ...groupLines('tax'),
        createLine('total_net_result', netResult >= 0 ? '(=) LUCRO LIQUIDO' : '(=) PREJUIZO LIQUIDO', netResult, prevOperatingResult - prevFinancialExpenses + prevFinancialRevenues - prevTaxes, true, 'result'),
      ];

      return {
        period: {
          start: format(startDate, 'yyyy-MM-dd'),
          end: format(endDate, 'yyyy-MM-dd'),
        },
        previousPeriod: compareWithPrevious ? {
          start: format(prevStart, 'yyyy-MM-dd'),
          end: format(prevEnd, 'yyyy-MM-dd'),
        } : undefined,
        lines,
        totals: {
          grossRevenue,
          netRevenue,
          grossProfit,
          operatingResult,
          netResult,
        },
      };
    },
    enabled: !!organizationId,
  });
}

export function useDREGroups() {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ['dre-groups', organizationId],
    queryFn: () => financialAPI.dreGroups<DREAccountGroup[]>(organizationId),
    enabled: !!organizationId,
  });
}

export function useDREMappings() {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ['dre-mappings', organizationId],
    queryFn: () => financialAPI.dreMappings<(DREAccountMapping & { group: DREAccountGroup | null })[]>(organizationId),
    enabled: !!organizationId,
  });
}

export function useInitializeDREGroups() {
  const { profile } = useAuth();

  const initializeGroups = async () => {
    if (!profile?.organization_id) return;
    await financialAPI.initializeDREGroups(profile.organization_id);
  };

  return { initializeGroups };
}

function calculateGroupValues(groups: DREAccountGroup[], mappings: DREAccountMapping[], entries: DREEntry[]) {
  const values: Record<string, number> = {};
  groups.forEach((group) => {
    values[group.id] = 0;
  });

  entries.forEach((entry) => {
    const mapping = mappings.find((candidate) => candidate.category === entry.category && candidate.entry_type === entry.type);
    if (mapping && values[mapping.group_id] !== undefined) {
      values[mapping.group_id] += Number(entry.amount || 0);
    }
  });

  return values;
}

function calculateVariation(value: number, previousValue: number) {
  if (previousValue !== 0) return ((value - previousValue) / Math.abs(previousValue)) * 100;
  return value > 0 ? 100 : 0;
}
