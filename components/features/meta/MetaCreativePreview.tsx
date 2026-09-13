"use client";

import { useState } from "react";
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
import {
  getMetaCreativeDestination,
  type MetaCreativeAsset,
} from "@/lib/api/meta";

interface MetaCreativePreviewProps {
  creative: Pick<
    MetaCreativeAsset,
    | "name"
    | "type"
    | "thumbnailUrl"
    | "creativeUrl"
    | "videoUrl"
    | "permalinkUrl"
  >;
  size?: "sm" | "md" | "lg" | "preview" | "gallery";
  showAction?: boolean;
  showFormatBadge?: boolean;
  formatHint?: "feed" | "story" | null;
  className?: string;
}

const sizeClasses = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
  preview: "mx-auto w-full max-w-[180px]",
  gallery: "",
};

const imageSizes = {
  sm: "40px",
  md: "56px",
  lg: "80px",
  preview: "180px",
  gallery: "260px",
};

function asSafeExternalUrl(value: string | null) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getUniqueImageSources(creative: MetaCreativePreviewProps["creative"]) {
  return [creative.thumbnailUrl, creative.creativeUrl]
    .map(asSafeExternalUrl)
    .filter((source): source is string => Boolean(source))
    .filter((source, index, sources) => sources.indexOf(source) === index);
}

function getSafeCreativeDestination(
  creative: MetaCreativePreviewProps["creative"],
) {
  return (
    [
      getMetaCreativeDestination(creative),
      creative.permalinkUrl,
      creative.videoUrl,
      creative.creativeUrl,
    ]
      .map(asSafeExternalUrl)
      .find((source): source is string => Boolean(source)) ?? null
  );
}

function CreativeMedia({
  creative,
  size,
  showFormatBadge,
  formatHint,
}: {
  creative: MetaCreativePreviewProps["creative"];
  size: NonNullable<MetaCreativePreviewProps["size"]>;
  showFormatBadge: boolean;
  formatHint: MetaCreativePreviewProps["formatHint"];
}) {
  const imageSources = getUniqueImageSources(creative);
  const videoSource =
    creative.type === "video" ? asSafeExternalUrl(creative.videoUrl) : null;
  const [imageSourceIndex, setImageSourceIndex] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<"feed" | "story">(
    formatHint ?? "feed",
  );
  const imageSource = imageSources[imageSourceIndex] ?? null;
  const showVideo = !imageSource && Boolean(videoSource) && !videoFailed;
  const hasMediaPreview = Boolean(imageSource || showVideo);
  const updatePreviewFormat = (width: number, height: number) => {
    if (
      (size !== "preview" && size !== "gallery") ||
      formatHint ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }
    setPreviewFormat(height / width >= 1.5 ? "story" : "feed");
  };

  const isFormattedPreview = size === "preview" || size === "gallery";
  const shouldShowFormatBadge =
    showFormatBadge &&
    isFormattedPreview &&
    Boolean(hasMediaPreview || formatHint);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[6px] bg-[var(--app-surface-soft)]",
        sizeClasses[size],
        size === "preview" &&
          (previewFormat === "story" ? "aspect-[9/16]" : "aspect-[4/5]"),
        size === "gallery" &&
          (previewFormat === "story"
            ? "h-full w-auto max-w-full aspect-[9/16]"
            : "w-full max-w-[260px] aspect-[4/5]"),
      )}
    >
      {imageSource ? (
        <Image
          src={imageSource}
          alt={`Criativo ${creative.name}`}
          fill
          sizes={imageSizes[size]}
          className={isFormattedPreview ? "object-contain" : "object-cover"}
          unoptimized
          onLoad={({ currentTarget }) => {
            updatePreviewFormat(
              currentTarget.naturalWidth,
              currentTarget.naturalHeight,
            );
          }}
          onError={() => {
            setImageSourceIndex((currentIndex) => currentIndex + 1);
          }}
        />
      ) : showVideo && videoSource ? (
        <video
          src={videoSource}
          aria-label={`Vídeo do criativo ${creative.name}`}
          className={cn(
            "h-full w-full",
            isFormattedPreview ? "object-contain" : "object-cover",
          )}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={({ currentTarget }) => {
            updatePreviewFormat(
              currentTarget.videoWidth,
              currentTarget.videoHeight,
            );
          }}
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1.5"
          role="img"
          aria-label={`Prévia indisponível para ${creative.name}`}
        >
          {creative.type === "video" ? (
            <Video
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ImageIcon
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          {isFormattedPreview ? (
            <span className="text-[9px] font-light text-muted-foreground">
              Prévia indisponível
            </span>
          ) : null}
        </div>
      )}

      {creative.type === "video" && hasMediaPreview ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--app-overlay)]">
          <Play
            className="h-4 w-4 fill-[var(--app-on-media)] text-[var(--app-on-media)]"
            aria-hidden="true"
          />
        </div>
      ) : null}

      {creative.type === "carousel" ? (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded-[4px] bg-[var(--app-media-scrim)] px-1 text-[9px] font-light text-[var(--app-on-media)]">
          carrossel
        </div>
      ) : null}

      {shouldShowFormatBadge ? (
        <span className="pointer-events-none absolute left-2 top-2 rounded-[4px] bg-[var(--app-media-scrim-strong)] px-1.5 py-1 text-[9px] font-medium leading-none text-[var(--app-on-media)]">
          {previewFormat === "story" ? "Stories" : "Feed"}
        </span>
      ) : null}
    </div>
  );
}

export function MetaCreativePreview({
  creative,
  size = "md",
  showAction = true,
  showFormatBadge = false,
  formatHint = null,
  className,
}: MetaCreativePreviewProps) {
  const destination = getSafeCreativeDestination(creative);
  const mediaIdentity = [
    creative.type,
    creative.thumbnailUrl,
    creative.creativeUrl,
    creative.videoUrl,
    formatHint,
  ].join("|");

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <CreativeMedia
        key={mediaIdentity}
        creative={creative}
        size={size}
        showFormatBadge={showFormatBadge}
        formatHint={formatHint}
      />

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
                  rel="noopener noreferrer"
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
