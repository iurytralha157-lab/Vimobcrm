'use client';

import { useAuth } from '@/contexts/AuthContext';

export function AccessValidationNotice() {
  const { accessValidationStale } = useAuth();
  if (!accessValidationStale) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] bg-amber-400 px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-[12px] font-normal text-[#151515]"
    >
      Conexão instável com o servidor. Você continua nesta tela e tentaremos novamente.
    </div>
  );
}
