import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Headphones, Play, Pause } from 'lucide-react';

export const AudioNode = memo(({ data, selected }: NodeProps) => {
  const url = data.audio_preview_url || data.audio_url || '';
  const isConfigured = Boolean(data.media_path || url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Continuously poll currentTime via rAF for smooth progress
  const updateProgress = useCallback(() => {
    if (audioRef.current && isPlaying) {
      setCurrentTime(audioRef.current.currentTime);
      const dur = audioRef.current.duration;
      if (isFinite(dur) && dur > 0 && duration === 0) {
        setDuration(dur);
      }
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPlaying, duration]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, updateProgress]);

  // Force duration detection: seek to end briefly
  useEffect(() => {
    if (!url) return;
    const audio = new Audio();
    audio.preload = 'metadata';

    const onLoaded = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('durationchange', onDuration);
        return;
      }
      // OGG/Opus workaround: seek to a large value to force duration calc
      audio.currentTime = 1e10;
    };

    const onDuration = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        audio.removeEventListener('durationchange', onDuration);
        audio.removeEventListener('timeupdate', onTimeSeek);
      }
    };

    const onTimeSeek = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      audio.removeEventListener('timeupdate', onTimeSeek);
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('timeupdate', onTimeSeek);
    audio.src = url;

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('timeupdate', onTimeSeek);
      audio.src = '';
    };
  }, [url]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!audioRef.current || !duration || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  }, [duration]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || isNaN(s) || s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--warning)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-amber-400 !w-3 !h-3 !border-2 !border-amber-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-500 shrink-0">
          <Headphones className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-400">Áudio</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isConfigured ? 'Áudio configurado' : 'Clique para configurar...'}
          </p>
        </div>
        {url && (
          <button
            type="button"
            onClick={togglePlay}
            className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center shrink-0 hover:bg-amber-600 transition-colors"
            aria-label={isPlaying ? 'Pausar prévia do áudio' : 'Reproduzir prévia do áudio'}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5 text-primary-foreground" />
            ) : (
              <Play className="ml-0.5 h-3.5 w-3.5 text-primary-foreground" />
            )}
          </button>
        )}
      </div>
      {url && (
        <div className="mt-2 space-y-1.5">
          <div
            ref={progressRef}
            className="group relative h-2 cursor-pointer rounded-full bg-[var(--app-surface-hover)]"
            onClick={handleSeek}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-amber-500"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-amber-500 opacity-0 shadow-none transition-opacity group-hover:opacity-100"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>

          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
          </div>

          <audio
            ref={audioRef}
            src={url}
            onEnded={handleEnded}
            preload="auto"
          />
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-amber-400 !w-3 !h-3 !border-2 !border-amber-500/50" />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
