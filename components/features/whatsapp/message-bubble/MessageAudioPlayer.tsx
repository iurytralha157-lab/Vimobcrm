import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import NextImage from "next/image";
import { AlertCircle, Download, Link2, Loader2, Mic, Pause, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { createMessageMediaObjectUrl } from "../message-media";
import {
  formatMessageAudioDuration,
  formatMessageTime,
  generateMessageWaveform,
} from "./model";
import { MessageStatus } from "./MessageStatus";

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

const checkOggOpusSupport = (): boolean => {
  try {
    const audio = document.createElement("audio");
    return Boolean(
      audio.canPlayType
      && audio.canPlayType("audio/ogg; codecs=opus").replace(/no/, ""),
    );
  } catch {
    return false;
  }
};

export interface MessageAudioPlayerProps {
  safeMediaUrl: string | null;
  mediaUrl: string | null;
  normalizedMediaMimeType?: string;
  messageId: string;
  sentAt: string;
  fromMe: boolean;
  status: string;
  audioAvatarName: string;
  audioAvatarInitial: string;
  safeAvatarUrl: string | null;
  attachableMediaUrl: string | null;
  leadId: string;
  onRequestAttach: () => void;
  onDownload: (event?: MouseEvent) => void | Promise<void>;
  isDownloading: boolean;
  onRetryMedia?: () => void | Promise<void>;
}

export function MessageAudioPlayer({
  safeMediaUrl,
  mediaUrl,
  normalizedMediaMimeType,
  messageId,
  sentAt,
  fromMe,
  status,
  audioAvatarName,
  audioAvatarInitial,
  safeAvatarUrl,
  attachableMediaUrl,
  leadId,
  onRequestAttach,
  onDownload,
  isDownloading,
  onRetryMedia,
}: MessageAudioPlayerProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [mediaReloadKey, setMediaReloadKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const [isRetryingMedia, setIsRetryingMedia] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioFallbackRequestRef = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMediaUrlRef = useRef<string | null>(null);
  const waveformBars = generateMessageWaveform(mediaUrl || sentAt, 28);

  useEffect(() => {
    const didUrlChange = mediaUrl !== lastMediaUrlRef.current || messageId !== lastMessageIdRef.current;
    lastMediaUrlRef.current = mediaUrl || null;
    lastMessageIdRef.current = messageId;

    if (didUrlChange) {
      audioFallbackRequestRef.current += 1;
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
        setMediaReloadKey(0);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [mediaUrl, messageId, blobUrl, safeMediaUrl]);

  useEffect(() => () => {
    audioFallbackRequestRef.current += 1;
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
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

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

  const handleAudioError = async (event: SyntheticEvent<HTMLAudioElement>) => {
    const audio = event.currentTarget;
    const errorCode = audio.error?.code ?? 0;

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
        return;
      } catch {
        // Se o fallback por blob falhar, exibimos o estado de erro no proprio bubble.
      }
    }

    if (normalizedMediaMimeType?.includes("ogg") && !checkOggOpusSupport()) {
      setAudioError("Formato não suportado neste navegador");
    } else if (errorCode === 4) {
      setAudioError("Formato não suportado");
    } else if (errorCode === 2) {
      setAudioError("Erro de rede");
    } else {
      setAudioError("Não foi possível reproduzir");
    }
  };

  const resetAudioPlayback = () => {
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

  const retryAudio = async () => {
    if (!onRetryMedia) {
      resetAudioPlayback();
      return;
    }

    setIsRetryingMedia(true);
    try {
      await onRetryMedia();
    } finally {
      setIsRetryingMedia(false);
      resetAudioPlayback();
    }
  };

  const seekAudioToPercent = (percentage: number) => {
    const audio = audioRef.current;
    if (!audio || !audioReady || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const boundedPercentage = Math.min(Math.max(percentage, 0), 1);
    audio.currentTime = boundedPercentage * audio.duration;
  };

  const handleWaveformClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekAudioToPercent((event.clientX - rect.left) / rect.width);
  };

  const handleWaveformKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
              : "border-[var(--app-surface-solid)] bg-primary text-primary-foreground",
          )}
        >
          <Mic className="h-2.5 w-2.5" />
        </span>
      </div>
    );
  };

  const renderMessageTimestamp = () => (
    <span
      data-message-timestamp-position={fromMe ? "bottom-left" : "bottom-right"}
      className={cn(
        "flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] leading-none",
        fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]",
      )}
    >
      {leadId && attachableMediaUrl && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRequestAttach();
          }}
          className="p-0.5 transition-colors hover:text-primary"
          title="Anexar ao Lead"
          aria-label="Anexar áudio à documentação do lead"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <span>{formatMessageTime(sentAt)}</span>
      <MessageStatus fromMe={fromMe} status={status} />
    </span>
  );

  if (safeMediaUrl) {
    const progressPercent = audioProgress || 0;
    const playedBars = Math.floor((progressPercent / 100) * waveformBars.length);
    const audioTimeLabel = (isPlaying || currentTime > 0)
      ? formatMessageAudioDuration(currentTime)
      : formatMessageAudioDuration(audioDuration);

    if (audioError) {
      return (
        <div className="flex flex-col gap-2 py-2 px-2 min-w-0 w-full">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
              fromMe ? "bg-primary-foreground/20" : "bg-muted-foreground/20",
            )}>
              <AlertCircle className="w-5 h-5 opacity-70" />
            </div>
            <div className="flex flex-col flex-1">
              <span className="text-xs opacity-80">{audioError}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-[6px] px-2 font-light shadow-none"
                  onClick={() => void retryAudio()}
                  disabled={isRetryingMedia}
                >
                  {isRetryingMedia
                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                    : <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />}
                  {isRetryingMedia ? "Recuperando..." : "Tentar novamente"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-[6px] px-2 font-light shadow-none"
                  onClick={onDownload}
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
          <div className={cn("flex items-center", fromMe ? "justify-start" : "justify-end")}>
            {renderMessageTimestamp()}
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-w-[250px] max-w-[310px] items-center gap-2 py-1.5 px-1">
        <button
          type="button"
          onClick={() => void handleAudioPlay()}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
            fromMe
              ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
              : "bg-primary/15 hover:bg-primary/25",
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
              aria-valuetext={`${formatMessageAudioDuration(currentTime)} de ${formatMessageAudioDuration(audioDuration)}`}
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
                        : "bg-primary/30",
                  )}
                  style={{ height: `${Math.max(height * 78, 18)}%` }}
                />
              ))}
            </div>

            <div
              className={cn(
                "pointer-events-none absolute h-3 w-3 rounded-full shadow-none transition-all duration-100",
                fromMe ? "bg-primary-foreground" : "bg-primary",
              )}
              style={{
                left: `calc(${progressPercent}% - 6px)`,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            {fromMe && renderMessageTimestamp()}
            <span className={cn(
              "text-[11px] leading-none",
              fromMe ? "text-primary-foreground/60" : "text-[var(--app-text-tertiary)]",
            )}>
              {audioTimeLabel}
            </span>
            {!fromMe && renderMessageTimestamp()}
          </div>
        </div>

        {renderAudioAvatar()}

        <audio
          key={`${blobUrl || safeMediaUrl}-${mediaReloadKey}`}
          ref={audioRef}
          preload="metadata"
          onEnded={() => {
            setIsPlaying(false);
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
          <source src={blobUrl || safeMediaUrl} type={normalizedMediaMimeType} />
        </audio>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex min-w-[180px] items-center gap-3 rounded-[8px] px-4 py-3",
      fromMe ? "bg-primary-foreground/10" : "bg-[var(--app-surface-hover)]",
    )}>
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center",
        fromMe ? "bg-primary-foreground/20" : "bg-muted-foreground/20",
      )}>
        <Mic className="w-5 h-5 opacity-50" />
      </div>
      <div className="flex flex-col">
        <span className="text-xs">Áudio não disponível</span>
      </div>
    </div>
  );
}
