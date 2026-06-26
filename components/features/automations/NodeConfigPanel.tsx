import { Node } from 'reactflow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Trash2, Play, MessageSquare, Timer, Image, Headphones, Video,
  GitBranch, Webhook, Tag, ArrowRightLeft, UserCheck, X, Save, GripHorizontal,
  Home, CircleDot,
} from 'lucide-react';
import { TriggerType } from '@/hooks/use-automations';
import { useCreateTag } from '@/hooks/use-tags';
import { useAllMetaFormConfigs } from '@/hooks/use-meta-forms';
import { useRef, useState, useCallback } from 'react';
import { AutomationMediaGallery } from './AutomationMediaGallery';
import { AudioRecorderInline } from './AudioRecorderInline';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { Plus } from 'lucide-react';

interface NodeConfigPanelProps {
  selectedNode: Node;
  onClose: () => void;
  onNodeDataChange: (nodeId: string, data: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string) => void;
  onSaveNode?: () => void;
  triggerType?: TriggerType;
  setTriggerType?: (t: TriggerType) => void;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  tagId?: string;
  setTagId?: (id: string) => void;
  pipelines?: Array<{ id: string; name: string }>;
  pipelineId?: string;
  setPipelineId?: (id: string) => void;
  stages?: Array<{ id: string; name: string; color?: string | null }>;
  stageId?: string;
  setStageId?: (id: string) => void;
  position?: { x: number; y: number };
  // Start node extras
  sessions?: Array<{ id: string; instance_name: string; display_name?: string | null; status: string }>;
  sessionId?: string;
  setSessionId?: (id: string) => void;
  users?: Array<{ id: string; name: string | null; email: string }>;
  filterUserId?: string;
  setFilterUserId?: (id: string) => void;
  properties?: Array<{ id: string; title: string | null; code?: string | null; bairro?: string | null; cidade?: string | null; preco?: number | null; imagem_principal?: string | null; tipo_de_imovel?: string | null; tipo_de_negocio?: string | null; commission_percentage?: number | null }>;
}

const NODE_TITLES: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  start: { icon: Play, label: 'Início', color: 'text-orange-500' },
  message: { icon: MessageSquare, label: 'Mensagem', color: 'text-green-600 dark:text-green-400' },
  wait: { icon: Timer, label: 'Espera', color: 'text-purple-600 dark:text-purple-400' },
  image: { icon: Image, label: 'Imagem', color: 'text-blue-600 dark:text-blue-400' },
  audio: { icon: Headphones, label: 'Áudio', color: 'text-amber-600 dark:text-amber-400' },
  video: { icon: Video, label: 'Vídeo', color: 'text-rose-600 dark:text-rose-400' },
  condition: { icon: GitBranch, label: 'Condição', color: 'text-yellow-600 dark:text-yellow-400' },
  webhook: { icon: Webhook, label: 'Webhook', color: 'text-indigo-600 dark:text-indigo-400' },
  tag: { icon: Tag, label: 'Tag', color: 'text-teal-600 dark:text-teal-400' },
  move_stage: { icon: ArrowRightLeft, label: 'Mudar Etapa', color: 'text-violet-600 dark:text-violet-400' },
  assign_user: { icon: UserCheck, label: 'Responsável', color: 'text-sky-600 dark:text-sky-400' },
  property_interest: { icon: Home, label: 'Imóvel Interesse', color: 'text-emerald-600 dark:text-emerald-400' },
  deal_status: { icon: CircleDot, label: 'Status', color: 'text-pink-600 dark:text-pink-400' },
};

function MetaFormSelector({ value, onChange }: { value: string | undefined; onChange: (id: string | null) => void }) {
  const { data: formConfigs, isLoading } = useAllMetaFormConfigs();

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Formulário Meta</Label>
      <Select value={value || '__all__'} onValueChange={(v) => onChange(v === '__all__' ? null : v)}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={isLoading ? "Carregando..." : "Todos os formulários"} />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          <SelectItem value="__all__">Todos os formulários</SelectItem>
          {formConfigs?.map((form) => (
            <SelectItem key={form.form_id} value={form.form_id}>
              {form.form_name || form.form_id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NodeConfigPanel({
  selectedNode, onClose, onNodeDataChange, onDeleteNode, onSaveNode,
  tags, tagId, setTagId, setTriggerType,
  pipelines, pipelineId, setPipelineId, stages, stageId, setStageId,
  position,
  sessions, sessionId, setSessionId,
  users, filterUserId, setFilterUserId,
  properties,
}: NodeConfigPanelProps) {
  const nodeInfo = NODE_TITLES[selectedNode.type || ''] || { icon: Play, label: 'Nó', color: 'text-foreground' };
  const Icon = nodeInfo.icon;
  const createTag = useCreateTag();
  const [newTagName, setNewTagName] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);

  // Dragging logic
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>(() => ({
    x: position?.x ?? 0,
    y: position?.y ?? 0,
  }));
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: panelPos.x, panelY: panelPos.y };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setPanelPos({
        x: dragStartRef.current.panelX + (ev.clientX - dragStartRef.current.mouseX),
        y: dragStartRef.current.panelY + (ev.clientY - dragStartRef.current.mouseY),
      });
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [panelPos]);

  const connectedSessions = sessions?.filter(s => s.status === 'connected') || [];

  return (
    <div
      ref={panelRef}
      className="absolute w-[300px] bg-[var(--app-surface)] border border-white/[0.055] rounded-2xl flex flex-col max-h-[70vh] z-[100] shadow-lg"
      style={{ left: panelPos.x, top: panelPos.y, isolation: 'isolate' }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.055] bg-white/[0.045] shrink-0 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          <Icon className={`h-4 w-4 ${nodeInfo.color}`} />
          <span className="text-sm font-semibold text-foreground">{nodeInfo.label}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {selectedNode.type === 'start' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Disparar quando</Label>
                <Select value={selectedNode.data.trigger_type || 'manual'}
                  onValueChange={(v: TriggerType) => { onNodeDataChange(selectedNode.id, { trigger_type: v }); setTriggerType?.(v); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="tag_added">Tag adicionada</SelectItem>
                    <SelectItem value="lead_created">Lead criado</SelectItem>
                    <SelectItem value="lead_stage_changed">Mudou de etapa</SelectItem>
                    <SelectItem value="manual">Disparo manual</SelectItem>
                    <SelectItem value="message_received">Mensagem recebida</SelectItem>
                    <SelectItem value="inactivity">Inatividade</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {selectedNode.data.trigger_type === 'lead_created' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Origem do Lead</Label>
                    <Select
                      value={selectedNode.data.source || '__all__'}
                      onValueChange={(v) => onNodeDataChange(selectedNode.id, { source: v === '__all__' ? null : v })}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Todas as origens" /></SelectTrigger>
                      <SelectContent className="z-[200]">
                        <SelectItem value="__all__">Todas as origens</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="meta">Meta (Facebook/Instagram)</SelectItem>
                        <SelectItem value="site">Site Interno</SelectItem>
                        <SelectItem value="website">Website Externo / Formulário</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedNode.data.source === 'meta' && (
                    <MetaFormSelector
                      value={selectedNode.data.meta_form_id}
                      onChange={(id) => onNodeDataChange(selectedNode.id, { meta_form_id: id })}
                    />
                  )}
                </>
              )}
              {selectedNode.data.trigger_type === 'tag_added' && tags && setTagId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tag</Label>
                  <Select value={tagId} onValueChange={setTagId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent className="z-[200]">{tags.map((t) => (
                      <SelectItem key={t.id} value={t.id}><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color || '#888' }} />{t.name}</div></SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
              )}
              {selectedNode.data.trigger_type === 'lead_stage_changed' && pipelines && setPipelineId && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Pipeline</Label>
                    <Select value={pipelineId} onValueChange={setPipelineId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent className="z-[200]">{pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {pipelineId && stages && setStageId && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Etapa</Label>
                      <Select value={stageId} onValueChange={setStageId}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent className="z-[200]">{stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color || '#888' }} />{s.name}</div></SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
              {selectedNode.data.trigger_type === 'inactivity' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tempo de inatividade</Label>
                  <div className="flex gap-2">
                    <Input type="number" min={1} className="w-20 h-9" value={selectedNode.data.inactivity_value || 1}
                      onChange={(e) => onNodeDataChange(selectedNode.id, { inactivity_value: parseInt(e.target.value) || 1 })} />
                    <Select value={selectedNode.data.inactivity_unit || 'days'}
                      onValueChange={(v) => onNodeDataChange(selectedNode.id, { inactivity_unit: v })}>
                      <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="z-[200]"><SelectItem value="hours">Horas</SelectItem><SelectItem value="days">Dias</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Session WhatsApp - moved from sidebar */}
              {connectedSessions.length > 0 && setSessionId && (
                <div className="space-y-1.5 pt-2 border-t border-white/[0.055]">
                  <Label className="text-xs">Sessão WhatsApp</Label>
                  <Select value={sessionId || ''} onValueChange={setSessionId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent className="z-[200]">{connectedSessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.display_name || s.instance_name}</SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
              )}

              {/* User filter - moved from sidebar */}
              {users && setFilterUserId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Filtrar por usuário</Label>
                  <Select value={filterUserId || '__all__'} onValueChange={(v) => setFilterUserId(v === '__all__' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent className="z-[200]">
                      <SelectItem value="__all__">Todos os usuários</SelectItem>
                      <SelectItem value="__me__">Apenas meus leads</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {selectedNode.type === 'message' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem</Label>
              <Textarea value={selectedNode.data.message || ''} rows={5} placeholder="Digite a mensagem..."
                onChange={(e) => onNodeDataChange(selectedNode.id, { message: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">{'{{lead.name}}'}, {'{{lead.phone}}'}</p>
            </div>
          )}

          {selectedNode.type === 'wait' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tempo de espera</Label>
                <div className="flex gap-2">
                  <Input type="number" min={1} value={selectedNode.data.wait_value || 1} className="w-20 h-9"
                    onChange={(e) => onNodeDataChange(selectedNode.id, { wait_value: parseInt(e.target.value) || 1 })} />
                  <Select value={selectedNode.data.wait_type || 'days'} onValueChange={(v) => onNodeDataChange(selectedNode.id, { wait_type: v })}>
                    <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[200]"><SelectItem value="seconds">Segundos</SelectItem><SelectItem value="minutes">Minutos</SelectItem><SelectItem value="hours">Horas</SelectItem><SelectItem value="days">Dias</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              {/* Stop on reply - moved here from sidebar */}
              <div className="space-y-2 pt-2 border-t border-white/[0.055]">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`stop-reply-${selectedNode.id}`}
                    checked={selectedNode.data.stop_on_reply === true}
                    onCheckedChange={(c) => onNodeDataChange(selectedNode.id, { stop_on_reply: c === true })}
                  />
                  <Label htmlFor={`stop-reply-${selectedNode.id}`} className="text-xs cursor-pointer">
                    Se o lead responder
                  </Label>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Cria duas saídas: &quot;Respondeu&quot; e &quot;Timeout&quot;. Configure ações diferentes para cada caminho.
                </p>
                {/* Legacy auto-reply message and stage move fields removed */}

              </div>
            </div>
          )}

          {selectedNode.type === 'image' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Galeria de Imagens</Label>
                <AutomationMediaGallery
                  mediaType="image"
                  accept="image/*"
                  selectedUrl={selectedNode.data.image_url || ''}
                  onSelect={(url) => onNodeDataChange(selectedNode.id, { image_url: url })}
                />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Ou cole uma URL</Label>
                <Input value={selectedNode.data.image_url || ''} placeholder="https://..." className="h-9" onChange={(e) => onNodeDataChange(selectedNode.id, { image_url: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Legenda</Label>
                <Input value={selectedNode.data.caption || ''} placeholder="Legenda" className="h-9" onChange={(e) => onNodeDataChange(selectedNode.id, { caption: e.target.value })} /></div>
            </div>
          )}

          {selectedNode.type === 'audio' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Gravar Áudio</Label>
                <AudioRecorderInline
                  onUploaded={(url) => onNodeDataChange(selectedNode.id, { audio_url: url, audio_type: 'voice' })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Galeria de Áudios</Label>
                <AutomationMediaGallery
                  mediaType="audio"
                  accept="audio/*"
                  selectedUrl={selectedNode.data.audio_url || ''}
                  onSelect={(url) => onNodeDataChange(selectedNode.id, { audio_url: url })}
                />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Ou cole uma URL</Label>
                <Input value={selectedNode.data.audio_url || ''} placeholder="https://..." className="h-9" onChange={(e) => onNodeDataChange(selectedNode.id, { audio_url: e.target.value })} /></div>
            </div>
          )}

          {selectedNode.type === 'video' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Galeria de Vídeos</Label>
                <AutomationMediaGallery
                  mediaType="video"
                  accept="video/*"
                  selectedUrl={selectedNode.data.video_url || ''}
                  onSelect={(url) => onNodeDataChange(selectedNode.id, { video_url: url })}
                />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Ou cole uma URL</Label>
                <Input value={selectedNode.data.video_url || ''} placeholder="https://..." className="h-9" onChange={(e) => onNodeDataChange(selectedNode.id, { video_url: e.target.value })} /></div>
            </div>
          )}

          {selectedNode.type === 'tag' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Ação</Label>
                <Select value={selectedNode.data.tag_action || 'add'} onValueChange={(v) => onNodeDataChange(selectedNode.id, { tag_action: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="add">Adicionar tag</SelectItem>
                    <SelectItem value="remove">Remover tag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tag</Label>
                <Select value={selectedNode.data.tag_id || ''} onValueChange={(v) => {
                  const selectedTag = tags?.find(t => t.id === v);
                  onNodeDataChange(selectedNode.id, { tag_id: v, tag_name: selectedTag?.name || '' });
                }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {(tags || []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color || '#888' }} />
                          {t.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Inline tag creation */}
              {!isCreatingTag ? (
                <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setIsCreatingTag(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Criar nova tag
                </Button>
              ) : (
                <div className="space-y-2 p-2 rounded-lg border border-white/[0.055] bg-white/[0.035]">
                  <Input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nome da tag..."
                    className="h-8 text-xs"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => { setIsCreatingTag(false); setNewTagName(''); }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      disabled={!newTagName.trim() || createTag.isPending}
                      onClick={async () => {
                        try {
                          const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
                          const created = await createTag.mutateAsync({ name: newTagName.trim(), color: randomColor });
                          onNodeDataChange(selectedNode.id, { tag_id: created.id, tag_name: created.name });
                          setNewTagName('');
                          setIsCreatingTag(false);
                        } catch {
                          // noop
                        }
                      }}
                    >
                      Criar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedNode.type === 'move_stage' && (
            <div className="space-y-3">
              {pipelines && pipelines.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Pipeline</Label>
                  <Select value={selectedNode.data.move_pipeline_id || ''} onValueChange={(v) => onNodeDataChange(selectedNode.id, { move_pipeline_id: v, move_stage_id: '' })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent className="z-[200]">
                      {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedNode.data.move_pipeline_id && stages && stages.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Etapa</Label>
                  <Select value={selectedNode.data.move_stage_id || ''} onValueChange={(v) => {
                    const selectedStage = stages.find(s => s.id === v);
                    onNodeDataChange(selectedNode.id, { move_stage_id: v, stage_name: selectedStage?.name || '' });
                  }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent className="z-[200]">
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color || '#888' }} />
                            {s.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {selectedNode.type === 'assign_user' && (
            <div className="space-y-3">
              {users && users.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Novo responsável</Label>
                  <Select value={selectedNode.data.assign_user_id || ''} onValueChange={(v) => {
                    const selectedUser = users.find(u => u.id === v);
                    onNodeDataChange(selectedNode.id, { assign_user_id: v, user_name: selectedUser?.name || selectedUser?.email || '' });
                  }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent className="z-[200]">
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {selectedNode.type === 'property_interest' && (
            <div className="space-y-3">
              <Label className="text-xs">Imóvel de interesse</Label>
              {selectedNode.data.property_name && (
                <p className="text-xs text-foreground font-medium">{selectedNode.data.property_name}</p>
              )}
              <PropertyPickerDialog
                properties={(properties || []).map(p => ({ id: p.id, code: p.code, title: p.title || 'Sem título', bairro: p.bairro, cidade: p.cidade, preco: p.preco, imagem_principal: p.imagem_principal, tipo_de_imovel: p.tipo_de_imovel, tipo_de_negocio: p.tipo_de_negocio, commission_percentage: p.commission_percentage }))}
                selectedPropertyId={selectedNode.data.property_id || null}
                onSelect={(prop) => {
                  onNodeDataChange(selectedNode.id, {
                    property_id: prop.id,
                    property_name: `${prop.code ? prop.code + ' - ' : ''}${prop.title || 'Sem título'}`,
                  });
                }}
                trigger={
                  <Button variant="outline" size="sm" className="w-full h-9 text-xs">
                    <Home className="h-3.5 w-3.5 mr-1.5" />
                    {selectedNode.data.property_id ? 'Trocar imóvel' : 'Selecionar imóvel'}
                  </Button>
                }
              />
            </div>
          )}

          {selectedNode.type === 'deal_status' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Novo status do lead</Label>
                <Select value={selectedNode.data.deal_status || ''} onValueChange={(v) => onNodeDataChange(selectedNode.id, { deal_status: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="open">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        Em aberto
                      </div>
                    </SelectItem>
                    <SelectItem value="won">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                        Ganho
                      </div>
                    </SelectItem>
                    <SelectItem value="lost">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        Perdido
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {selectedNode.type === 'condition' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de condição</Label>
                <Select value={selectedNode.data.condition_type || 'custom'} onValueChange={(v) => onNodeDataChange(selectedNode.id, { condition_type: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="response_sentiment">Resposta do lead (positiva/negativa)</SelectItem>
                    <SelectItem value="custom">Variável personalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(selectedNode.data.condition_type || 'custom') === 'response_sentiment' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground">
                    Analisa a última mensagem recebida do lead e classifica como positiva ou negativa.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-green-600 dark:text-green-400">Palavras positivas</Label>
                    <Textarea
                      value={selectedNode.data.positive_keywords || 'sim, claro, quero, pode, beleza, bora, vamos, aceito, ok, com certeza, fechado, top, pode ser, show, perfeito, ótimo, massa, interessado'}
                      onChange={(e) => onNodeDataChange(selectedNode.id, { positive_keywords: e.target.value })}
                      rows={3}
                      className="text-xs"
                      placeholder="sim, claro, quero, pode..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-red-600 dark:text-red-400">Palavras negativas</Label>
                    <Textarea
                      value={selectedNode.data.negative_keywords || 'não, nao, nope, sem interesse, desculpa, obrigado mas não, talvez não, deixa pra lá, não quero, não preciso, dispenso, valeu mas não, nunca, jamais, negativo'}
                      onChange={(e) => onNodeDataChange(selectedNode.id, { negative_keywords: e.target.value })}
                      rows={3}
                      className="text-xs"
                      placeholder="não, nao, sem interesse..."
                    />
                  </div>
                </div>
              )}

              {(selectedNode.data.condition_type || 'custom') === 'custom' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Variável</Label>
                    <Input value={selectedNode.data.variable || ''} placeholder="Ex: lead.source" className="h-9"
                      onChange={(e) => onNodeDataChange(selectedNode.id, { variable: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Operador</Label>
                    <Select value={selectedNode.data.operator || 'equals'} onValueChange={(v) => onNodeDataChange(selectedNode.id, { operator: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="z-[200]">
                        <SelectItem value="equals">Igual a</SelectItem>
                        <SelectItem value="not_equals">Diferente de</SelectItem>
                        <SelectItem value="contains">Contém</SelectItem>
                        <SelectItem value="not_contains">Não contém</SelectItem>
                        <SelectItem value="greater_than">Maior que</SelectItem>
                        <SelectItem value="less_than">Menor que</SelectItem>
                        <SelectItem value="is_set">Existe</SelectItem>
                        <SelectItem value="is_not_set">Não existe</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor</Label>
                    <Input value={selectedNode.data.value || ''} placeholder="Valor esperado" className="h-9"
                      onChange={(e) => onNodeDataChange(selectedNode.id, { value: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-white/[0.055] space-y-2">
            {onSaveNode && (
              <Button size="sm" className="w-full h-8 text-xs" onClick={onSaveNode}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Guardar
              </Button>
            )}
            <Button variant="destructive" size="sm" className="w-full h-8 text-xs" onClick={() => onDeleteNode(selectedNode.id)}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Remover nó
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
