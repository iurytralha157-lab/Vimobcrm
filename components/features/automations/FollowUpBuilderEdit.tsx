import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  BackgroundVariant,
  Panel,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Save,
  ArrowLeft,
  Loader2,
  MessageSquare,
  Timer,
  Play,
  Image,
  Headphones,
  Video,
  GitBranch,
  Webhook,
  Tag,
  ArrowRightLeft,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Home,
  CircleDot,
} from 'lucide-react';
import { NodeConfigPanel } from './NodeConfigPanel';
import { MessageNode } from './nodes/MessageNode';
import { WaitNode } from './nodes/WaitNode';
import { StartNode } from './nodes/StartNode';
import { ImageNode } from './nodes/ImageNode';
import { AudioNode } from './nodes/AudioNode';
import { VideoNode } from './nodes/VideoNode';
import { ConditionNode } from './nodes/ConditionNode';
import { WebhookNode } from './nodes/WebhookNode';
import { TagNode } from './nodes/TagNode';
import { MoveStageNode } from './nodes/MoveStageNode';
import { AssignUserNode } from './nodes/AssignUserNode';
import { PropertyInterestNode } from './nodes/PropertyInterestNode';
import { DealStatusNode } from './nodes/DealStatusNode';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useTags } from '@/hooks/use-tags';
import { useStages, usePipelines } from '@/hooks/use-stages';
import {
  useAutomation,
  useUpdateAutomation,
  useSaveAutomationFlow,
  TriggerType,
  ActionType,
} from '@/hooks/use-automations';
import { useUsers } from '@/hooks/use-users';
import { useProperties } from '@/hooks/use-properties';
import { toast } from 'sonner';
import DeletableEdge from './edges/DeletableEdge';
import { FlowSimulator } from './FlowSimulator';
import type { Json } from '@/integrations/supabase/types';

const edgeTypes = {
  deletable: DeletableEdge,
};

const nodeTypes = {
  start: StartNode,
  message: MessageNode,
  wait: WaitNode,
  image: ImageNode,
  audio: AudioNode,
  video: VideoNode,
  condition: ConditionNode,
  webhook: WebhookNode,
  tag: TagNode,
  move_stage: MoveStageNode,
  assign_user: AssignUserNode,
  property_interest: PropertyInterestNode,
  deal_status: DealStatusNode,
};

type NodeCategory = 'bubbles' | 'conditionals' | 'actions';

interface PaletteItem {
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  category: NodeCategory;
  defaultData: Record<string, unknown>;
}

const NODE_PALETTE: PaletteItem[] = [
  { type: 'start', label: 'Início', icon: Play, color: 'bg-orange-500 text-white', category: 'actions', defaultData: { trigger_type: 'manual' } },
  { type: 'message', label: 'Texto', icon: MessageSquare, color: 'bg-green-500 text-white', category: 'bubbles', defaultData: { message: 'Nova mensagem...', day: 1 } },
  { type: 'image', label: 'Imagem', icon: Image, color: 'bg-blue-500 text-white', category: 'bubbles', defaultData: { image_url: '', caption: '' } },
  { type: 'video', label: 'Vídeo', icon: Video, color: 'bg-rose-500 text-white', category: 'bubbles', defaultData: { video_url: '' } },
  { type: 'audio', label: 'Áudio', icon: Headphones, color: 'bg-amber-500 text-white', category: 'bubbles', defaultData: { audio_url: '' } },
  { type: 'condition', label: 'Condição', icon: GitBranch, color: 'bg-yellow-500 text-white', category: 'conditionals', defaultData: { variable: '', operator: 'equals', value: '' } },
  { type: 'wait', label: 'Espera', icon: Timer, color: 'bg-purple-500 text-white', category: 'actions', defaultData: { wait_type: 'days', wait_value: 1 } },
  { type: 'webhook', label: 'Webhook', icon: Webhook, color: 'bg-indigo-500 text-white', category: 'actions', defaultData: { webhook_url: '', method: 'POST' } },
  { type: 'tag', label: 'Tag', icon: Tag, color: 'bg-teal-500 text-white', category: 'actions', defaultData: { tag_id: '', tag_action: 'add' } },
  { type: 'move_stage', label: 'Mudar Etapa', icon: ArrowRightLeft, color: 'bg-violet-500 text-white', category: 'actions', defaultData: { move_pipeline_id: '', move_stage_id: '' } },
  { type: 'assign_user', label: 'Responsável', icon: UserCheck, color: 'bg-sky-500 text-white', category: 'actions', defaultData: { assign_user_id: '' } },
  { type: 'property_interest', label: 'Imóvel Interesse', icon: Home, color: 'bg-emerald-500 text-white', category: 'actions', defaultData: { property_id: '', property_name: '' } },
  { type: 'deal_status', label: 'Status', icon: CircleDot, color: 'bg-pink-500 text-white', category: 'actions', defaultData: { deal_status: '' } },
];

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  bubbles: 'Bubbles',
  conditionals: 'Condicionais',
  actions: 'Ações',
};

const CATEGORY_COLORS: Record<NodeCategory, string> = {
  bubbles: 'text-green-500',
  conditionals: 'text-yellow-500',
  actions: 'text-purple-500',
};

function getWaitReplyConfig(flowNodes: Node[]) {
  const waitNodes = flowNodes.filter((node) => node.type === 'wait');
  const waitNodeWithReply = waitNodes.find((node) => node.data?.stop_on_reply === true);

  return {
    hasWaitNodes: waitNodes.length > 0,
    stopOnReply: Boolean(waitNodeWithReply),
  };
}


interface FollowUpBuilderEditProps {
  automationId: string;
  onBack: () => void;
  onComplete: (automationId?: string) => void;
}

function FollowUpBuilderEditInner({ automationId, onBack, onComplete }: FollowUpBuilderEditProps) {
  const reactFlowInstance = useReactFlow();
  const { data: automation, isLoading: isLoadingAutomation } = useAutomation(automationId);
  const { data: sessions } = useWhatsAppSessions();
  const { data: tags } = useTags();
  const { data: pipelines } = usePipelines();
  const { data: users } = useUsers();
  const { data: properties } = useProperties();
  const [pipelineId, setPipelineId] = useState<string>('');
  const { data: stages } = useStages(pipelineId || undefined);
  const updateAutomation = useUpdateAutomation();
  const saveFlow = useSaveAutomationFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initialPipelineId, setInitialPipelineId] = useState<string | null>(null);

  // Config
  const [name, setName] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [triggerType, setTriggerType] = useState<TriggerType>('tag_added');
  const [stageId, setStageId] = useState<string>('');
  const [tagId, setTagId] = useState<string>('');

  // New: User filter and stop on reply settings
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [stopOnReply, setStopOnReply] = useState<boolean>(true);


  const [isActive, setIsActive] = useState<boolean>(true);
  const [showSimulator, setShowSimulator] = useState(false);
  const [, setSimulatorHighlightNodeId] = useState<string | null>(null);

  const handleHighlightNode = useCallback((nodeId: string | null) => {
    setSimulatorHighlightNodeId(nodeId);
    if (nodeId === null) {
      setNodes((nds) => nds.map((n) => ({ ...n, className: undefined })));
    } else {
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          className: n.id === nodeId ? 'sim-active-node' : (n.className === 'sim-active-node' ? 'sim-visited-node' : n.className),
        }))
      );
    }
  }, [setNodes]);

  const [expandedCategories, setExpandedCategories] = useState<Record<NodeCategory, boolean>>({
    bubbles: true, conditionals: true, actions: true,
  });
  // Load automation data
  /* eslint-disable react-hooks/set-state-in-effect -- Hydrates the editable draft once async automation data is available. */
  useEffect(() => {
    if (automation && !isInitialized) {
      setName(automation.name || '');
      setIsActive(automation.is_active);
      setTriggerType(automation.trigger_type as TriggerType);

      const config = automation.trigger_config as Record<string, unknown> || {};
      if (config.tag_id) setTagId(config.tag_id as string);
      if (config.pipeline_id) {
        setPipelineId(config.pipeline_id as string);
        setInitialPipelineId(config.pipeline_id as string);
      }
      if (config.to_stage_id) setStageId(config.to_stage_id as string);
      if (config.filter_user_id) setFilterUserId(config.filter_user_id as string);
      if (typeof config.stop_on_reply === 'boolean') setStopOnReply(config.stop_on_reply);
      // Load nodes and edges
      const flowNodes: Node[] = [];
      const flowEdges: Edge[] = [];

       automation.nodes?.forEach((node) => {
        const nodeConfig = node.config as Record<string, unknown> || {};
        const pos = { x: node.position_x || 250, y: node.position_y || 180 };

        if (node.node_type === 'trigger') {
          flowNodes.push({
            id: node.id,
            type: 'start',
            position: { x: pos.x, y: node.position_y || 50 },
            data: {
              trigger_type: automation.trigger_type,
              source: nodeConfig.source || config.source, // Try both node config and trigger config
              meta_form_id: nodeConfig.meta_form_id || config.meta_form_id
            }
          });
          if (nodeConfig.session_id) setSessionId(nodeConfig.session_id as string);
        } else if (node.node_type === 'action' && node.action_type === 'send_whatsapp') {
          flowNodes.push({ id: node.id, type: 'message', position: pos, data: { message: nodeConfig.message || '', day: nodeConfig.day || 1 } });
          if (nodeConfig.session_id) {
            setSessionId((current) => current || (nodeConfig.session_id as string));
          }
        } else if (node.node_type === 'action' && node.action_type === 'send_image') {
          flowNodes.push({ id: node.id, type: 'image', position: pos, data: { image_url: nodeConfig.image_url || '', caption: nodeConfig.caption || '' } });
        } else if (node.node_type === 'action' && node.action_type === 'send_audio') {
          flowNodes.push({ id: node.id, type: 'audio', position: pos, data: { audio_url: nodeConfig.audio_url || '', audio_type: nodeConfig.audio_type || 'file' } });
        } else if (node.node_type === 'action' && node.action_type === 'send_video') {
          flowNodes.push({ id: node.id, type: 'video', position: pos, data: { video_url: nodeConfig.video_url || '' } });
        } else if (node.node_type === 'action' && node.action_type === 'webhook') {
          flowNodes.push({ id: node.id, type: 'webhook', position: pos, data: { webhook_url: nodeConfig.webhook_url || '', method: nodeConfig.method || 'POST' } });
        } else if (node.node_type === 'action' && (node.action_type === 'add_tag' || node.action_type === 'remove_tag')) {
          flowNodes.push({ id: node.id, type: 'tag', position: pos, data: { tag_id: nodeConfig.tag_id || '', tag_action: nodeConfig.tag_action || 'add', tag_name: nodeConfig.tag_name || '' } });
        } else if (node.node_type === 'action' && node.action_type === 'move_lead') {
          flowNodes.push({ id: node.id, type: 'move_stage', position: pos, data: { move_pipeline_id: nodeConfig.pipeline_id || '', move_stage_id: nodeConfig.stage_id || '', stage_name: nodeConfig.stage_name || '' } });
        } else if (node.node_type === 'action' && node.action_type === 'assign_user') {
          flowNodes.push({ id: node.id, type: 'assign_user', position: pos, data: { assign_user_id: nodeConfig.user_id || '', user_name: nodeConfig.user_name || '' } });
        } else if (node.node_type === 'action' && nodeConfig.actionType === 'property_interest') {
          flowNodes.push({ id: node.id, type: 'property_interest', position: pos, data: { property_id: nodeConfig.property_id || '', property_name: nodeConfig.property_name || '' } });
        } else if (node.node_type === 'action' && nodeConfig.actionType === 'deal_status') {
          flowNodes.push({ id: node.id, type: 'deal_status', position: pos, data: { deal_status: nodeConfig.deal_status || '' } });
        } else if (node.node_type === 'condition') {
          flowNodes.push({ id: node.id, type: 'condition', position: pos, data: {
            condition_type: nodeConfig.condition_type || 'custom',
            variable: nodeConfig.variable || '',
            operator: nodeConfig.operator || 'equals',
            value: nodeConfig.value || '',
            positive_keywords: nodeConfig.positive_keywords || '',
            negative_keywords: nodeConfig.negative_keywords || '',
          } });
        } else if (node.node_type === 'delay') {
          flowNodes.push({
            id: node.id,
            type: 'wait',
            position: pos,
            data: {
              wait_type: nodeConfig.delay_type || 'days',
              wait_value: nodeConfig.delay_value || 1,
              stop_on_reply: nodeConfig.stop_on_reply || false,
              on_reply_message: nodeConfig.on_reply_message || '',
              on_reply_stage_id: nodeConfig.on_reply_stage_id || nodeConfig.on_reply_move_to_stage_id || '',
            },
          });
        }
      });

      automation.connections?.forEach((conn) => {
        flowEdges.push({
          id: conn.id,
          source: conn.source_node_id,
          target: conn.target_node_id,
          sourceHandle: conn.source_handle || undefined,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 2 },
        });
      });

      setNodes(flowNodes);
      setEdges(flowEdges);
      setIsInitialized(true);
    }
  }, [automation, isInitialized, setNodes, setEdges]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTriggerTypeChange = useCallback((nextTriggerType: TriggerType) => {
    setTriggerType(nextTriggerType);
    if (isInitialized) {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.type === 'start') {
            return { ...node, data: { ...node.data, trigger_type: nextTriggerType } };
          }
          return node;
        })
      );
    }
  }, [isInitialized, setNodes]);

  const handlePipelineIdChange = useCallback((nextPipelineId: string) => {
    setPipelineId(nextPipelineId);

    if (isInitialized && (initialPipelineId === null || nextPipelineId !== initialPipelineId)) {
      setStageId('');
    }

    if (isInitialized && initialPipelineId && nextPipelineId !== initialPipelineId) {
      setInitialPipelineId(null);
    }
  }, [initialPipelineId, isInitialized]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, [setEdges]);

  const edgesWithDelete = useMemo(() =>
    edges.map((e) => ({
      ...e,
      type: 'deletable',
      data: { ...e.data, onDelete: handleDeleteEdge },
    })),
    [edges, handleDeleteEdge]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({
        ...params,
        type: 'deletable',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
      }, eds));
    },
    [setEdges]
  );

  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    const rect = (event.currentTarget as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
    if (rect) {
      const x = event.clientX - rect.left + 20;
      const y = event.clientY - rect.top - 20;
      setPanelPosition({ x: Math.min(x, rect.width - 320), y: Math.max(0, Math.min(y, rect.height - 300)) });
    }
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleAddNode = useCallback((paletteItem: PaletteItem) => {
    const lastNode = nodes[nodes.length - 1];
    const newX = lastNode ? lastNode.position.x + 300 : 250;
    const newY = lastNode ? lastNode.position.y : 200;
    const newNodeId = `${paletteItem.type}-${Date.now()}`;
    const newNode: Node = {
      id: newNodeId,
      type: paletteItem.type,
      position: { x: newX, y: newY },
      data: { ...paletteItem.defaultData },
    };
    if (paletteItem.type === 'message') {
      newNode.data.day = nodes.filter(n => n.type === 'message').length + 1;
    }
    setNodes((nds) => [...nds, newNode]);
    if (lastNode && lastNode.type !== 'start') {
      setEdges((eds) => [...eds, {
        id: `e-${lastNode.id}-${newNodeId}`,
        source: lastNode.id,
        target: newNodeId,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
      }]);
    }
  }, [nodes, setNodes, setEdges]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const handleNodeDataChange = useCallback((nodeId: string, data: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, ...data } };
        }
        return node;
      })
    );
    setSelectedNode((prev) => prev && prev.id === nodeId
      ? { ...prev, data: { ...prev.data, ...data } }
      : prev
    );
  }, [setNodes]);

  // Undo history
  const undoStackRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const isUndoingRef = useRef(false);

  useEffect(() => {
    if (isUndoingRef.current) { isUndoingRef.current = false; return; }
    if (nodes.length > 0 || edges.length > 0) {
      undoStackRef.current = [...undoStackRef.current.slice(-30), { nodes: nodes.map(n => ({ ...n })), edges: edges.map(e => ({ ...e })) }];
    }
  }, [nodes, edges]);

  const clipboardRef = useRef<Node[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const selected = nodes.filter(n => n.selected);
        if (selected.length > 0) {
          clipboardRef.current = selected;
          toast.success(`${selected.length} nó(s) copiado(s)`);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardRef.current.length > 0) {
          const newNodes: Node[] = clipboardRef.current.map(n => ({
            ...n,
            id: `${n.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            position: { x: n.position.x + 50, y: n.position.y + 80 },
            selected: false,
            data: { ...n.data },
          }));
          setNodes(nds => [...nds, ...newNodes]);
          toast.success(`${newNodes.length} nó(s) colado(s)`);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (undoStackRef.current.length > 1) {
          undoStackRef.current.pop();
          const prev = undoStackRef.current[undoStackRef.current.length - 1];
          if (prev) {
            isUndoingRef.current = true;
            setNodes(prev.nodes);
            setEdges(prev.edges);
            toast.success('Ação desfeita');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, setNodes, setEdges]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/reactflow-type');
    const dataStr = e.dataTransfer.getData('application/reactflow-data');
    if (!type) return;
    const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const defaultData = dataStr ? JSON.parse(dataStr) : {};
    const newNode: Node = { id: `${type}-${Date.now()}`, type, position, data: { ...defaultData } };
    if (type === 'message') newNode.data.day = nodes.filter(n => n.type === 'message').length + 1;
    setNodes(nds => [...nds, newNode]);
  }, [reactFlowInstance, nodes, setNodes]);

  const handleSave = async () => {
    if (!sessionId) {
      toast.error('Selecione uma sessão WhatsApp');
      return;
    }

    if (!name.trim()) {
      toast.error('Digite um nome para a automação');
      return;
    }

    if (triggerType === 'tag_added' && !tagId) {
      toast.error('Selecione uma tag para o gatilho');
      return;
    }

    if (triggerType === 'lead_stage_changed' && !pipelineId) {
      toast.error('Selecione uma pipeline para o gatilho');
      return;
    }

    if (triggerType === 'lead_stage_changed' && !stageId) {
      toast.error('Selecione uma etapa para o gatilho');
      return;
    }

    const messageNodes = nodes.filter(n => n.type === 'message');
    if (messageNodes.length === 0) {
      toast.error('Adicione pelo menos uma mensagem');
      return;
    }

    setIsSaving(true);

    try {
      const waitReplyConfig = getWaitReplyConfig(nodes);
      const shouldStopOnReply = waitReplyConfig.hasWaitNodes ? waitReplyConfig.stopOnReply : stopOnReply;


      // Find the start node to get its data (source, meta_form_id)
      const startNode = nodes.find(n => n.type === 'start');
      const startNodeData = startNode?.data || {};
      const startSource = typeof startNodeData.source === 'string' ? startNodeData.source : null;
      const startMetaFormId = typeof startNodeData.meta_form_id === 'string' ? startNodeData.meta_form_id : null;
      const triggerConfig: Json = {
        ...(triggerType === 'tag_added' ? { tag_id: tagId } : {}),
        ...(triggerType === 'lead_stage_changed' ? {
          pipeline_id: pipelineId,
          to_stage_id: stageId
        } : {}),
        ...(triggerType === 'lead_created' ? {
          source: startSource,
          meta_form_id: startMetaFormId
        } : {}),
        filter_user_id: filterUserId && filterUserId !== "__all__" ? filterUserId : null,
        stop_on_reply: shouldStopOnReply,
        on_reply_move_to_stage_id: null,
        on_reply_message: null,
      };

      // Update automation
      await updateAutomation.mutateAsync({
        id: automationId,
        name,
        is_active: isActive,
        description: `Follow-up com ${messageNodes.length} mensagens`,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
      });

      // Build nodes for database
      const dbNodes: {
        id: string;
        node_type: 'trigger' | 'action' | 'delay' | 'condition';
        action_type: import('@/hooks/use-automations').ActionType | null;
        config: Record<string, unknown>;
        position_x: number;
        position_y: number;
      }[] = [];

      nodes.forEach((node) => {
        const pos = { position_x: Math.round(node.position.x), position_y: Math.round(node.position.y) };

        if (node.type === 'start') {
          dbNodes.push({
            id: node.id, node_type: 'trigger', action_type: null,
            config: {
              trigger_type: triggerType,
              tag_id: tagId,
              pipeline_id: pipelineId,
              to_stage_id: stageId,
              source: node.data.source || null,
              meta_form_id: node.data.meta_form_id || null,
              filter_user_id: filterUserId && filterUserId !== "__all__" ? filterUserId : null,
              stop_on_reply: stopOnReply,
              on_reply_move_to_stage_id: null,
              on_reply_message: null,

            },
            ...pos,
          });
        } else if (node.type === 'message') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'send_whatsapp',
            config: { session_id: sessionId, message: node.data.message, actionType: 'send_whatsapp' },
            ...pos,
          });
        } else if (node.type === 'image') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'send_image',
            config: { session_id: sessionId, image_url: node.data.image_url, caption: node.data.caption, actionType: 'send_image' },
            ...pos,
          });
        } else if (node.type === 'audio') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'send_audio',
            config: { session_id: sessionId, audio_url: node.data.audio_url, audio_type: node.data.audio_type || 'file', actionType: 'send_audio' },
            ...pos,
          });
        } else if (node.type === 'video') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'send_video',
            config: { session_id: sessionId, video_url: node.data.video_url, actionType: 'send_video' },
            ...pos,
          });
        } else if (node.type === 'wait') {

          dbNodes.push({
            id: node.id, node_type: 'delay', action_type: null,
            config: {
              delay_type: node.data.wait_type || 'days',
              delay_value: node.data.wait_value || 1,
              stop_on_reply: node.data.stop_on_reply || false,
              on_reply_message: null,
              on_reply_stage_id: null,
              on_reply_move_to_stage_id: null,

              nodeType: 'delay',
            },
            ...pos,
          });
        } else if (node.type === 'condition') {
          dbNodes.push({
            id: node.id, node_type: 'condition', action_type: null,
            config: {
              condition_type: node.data.condition_type || 'custom',
              variable: node.data.variable,
              operator: node.data.operator,
              value: node.data.value,
              positive_keywords: node.data.positive_keywords || '',
              negative_keywords: node.data.negative_keywords || '',
              nodeType: 'condition',
            },
            ...pos,
          });
        } else if (node.type === 'webhook') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'webhook',
            config: { webhook_url: node.data.webhook_url, method: node.data.method, actionType: 'webhook' },
            ...pos,
          });
        } else if (node.type === 'tag') {
          const selectedTag = tags?.find(t => t.id === node.data.tag_id);
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: node.data.tag_action === 'remove' ? 'remove_tag' : 'add_tag',
            config: { tag_id: node.data.tag_id, tag_action: node.data.tag_action || 'add', tag_name: selectedTag?.name || '', actionType: node.data.tag_action === 'remove' ? 'remove_tag' : 'add_tag' },
            ...pos,
          });
        } else if (node.type === 'move_stage') {
          const selectedStage = stages?.find(s => s.id === node.data.move_stage_id);
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'move_lead',
            config: { pipeline_id: node.data.move_pipeline_id, stage_id: node.data.move_stage_id, stage_name: selectedStage?.name || '', actionType: 'move_stage' },
            ...pos,
          });
        } else if (node.type === 'assign_user') {
          const selectedUser = users?.find(u => u.id === node.data.assign_user_id);
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'assign_user',
            config: { user_id: node.data.assign_user_id, user_name: selectedUser?.name || selectedUser?.email || '', actionType: 'assign_user' },
            ...pos,
          });
        } else if (node.type === 'property_interest') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'set_variable' as ActionType,
            config: { property_id: node.data.property_id, property_name: node.data.property_name || '', actionType: 'property_interest' },
            ...pos,
          });
        } else if (node.type === 'deal_status') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'set_variable' as ActionType,
            config: { deal_status: node.data.deal_status, actionType: 'deal_status' },
            ...pos,
          });
        }
      });

      // Build connections - preserve source_handle for conditional branching
      const dbConnections = edges.map((edge) => ({
        source_node_id: edge.source,
        target_node_id: edge.target,
        source_handle: edge.sourceHandle || null,
        condition_branch: edge.sourceHandle || 'default',
      }));

      await saveFlow.mutateAsync({
        automationId,
        nodes: dbNodes.map(n => ({
          id: n.id,
          automation_id: automationId,
          node_type: n.node_type,
          action_type: n.action_type,
          config: n.config as unknown as Json,
          position_x: n.position_x,
          position_y: n.position_y,
        })),
        connections: dbConnections.map(c => ({
          automation_id: automationId,
          ...c,
        })),
      });

      toast.success('Automação salva com sucesso!');
      onComplete(automationId);
    } catch (error) {
      console.error('Error saving automation:', error);
      toast.error('Erro ao salvar automação');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingAutomation) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!automation) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Automação não encontrada</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="automation-builder-shell flex h-full flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface)] text-foreground">
      {/* Header */}
      <div className="automation-header flex items-center justify-between bg-[var(--app-surface)] p-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 min-w-[220px] rounded-[8px] border-0 bg-[var(--app-background)] px-3 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus-visible:ring-1"
              placeholder="Nome da automação"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-background)] px-3 py-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-green-500' : 'text-muted-foreground'}`}>
              {isActive ? 'Ativa' : 'Inativa'}
            </span>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              className="scale-75 data-[state=checked]:bg-green-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showSimulator ? "default" : "outline"}
              onClick={() => setShowSimulator(!showSimulator)}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Preview
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Typebot-style */}
        <div className="automation-sidebar flex w-64 flex-col bg-[var(--app-surface-muted)]">
          <div className="automation-sidebar-scroll flex-1 overflow-y-auto overscroll-contain">
            <div className="space-y-1 p-3">
              {(['bubbles', 'conditionals', 'actions'] as NodeCategory[]).map((category) => {
                const items = NODE_PALETTE.filter(item => item.category === category);
                const isExpanded = expandedCategories[category];
                return (
                  <div key={category}>
                    <button className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--app-surface-hover)]"
                      onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className={CATEGORY_COLORS[category]}>{CATEGORY_LABELS[category]}</span>
                    </button>
                    {isExpanded && (
                      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                        {items.map((item, idx) => {
                          const Icon = item.icon;
                          return (
                            <div key={`${item.type}-${item.label}-${idx}`}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('application/reactflow-type', item.type);
                                e.dataTransfer.setData('application/reactflow-data', JSON.stringify(item.defaultData));
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              className="automation-palette-card group flex cursor-grab items-center gap-2 rounded-[8px] px-3 py-2.5 text-left transition-all hover:bg-primary/10 active:cursor-grabbing"
                              onClick={() => handleAddNode(item)}>
                              <div className={`rounded-[6px] p-1 ${item.color}`}><Icon className="h-3.5 w-3.5" /></div>
                              <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <button className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-[var(--app-surface-hover)]">
                📋 Variáveis
              </button>
              <div className="px-3 pb-2 text-xs text-muted-foreground space-y-0.5">
                <code className="block rounded-[4px] bg-[var(--app-surface-hover)] px-1.5 py-0.5 text-[10px] text-foreground">{'{{lead.name}}'}</code>
                <code className="block rounded-[4px] bg-[var(--app-surface-hover)] px-1.5 py-0.5 text-[10px] text-foreground">{'{{lead.phone}}'}</code>
                <code className="block rounded-[4px] bg-[var(--app-surface-hover)] px-1.5 py-0.5 text-[10px] text-foreground">{'{{lead.email}}'}</code>
                <code className="block rounded-[4px] bg-[var(--app-surface-hover)] px-1.5 py-0.5 text-[10px] text-foreground">{'{{organization.name}}'}</code>
              </div>
            </div>
          </div>
        </div>

        {/* Flow Editor */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edgesWithDelete}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            className="automation-canvas"
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
            <Panel position="bottom-center" className="rounded-[8px] border-0 !bg-[var(--app-surface)] px-4 py-2.5 text-xs text-muted-foreground shadow-sm">
              Arraste para conectar • Clique para editar • Ctrl+C/V para copiar/colar
            </Panel>
          </ReactFlow>
        </div>

        {/* Flow Simulator */}
        {showSimulator && (
          <FlowSimulator
            nodes={nodes}
            edges={edges}
            onClose={() => { setShowSimulator(false); handleHighlightNode(null); }}
            onHighlightNode={handleHighlightNode}
          />
        )}

        {selectedNode && (
            <NodeConfigPanel
              key={`${selectedNode.id}-${panelPosition?.x ?? 0}-${panelPosition?.y ?? 0}`}
              selectedNode={selectedNode}
              onClose={() => setSelectedNode(null)}
              onNodeDataChange={handleNodeDataChange}
              onDeleteNode={handleDeleteNode}
              onSaveNode={() => { toast.success('Configuração do nó guardada'); setSelectedNode(null); }}
              triggerType={triggerType}
              setTriggerType={handleTriggerTypeChange}
              tags={tags || []}
              tagId={tagId}
              setTagId={setTagId}
              pipelines={pipelines || []}
              pipelineId={pipelineId}
              setPipelineId={handlePipelineIdChange}
              stages={stages || []}
              stageId={stageId}
              setStageId={setStageId}
              position={panelPosition || undefined}
              sessions={sessions || []}
              sessionId={sessionId}
              setSessionId={setSessionId}
              users={users || []}
              filterUserId={filterUserId}
              setFilterUserId={setFilterUserId}
              properties={properties || []}
            />
        )}
      </div>
    </div>
  );
}

export function FollowUpBuilderEdit(props: FollowUpBuilderEditProps) {
  return (
    <ReactFlowProvider>
      <FollowUpBuilderEditInner {...props} />
    </ReactFlowProvider>
  );
}
