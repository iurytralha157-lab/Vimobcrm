import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';

export type EditableTag = {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  updated_at: string;
};

type TagValues = { name: string; color: string; description?: string };

export type TagFormState = {
  open: boolean;
  editingTag: EditableTag | null;
  values: TagValues;
  error: string | null;
};

export function createTagFormState(): TagFormState {
  return { open: false, editingTag: null, values: { name: '', color: DEFAULT_TAG_COLOR }, error: null };
}

type TagFormAction =
  | { type: 'visibility'; open: boolean }
  | { type: 'reset' }
  | { type: 'edit'; tag: EditableTag }
  | { type: 'values'; values: TagValues }
  | { type: 'error'; error: string | null };

function editableTagColor(color: string) {
  const normalized = color.trim();
  // Legacy short hexadecimal tags remain editable through the canonical API.
  if (/^#[\da-f]{3}$/i.test(normalized)) return '#' + normalized.slice(1).split('').map((value) => value + value).join('');
  return normalized;
}

export function tagFormReducer(state: TagFormState, action: TagFormAction): TagFormState {
  switch (action.type) {
    case 'visibility':
      return action.open ? { ...state, open: true } : createTagFormState();
    case 'reset':
      return { ...createTagFormState(), open: state.open };
    case 'edit':
      return { open: true, editingTag: action.tag, values: {
        name: action.tag.name, color: editableTagColor(action.tag.color), description: action.tag.description ?? undefined,
      }, error: null };
    case 'values':
      return { ...state, values: action.values };
    case 'error':
      return { ...state, error: action.error };
  }
}
