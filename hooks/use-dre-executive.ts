import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsAPI } from '@/lib/api/analytics';

export interface DRELine {
  id: string;
  name: string;
  value: number;
  previousValue?: number;
  percentage?: number;
  variation?: number;
  isTotal?: boolean;
  type?: 'revenue' | 'expense' | 'total' | 'tax';
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
    ebitda: number;
    roi: number;
    fixedCosts: number;
    variableCosts: number;
  };
}

interface UseDREParams {
  startDate: Date;
  endDate: Date;
  regime: 'cash' | 'accrual';
  compareWithPrevious?: boolean;
}

export function useDREExecutive({ startDate, endDate, regime, compareWithPrevious = false }: UseDREParams) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['dre-executive', organization?.id, startDate.toISOString(), endDate.toISOString(), regime, compareWithPrevious],
    queryFn: async (): Promise<DREData> => {
      if (!organization?.id) throw new Error('No organization');

      return analyticsAPI.dreExecutive<DREData>({
        startDate: format(startDate, 'yyyy-MM-dd'),
        endDate: format(endDate, 'yyyy-MM-dd'),
        regime,
        compareWithPrevious,
      });
    },
    enabled: !!organization?.id,
  });
}
