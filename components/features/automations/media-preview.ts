import type { Node } from 'reactflow';

import type { AutomationMediaFile } from '@/lib/api/automations';

export function createAutomationMediaPreviewIndex(files: AutomationMediaFile[]) {
  return new Map(files.map((file) => [file.path, file.publicUrl]));
}

export function withAutomationMediaPreview(node: Node, previews: Map<string, string>): Node {
  const mediaPath = typeof node.data.media_path === 'string' ? node.data.media_path : '';
  const previewUrl = mediaPath ? previews.get(mediaPath) : undefined;
  if (!previewUrl) return node;

  const previewKey = node.type === 'image'
    ? 'image_preview_url'
    : node.type === 'audio'
      ? 'audio_preview_url'
      : node.type === 'video'
        ? 'video_preview_url'
        : null;
  if (!previewKey || node.data[previewKey] === previewUrl) return node;

  return {
    ...node,
    data: {
      ...node.data,
      [previewKey]: previewUrl,
    },
  };
}
