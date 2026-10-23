import { notFound } from 'next/navigation';
import { NoOrganizationEmptyState } from '@/components/features/auth/screens/NoOrganizationEmptyState';

export default function NoOrganizationPreviewPage() {
  if (
    process.env.NODE_ENV !== 'development'
    || process.env.NEXT_PUBLIC_LOCAL_READ_ONLY !== 'true'
  ) {
    notFound();
  }

  return (
    <>
      <div className="fixed left-4 top-4 z-50 rounded-[6px] border border-white/15 bg-black/70 px-3 py-2 text-[12px] text-white [@media(max-height:500px)]:hidden">
        Prévia visual local — sem alterar sua sessão
      </div>
      <NoOrganizationEmptyState />
    </>
  );
}
