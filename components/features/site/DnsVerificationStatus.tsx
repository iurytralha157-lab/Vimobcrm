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
    error?: string;
  } | null>(null);

  const handleVerify = async () => {
    const result = await verifyDomain.mutateAsync(domain);
    setLastCheck({
      verified: result.verified,
      error: result.error
    });
    if (result.verified && onVerified) {
      onVerified();
    }
  };

  if (isVerified) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
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
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
          <Clock className="w-3 h-3 mr-1" />
          Aguardando verificação
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerify}
          disabled={verifyDomain.isPending}
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
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="w-4 h-4" />
            Domínio ainda não configurado
          </div>
          <p className="text-xs text-muted-foreground">
            Verifique se o Cloudflare Worker está ativo e a rota está configurada corretamente para o domínio.
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
          {lastCheck.error && (
            <p className="text-xs text-destructive">Erro: {lastCheck.error}</p>
          )}
        </div>
      )}

      {lastCheck?.verified && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <Check className="w-4 h-4" />
            Domínio verificado com sucesso!
          </div>
        </div>
      )}
    </div>
  );
}
