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
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-[var(--app-surface)] border-t border-white/[0.055] shadow-lg animate-in slide-in-from-bottom duration-300">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center overflow-hidden">
            <NextImage
              src={settings?.pwa_icon_url || "/apple-touch-icon.png"}
              alt="App Icon"
              width={48}
              height={48}
              className="w-full h-full object-cover"
              unoptimized
            />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-sm">
              Instalar Vimob
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              Acesse mais rápido direto da sua tela inicial
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={dismiss}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleInstall}
            >
              <Download className="h-4 w-4" />
              Instalar
            </Button>
          </div>
        </div>
      </div>

      {/* iOS Instructions Dialog */}
      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
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
