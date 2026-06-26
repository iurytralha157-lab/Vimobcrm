"use client";

import Image from "next/image";
import { ExternalLink, Image as ImageIcon, Play, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getMetaCreativeDestination, type MetaCreativeAsset } from "@/lib/api/meta";

interface MetaCreativePreviewProps {
  creative: Pick<
    MetaCreativeAsset,
    "name" | "type" | "thumbnailUrl" | "creativeUrl" | "videoUrl" | "permalinkUrl"
  >;
  size?: "sm" | "md" | "lg";
  showAction?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
};

export function MetaCreativePreview({
  creative,
  size = "md",
  showAction = true,
  className,
}: MetaCreativePreviewProps) {
  const destination = getMetaCreativeDestination(creative);
  const hasImage = !!(creative.thumbnailUrl || creative.creativeUrl);
  const src = creative.thumbnailUrl || creative.creativeUrl || "";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-white/[0.045]", sizeClasses[size])}>
        {hasImage ? (
          <Image
            src={src}
            alt={creative.name}
            fill
            sizes={size === "lg" ? "80px" : size === "md" ? "56px" : "40px"}
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        {creative.type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        )}
        {creative.type === "carousel" && (
          <div className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[9px] font-medium text-white">
            carrossel
          </div>
        )}
      </div>

      {showAction && destination && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
              >
                <a
                  href={destination}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir criativo ${creative.name}`}
                >
                  {creative.type === "video" ? (
                    <Video className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Abrir criativo</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
