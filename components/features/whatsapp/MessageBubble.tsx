import { useState, useRef, useEffect, SyntheticEvent } from "react";
import NextImage from "next/image";
import { Check, CheckCheck, Clock, Mic, Play, Pause, FileText, Download, AlertCircle, RefreshCw, Loader2, Image as ImageIcon, Video, Link2, MessageCircleOff, SmilePlus, Maximize2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MediaViewer } from "./MediaViewer";
import { useCreateLeadAttachment } from "@/hooks/use-lead-attachments";
import { useMentionNames } from "@/hooks/use-mention-names";
import {
  buildMessageMediaFilename,
  createMessageMediaObjectUrl,
  downloadMessageMedia,
  getSafeAvatarUrl,
  getSafeExternalHttpUrl,
  getSafeMessageMediaUrl,
  type MessageMediaKind,
} from "./message-media";
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
  onRetryMedia?: () => void;
  messageId: string;
  leadId: string;
  leadName: string;
  contactAvatarUrl?: string | null;
  conversationRemoteJid?: string | null;
  conversationSessionId?: string | null;
  compact?: boolean;
  reactions: Array<{
    emoji: string;
    senderName: string | null;
    fromMe: boolean;
  }>;
  onReact?: (emoji: string) => unknown | Promise<unknown>;
  isReacting?: boolean;
}

type MediaKind = MessageMediaKind | "text" | "reaction" | "deleted";

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

const AUDIO_PLAYBACK_RATES = [1, 1.5, 2] as const;
type AudioPlaybackRate = typeof AUDIO_PLAYBACK_RATES[number];
const AUDIO_PLAYBACK_RATE_STORAGE_KEY = "vimob:whatsapp-audio-rate";
const AUDIO_PLAYBACK_RATE_EVENT = "vimob:whatsapp-audio-rate-change";
let sharedAudioPlaybackRate: AudioPlaybackRate = 1;

const isAudioPlaybackRate = (value: unknown): value is AudioPlaybackRate =>
  AUDIO_PLAYBACK_RATES.includes(value as AudioPlaybackRate);

const readStoredAudioPlaybackRate = (): AudioPlaybackRate => {
  if (typeof window === "undefined") return sharedAudioPlaybackRate;
  try {
    const stored = Number(window.localStorage.getItem(AUDIO_PLAYBACK_RATE_STORAGE_KEY));
    return isAudioPlaybackRate(stored) ? stored : sharedAudioPlaybackRate;
  } catch {
    return sharedAudioPlaybackRate;
  }
};

const persistAudioPlaybackRate = (rate: AudioPlaybackRate) => {
  sharedAudioPlaybackRate = rate;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PLAYBACK_RATE_STORAGE_KEY, String(rate));
  } catch {
    // Mantem a velocidade sincronizada nesta sessao mesmo sem storage persistente.
  }
  window.dispatchEvent(new CustomEvent(AUDIO_PLAYBACK_RATE_EVENT, { detail: rate }));
};

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

const cleanMimeType = (value: string | null | undefined) => {
  const mimeType = String(value || "").split(";")[0]?.trim().toLowerCase();
  return mimeType || "";
};

const getEffectiveMediaKind = (
  messageType: string,
  mediaMimeType: string | null,
  mediaUrl: string | null,
): MediaKind => {
  const type = String(messageType || "text").toLowerCase();
  const mimeType = cleanMimeType(mediaMimeType);

  if (type === "deleted") return "deleted";
  if (type === "reaction") return "reaction";
  if (type === "sticker") return "sticker";
  if (type === "audio" || type === "video" || type === "image") return type;

  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "image/webp") return "sticker";
  if (mimeType.startsWith("image/")) return "image";

  if (type === "document") return "document";
  if (mediaUrl && type !== "text") return "document";
  return "text";
};

const normalizeMediaMimeType = (mediaMimeType: string | null, mediaKind: MediaKind) => {
  const mimeType = cleanMimeType(mediaMimeType);
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;

  switch (mediaKind) {
    case "audio":
      return "audio/ogg";
    case "video":
      return "video/mp4";
    case "sticker":
      return "image/webp";
    case "image":
      return "image/jpeg";
    case "document":
      return "application/octet-stream";
    default:
      return undefined;
  }
};

const toMessageMediaKind = (mediaKind: MediaKind): MessageMediaKind => {
  switch (mediaKind) {
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return mediaKind;
    default:
      return "document";
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
  contactAvatarUrl,
  conversationRemoteJid,
  conversationSessionId,
  compact = false,
  reactions = [],
  onReact,
  isReacting = false,
}: MessageBubbleProps) {
  const createAttachment = useCreateLeadAttachment();
  const safeContent = toSafeText(content);
  const [attachConfirmOpen, setAttachConfirmOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [mediaReloadKey, setMediaReloadKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<AudioPlaybackRate>(() => {
    const storedRate = readStoredAudioPlaybackRate();
    sharedAudioPlaybackRate = storedRate;
    return storedRate;
  });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobAttempted, setBlobAttempted] = useState(false);
  const [mediaPendingNowMs, setMediaPendingNowMs] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioFallbackRequestRef = useRef(0);
  const downloadRequestRef = useRef(0);
  const mediaKind = getEffectiveMediaKind(messageType, mediaMimeType, mediaUrl);
  const messageMediaKind = toMessageMediaKind(mediaKind);
  const safeMediaUrl = getSafeMessageMediaUrl(mediaUrl, messageMediaKind);
  const attachableMediaUrl = safeMediaUrl && /^https?:\/\//i.test(safeMediaUrl) ? safeMediaUrl : null;
  const safeAvatarUrl = getSafeAvatarUrl(contactAvatarUrl);
  const normalizedMediaMimeType = normalizeMediaMimeType(mediaMimeType, mediaKind);
  const safeSenderName = toSafeText(senderName).trim();
  const displaySenderName = safeSenderName || (fromMe ? "Você" : "");
  const audioAvatarName = fromMe
    ? displaySenderName
    : (toSafeText(leadName).trim() || safeSenderName || "Contato");
  const audioAvatarInitial = audioAvatarName.charAt(0).toUpperCase() || (fromMe ? "V" : "C");

  // Waveform bars generated from mediaUrl or sentAt as seed
  const waveformBars = generateWaveform(mediaUrl || sentAt, 28);

  const lastMessageIdRef = useRef<string | null>(null);
  const lastMediaUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const didUrlChange = mediaUrl !== lastMediaUrlRef.current || messageId !== lastMessageIdRef.current;
    lastMediaUrlRef.current = mediaUrl || null;
    lastMessageIdRef.current = messageId;

    if (didUrlChange) {
      audioFallbackRequestRef.current += 1;
      downloadRequestRef.current += 1;
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

        if (mediaKind === "image" || mediaKind === "sticker") {
          setImageError(false);
          setImageLoading(Boolean(safeMediaUrl));
        }
        if (mediaKind === "video") {
          setVideoError(false);
          setVideoLoading(Boolean(safeMediaUrl));
        }
        setMediaReloadKey(0);
        setDownloadFeedback(null);
        setIsDownloading(false);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [mediaUrl, mediaKind, messageId, blobUrl, safeMediaUrl]);

  useEffect(() => () => {
    audioFallbackRequestRef.current += 1;
    downloadRequestRef.current += 1;
  }, []);

  useEffect(() => {
    const handlePlaybackRateChange = (event: Event) => {
      const nextRate = (event as CustomEvent<number>).detail;
      if (!isAudioPlaybackRate(nextRate)) return;
      setPlaybackRate(nextRate);
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
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = () => {
    if (!fromMe) return null;

    switch (status) {
      case "read":
      case "played":
        return <CheckCheck className="w-[16px] h-[16px] text-blue-400" role="img" aria-label="Mensagem lida" />;
      case "delivered":
        return <CheckCheck className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem entregue" />;
      case "sent":
        return <Check className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem enviada" />;
      case "queued":
      case "pending":
        return <Clock className="w-[16px] h-[16px] opacity-60 animate-pulse" role="img" aria-label="Mensagem na fila" />;
      case "sending":
      case "confirming":
        return <Clock className="w-[16px] h-[16px] text-amber-300 animate-pulse" role="img" aria-label="Confirmando envio" />;
      case "failed":
      case "error":
        return <AlertCircle className="w-[16px] h-[16px] text-red-300" role="img" aria-label="Falha no envio" />;
      default:
        return <Check className="w-[16px] h-[16px] opacity-60" role="img" aria-label="Mensagem enviada" />;
    }
  };

  const cyclePlaybackRate = () => {
    const currentIndex = AUDIO_PLAYBACK_RATES.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % AUDIO_PLAYBACK_RATES.length;
    const newRate = AUDIO_PLAYBACK_RATES[nextIndex];
    persistAudioPlaybackRate(newRate);
    setPlaybackRate(newRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate;
    }
  };

  const handleAudioPlay = async () => {
    const audio = audioRef.current;
    if (!audio || audioError) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    try {
      audio.playbackRate = playbackRate;
      await audio.play();
    } catch {
      setIsPlaying(false);
      setAudioError("Erro ao reproduzir");
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
    if (!blobAttempted && safeMediaUrl) {
      setBlobAttempted(true);
      const requestId = ++audioFallbackRequestRef.current;
      try {
        const blob = await createMessageMediaObjectUrl({
          url: safeMediaUrl,
          kind: "audio",
          mimeType: normalizedMediaMimeType,
        });
        if (requestId !== audioFallbackRequestRef.current) {
          URL.revokeObjectURL(blob);
          return;
        }
        setBlobUrl(blob);
        setAudioError(null);
        // The audio element will re-render with the new blob src
        return;
      } catch {
        // Se o fallback por blob falhar, exibimos o estado de erro no proprio bubble.
      }
    }

    // Check if it's a format issue
    if (normalizedMediaMimeType?.includes('ogg') && !checkOggOpusSupport()) {
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

  const retryImage = () => {
    setImageError(false);
    setImageLoading(true);
    setMediaReloadKey((key) => key + 1);
  };

  const retryVideo = () => {
    setVideoError(false);
    setVideoLoading(true);
    setMediaReloadKey((key) => key + 1);
  };

  const retryAudio = () => {
    audioFallbackRequestRef.current += 1;
    audioRef.current?.pause();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setBlobAttempted(false);
    setAudioError(null);
    setAudioReady(false);
    setAudioProgress(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setMediaReloadKey((key) => key + 1);
  };

  const seekAudioToPercent = (percentage: number) => {
    const audio = audioRef.current;
    if (!audio || !audioReady || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const boundedPercentage = Math.min(Math.max(percentage, 0), 1);
    audio.currentTime = boundedPercentage * audio.duration;
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekAudioToPercent((e.clientX - rect.left) / rect.width);
  };

  const handleWaveformKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audioReady) return;

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      seekAudioToPercent(event.key === "Home" ? 0 : 1);
      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    audio.currentTime = Math.min(Math.max(audio.currentTime + direction * 5, 0), audio.duration);
  };

  const handleDownloadMedia = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!safeMediaUrl || isDownloading) {
      setDownloadFeedback({ message: "Link de mídia inválido ou indisponível.", error: true });
      return;
    }

    const fileName = getAttachmentFileName();
    const requestId = ++downloadRequestRef.current;
    setIsDownloading(true);
    setDownloadFeedback(null);
    try {
      const result = await downloadMessageMedia({
        url: safeMediaUrl,
        kind: messageMediaKind,
        filename: fileName,
      });
      if (requestId !== downloadRequestRef.current) return;
      setDownloadFeedback({
        message: result === "opened"
          ? "O arquivo foi aberto em uma nova aba para download."
          : "Download iniciado.",
        error: false,
      });
    } catch {
      if (requestId !== downloadRequestRef.current) return;
      setDownloadFeedback({ message: "Não foi possível baixar esta mídia.", error: true });
    } finally {
      if (requestId === downloadRequestRef.current) setIsDownloading(false);
    }
  };

  const getAttachmentFileName = () => {
    return buildMessageMediaFilename({
      content: safeContent,
      kind: messageMediaKind,
      mimeType: normalizedMediaMimeType,
      sentAt,
    });
  };

  const handleAttachToLead = async () => {
    if (!leadId || !attachableMediaUrl) return;

    try {
      await createAttachment.mutateAsync({
        lead_id: leadId,
        file_name: getAttachmentFileName(),
        file_url: attachableMediaUrl,
        file_type: mediaKind,
        file_size: mediaSize || undefined,
        message_id: messageId,
      });
      setAttachConfirmOpen(false);
    } catch {
      // The mutation owns the user-facing error. Keep the dialog open for retry.
    }
  };

  const renderMediaPending = () => {
    // If message is older than 90 seconds and still pending, show retry option
    const sentAtMs = new Date(sentAt).getTime();
    const ageMs = (mediaPendingNowMs ?? sentAtMs) - sentAtMs;
    const isStuck = !Number.isFinite(sentAtMs) || ageMs > 90_000;

    if (isStuck) {
      return (
        <div className={cn(
          "flex min-w-[180px] flex-col items-center gap-2 rounded-[6px] p-4",
          fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]"
        )}>
          <Clock className="h-5 w-5 opacity-70" aria-hidden="true" />
          <span className="text-center text-[12px] font-light opacity-90">Mídia demorando para chegar</span>
          {onRetryMedia && (
            <Button size="sm" variant="outline" className="mt-1 rounded-[6px] font-light shadow-none" onClick={onRetryMedia}>
              <RefreshCw className="w-3 h-3 mr-1" />
              Tentar novamente
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className={cn(
        "flex min-w-[180px] items-center gap-3 rounded-[6px] p-4",
        fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]"
      )}>
        <Loader2 className="h-5 w-5 animate-spin opacity-70" aria-hidden="true" />
        <div className="flex flex-col">
          <span className="text-[12px] font-light opacity-80" role="status">Carregando mídia...</span>
          <span className="text-[11px] font-light opacity-50">Aguarde um momento</span>
        </div>
      </div>
    );
  };

  const renderMediaFailed = () => (
    <div className={cn(
      "flex min-w-[180px] flex-col items-center gap-2 rounded-[6px] bg-destructive/10 p-4",
    )}>
      <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <span className="text-[12px] font-light text-muted-foreground">Mídia não disponível</span>
      {mediaError && (
        <span className="text-xs text-muted-foreground/70 text-center max-w-[180px] truncate">
          {mediaError}
        </span>
      )}
      {onRetryMedia && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 rounded-[6px] font-light shadow-none"
          onClick={onRetryMedia}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Tentar novamente
        </Button>
      )}
    </div>
  );

  const renderMediaTimestamp = () => (
    <div className="absolute bottom-1 right-1 flex items-center gap-1.5 rounded-[4px] bg-[var(--app-media-scrim)] px-1.5 py-0.5">
      {leadId && attachableMediaUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAttachConfirmOpen(true);
          }}
          className="hover:text-primary transition-colors p-0.5"
          title="Anexar ao Lead"
          aria-label="Anexar mídia à documentação do lead"
        >
          <Link2 className="w-3 h-3 text-white" aria-hidden="true" />
        </button>
      )}
      <span className="text-[11px] text-white/90 leading-none">{formatTime(sentAt)}</span>
      {fromMe && <span className="text-white/90">{getStatusIcon()}</span>}
    </div>
  );

  const renderAudioAvatar = () => {
    const canChangePlaybackRate = isPlaying || currentTime > 0;

    return (
      <div className="relative h-10 w-10 shrink-0 overflow-visible">
        <button
          type="button"
          onClick={canChangePlaybackRate ? cyclePlaybackRate : undefined}
          disabled={!canChangePlaybackRate}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-[11px] font-normal transition-colors disabled:cursor-default",
            fromMe
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-[var(--app-surface-hover)] text-[var(--app-text-primary)]",
            canChangePlaybackRate && (fromMe ? "hover:bg-primary-foreground/30" : "hover:bg-[var(--app-surface-soft)]"),
          )}
          title={canChangePlaybackRate ? `Velocidade ${playbackRate}x` : audioAvatarName}
          aria-label={canChangePlaybackRate ? `Alterar velocidade do audio para ${playbackRate}x` : "Avatar do audio"}
        >
          {canChangePlaybackRate ? (
            <span>{playbackRate}x</span>
          ) : safeAvatarUrl && safeAvatarUrl !== failedAvatarUrl && !fromMe ? (
            <NextImage
              src={safeAvatarUrl}
              alt={audioAvatarName}
              fill
              sizes="40px"
              className="object-cover"
              onError={() => setFailedAvatarUrl(safeAvatarUrl)}
              unoptimized
            />
          ) : (
            <span>{audioAvatarInitial}</span>
          )}
        </button>
        <span
          className={cn(
            "pointer-events-none absolute -bottom-0.5 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border",
            fromMe
              ? "border-primary bg-primary-foreground text-primary"
              : "border-[var(--app-surface-solid)] bg-primary text-primary-foreground"
          )}
        >
          <Mic className="h-2.5 w-2.5" />
        </span>
      </div>
    );
  };

  const renderAudioPlayer = () => {
    const hasValidMedia = Boolean(safeMediaUrl);

    if (hasValidMedia) {
      const progressPercent = audioProgress || 0;
      const playedBars = Math.floor((progressPercent / 100) * waveformBars.length);
      const audioTimeLabel = (isPlaying || currentTime > 0)
        ? formatDuration(currentTime)
        : formatDuration(audioDuration);

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
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryAudio}>
                    <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                    Tentar novamente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-[6px] px-2 font-light shadow-none"
                    onClick={handleDownloadMedia}
                    disabled={isDownloading}
                  >
                    {isDownloading
                      ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                      : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                    {isDownloading ? "Baixando..." : "Baixar áudio"}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className={cn(
                "text-[11px]",
                fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]"
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
          "flex min-w-[250px] max-w-[310px] items-center gap-2 py-1.5 px-1",
        )}>
          <button
            type="button"
            onClick={() => void handleAudioPlay()}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
              fromMe
                ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
                : "bg-primary/15 hover:bg-primary/25"
            )}
            aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="relative flex h-[30px] items-center">
              <div
                className="flex h-full w-full cursor-pointer items-center gap-[2px] rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={handleWaveformClick}
                onKeyDown={handleWaveformKeyDown}
                role="slider"
                tabIndex={0}
                aria-label="Posição do áudio"
                aria-valuemin={0}
                aria-valuemax={Math.max(Math.round(audioDuration), 0)}
                aria-valuenow={Math.max(Math.round(currentTime), 0)}
                aria-valuetext={`${formatDuration(currentTime)} de ${formatDuration(audioDuration)}`}
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
                    style={{ height: `${Math.max(height * 78, 18)}%` }}
                  />
                ))}
              </div>

              <div
                className={cn(
                  "pointer-events-none absolute h-3 w-3 rounded-full shadow-none transition-all duration-100",
                  fromMe ? "bg-primary-foreground" : "bg-primary"
                )}
                style={{
                  left: `calc(${progressPercent}% - 6px)`,
                  top: '50%',
                  transform: 'translateY(-50%)'
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className={cn(
                "text-[11px] leading-none",
                fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]"
              )}>
                {audioTimeLabel}
              </span>
              <div className={cn(
                "flex shrink-0 items-center gap-1 leading-none",
                fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]"
              )}>
                {leadId && attachableMediaUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachConfirmOpen(true);
                    }}
                    className="hover:text-primary transition-colors p-0.5"
                    title="Anexar ao Lead"
                    aria-label="Anexar áudio à documentação do lead"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                <span className="text-[11px]">{formatTime(sentAt)}</span>
                {getStatusIcon()}
              </div>
            </div>
          </div>

          {renderAudioAvatar()}

          <audio
            key={`${blobUrl || safeMediaUrl}-${mediaReloadKey}`}
            ref={audioRef}
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
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={handleAudioError}
            className="hidden"
          >
            <source src={blobUrl || safeMediaUrl!} type={normalizedMediaMimeType} />
          </audio>
        </div>
      );
    }

    return (
      <div className={cn(
        "flex min-w-[180px] items-center gap-3 rounded-[8px] px-4 py-3",
        fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]"
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
    const hasValidMedia = Boolean(safeMediaUrl);

    // Check media status for proper state handling
    if (mediaStatus === 'pending' && !hasValidMedia) {
      return renderMediaPending();
    }

    if (!hasValidMedia) {
      return renderMediaFailed();
    }

    switch (mediaKind) {
      case "image":
        if (!imageError) {
          return (
            <>
              <div className="relative w-full max-w-[280px] overflow-hidden rounded-[6px] sm:max-w-[300px]">
                {imageLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-overlay)]" role="status" aria-label="Carregando imagem">
                    <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-hidden="true" />
                  </div>
                )}
                <NextImage
                  key={`${messageId}-image-${mediaReloadKey}`}
                  src={safeMediaUrl!}
                  alt={safeContent || "Imagem"}
                  width={300}
                  height={400}
                  sizes="(max-width: 640px) 75vw, 300px"
                  className="h-auto max-h-[400px] w-full cursor-zoom-in object-cover outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onError={handleImageError}
                  onLoad={handleImageLoad}
                  onClick={() => setViewerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setViewerOpen(true);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Abrir imagem em tela ampliada"
                  unoptimized
                />
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={safeMediaUrl!}
                type="image"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
                filename={getAttachmentFileName()}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex h-[180px] w-[min(260px,70vw)] flex-col items-center justify-center gap-2 rounded-[8px] p-4",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]"
          )}>
            <ImageIcon className="h-10 w-10 opacity-50" aria-hidden="true" />
            <span className="text-[12px] font-light opacity-70">Imagem não disponível</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryImage}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-[6px] px-2 font-light shadow-none"
                onClick={handleDownloadMedia}
                disabled={isDownloading}
              >
                {isDownloading
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                {isDownloading ? "Baixando..." : "Baixar"}
              </Button>
            </div>
          </div>
        );

      case "video":
        if (!videoError) {
          return (
            <>
              <div className="relative w-full max-w-[280px] overflow-hidden rounded-[6px] sm:max-w-[300px]">
                {videoLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-overlay)]" role="status" aria-label="Carregando vídeo">
                    <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-hidden="true" />
                  </div>
                )}
                <video
                  key={`${messageId}-video-${mediaReloadKey}`}
                  src={safeMediaUrl!}
                  className="h-auto max-h-[400px] w-full object-cover"
                  preload="metadata"
                  controls
                  playsInline
                  onLoadedData={() => setVideoLoading(false)}
                  onError={() => {
                    setVideoLoading(false);
                    setVideoError(true);
                  }}
                />
                <button
                  type="button"
                  className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--app-media-scrim)] text-[var(--app-on-media)] transition-colors hover:bg-[var(--app-media-scrim-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-on-media)]/70"
                  onClick={() => setViewerOpen(true)}
                  aria-label="Abrir vídeo em tela ampliada"
                  title="Ampliar vídeo"
                >
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
                {renderMediaTimestamp()}
              </div>
              <MediaViewer
                src={safeMediaUrl!}
                type="video"
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
                filename={getAttachmentFileName()}
              />
            </>
          );
        }
        return (
          <div className={cn(
            "flex h-[180px] w-[min(260px,70vw)] flex-col items-center justify-center gap-2 rounded-[8px] p-4",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]"
          )}>
            <Video className="h-10 w-10 opacity-50" aria-hidden="true" />
            <span className="text-[12px] font-light opacity-70">Vídeo não disponível</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryVideo}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={handleDownloadMedia} disabled={isDownloading}>
                {isDownloading
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                {isDownloading ? "Baixando..." : "Baixar"}
              </Button>
            </div>
          </div>
        );

      case "audio":
        return renderAudioPlayer();

      case "document":
        return (
          <div
            className={cn(
              "flex min-w-0 w-full max-w-[260px] items-center gap-2 rounded-[6px] p-2 transition-colors",
              fromMe
                ? "bg-primary-foreground/10"
                : "bg-[var(--app-surface-hover)]"
            )}
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
                className={cn(compact ? "text-xs" : "text-sm", "truncate font-normal leading-tight")}
                title={safeContent || "Documento"}
              >
                {safeContent || "Documento"}
              </p>
              {normalizedMediaMimeType && (
                <span className="text-[10px] opacity-50 block">
                  {normalizedMediaMimeType.split("/")[1]?.toUpperCase().replace("OCTET-STREAM", "DOC") || "DOC"}
                  {mediaSize ? ` · ${formatFileSize(mediaSize)}` : ""}
                </span>
              )}
            </div>

            {/* Timestamp area */}
            <div className="flex flex-col items-end shrink-0 gap-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDownloadMedia}
                  disabled={isDownloading}
                  className="rounded-[4px] p-0.5 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-50"
                  aria-label={isDownloading ? "Baixando documento" : "Baixar documento"}
                  title="Baixar documento"
                >
                  {isDownloading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                {leadId && attachableMediaUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachConfirmOpen(true);
                    }}
                    className="hover:text-primary transition-colors p-0.5"
                    title="Anexar ao Lead"
                    aria-label="Anexar documento à documentação do lead"
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                <span className={cn(
                  "text-[11px] leading-none whitespace-nowrap",
                  fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]"
                )}>
                  {formatTime(sentAt)}
                </span>
              </div>
              {fromMe && getStatusIcon()}
            </div>
          </div>
        );

      case "sticker":
        if (!imageError) {
          return (
            <div className="relative max-h-[160px] max-w-[160px] p-1">
              {imageLoading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[6px] bg-[var(--app-overlay)]" role="status" aria-label="Carregando figurinha">
                  <Loader2 className="h-5 w-5 animate-spin text-white/70" aria-hidden="true" />
                </div>
              )}
              <NextImage
                key={`${messageId}-sticker-${mediaReloadKey}`}
                src={safeMediaUrl!}
                alt={safeContent || "Figurinha"}
                width={150}
                height={150}
                sizes="150px"
                className="max-h-[150px] max-w-[150px] object-contain"
                onError={handleImageError}
                onLoad={handleImageLoad}
                unoptimized
              />
              {renderMediaTimestamp()}
            </div>
          );
        }
        return (
          <div className={cn(
            "flex min-h-[120px] min-w-[140px] flex-col items-center justify-center gap-2 rounded-[8px] p-3",
            fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
          )}>
            <ImageIcon className="h-8 w-8 opacity-50" aria-hidden="true" />
            <span className="text-[11px] font-light opacity-70">Figurinha indisponível</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 rounded-[6px] px-2 font-light shadow-none" onClick={retryImage}>
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Tentar novamente
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-[6px] shadow-none" onClick={handleDownloadMedia} disabled={isDownloading} aria-label="Baixar figurinha">
                {isDownloading
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  : <Download className="h-3 w-3" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const isMediaMessage = mediaKind !== "text" && mediaKind !== "reaction" && mediaKind !== "deleted";
  const isDeletedMessage = mediaKind === "deleted";
  const isMediaWithOverlayTimestamp = (
    (mediaKind === "image" && Boolean(safeMediaUrl) && !imageError)
    || (mediaKind === "video" && Boolean(safeMediaUrl) && !videoError)
  );
  const isAudioMessage = mediaKind === "audio";
  const isMediaWithOwnTimestamp = isAudioMessage || mediaKind === "document";
  const hasReactions = reactions.length > 0;
  const ownReactionEmoji = reactions.find((reaction) => reaction.fromMe)?.emoji || null;
  const reactionOptions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const handleReaction = async (emoji: string) => {
    if (!onReact || isReacting) return;
    setReactionPickerOpen(false);
    try {
      await onReact(ownReactionEmoji === emoji ? '' : emoji);
    } catch {
      // The mutation owns the user-facing error and cache reconciliation.
    }
  };

  const renderReactions = () => {
    if (!hasReactions) return null;
    return (
      <div className={cn(
        "absolute -bottom-3 z-10 flex",
        fromMe ? "right-2" : "left-2",
      )}>
        <div className={cn(
          "inline-flex items-center gap-0.5 rounded-[8px] border px-1.5 py-0.5 text-sm leading-none shadow-none",
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

  if (mediaKind === "reaction") return null;

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
          "relative overflow-visible rounded-[8px] border-0 shadow-none transition-colors duration-200",
          fromMe
            ? "rounded-tr-[4px] bg-primary text-primary-foreground"
            : "rounded-tl-[4px] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
          (mediaKind === "image" || mediaKind === "video") && !content ? "p-[3px]" : "px-3 py-2"
        )}>
          {onReact && !isDeletedMessage && (
            <div className={cn(
              "absolute top-1/2 z-20 -translate-y-1/2",
              fromMe ? "-left-9" : "-right-9",
            )}>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground shadow-none transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setReactionPickerOpen((open) => !open)}
                disabled={isReacting}
                aria-label="Reagir a mensagem"
                aria-expanded={reactionPickerOpen}
                aria-haspopup="true"
              >
                {isReacting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              {reactionPickerOpen && (
                <div className={cn(
                  "absolute top-8 flex items-center gap-0.5 rounded-[8px] border border-border bg-[var(--app-surface-solid)] p-1 shadow-none",
                  fromMe ? "right-0" : "left-0",
                )}
                  role="group"
                  aria-label="Escolha uma reação"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setReactionPickerOpen(false);
                  }}
                >
                  {reactionOptions.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-[6px] text-base transition-colors hover:bg-muted",
                        ownReactionEmoji === emoji && "bg-muted ring-1 ring-primary/40",
                      )}
                      onClick={() => void handleReaction(emoji)}
                      aria-label={ownReactionEmoji === emoji ? `Remover reacao ${emoji}` : `Reagir com ${emoji}`}
                      aria-pressed={ownReactionEmoji === emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Sender name for groups or sent messages with sender info */}
          {!fromMe && displaySenderName && (
            <p className={cn(compact ? "text-[11px]" : "text-xs", "mb-0.5 font-normal text-primary")}>{displaySenderName}</p>
          )}
          {fromMe && displaySenderName && (
            <p className="mb-0.5 text-[11px] font-normal opacity-70">{displaySenderName}</p>
          )}

          {/* Media content */}
          {isMediaMessage && renderMedia()}

          {/* Text content */}
          {isDeletedMessage && (
            <div className="flex items-center gap-1.5 text-[13.5px] italic opacity-75">
              <MessageCircleOff className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Esta mensagem foi apagada</span>
            </div>
          )}
          {safeContent && mediaKind === "text" && (
            <MessageText
              content={safeContent}
              fromMe={fromMe}
              groupJid={isGroup ? conversationRemoteJid : null}
              sessionId={isGroup ? conversationSessionId : null}
              compact={compact}
            />
          )}


          {/* Inline timestamp for text messages and non-overlay media (except audio which has its own) */}
          {(!isMediaWithOverlayTimestamp && !isMediaWithOwnTimestamp) && (
            <span className={cn(
              "float-right -mt-4 ml-2 flex items-center gap-0.5",
              fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]"
            )}>
              <span className="text-[11px] leading-none">{formatTime(sentAt)}</span>
              {getStatusIcon()}
            </span>
          )}

          {downloadFeedback && (
            <p
              className={cn(
                "mt-1 max-w-[260px] text-[10px] font-light",
                downloadFeedback.error
                  ? "text-destructive"
                  : fromMe
                    ? "text-primary-foreground/75"
                    : "text-[var(--app-text-secondary)]",
              )}
              role={downloadFeedback.error ? "alert" : "status"}
            >
              {downloadFeedback.message}
            </p>
          )}

          <AlertDialog
            open={attachConfirmOpen}
            onOpenChange={(open) => {
              if (!createAttachment.isPending) setAttachConfirmOpen(open);
            }}
          >
          <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <AlertDialogHeader>
              <AlertDialogTitle>Anexar ao Lead</AlertDialogTitle>
              <AlertDialogDescription>
                Deseja anexar este arquivo de mídia à documentação do lead <strong>{leadName}</strong>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={createAttachment.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={createAttachment.isPending || !attachableMediaUrl}
                onClick={(event) => {
                  event.preventDefault();
                  void handleAttachToLead();
                }}
              >
                {createAttachment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
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
  compact = false,
}: {
  content: string;
  fromMe: boolean;
  groupJid?: string | null;
  sessionId?: string | null;
  compact?: boolean;
}) {
  const mentionRegex = /(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})/g;
  const mentionTokenRegex = /^(@\d{7,}|@[\w\u00C0-\u017F]+(?:\s[\w\u00C0-\u017F]+){0,2})$/;
  const parts = content.split(mentionRegex).filter((part): part is string => typeof part === "string" && part.length > 0);

  const digitMentions = parts
    .filter((p) => /^@\d{7,}$/.test(p))
    .map((p) => p.slice(1));
  const names = useMentionNames(digitMentions, { groupJid, sessionId });

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    const urlParts = text.split(urlRegex);

    return urlParts.map((urlPart, i) => {
      const safeUrl = /^https?:\/\//i.test(urlPart) ? getSafeExternalHttpUrl(urlPart) : null;
      if (safeUrl) {
        return (
          <a
            key={i}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className={cn(
              "underline break-all transition-colors duration-200",
              fromMe
                ? "font-normal text-primary-foreground hover:text-primary-foreground/80"
                : "font-normal text-primary hover:text-primary/80"
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
    <p className={cn(compact ? "text-[12px] leading-[16px]" : "text-[13px] leading-[18px]", "whitespace-pre-wrap break-words")}>
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
                  "inline-block rounded-[4px] px-1 py-0.5 font-normal transition-colors duration-200",
                  fromMe
                    ? "bg-primary-foreground/20 text-primary-foreground"
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
