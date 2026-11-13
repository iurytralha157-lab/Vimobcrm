import type { Node } from 'reactflow';

import type { AutomationMediaFile } from '@/lib/api/automations';

const mediaFolder = { image: 'images', audio: 'audios', video: 'videos' } as const;
const legacyStorageRoute = /^\/(?:storage\/v1\/)?object\/(?:sign|public|authenticated)\/automation-media\//;
const controlOrUnsafePath = /[%\\\p{Cc}]/u;

export function restoreAutomationMediaPath(
  savedPath: unknown,
  legacyUrl: unknown,
  organizationId: string,
  mediaType: keyof typeof mediaFolder,
  storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  const prefix = `${organizationId}/${mediaFolder[mediaType]}/`;
  const isCanonical = (path: string) => {
    const fileName = path.slice(prefix.length);
    return path.length <= 1_000 && path.startsWith(prefix) && fileName.length > 0
      && fileName !== '.' && !fileName.includes('..') && !fileName.includes('/')
      && !controlOrUnsafePath.test(fileName);
  };
  if (typeof savedPath === 'string' && isCanonical(savedPath)) return savedPath;
  if (typeof legacyUrl !== 'string' || !legacyUrl || !storageUrl) return '';

  try {
    const storage = new URL(storageUrl);
    const url = new URL(legacyUrl, storage);
    if (url.origin !== storage.origin || url.username || url.password) return '';
    const route = url.pathname.match(legacyStorageRoute)?.[0];
    if (!route) return '';

    const path = decodeURIComponent(url.pathname.slice(route.length));
    return isCanonical(path) ? path : '';
  } catch {
    return '';
  }
}

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
