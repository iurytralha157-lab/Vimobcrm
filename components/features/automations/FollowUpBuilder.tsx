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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Save,
  ArrowLeft,
  Loader2,
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
import { MessageSquare, Timer } from 'lucide-react';
import { MessageNode, WaitNode, StartNode, ImageNode, AudioNode, VideoNode, ConditionNode, WebhookNode, TagNode, MoveStageNode, AssignUserNode, PropertyInterestNode, DealStatusNode } from './nodes';
import { DEFAULT_ON_REPLY_MESSAGE } from './FollowUpTemplates';
import { NodeConfigPanel } from './NodeConfigPanel';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useTags } from '@/hooks/use-tags';
import { useStages, usePipelines } from '@/hooks/use-stages';
import { useCreateAutomation, useSaveAutomationFlow, TriggerType, ActionType } from '@/hooks/use-automations';
import { useUsers } from '@/hooks/use-users';
import { useProperties } from '@/hooks/use-properties';
import { toast } from 'sonner';
import DeletableEdge from './edges/DeletableEdge';
import { FlowSimulator } from './FlowSimulator';

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

interface FollowUpBuilderProps {
  onBack: () => void;
  onComplete: (automationId?: string) => void;
  initialTemplate?: {
    name: string;
    messages: { day: number; content: string }[];
    onReplyMessage?: string;
  } | null;
}

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
  { type: 'condition', label: 'Condição', icon: GitBranch, color: 'bg-yellow-500 text-white', category: 'conditionals', defaultData: { condition_type: 'custom', variable: '', operator: 'equals', value: '' } },
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

  const rawStageId = waitNodeWithReply?.data?.on_reply_stage_id || waitNodeWithReply?.data?.on_reply_move_to_stage_id;
  const normalizedStageId = typeof rawStageId === 'string' && rawStageId && rawStageId !== '__none__'
    ? rawStageId
    : null;

  const rawMessage = waitNodeWithReply?.data?.on_reply_message;
  const normalizedMessage = typeof rawMessage === 'string' && rawMessage.trim()
    ? rawMessage.trim()
    : null;

  return {
    hasWaitNodes: waitNodes.length > 0,
    stopOnReply: Boolean(waitNodeWithReply),
    onReplyMoveToStageId: normalizedStageId,
    onReplyMessage: normalizedMessage,
  };
}

function FollowUpBuilderInner({ onBack, onComplete, initialTemplate }: FollowUpBuilderProps) {
  const reactFlowInstance = useReactFlow();
  const { data: sessions } = useWhatsAppSessions();
  const { data: tags } = useTags();
  const { data: pipelines } = usePipelines();
  const { data: users } = useUsers();
  const { data: properties } = useProperties();
  const [pipelineId, setPipelineId] = useState<string>('');
  const { data: stages } = useStages(pipelineId || undefined);
  const createAutomation = useCreateAutomation();
  const saveFlow = useSaveAutomationFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Config
  const [name, setName] = useState(initialTemplate?.name || 'Meu Follow-up');
  const [sessionId, setSessionId] = useState<string>('');
  const [triggerType, setTriggerType] = useState<TriggerType>('tag_added');
  const [stageId, setStageId] = useState<string>('');
  const [tagId, setTagId] = useState<string>('');

  // New: User filter and stop on reply settings
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [stopOnReply] = useState<boolean>(true);
  const [onReplyStageId] = useState<string>('');
  const [showSimulator, setShowSimulator] = useState(false);
  const [, setSimulatorHighlightNodeId] = useState<string | null>(null);

  // Apply visual highlight to the active node on canvas
  const handleHighlightNode = useCallback((nodeId: string | null) => {
    setSimulatorHighlightNodeId(nodeId);
    if (nodeId === null) {
      // Clear all simulation classes
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
    bubbles: true,
    conditionals: true,
    actions: true,
  });
  const [onReplyMessage] = useState<string>(initialTemplate?.onReplyMessage || DEFAULT_ON_REPLY_MESSAGE);

  // Initialize flow with template or default
  useEffect(() => {
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];

    // Start node
    const startId = 'start-1';
    initialNodes.push({
      id: startId,
      type: 'start',
      position: { x: 250, y: 50 },
      data: { trigger_type: 'tag_added' },
    });

    if (initialTemplate?.messages && initialTemplate.messages.length > 0) {
      let previousId = startId;
      let yPos = 180;

      initialTemplate.messages.forEach((msg, index) => {
        const messageId = `message-${index + 1}`;
        initialNodes.push({
          id: messageId,
          type: 'message',
          position: { x: 250, y: yPos },
          data: { message: msg.content, day: msg.day },
        });

        initialEdges.push({
          id: `e-${previousId}-${messageId}`,
          source: previousId,
          target: messageId,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 2 },
        });

        previousId = messageId;
        yPos += 140;

        // Add wait node between messages (except last)
        if (index < initialTemplate.messages.length - 1) {
          const waitId = `wait-${index + 1}`;
          initialNodes.push({
            id: waitId,
            type: 'wait',
            position: { x: 250, y: yPos },
            data: { wait_type: 'days', wait_value: 1 },
          });

          initialEdges.push({
            id: `e-${previousId}-${waitId}`,
            source: previousId,
            target: waitId,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          });

          previousId = waitId;
          yPos += 120;
        }
      });
    } else {
      // Default: start + one message
      const messageId = 'message-1';
      initialNodes.push({
        id: messageId,
        type: 'message',
        position: { x: 250, y: 180 },
        data: { message: 'Olá {{lead.name}}! Como posso ajudar?', day: 1 },
      });

      initialEdges.push({
        id: `e-${startId}-${messageId}`,
        source: startId,
        target: messageId,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
      });
    }

    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialTemplate, setNodes, setEdges]);

  // No longer globally sync trigger type - each start node has its own config

  const handlePipelineIdChange = useCallback((nextPipelineId: string) => {
    setPipelineId(nextPipelineId);
    setStageId('');
  }, []);

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
    // Position the panel near the click, offset a bit to the right
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

    // For message nodes, set incrementing day
    if (paletteItem.type === 'message') {
      newNode.data.day = nodes.filter(n => n.type === 'message').length + 1;
    }

    setNodes((nds) => [...nds, newNode]);

    // Auto-connect to last node if exists
    if (lastNode && lastNode.type !== 'start') {
      const sourceHandle = lastNode.type === 'wait' ? 'no_reply' :
                          lastNode.type === 'condition' ? 'true' : null;

      const newEdge: Edge = {
        id: `e-${lastNode.id}-${newNodeId}`,
        source: lastNode.id,
        target: newNodeId,
        sourceHandle: sourceHandle,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2 },
      };
      setEdges((eds) => [...eds, newEdge]);
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

  // Save state to undo stack on meaningful changes
  useEffect(() => {
    if (isUndoingRef.current) { isUndoingRef.current = false; return; }
    if (nodes.length > 0 || edges.length > 0) {
      undoStackRef.current = [...undoStackRef.current.slice(-30), { nodes: nodes.map(n => ({ ...n })), edges: edges.map(e => ({ ...e })) }];
    }
  }, [nodes, edges]);

  // Ctrl+C / Ctrl+V / Ctrl+Z
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
          undoStackRef.current.pop(); // remove current
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

  // Drag & drop from palette
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
    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: { ...defaultData },
    };
    if (type === 'message') {
      newNode.data.day = nodes.filter(n => n.type === 'message').length + 1;
    }
    setNodes(nds => [...nds, newNode]);
  }, [reactFlowInstance, nodes, setNodes]);

  const handleSave = async () => {
    if (!sessionId) {
      toast.error('Selecione uma sessão WhatsApp');
      return;
    }

    if (!name.trim()) {
      toast.error('Digite um nome para o follow-up');
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
      const resolvedOnReplyStageId = shouldStopOnReply
        ? (waitReplyConfig.onReplyMoveToStageId ?? (onReplyStageId && onReplyStageId !== '__none__' ? onReplyStageId : null))
        : null;
      const resolvedOnReplyMessage = shouldStopOnReply
        ? (waitReplyConfig.onReplyMessage ?? (onReplyMessage?.trim() ? onReplyMessage.trim() : null))
        : null;

      // Create automation
      const automation = await createAutomation.mutateAsync({
        name,
        description: `Follow-up com ${messageNodes.length} mensagens`,
        trigger_type: triggerType,
        trigger_config: {
          ...(triggerType === 'tag_added' ? { tag_id: tagId } : {}),
          ...(triggerType === 'lead_stage_changed' ? {
            pipeline_id: pipelineId,
            to_stage_id: stageId
          } : {}),
          filter_user_id: filterUserId && filterUserId !== "__all__" ? filterUserId : null,
          stop_on_reply: shouldStopOnReply,
          on_reply_move_to_stage_id: resolvedOnReplyStageId,
          on_reply_message: resolvedOnReplyMessage,
        },
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
              trigger_type: triggerType, tag_id: tagId, pipeline_id: pipelineId, to_stage_id: stageId,
              filter_user_id: filterUserId && filterUserId !== "__all__" ? filterUserId : null,
              stop_on_reply: stopOnReply,
              on_reply_move_to_stage_id: stopOnReply && onReplyStageId && onReplyStageId !== "__none__" ? onReplyStageId : null,
              on_reply_message: stopOnReply && onReplyMessage?.trim() ? onReplyMessage.trim() : null,
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
            config: { session_id: sessionId, audio_url: node.data.audio_url, actionType: 'send_audio' },
            ...pos,
          });
        } else if (node.type === 'video') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'send_video',
            config: { session_id: sessionId, video_url: node.data.video_url, actionType: 'send_video' },
            ...pos,
          });
        } else if (node.type === 'wait') {
          const waitRawStageId = node.data.on_reply_stage_id || node.data.on_reply_move_to_stage_id;
          const waitStageId = typeof waitRawStageId === 'string' && waitRawStageId && waitRawStageId !== '__none__'
            ? waitRawStageId
            : null;
          const waitReplyMessage = typeof node.data.on_reply_message === 'string' && node.data.on_reply_message.trim()
            ? node.data.on_reply_message.trim()
            : null;

          dbNodes.push({
            id: node.id, node_type: 'delay', action_type: null,
            config: {
              delay_type: node.data.wait_type || 'days',
              delay_value: node.data.wait_value || 1,
              stop_on_reply: node.data.stop_on_reply || false,
              on_reply_message: waitReplyMessage,
              on_reply_stage_id: waitStageId,
              on_reply_move_to_stage_id: waitStageId,
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
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'add_tag',
            config: { tag_id: node.data.tag_id, tag_action: node.data.tag_action || 'add', actionType: node.data.tag_action === 'remove' ? 'remove_tag' : 'add_tag' },
            ...pos,
          });
        } else if (node.type === 'move_stage') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'move_lead',
            config: { pipeline_id: node.data.move_pipeline_id, stage_id: node.data.move_stage_id, actionType: 'move_stage' },
            ...pos,
          });
        } else if (node.type === 'assign_user') {
          dbNodes.push({
            id: node.id, node_type: 'action', action_type: 'assign_user',
            config: { user_id: node.data.assign_user_id, actionType: 'assign_user' },
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
        automationId: automation.id,
        nodes: dbNodes.map(n => ({
          id: n.id,
          automation_id: automation.id,
          node_type: n.node_type,
          action_type: n.action_type,
          config: n.config as unknown as import('@/integrations/supabase/types').Json,
          position_x: n.position_x,
          position_y: n.position_y,
        })),
        connections: dbConnections.map(c => ({
          automation_id: automation.id,
          ...c,
        })),
      });

      toast.success('Follow-up criado com sucesso!');
      onComplete(automation.id);
    } catch (error) {
      console.error('Error saving follow-up:', error);
      toast.error('Erro ao salvar follow-up');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--app-surface)] text-foreground rounded-2xl border border-white/[0.055]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/[0.055] automation-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="text-muted-foreground hover:text-foreground hover:bg-white/[0.06]">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-semibold h-8 w-auto min-w-[200px] border-none focus-visible:ring-1 bg-transparent text-foreground placeholder:text-muted-foreground"
              placeholder="Nome do follow-up"
            />
          </div>
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

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Typebot-style Node Palette */}
        <div className="w-64 border-r border-white/[0.055] automation-sidebar flex flex-col">
          <ScrollArea className="flex-1">
             <div className="p-3 space-y-1">
              {/* Node Categories - Typebot Style */}
              {(['bubbles', 'conditionals', 'actions'] as NodeCategory[]).map((category) => {
                const items = NODE_PALETTE.filter(item => item.category === category);
                const isExpanded = expandedCategories[category];

                return (
                  <div key={category}>
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium hover:bg-white/[0.055] transition-colors"
                      onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className={CATEGORY_COLORS[category]}>{CATEGORY_LABELS[category]}</span>
                    </button>

                    {isExpanded && (
                      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
                        {items.map((item, idx) => {
                          const Icon = item.icon;
                          return (
                            <div
                              key={`${item.type}-${item.label}-${idx}`}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('application/reactflow-type', item.type);
                                e.dataTransfer.setData('application/reactflow-data', JSON.stringify(item.defaultData));
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.055] bg-white/[0.045] hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all text-left group cursor-grab active:cursor-grabbing"
                              onClick={() => handleAddNode(item)}
                            >
                              <div className={`p-1 rounded-lg ${item.color}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <span className="text-xs font-medium truncate text-foreground group-hover:text-white">{item.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Variables Help */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium hover:bg-white/[0.055] transition-colors text-muted-foreground"
                onClick={() => {}}
              >
                📋 Variáveis
              </button>
              <div className="px-3 pb-2 text-xs text-muted-foreground space-y-0.5">
                <code className="block bg-white/[0.06] px-1.5 py-0.5 rounded text-[10px] text-foreground">{'{{lead.name}}'}</code>
                <code className="block bg-white/[0.06] px-1.5 py-0.5 rounded text-[10px] text-foreground">{'{{lead.phone}}'}</code>
                <code className="block bg-white/[0.06] px-1.5 py-0.5 rounded text-[10px] text-foreground">{'{{lead.email}}'}</code>
                <code className="block bg-white/[0.06] px-1.5 py-0.5 rounded text-[10px] text-foreground">{'{{organization.name}}'}</code>
                <code className="block bg-white/[0.06] px-1.5 py-0.5 rounded text-[10px] text-foreground">{'{{date}}'}</code>
              </div>
            </div>
          </ScrollArea>
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
            <Panel position="bottom-center" className="!bg-[var(--app-surface)] rounded-xl px-4 py-2.5 text-xs text-muted-foreground border border-white/[0.055]">
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
              setTriggerType={setTriggerType}
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

export function FollowUpBuilder(props: FollowUpBuilderProps) {
  return (
    <ReactFlowProvider>
      <FollowUpBuilderInner {...props} />
    </ReactFlowProvider>
  );
}
