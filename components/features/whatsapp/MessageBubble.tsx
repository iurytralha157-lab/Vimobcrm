import { useState, useRef, useEffect, SyntheticEvent } from "react";
import NextImage from "next/image";
import { Check, CheckCheck, Clock, Mic, Play, Pause, FileText, Download, AlertCircle, RefreshCw, Loader2, Image as ImageIcon, Video, Link2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MediaViewer } from "./MediaViewer";
import { useCreateLeadAttachment } from "@/hooks/use-lead-attachments";
import { useMentionNames } from "@/hooks/use-mention-names";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface MessageBubbleProps {
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaStatus: 'pending' | 'ready' | 'failed' | null;
  mediaError: string | null;
  mediaSize?: number | null;
  fromMe: boolean;
  status: string;
  sentAt: string;
  senderName: string | null;
  isGroup: boolean;
  onRetryMedia: () => void;
  messageId: string;
  leadId: string;
  leadName: string;
  conversationRemoteJid?: string | null;
  conversationSessionId?: string | null;
  reactions: Array<{
    emoji: string;
    senderName: string | null;
    fromMe: boolean;
  }>;
}

// Generate pseudo-random waveform bars based on a seed
const generateWaveform = (seed: string, count: number = 40): number[] => {
  const bars: number[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }

  for (let i = 0; i < count; i++) {
    const val = Math.abs(Math.sin(hash * (i + 1) * 0.1) * Math.cos(hash * (i + 1) * 0.05));
    bars.push(0.2 + val * 0.8); // Min 20%, max 100%
  }
  return bars;
};

// Check browser support for audio/ogg with opus codec
const checkOggOpusSupport = (): boolean => {
  try {
    const audio = document.createElement('audio');
    return !!(audio.canPlayType && audio.canPlayType('audio/ogg; codecs=opus').replace(/no/, ''));
  } catch {
    return false;
  }
};

// Fetch audio as blob URL to bypass format detection issues
const fetchAsBlobUrl = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Media request failed: ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const AUDIO_PLAYBACK_RATES = [1, 1.5, 2] as const;
const AUDIO_PLAYBACK_RATE_EVENT = "vimob:whatsapp-audio-rate";
let sharedAudioPlaybackRate: typeof AUDIO_PLAYBACK_RATES[number] = 1;

const toSafeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[conteúdo indisponível]";
  }
};

export function MessageBubble({
  content,
  messageType,
  mediaUrl,
  mediaMimeType,
  mediaStatus,
  mediaError,
  mediaSize,
  fromMe,
  status,
  sentAt,
  senderName,
  isGroup,
  onRetryMedia,
  messageId,
  leadId,
  leadName,
  conversationRemoteJid,
  conversationSessionId,
  reactions = [],
}: MessageBubbleProps) {
  const createAttachment = useCreateLeadAttachment();
  const safeContent = toSafeText(content);
  const [attachConfirmOpen, setAttachConfirmOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(sharedAudioPlaybackRate);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobAttempted, setBlobAttempted] = useState(false);
  const [mediaPendingNowMs, setMediaPendingNowMs] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Waveform bars generated from mediaUrl or sentAt as seed
  const waveformBars = generateWaveform(mediaUrl || sentAt, 28);

  const lastMessageIdRef = useRef<string | null>(null);
  const lastMediaUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const didUrlChange = mediaUrl !== lastMediaUrlRef.current || messageId !== lastMessageIdRef.current;
    lastMediaUrlRef.current = mediaUrl || null;
    lastMessageIdRef.current = messageId;

    if (didUrlChange) {
      const previousBlobUrl = blobUrl;
      let cancelled = false;

      queueMicrotask(() => {
        if (cancelled) return;

        if (previousBlobUrl) {
          URL.revokeObjectURL(previousBlobUrl);
          setBlobUrl(null);
        }
        setBlobAttempted(false);
        setAudioError(null);
        setAudioReady(false);
        setAudioProgress(0);
        setCurrentTime(0);
        setIsPlaying(false);

        if (messageType === "image" || messageType === "sticker") {
          setImageError(false);
          setImageLoading(!!mediaUrl);
        }
      });

      return () => {
        cancelled = true;
      };
    }
  }, [mediaUrl, messageType, messageId, blobUrl]);

  useEffect(() => {
    const handlePlaybackRateChange = (event: Event) => {
      const nextRate = (event as CustomEvent<number>).detail;
      if (!AUDIO_PLAYBACK_RATES.includes(nextRate as typeof AUDIO_PLAYBACK_RATES[number])) return;
      setPlaybackRate(nextRate as typeof AUDIO_PLAYBACK_RATES[number]);
      if (audioRef.current) {
        audioRef.current.playbackRate = nextRate;
      }
    };

    window.addEventListener(AUDIO_PLAYBACK_RATE_EVENT, handlePlaybackRateChange);
    return () => window.removeEventListener(AUDIO_PLAYBACK_RATE_EVENT, handlePlaybackRateChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncPendingTime = () => {
      if (cancelled) return;
      setMediaPendingNowMs(mediaStatus === "pending" ? Date.now() : null);
    };

    const initialTimer = window.setTimeout(syncPendingTime, 0);
    const interval = mediaStatus === "pending"
      ? window.setInterval(syncPendingTime, 30_000)
      : null;

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      if (interval) window.clearInterval(interval);
    };
  }, [mediaStatus, sentAt]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const formatTime = (date: string) => {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return format(parsed, "HH:mm");
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = () => {
    if (!fromMe) return null;

    switch (status) {
      case "read":
      case "played":
        return <CheckCheck className="w-[16px] h-[16px] text-blue-400" />;
      case "delivered":
        return <CheckCheck className="w-[16px] h-[16px] opacity-60" />;
      case "sent":
        return <Check className="w-[16px] h-[16px] opacity-60" />;
      case "pending":
        return <Clock className="w-[16px] h-[16px] opacity-60 animate-pulse" />;
      default:
        return <Check className="w-[16px] h-[16px] opacity-60" />;
    }
  };

  const isValidMediaUrl = (url: string | null | undefined): boolean => {
    if (!url) return false;
    if (messageType === "sticker" && url.includes("a.whatsapp.net")) return false;
    if (url.includes("mmg.whatsapp.net")) return false;
    if (url.includes("pps.whatsapp.net")) return false;
    // Extract path without query parameters to avoid false matches on signed URL token strings
    const pathPart = url.split("?")[0];
    if (pathPart.endsWith(".enc") || pathPart.includes(".enc/")) return false;
    if (url.startsWith("data:")) return true;
    return url.startsWith("http://") || url.startsWith("https://");
  };

  const cyclePlaybackRate = () => {
    const currentIndex = AUDIO_PLAYBACK_RATES.indexOf(playbackRate as typeof AUDIO_PLAYBACK_RATES[number]);
    const nextIndex = (currentIndex + 1) % AUDIO_PLAYBACK_RATES.length;
    const newRate = AUDIO_PLAYBACK_RATES[nextIndex];
    sharedAudioPlaybackRate = newRate;
    setPlaybackRate(newRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate;
    }
    window.dispatchEvent(new CustomEvent(AUDIO_PLAYBACK_RATE_EVENT, { detail: newRate }));
  };

  const handleAudioPlay = () => {
    if (audioRef.current && !audioError) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.play().catch(() => {
          setAudioError('Erro ao reproduzir');
        });
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      const duration = audioRef.current.duration;
      const progress = Number.isFinite(duration) && duration > 0
        ? (audioRef.current.currentTime / duration) * 100
        : 0;
      setAudioProgress(progress || 0);
      setCurrentTime(Number.isFinite(audioRef.current.currentTime) ? audioRef.current.currentTime : 0);
    }
  };

  const handleAudioLoadedMetadata = () => {
    if (audioRef.current) {
      const duration = audioRef.current.duration;
      setAudioDuration(Number.isFinite(duration) && duration > 0 ? duration : 0);
      setAudioReady(true);
    }
  };

  const handleAudioError = async (e: SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    const errorCode = audio.error?.code ?? 0;

    // Try blob URL fallback before giving up (bypasses browser format sniffing)
    if (!blobAttempted && mediaUrl && isValidMediaUrl(mediaUrl)) {
      setBlobAttempted(true);
      try {
        const blob = await fetchAsBlobUrl(mediaUrl);
        setBlobUrl(blob);
        setAudioError(null);
        // The audio element will re-render with the new blob src
        return;
      } catch {
        // Se o fallback por blob falhar, exibimos o estado de erro no proprio bubble.
      }
    }

    // Check if it's a format issue
    if (mediaMimeType?.includes('ogg') && !checkOggOpusSupport()) {
      setAudioError('Formato não suportado neste navegador');
    } else if (errorCode === 4) {
      setAudioError('Formato não suportado');
    } else if (errorCode === 2) {
      setAudioError('Erro de rede');
    } else {
      setAudioError('Não foi possível reproduzir');
    }
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoading(false);
  };

  const handleImageLoad = () => {
    setImageLoading(false);
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current && audioReady) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      audioRef.current.currentTime = percentage * audioRef.current.duration;
    }
  };

  const handleDownloadMedia = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!mediaUrl) return;

    const fileName = getAttachmentFileName();
    try {
      const response = await fetch(mediaUrl);
      if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      const link = document.createElement("a");
      link.href = mediaUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  const getAttachmentFileName = () => {
    if (safeContent) return safeContent;
    const parsed = new Date(sentAt);
    const timestamp = Number.isNaN(parsed.getTime()) ? "sem-data" : format(parsed, 'yyyyMMdd-HHmm');
    if (messageType === 'audio') return `Audio-${timestamp}`;
    if (messageType === 'image') return `Imagem-${timestamp}`;
    if (messageType === 'video') return `Video-${timestamp}`;
    return `Documento-${timestamp}`;
  };

  const renderMediaPending = () => {
    // If message is older than 90 seconds and still pending, show retry option
    const sentAtMs = new Date(sentAt).getTime();
    const ageMs = (mediaPendingNowMs ?? sentAtMs) - sentAtMs;
    const isStuck = ageMs > 90_000;

    if (isStuck) {
      return (
        <div className={cn(
          "flex flex-col items-center gap-2 p-4 rounded-md min-w-[200px]",
          fromMe ? "bg-primary-foreground/10" : "bg-white/[0.055]"
        )}>
          <Clock className="w-5 h-5 opacity-70" />
          <span className="text-sm opacity-90 text-center">Mídia demorando para chegar</span>
          {onRetryMedia && (
            <Button size="sm" variant="outline" className="mt-1" onClick={onRetryMedia}>
              <RefreshCw className="w-3 h-3 mr-1" />
              Tentar novamente
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className={cn(
        "flex items-center gap-3 p-4 rounded-md animate-pulse min-w-[180px]",
        fromMe ? "bg-primary-foreground/10" : "bg-white/[0.055]"
      )}>
        <Loader2 className="w-5 h-5 animate-spin opacity-70" />
        <div className="flex flex-col">
          <span className="text-sm opacity-80">Carregando mídia...</span>
          <span className="text-xs opacity-50">Aguarde um momento</span>
        </div>
      </div>
    );
  };

  const renderMediaFailed = () => (
    <div className={cn(
      "flex flex-col items-center gap-2 p-4 rounded-md min-w-[180px]",
      fromMe ? "bg-destructive/10" : "bg-destructive/10"
    )}>
      <AlertCircle className="w-6 h-6 text-destructive" />
      <span className="text-sm text-muted-foreground">Mídia não disponível</span>
      {mediaError && (
        <span className="text-xs text-muted-foreground/70 text-center max-w-[180px] truncate">
          {mediaError}
        </span>
      )}
      {onRetryMedia && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1"
          onClick={onRetryMedia}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Tentar novamente
        </Button>
      )}
    </div>
  );

  const renderMediaTimestamp = () => (
    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/50 flex items-center gap-1.5">
      {leadId && isValidMediaUrl(mediaUrl) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setAttachConfirmOpen(true);
          }}
          className="hover:text-primary transition-colors p-0.5"
          title="Anexar ao Lead"
        >
          <Link2 className="w-3 h-3 text-white" />
        </button>
      )}
      <span className="text-[11px] text-white/90 leading-none">{formatTime(sentAt)}</span>
      {fromMe && <span className="text-white/90">{getStatusIcon()}</span>}
    </div>
  );

  const renderAudioPlayer = () => {
    const hasValidMedia = isValidMediaUrl(mediaUrl);

    if (hasValidMedia) {
      const progressPercent = audioProgress || 0;
      const playedBars = Math.floor((progressPercent / 100) * waveformBars.length);

      // If there's an error, show fallback with download button
      if (audioError) {
        return (
          <div className={cn(
            "flex flex-col gap-2 py-2 px-2 min-w-0 w-full",
          )}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                fromMe ? "bg-primary-foreground/20" : "bg-muted-foreground/20"
              )}>
                <AlertCircle className="w-5 h-5 opacity-70" />
              </div>
              <div className="flex flex-col flex-1">
                <span className="text-xs opacity-80">{audioError}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 mt-1 w-fit"
                  onClick={handleDownloadMedia}
                >
                  <Download className="w-3 h-3 mr-1" />
                  Baixar áudio
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className={cn(
                "text-[11px]",
                fromMe ? "text-primary-foreground/60" : "text-white/55"
              )}>
                {formatTime(sentAt)}
              </span>
              {getStatusIcon()}
            </div>
          </div>
        );
      }

      return (
        <div className={cn(
          "flex items-center gap-2 py-1.5 px-2 min-w-0 w-full",
        )}>
          {/* Speed Control Button - only show when playing or has progress */}
          <button
            onClick={cyclePlaybackRate}
            className={cn(
              "h-7 px-2 rounded-full text-xs font-medium shrink-0 transition-colors",
              fromMe
                ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
                : "bg-white/[0.055] hover:bg-white/[0.08]"
            )}
          >
            {playbackRate}x
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={handleAudioPlay}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
              fromMe
                ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
                : "bg-primary/15 hover:bg-primary/25"
            )}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* Waveform with progress indicator */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="relative h-[28px] flex items-center">
              {/* Waveform container */}
              <div
                className="flex items-center gap-[2px] h-full w-full cursor-pointer"
                onClick={handleWaveformClick}
              >
                {waveformBars.map((height, index) => (
                  <div
                    key={index}
                    className={cn(
                      "w-[3px] rounded-full transition-colors duration-100",
                      index < playedBars
                        ? fromMe
                          ? "bg-primary-foreground"
                          : "bg-primary"
                        : fromMe
                          ? "bg-primary-foreground/30"
                          : "bg-primary/30"
                    )}
                    style={{ height: `${Math.max(height * 100, 15)}%` }}
                  />
                ))}
              </div>

              {/* Progress indicator dot */}
              <div
                className={cn(
                  "absolute w-3 h-3 rounded-full shadow-sm transition-all duration-100 pointer-events-none",
                  fromMe ? "bg-primary-foreground" : "bg-primary"
                )}
                style={{
                  left: `calc(${progressPercent}% - 6px)`,
                  top: '50%',
                  transform: 'translateY(-50%)'
                }}
              />
            </div>

            {/* Time indicators */}
            <div className="flex items-center justify-between">
              <span className={cn(
                "text-[11px]",
                fromMe ? "text-primary-foreground/60" : "text-white/55"
              )}>
                {formatDuration(currentTime)}
              </span>
              <span className={cn(
                "text-[11px]",
                fromMe ? "text-primary-foreground/60" : "text-white/55"
              )}>
                {formatDuration(audioDuration)}
              </span>
            </div>
          </div>

          {/* Message timestamp and status */}
          <div className={cn(
            "flex items-center gap-1 shrink-0",
            fromMe ? "text-primary-foreground/60" : "text-white/55"
          )}>
            {leadId && isValidMediaUrl(mediaUrl) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAttachConfirmOpen(true);
                }}
                className="hover:text-primary transition-colors p-0.5"
                title="Anexar ao Lead"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="text-[11px]">{formatTime(sentAt)}</span>
            {getStatusIcon()}
          </div>

          <audio
            ref={audioRef}
            src={blobUrl || mediaUrl!}
            preload="metadata"
            onEnded={() => {
              setIsPlaying(false);
              // Don't reset progress - keep it at the end
              setAudioProgress(100);
              setCurrentTime(Number.isFinite(audioDuration) ? audioDuration : 0);
            }}
            onTimeUpdate={handleAudioTimeUpdate}
            onLoadedMetadata={handleAudioLoadedMetadata}
            onCanPlay={() => setAudioReady(true)}
            onError={handleAudioError}
            className="hidden"
          />
        </div>
      );
    }

    return (
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-full min-w-[180px]",
        fromMe ? "bg-primary-foreground/10" : "bg-white/[0.055]"
      )}>
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center",
          fromMe ? "bg-primary-foreground/20" : "bg-muted-foreground/20"
        )}>
          <Mic className="w-5 h-5 opacity-50" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs">Áudio não disponível</span>
        </div>
      </div>
    );
  };

  const renderMedia = () => {
    const hasValidMedia = isValidMediaUrl(mediaUrl);

    // Check media status for proper state handling
    if (mediaStatus === 'pending' && !hasValidMedia) {
      return renderMediaPending();
    }

    if (mediaStatus === 'failed' && !hasValidMedia) {
      return renderMediaFailed();
    }

    // For 'ready' status or legacy messages (null status), check URL validity
    // If no valid URL but status is null (legacy), show as failed for retry
    if (!hasValidMedia && mediaStatus === null && messageType !== 'text' && messageType !== 'sticker') {
      // Legacy message with expired/invalid URL - treat as failed
      return renderMediaFailed();
    }

    switch (messageType) {
      case "image":
        if (hasValidMedia && !imageError) {
          return (
            <>
              <div
                className="rounded-md overflow-hidden cursor-pointer relative w-full max-w-[280px] sm:max-w-[300px] border-[0.5px] border-black/5"
                onClick={() => setViewerOpen(true)}
              >
                {imageLoading && (
                  <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin opacity-50" />
                  </div>
                )}
                <NextImage
                  src={mediaUrl!}
                  alt={safeContent || "Imagem"}
                  width={300}
                  height={400}
                  className="w-full h-auto max-h-[400px] object-cover"
                  onError={handleImageError}
                  onLoad={handleImageLoad}
                  unoptimized
                />
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={mediaUrl!}
                type="image"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex flex-col items-center justify-center gap-2 p-4 rounded-lg w-[300px] h-[200px]",
            fromMe ? "bg-primary-foreground/10" : "bg-white/[0.055]"
          )}>
            <ImageIcon className="w-10 h-10 opacity-50" />
            <span className="text-xs opacity-70">Imagem não disponível</span>
            {hasValidMedia && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={handleDownloadMedia}
              >
                <Download className="w-3 h-3 mr-1" />
                Baixar
              </Button>
            )}
          </div>
        );

      case "video":
        if (hasValidMedia) {
          return (
            <>
              <div
                className="rounded-md overflow-hidden cursor-pointer relative w-full max-w-[280px] sm:max-w-[300px] border-[0.5px] border-black/5"
                onClick={() => setViewerOpen(true)}
              >
                <video
                  src={mediaUrl!}
                  className="w-full h-auto max-h-[400px] object-cover"
                  preload="metadata"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="w-6 h-6 text-black ml-1" />
                  </div>
                </div>
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={mediaUrl!}
                type="video"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex flex-col items-center justify-center gap-2 p-4 rounded-lg w-[300px] h-[200px]",
            fromMe ? "bg-primary-foreground/10" : "bg-white/[0.055]"
          )}>
            <Video className="w-10 h-10 opacity-50" />
            <span className="text-xs opacity-70">Vídeo não disponível</span>
          </div>
        );

      case "audio":
        return renderAudioPlayer();

      case "document":
        return (
          <div
            className={cn(
              "flex items-center gap-2 p-2 rounded-md transition-colors min-w-0 w-full max-w-[260px]",
              hasValidMedia ? "cursor-pointer" : "",
              fromMe
                ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                : "bg-white/[0.055] hover:bg-white/[0.08]"
            )}
            onClick={(e) => hasValidMedia && handleDownloadMedia(e)}
          >
            {/* Icon - fixed width */}
            <div className={cn(
              "w-9 h-9 rounded-md flex items-center justify-center shrink-0",
              fromMe ? "bg-primary-foreground/20" : "bg-primary/10"
            )}>
              <FileText className={cn(
                "w-5 h-5",
                fromMe ? "text-primary-foreground" : "text-primary"
              )} />
            </div>

            {/* Content area — flex-1 com overflow hidden garante truncate */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <p
                className="text-sm font-medium truncate leading-tight"
                title={safeContent || "Documento"}
              >
                {safeContent || "Documento"}
              </p>
              {mediaMimeType && (
                <span className="text-[10px] opacity-50 block">
                  {mediaMimeType.split("/")[1]?.toUpperCase().replace("OCTET-STREAM", "DOC") || "DOC"}
                  {mediaSize ? ` · ${formatFileSize(mediaSize)}` : ""}
                </span>
              )}
            </div>

            {/* Timestamp area */}
            <div className="flex flex-col items-end shrink-0 gap-1">
              <div className="flex items-center gap-1.5">
                {leadId && hasValidMedia && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachConfirmOpen(true);
                    }}
                    className="hover:text-primary transition-colors p-0.5"
                    title="Anexar ao Lead"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className={cn(
                  "text-[11px] leading-none whitespace-nowrap",
                  fromMe ? "text-primary-foreground/60" : "text-white/55"
                )}>
                  {formatTime(sentAt)}
                </span>
              </div>
              {fromMe && getStatusIcon()}
            </div>
          </div>
        );

      case "sticker":
        if (hasValidMedia && !imageError) {
          return (
            <div className="relative max-w-[160px] max-h-[160px] p-1">
              <NextImage
                src={mediaUrl!}
                alt={safeContent || "Figurinha"}
                width={150}
                height={150}
                className="max-w-[150px] max-h-[150px] object-contain"
                onError={handleImageError}
                onLoad={handleImageLoad}
                unoptimized
              />
              {renderMediaTimestamp()}
            </div>
          );
        }
        return renderMediaFailed();

      default:
        return null;
    }
  };

  const isMediaMessage = messageType !== "text" && messageType !== "reaction";
  const isMediaWithOverlayTimestamp = (messageType === "image" || messageType === "video") && isValidMediaUrl(mediaUrl) && !imageError;
  const isAudioMessage = messageType === "audio";
  const hasReactions = reactions.length > 0;

  const renderReactions = () => {
    if (!hasReactions) return null;
    return (
      <div className={cn(
        "absolute -bottom-2 right-2 z-10 flex"
      )}>
        <div className={cn(
          "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-sm leading-none shadow-md backdrop-blur-sm",
          fromMe
            ? "border-primary-foreground/20 bg-background/95 text-foreground"
            : "border-white/10 bg-background/95 text-foreground"
        )}>
          {reactions.slice(0, 4).map((reaction, index) => (
            <span key={`${toSafeText(reaction.emoji)}-${index}`} title={toSafeText(reaction.senderName) || undefined}>
              {toSafeText(reaction.emoji)}
            </span>
          ))}
          {reactions.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{reactions.length - 4}</span>
          )}
        </div>
      </div>
    );
  };

  if (messageType === "reaction") return null;

  return (
    <div
      className={cn(
        "flex w-full mb-1 animate-fade-in",
        fromMe ? "justify-end" : "justify-start"
      )}
    >
      <div className={cn(
        "max-w-[85%] sm:max-w-[75%] flex flex-col",
        fromMe ? "items-end" : "items-start"
      )}>
        <div className={cn(
          "rounded-2xl relative overflow-visible transition-all duration-200 shadow-sm",
          fromMe
            ? "bg-primary text-primary-foreground rounded-tr-none"
            : "bg-[#242424] text-white border border-white/5 rounded-tl-none",
          (messageType === "image" || messageType === "video") && !content ? "p-[3px]" : "px-3 py-2"
        )}>
          {/* Sender name for groups or sent messages with sender info */}
          {!fromMe && senderName && (
            <p className="text-xs font-semibold text-primary mb-0.5">{toSafeText(senderName)}</p>
          )}
          {fromMe && senderName && (
            <p className="text-[11px] font-medium mb-0.5 opacity-70">{toSafeText(senderName)}</p>
          )}

          {/* Media content */}
          {isMediaMessage && renderMedia()}

          {/* Text content */}
          {safeContent && messageType === "text" && (
            <MessageText
              content={safeContent}
              fromMe={fromMe}
              groupJid={isGroup ? conversationRemoteJid : null}
              sessionId={isGroup ? conversationSessionId : null}
            />
          )}


          {/* Inline timestamp for text messages and non-overlay media (except audio which has its own) */}
          {(!isMediaWithOverlayTimestamp && !isAudioMessage) && (
            <span className={cn(
              "float-right -mt-4 ml-2 flex items-center gap-0.5",
              fromMe ? "text-primary-foreground/60" : "text-white/55"
            )}>
              <span className="text-[11px] leading-none">{formatTime(sentAt)}</span>
              {getStatusIcon()}
            </span>
          )}

          <AlertDialog open={attachConfirmOpen} onOpenChange={setAttachConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Anexar ao Lead</AlertDialogTitle>
              <AlertDialogDescription>
                Deseja anexar este arquivo de mídia à documentação do lead <strong>{leadName}</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (leadId && mediaUrl) {
                    const fileName = getAttachmentFileName();

                    await createAttachment.mutateAsync({
                      lead_id: leadId,
                      file_name: fileName,
                      file_url: mediaUrl,
                      file_type: messageType,
                      file_size: mediaSize || undefined,
                      message_id: messageId,
                    });

                  }
                  setAttachConfirmOpen(false);
                }}
              >
                Anexar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
          </AlertDialog>
          {renderReactions()}
        </div>
      </div>
    </div>
  );
}

// Renders message text with WhatsApp-style mentions.
// Digit mentions (@5511999998888) are resolved to contact / lead names
// via useMentionNames. Word mentions (@Joao) keep highlight styling.
function MessageText({
  content,
  fromMe,
  groupJid,
  sessionId,
}: {
  content: string;
  fromMe: boolean;
  groupJid?: string | null;
  sessionId?: string | null;
}) {
  const mentionRegex = /(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})/g;
  const mentionTokenRegex = /^(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})$/;
  const parts = content.split(mentionRegex).filter((part): part is string => typeof part === "string" && part.length > 0);

  const digitMentions = parts
    .filter((p) => /^@\d{7,}$/.test(p))
    .map((p) => p.slice(1));
  const names = useMentionNames(digitMentions, { groupJid, sessionId });

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urlParts = text.split(urlRegex);

    return urlParts.map((urlPart, i) => {
      if (urlRegex.test(urlPart)) {
        return (
          <a
            key={i}
            href={urlPart}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "underline break-all transition-colors duration-200",
              fromMe
                ? "text-white hover:text-white/80 font-medium"
                : "text-primary hover:text-primary/80 font-medium"
            )}
          >
            {urlPart}
          </a>
        );
      }
      return urlPart;
    });
  };

  return (
    <p className="text-[14.2px] leading-[19px] whitespace-pre-wrap break-words">
      {parts.length === 1
        ? renderTextWithLinks(content)
        : parts.map((part, index) => {
            if (!mentionTokenRegex.test(part)) return renderTextWithLinks(part);
            const isDigit = /^@\d{7,}$/.test(part);
            const display = isDigit ? `@${names[part.slice(1)] ?? part.slice(1)}` : part;
            return (
              <span
                key={index}
                className={cn(
                  "font-semibold px-1 py-0.5 rounded transition-all duration-200 inline-block",
                  fromMe
                    ? "bg-white/20 text-white"
                    : "bg-primary/15 text-primary dark:bg-primary/25",
                )}
              >
                {display}
              </span>
            );
          })}
      {/* Invisible spacer for timestamp */}
      <span className="inline-block w-[65px]"></span>
    </p>
  );
}
