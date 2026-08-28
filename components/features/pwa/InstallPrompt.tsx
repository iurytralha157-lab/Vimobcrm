import { useEffect, useState } from "react";
import { Download, Share, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import {
  PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
  PwaActionPrompt,
} from "./PwaActionPrompt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function InstallPrompt() {
  const { showPrompt, isIOS, isStandalone, install, dismiss, canInstall } =
    useInstallPrompt();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const isBannerVisible = !isStandalone && showPrompt && !showIOSInstructions;

  useEffect(() => {
    const publishVisibility = (visible: boolean) => {
      window.dispatchEvent(
        new CustomEvent(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, {
          detail: { visible },
        }),
      );
    };

    publishVisibility(isBannerVisible);
    return () => publishVisibility(false);
  }, [isBannerVisible]);

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
        <PwaActionPrompt
          title="Instalar Vimob"
          description="Acesse mais rápido direto da sua tela inicial"
          actionLabel="Instalar"
          actionIcon={Download}
          onAction={handleInstall}
          onDismiss={dismiss}
          ariaLabel="Aviso de instalação do Vimob"
          promptKind="install"
        />
      )}

      {/* iOS Instructions Dialog */}
      <Dialog
        open={showIOSInstructions}
        onOpenChange={(open) => {
          setShowIOSInstructions(open);
          if (!open) dismiss();
        }}
      >
        <DialogContent className="w-[calc(100vw-24px)] rounded-[8px] p-5 sm:w-full sm:max-w-md">
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
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-sm font-light text-primary-foreground">
                1
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Toque no botão Compartilhar
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  O ícone <Share className="h-3 w-3 inline" /> na barra do
                  Safari
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-sm font-light text-primary-foreground">
                2
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Role para baixo e toque em
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Plus className="h-3 w-3 inline" /> &quot;Adicionar à Tela de
                  Início&quot;
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-sm font-light text-primary-foreground">
                3
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Toque em &quot;Adicionar&quot;
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O app será instalado na sua tela inicial
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              className="w-full rounded-[6px] bg-primary/50 font-light text-primary-foreground hover:bg-primary focus-visible:bg-primary"
              onClick={() => {
                setShowIOSInstructions(false);
                dismiss();
              }}
            >
              Entendi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
