'use client';

import NextImage from 'next/image';
import { LogOut, MessageCircle } from 'lucide-react';
import { LoginHeroMedia } from '@/components/features/auth/LoginHeroMedia';

type NoOrganizationEmptyStateProps = {
  onSignOut?: () => void;
  signingOut?: boolean;
  error?: string | null;
};

export function NoOrganizationEmptyState({
  onSignOut,
  signingOut = false,
  error,
}: NoOrganizationEmptyStateProps) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#171717] p-4 text-center text-white">
      <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <LoginHeroMedia posterSizes="100vw" alwaysPlay />
      </div>
      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(8,8,8,0.05)_28%,rgba(8,8,8,0.82)_100%)]" aria-hidden="true" />
      <div className="relative z-20 flex w-full max-w-[440px] flex-col items-center rounded-[8px] border-0 bg-white/[0.72] px-6 py-9 text-[#171717] shadow-none backdrop-blur-[18px] sm:px-10 sm:py-10">
        <NextImage
          src="/icons/favicon-laranja.png"
          alt="Vimob"
          width={60}
          height={60}
          className="h-[60px] w-[60px] object-contain"
        />
        <h2 className="mt-6 max-w-md text-[16px] font-normal text-[#171717]">
          Você não está cadastrado em nenhuma imobiliária no momento.
        </h2>
        <p className="mt-3 max-w-sm text-[12px] font-light leading-[18px] text-[#171717]/70">
          Entre em contato com os administradores para regularizar seu acesso.
        </p>

        <div className="mt-8 flex w-full max-w-[320px] flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onSignOut}
            disabled={!onSignOut || signingOut}
            title={onSignOut ? undefined : 'Prévia visual: sair está desativado'}
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[6px] border-0 bg-black/[0.06] px-4 text-[12px] font-light text-[#171717] transition-colors hover:bg-black/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-auto sm:flex-1"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.6} />
            {signingOut ? 'Saindo...' : 'Sair'}
          </button>
          <button
            type="button"
            disabled
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-[6px] border-0 bg-primary px-4 text-[12px] font-light text-white transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto sm:flex-1"
          >
            <MessageCircle className="h-4 w-4" strokeWidth={1.6} />
            Falar com suporte
          </button>
        </div>

        {error ? <p role="alert" className="mt-4 text-[12px] text-destructive">{error}</p> : null}

      </div>
    </div>
  );
}
