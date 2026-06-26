import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '@/lib/api/admin';

export interface TableStats {
  name: string;
  size_bytes: number;
  size_pretty: string;
  estimated_rows: number;
}

export interface DatabaseStats {
  database_size_bytes: number;
  database_size_pretty: string;
  tables: TableStats[];
  storage: {
    count: number;
    size_bytes: number;
  };
  counts: {
    whatsapp_messages: number;
    notifications: number;
    activities: number;
    audit_logs: number;
    leads: number;
    users: number;
    organizations: number;
  };
}

export function useDatabaseStats() {
  return useQuery({
    queryKey: ['database-stats-admin'],
    queryFn: () => adminAPI.databaseStats<DatabaseStats>(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}
