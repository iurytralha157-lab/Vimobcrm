import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, ZoomIn, ZoomOut, AlertCircle } from "lucide-react";
import { useState } from "react";
import NextImage from "next/image";
import { cn } from "@/lib/utils";

interface MediaViewerProps {
  src: string;
  type: "image" | "video";
  isOpen: boolean;
  onClose: () => void;
  filename?: string;
}

export function MediaViewer({ src, type, isOpen, onClose, filename }: MediaViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const resetZoom = () => setZoom(1);

  const handleError = () => {
    console.error('[MediaViewer Error]', {
      type,
      src: src.substring(0, 80) + '...'
    });
    setError(true);
  };

  const handleClose = () => {
    setZoom(1);
    setError(false);
    onClose();
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "media";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      const link = document.createElement("a");
      link.href = src;
      link.download = filename || "media";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">{filename || "Visualizar mídia"}</DialogTitle>
        <div className="relative w-full h-full flex flex-col">
          {/* Header controls */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center gap-2">
              {type === "image" && !error && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20"
                    onClick={handleZoomOut}
                  >
                    <ZoomOut className="w-5 h-5" />
                  </Button>
                  <span className="text-white text-sm min-w-[3rem] text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20"
                    onClick={handleZoomIn}
                  >
                    <ZoomIn className="w-5 h-5" />
                  </Button>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={handleClose}
            >
              <X className="w-6 h-6" />
            </Button>
          </div>

          {/* Media content */}
          <div
            className="flex-1 flex items-center justify-center overflow-auto p-8"
            onClick={type === "image" && !error ? resetZoom : undefined}
          >
            {error ? (
              <div className="flex flex-col items-center gap-4 text-white">
                <AlertCircle className="w-12 h-12 opacity-70" />
                <p className="text-lg">Erro ao carregar mídia</p>
                <p className="text-sm opacity-60 max-w-[300px] text-center">
                  O arquivo pode estar corrompido ou inacessível
                </p>
                <Button
                  variant="secondary"
                  className="bg-white/20 hover:bg-white/30 text-white border-none"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Tentar baixar
                </Button>
              </div>
            ) : type === "image" ? (
              <NextImage
                src={src}
                alt="Media"
                width={1200}
                height={900}
                className={cn(
                  "max-w-full max-h-[80vh] object-contain transition-transform duration-200",
                  zoom !== 1 && "cursor-zoom-out"
                )}
                style={{ transform: `scale(${zoom})` }}
                onError={handleError}
                onClick={(e) => {
                  e.stopPropagation();
                  if (zoom === 1) handleZoomIn();
                  else resetZoom();
                }}
                unoptimized
              />
            ) : (
              <video
                src={src}
                controls
                autoPlay
                className="max-w-full max-h-[80vh]"
                onError={handleError}
              />
            )}
          </div>

          {/* Footer controls */}
          {!error && (
            <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-3 p-4 bg-gradient-to-t from-black/70 to-transparent">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/20 hover:bg-white/30 text-white border-none"
                onClick={handleDownload}
              >
                <Download className="w-4 h-4 mr-2" />
                Baixar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
