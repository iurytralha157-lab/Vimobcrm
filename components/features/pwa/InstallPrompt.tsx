import { useState } from 'react';
import NextImage from 'next/image';
import { X, Download, Share, Plus, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { useSystemSettings } from '@/hooks/use-system-settings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function InstallPrompt() {
  const { showPrompt, isIOS, isStandalone, install, dismiss, canInstall } = useInstallPrompt();
  const { data: settings } = useSystemSettings();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  // Don't show if already installed or prompt shouldn't be shown
  if (isStandalone || !showPrompt) {
    return null;
  }

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
    } else if (canInstall) {
      const installed = await install();
      if (installed) {
        // Successfully installed
      }
    }
  };

  return (
    <>
      {/* Install Banner */}
      {!showIOSInstructions && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300 sm:p-4 sm:pb-4">
          <div className="mx-auto flex w-full max-w-lg items-center gap-3 rounded-[14px] border border-white/[0.055] bg-[var(--app-surface-solid)] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-primary/10 sm:h-12 sm:w-12">
              <NextImage
                src={settings?.pwa_icon_url || "/apple-touch-icon.png"}
                alt="App Icon"
                width={48}
                height={48}
                className="h-full w-full object-cover"
                unoptimized
              />
            </div>

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              Instalar Vimob
            </h3>
            <p className="max-h-[2.35em] overflow-hidden text-xs leading-snug text-muted-foreground sm:max-h-none sm:truncate">
              Acesse mais rápido direto da sua tela inicial
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-[8px]"
              onClick={dismiss}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="h-10 gap-1.5 rounded-[8px] px-3 text-sm"
              onClick={handleInstall}
            >
              <Download className="h-4 w-4" />
              Instalar
            </Button>
          </div>
        </div>
        </div>
      )}

      {/* iOS Instructions Dialog */}
      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent className="w-[calc(100vw-24px)] rounded-[14px] p-5 sm:w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              Instalar no iPhone/iPad
            </DialogTitle>
            <DialogDescription>
              Siga os passos abaixo para adicionar o Vimob à sua tela inicial
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                1
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Toque no botão Compartilhar</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  O ícone <Share className="h-3 w-3 inline" /> na barra do Safari
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                2
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Role para baixo e toque em</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Plus className="h-3 w-3 inline" /> &quot;Adicionar à Tela de Início&quot;
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                3
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Toque em &quot;Adicionar&quot;</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O app será instalado na sua tela inicial
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button className="w-full rounded-xl" onClick={() => {
              setShowIOSInstructions(false);
              dismiss();
            }}>
              Entendi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
