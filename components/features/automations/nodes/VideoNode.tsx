import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Video } from 'lucide-react';

export const VideoNode = memo(({ data, selected }: NodeProps) => {
  const url = data.video_preview_url || data.video_url || '';
  const isConfigured = Boolean(data.media_path || url);

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-5)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-rose-400 !w-3 !h-3 !border-2 !border-rose-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-rose-500 shrink-0">
          <Video className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <span className="text-[12px] font-normal text-rose-600 dark:text-rose-400">Vídeo</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isConfigured ? 'Vídeo configurado' : 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-rose-400 !w-3 !h-3 !border-2 !border-rose-500/50" />
    </div>
  );
});

VideoNode.displayName = 'VideoNode';
