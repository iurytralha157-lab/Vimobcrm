import { useState } from "react";
import { Check, Loader2, RefreshCw, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVerifyDomain } from "@/hooks/use-verify-domain";

interface DnsVerificationStatusProps {
  domain: string;
  isVerified: boolean;
  verifiedAt?: string | null;
  onVerified?: () => void;
}

export function DnsVerificationStatus({
  domain,
  isVerified,
  verifiedAt,
  onVerified
}: DnsVerificationStatusProps) {
  const verifyDomain = useVerifyDomain();
  const [lastCheck, setLastCheck] = useState<{
    verified: boolean;
    reason?: 'challenge_unavailable' | 'challenge_mismatch';
  } | null>(null);

  const handleVerify = async () => {
    if (!domain.trim()) return;
    try {
      const result = await verifyDomain.mutateAsync(domain);
      setLastCheck({
        verified: result.verified,
        reason: result.reason,
      });
      if (result.verified && onVerified) {
        onVerified();
      }
    } catch {
      setLastCheck({
        verified: false,
        reason: 'challenge_unavailable',
      });
    }
  };

  if (isVerified) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="border-0 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <Check className="w-3 h-3 mr-1" />
          Verificado
        </Badge>
        {verifiedAt && (
          <span className="text-muted-foreground text-xs">
            em {new Date(verifiedAt).toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="border-0 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          <Clock className="w-3 h-3 mr-1" />
          Aguardando verificação
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="border-0 bg-[var(--app-surface-soft)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={handleVerify}
          disabled={verifyDomain.isPending || !domain.trim()}
        >
          {verifyDomain.isPending ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1" />
          )}
          Verificar agora
        </Button>
      </div>

      {lastCheck && !lastCheck.verified && (
        <div className="space-y-2 rounded-[8px] bg-destructive/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="w-4 h-4" />
            Domínio ainda não configurado
          </div>
          <p className="text-xs text-muted-foreground">
            {lastCheck.reason === 'challenge_mismatch'
              ? 'O domínio respondeu, mas o token não confere. Copie novamente o Worker gerado para este domínio e publique.'
              : 'Não encontramos o token de verificação. Confira se o Worker está publicado e se a rota do domínio está ativa.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Testar em{' '}
            <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {domain}
            </a>
            {' '}ou verifique DNS em{' '}
            <a href="https://dnschecker.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              dnschecker.org
            </a>
          </p>
        </div>
      )}

      {lastCheck?.verified && (
        <div className="rounded-[8px] bg-green-50 p-3 dark:bg-green-900/20">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <Check className="w-4 h-4" />
            Domínio verificado com sucesso!
          </div>
        </div>
      )}
    </div>
  );
}
