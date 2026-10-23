import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import NextImage from "next/image";
import { AlertCircle, Download, Loader2, Mic, Pause, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getWhatsAppAvatarCandidates } from "@/lib/whatsapp-avatar";

import { createMessageMediaObjectUrl } from "../message-media";
import {
  formatMessageAudioDuration,
  formatMessageTime,
  generateMessageWaveform,
} from "./model";
import { MessageStatus } from "./MessageStatus";
import { claimMessageAudio, releaseMessageAudio } from "./audio-playback-coordinator";
import { useMessagePlaybackSource } from "@/hooks/whatsapp/use-message-playback-source";

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
  playbackIdentity?: string;
  normalizedMediaMimeType?: string;
  messageId: string;
  sentAt: string;
  fromMe: boolean;
  status: string;
  audioAvatarName: string;
  audioAvatarInitial: string;
  safeAvatarUrl: string | null;
  contactAvatarFallbackUrl?: string | null;
  audioAvatarFallbackUrl?: string | null;
  leadId: string;
  onDownload: (event?: MouseEvent) => void | Promise<void>;
  isDownloading: boolean;
  onRetryMedia?: () => void | Promise<void>;
  onRefreshMedia?: () => Promise<string | null>;
}

export function MessageAudioPlayer({
  safeMediaUrl,
  mediaUrl,
  playbackIdentity,
  normalizedMediaMimeType,
  messageId,
  sentAt,
  fromMe,
  status,
  audioAvatarName,
  audioAvatarInitial,
  safeAvatarUrl,
  contactAvatarFallbackUrl,
  audioAvatarFallbackUrl,
  leadId,
  onDownload,
  isDownloading,
  onRetryMedia,
  onRefreshMedia,
}: MessageAudioPlayerProps) {
  const avatarIntent = useMemo(() => ({ messageId, playbackIdentity,
    candidates: getWhatsAppAvatarCandidates(safeAvatarUrl, fromMe ? audioAvatarFallbackUrl : contactAvatarFallbackUrl),
  }), [messageId, playbackIdentity, safeAvatarUrl, fromMe, audioAvatarFallbackUrl, contactAvatarFallbackUrl]);
  const [avatarAttempt, setAvatarAttempt] = useState({ intent: avatarIntent, index: 0, retry: 0, exhausted: false });
  const currentAvatarAttempt = avatarAttempt.intent === avatarIntent ? avatarAttempt : { intent: avatarIntent, index: 0, retry: 0, exhausted: false };
  if (avatarAttempt.intent !== avatarIntent) setAvatarAttempt(currentAvatarAttempt);
  useEffect(() => {
    if (!currentAvatarAttempt.exhausted || currentAvatarAttempt.retry > 0 || avatarIntent.candidates.length === 0) return;
    const timer = window.setTimeout(() => setAvatarAttempt(previous => previous.intent === avatarIntent && previous.exhausted && previous.retry === 0
      ? { intent: avatarIntent, index: 0, retry: 1, exhausted: false } : previous), 750);
    return () => window.clearTimeout(timer);
  }, [avatarIntent, currentAvatarAttempt.exhausted, currentAvatarAttempt.retry]);
  const selectedAvatarUrl = currentAvatarAttempt.exhausted ? null : avatarIntent.candidates[currentAvatarAttempt.index];
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
  const playback = useMessagePlaybackSource(JSON.stringify([playbackIdentity, messageId, leadId]), safeMediaUrl, audioRef);
  const audioFallbackRequestRef = useRef(0);
  const fallbackControllerRef = useRef<AbortController | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const waveformBars = generateMessageWaveform(messageId || sentAt, 28);
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) { audio.pause(); releaseMessageAudio(audio); }
    };
  }, [playback.generation, playback.url, messageId, blobUrl, mediaReloadKey, audioError]);

  useEffect(() => {
    const sourceIdentity = JSON.stringify([messageId, playbackIdentity, playback.generation]);
    const didUrlChange = sourceIdentity !== lastMessageIdRef.current;
    lastMessageIdRef.current = sourceIdentity;

    if (didUrlChange) {
      audioFallbackRequestRef.current += 1;
      fallbackControllerRef.current?.abort();
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
        setIsRetryingMedia(false);
        setMediaReloadKey(0);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [mediaUrl, messageId, playbackIdentity, playback.generation, blobUrl, safeMediaUrl]);

  useEffect(() => () => {
    audioFallbackRequestRef.current += 1;
    fallbackControllerRef.current?.abort();
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

    const generation = audioFallbackRequestRef.current;
    try {
      claimMessageAudio(audio);
      audio.playbackRate = playbackRate;
      await audio.play();
      if (generation !== audioFallbackRequestRef.current || audioRef.current !== audio) audio.pause();
    } catch {
      releaseMessageAudio(audio);
      if (audioRef.current !== audio || generation !== audioFallbackRequestRef.current) return;
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
    if (audioRef.current !== audio) return;
    if (playback.recoverRotatedSource(audio)) return;
    const errorCode = audio.error?.code ?? 0;
    const requestId = ++audioFallbackRequestRef.current;

    if (!blobAttempted && safeMediaUrl) {
      setBlobAttempted(true);
      fallbackControllerRef.current?.abort();
      const controller = new AbortController();
      fallbackControllerRef.current = controller;
      try {
        const blob = await createMessageMediaObjectUrl({
          url: safeMediaUrl,
          kind: "audio",
          mimeType: normalizedMediaMimeType,
          signal: controller.signal,
        });
        if (requestId !== audioFallbackRequestRef.current) {
          URL.revokeObjectURL(blob);
          return;
        }
        setBlobUrl(blob);
        setAudioError(null);
        return;
      } catch {
        if (requestId !== audioFallbackRequestRef.current || controller.signal.aborted) return;
      }
    }

    if (requestId !== audioFallbackRequestRef.current || audioRef.current !== audio) return;
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
    fallbackControllerRef.current?.abort();
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
    if (!onRefreshMedia && !onRetryMedia) {
      resetAudioPlayback();
      return;
    }

    setIsRetryingMedia(true);
    const generation = audioFallbackRequestRef.current;
    try {
      if (onRefreshMedia) await onRefreshMedia();
      else if (onRetryMedia) await onRetryMedia();
      if (generation === audioFallbackRequestRef.current) {
        setIsRetryingMedia(false);
        resetAudioPlayback();
      }
    } catch {
      if (generation === audioFallbackRequestRef.current) {
        setIsRetryingMedia(false);
        setAudioError("Não foi possível recuperar o áudio.");
      }
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
      <div className={cn(
        "relative row-start-1 h-10 w-10 shrink-0 translate-y-0.5 overflow-visible",
        fromMe ? "col-start-1" : "col-start-3",
      )}>
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
          ) : selectedAvatarUrl ? (
            <NextImage
              key={`${currentAvatarAttempt.index}:${currentAvatarAttempt.retry}`}
              src={selectedAvatarUrl}
              alt={audioAvatarName}
              fill
              sizes="40px"
              className="object-cover"
              onError={() => setAvatarAttempt(previous => {
                if (previous.intent !== avatarIntent || previous.index !== currentAvatarAttempt.index || previous.retry !== currentAvatarAttempt.retry) return previous;
                return previous.index + 1 < avatarIntent.candidates.length ? { ...previous, index: previous.index + 1 }
                  : { ...previous, exhausted: true };
              })}
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
      data-message-timestamp-position={fromMe ? "bottom-right" : "bottom-left"}
      className={cn(
        "flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] leading-none",
        fromMe ? "ml-auto text-primary-foreground/60" : "text-[var(--app-text-tertiary)]",
      )}
    >
      <span>{formatMessageTime(sentAt)}</span>
      <MessageStatus compact fromMe={fromMe} status={status} />
    </span>
  );

  if (playback.url) {
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
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs opacity-80">{audioError}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto min-h-7 max-w-full whitespace-normal rounded-[6px] px-2 text-left text-[12px] font-light shadow-none"
                  onClick={() => void retryAudio()}
                  disabled={isRetryingMedia}
                >
                  {isRetryingMedia
                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />}
                  {isRetryingMedia ? "Recuperando..." : "Tentar novamente"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto min-h-7 max-w-full whitespace-normal rounded-[6px] px-2 text-left text-[12px] font-light shadow-none"
                  onClick={onDownload}
                  disabled={isDownloading}
                >
                  {isDownloading
                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <Download className="mr-1 h-3 w-3" aria-hidden="true" />}
                  {isDownloading ? "Baixando..." : "Baixar áudio"}
                </Button>
              </div>
            </div>
          </div>
          <div className={cn("flex items-center", fromMe ? "justify-end" : "justify-start")}>
            {renderMessageTimestamp()}
          </div>
        </div>
      );
    }

    return (
      <div
        data-message-audio-player
        className={cn(
          "grid w-[min(270px,65vw)] min-w-0 max-w-full grid-rows-[40px_auto] items-center gap-x-2 gap-y-0 px-1",
          fromMe ? "grid-cols-[40px_36px_minmax(0,1fr)]" : "grid-cols-[36px_minmax(0,1fr)_40px]",
        )}
      >
        {fromMe && renderAudioAvatar()}
        <button
          type="button"
          onClick={() => void handleAudioPlay()}
          className={cn(
            "row-start-1 flex h-9 w-9 shrink-0 translate-y-0.5 items-center justify-center rounded-full transition-colors",
            fromMe ? "col-start-2" : "col-start-1",
            fromMe
              ? "bg-primary-foreground/20 hover:bg-primary-foreground/30"
              : "bg-primary/50 text-primary-foreground hover:bg-primary/70",
          )}
          aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>

        <div className={cn(
          "relative row-start-1 flex h-[30px] min-w-0 translate-y-0.5 items-center",
          fromMe ? "col-start-3" : "col-start-2",
        )}>
          <div
            className="flex h-full w-full cursor-pointer items-center gap-[2px] rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            style={{ columnGap: `clamp(0.5px, calc(100% / ${waveformBars.length * 2}), 2px)` }}
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
                  "min-w-0 flex-1 rounded-full transition-colors duration-100",
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

        <div className={cn(
          "row-start-2 flex w-full min-w-max items-center justify-between gap-x-2",
          fromMe ? "col-start-3 justify-self-end" : "col-start-2 justify-self-start",
        )}>
          {!fromMe && renderMessageTimestamp()}
          <span data-message-audio-duration className={cn(
            "text-[10px] leading-none",
            fromMe ? "text-primary-foreground/60" : "ml-auto text-[var(--app-text-tertiary)]",
          )}>
            {audioTimeLabel}
          </span>
          {fromMe && renderMessageTimestamp()}
        </div>

        {!fromMe && renderAudioAvatar()}

        <audio
          key={`${blobUrl || playback.url}-${playback.generation}-${mediaReloadKey}`}
          ref={audioRef}
          preload="metadata"
          onEnded={(event) => {
            if (!playback.isCurrent(event.currentTarget)) return;
            playback.onEnded(event.currentTarget);
            setIsPlaying(false);
            setAudioProgress(100);
            setCurrentTime(Number.isFinite(audioDuration) ? audioDuration : 0);
          }}
          onTimeUpdate={handleAudioTimeUpdate}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            void playback.onLoadedMetadata(audio).then(result => {
              if (!playback.isCurrent(audio)) return;
              if (result === "resume_failed") setAudioError("Não foi possível retomar. Toque para tentar novamente.");
              handleAudioLoadedMetadata();
              handleAudioTimeUpdate();
            });
          }}
          onCanPlay={() => setAudioReady(true)}
           onPlay={(event) => { if (!playback.isCurrent(event.currentTarget)) return; playback.onPlay(event.currentTarget); setIsPlaying(true); }}
           onPause={(event) => { if (!playback.isCurrent(event.currentTarget)) return; playback.onPause(event.currentTarget); setIsPlaying(false); }}
          onError={handleAudioError}
          className="hidden"
        >
          <source src={blobUrl || playback.url} type={normalizedMediaMimeType} />
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
