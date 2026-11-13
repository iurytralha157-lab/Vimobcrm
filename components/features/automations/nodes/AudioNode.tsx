import { memo, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Headphones, Play, Pause } from 'lucide-react';

const emptyPlayback = { url: '', isPlaying: false, currentTime: 0, duration: 0 };

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export const AudioNode = memo(({ data, selected }: NodeProps) => {
  const url = data.audio_preview_url || data.audio_url || '';
  const isConfigured = Boolean(data.media_path || url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playback, setPlayback] = useState(emptyPlayback);
  const { isPlaying, currentTime, duration } = playback.url === url ? playback : emptyPlayback;

  const syncPlayback = ({ currentTarget: audio }: SyntheticEvent<HTMLAudioElement>) => {
    setPlayback({
      url,
      isPlaying: !audio.paused && !audio.ended && !audio.error,
      currentTime: audio.ended ? 0 : audio.currentTime,
      duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0,
    });
  };

  const togglePlay = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  const handleSeek = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (!audio || !duration || !width) return;
    const position = Math.max(0, Math.min(1, (event.clientX - left) / width));
    audio.currentTime = position * duration;
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
            className="nodrag w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center shrink-0 hover:bg-amber-600 transition-colors"
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
            className="nodrag group relative h-2 cursor-pointer rounded-full bg-[var(--app-surface-hover)]"
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
            key={url}
            ref={audioRef}
            src={url}
            onLoadedMetadata={syncPlayback}
            onDurationChange={syncPlayback}
            onTimeUpdate={syncPlayback}
            onPlay={syncPlayback}
            onPause={syncPlayback}
            onEnded={syncPlayback}
            onError={syncPlayback}
            preload="none"
          />
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-amber-400 !w-3 !h-3 !border-2 !border-amber-500/50" />
    </div>
  );
});

AudioNode.displayName = 'AudioNode';
