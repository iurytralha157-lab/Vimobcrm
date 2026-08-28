import { memo } from 'react';
import NextImage from 'next/image';
import { Handle, Position, NodeProps } from 'reactflow';
import { Image as ImageIcon } from 'lucide-react';

export const ImageNode = memo(({ data, selected }: NodeProps) => {
  const url = data.image_preview_url || data.image_url || '';
  const isConfigured = Boolean(data.media_path || url);
  const caption = data.caption || '';

  return (
    <div className={`automation-node min-w-[220px] max-w-[280px] rounded-[8px] px-4 py-3 ${
      selected ? 'automation-node-selected' : ''
    }`} style={{ '--node-accent': 'var(--chart-2)' } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-3 !h-3 !border-2 !border-blue-500/50" />
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-blue-500 shrink-0">
          <ImageIcon className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-normal text-blue-600 dark:text-blue-400">Imagem</span>
          <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
            {isConfigured ? caption || 'Imagem configurada' : 'Clique para configurar...'}
          </p>
        </div>
      </div>
      {url && (
        <div className="mt-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
          <NextImage
            src={url}
            alt={caption || 'Preview'}
            width={280}
            height={160}
            className="w-full object-contain max-h-[160px]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            unoptimized
          />
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-3 !h-3 !border-2 !border-blue-500/50" />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
