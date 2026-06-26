import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Video } from 'lucide-react';

export const VideoNode = memo(({ data, selected }: NodeProps) => {
  const url = data.video_url || '';

  return (
    <div className={`automation-node px-4 py-3 rounded-xl min-w-[220px] max-w-[280px] ${
      selected ? 'ring-2 ring-rose-400/60' : ''
    }`} style={{ '--node-accent': '#f43f5e' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-rose-400 !w-3 !h-3 !border-2 !border-rose-500/50" />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-rose-500 shrink-0">
          <Video className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">Vídeo</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {url ? 'Vídeo configurado' : 'Clique para configurar...'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-rose-400 !w-3 !h-3 !border-2 !border-rose-500/50" />
    </div>
  );
});

VideoNode.displayName = 'VideoNode';
