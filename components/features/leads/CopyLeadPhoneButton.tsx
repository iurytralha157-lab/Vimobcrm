import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

type CopyLeadPhoneButtonProps = {
  phone?: string | null;
  className?: string;
};

export function CopyLeadPhoneButton({ phone, className }: CopyLeadPhoneButtonProps) {
  const handleCopy = async () => {
    if (!phone) return;

    const copied = await copyTextToClipboard(phone);
    if (copied) {
      toast.success('Telefone copiado');
      return;
    }

    toast.error('Não foi possível copiar o telefone');
  };

  if (!phone?.trim()) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Copiar telefone"
      onClick={handleCopy}
      className={cn(
        'h-7 w-7 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]',
        className,
      )}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}
