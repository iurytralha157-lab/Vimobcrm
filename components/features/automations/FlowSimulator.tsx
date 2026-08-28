import { useState, useCallback, useEffect, useRef } from 'react';
import NextImage from 'next/image';
import { Node, Edge } from 'reactflow';
import { X, RotateCcw, Globe, Image as ImageIcon, Headphones, Video, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createClientId } from '@/lib/client-id';
import {
  AUTOMATION_CUSTOM_VARIABLES,
  evaluateAutomationCondition,
  renderAutomationTemplate,
  resolveReplyKeywordConfig,
  unknownAutomationTemplateVariables,
} from '@/lib/automations';

interface SimMessage {
  id: string;
  type: 'bot' | 'user' | 'system';
  content: string;
  mediaType?: 'image' | 'audio' | 'video';
  mediaUrl?: string;
  timestamp: Date;
}

interface FlowSimulatorProps {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onHighlightNode?: (nodeId: string | null) => void;
}

interface PreviewValidationIssue {
  message: string;
  nodeId?: string;
}

const PREVIEW_WAIT_LIMIT_SECONDS = 2;
const UNSUPPORTED_PREVIEW_NODE_TYPES = new Set(['property_interest', 'deal_status']);
const CUSTOM_CONDITION_OPERATORS = new Set([
  'equals', 'not_equals', 'contains', 'not_contains', 'contains_any', 'not_contains_any',
  'greater_than', 'less_than', 'is_set', 'is_not_set',
]);

function previewContext(replyContent?: string | null): Record<string, unknown> {
  return {
    lead: {
      name: 'João Silva',
      phone: '(31) 99999-0000',
      email: 'joao@email.com',
      source: 'Site',
      status: 'new',
      pipeline_id: 'pipeline-preview',
      stage_id: 'stage-preview',
      assigned_user_id: 'user-preview',
    },
    organization: { name: 'Minha Empresa' },
    date: new Date().toLocaleDateString('pt-BR'),
    execution: replyContent === undefined
      ? { trigger_data: {} }
      : { trigger_data: {}, reply_payload: { content: replyContent } },
  };
}

function validatePreviewFlow(nodes: Node[], edges: Edge[]): PreviewValidationIssue | null {
  const startNodes = nodes.filter((node) => node.type === 'start');
  if (startNodes.length !== 1) return { message: 'O fluxo precisa ter exatamente um card de Início.' };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      return { message: 'Existe uma conexão apontando para um card que não existe mais.' };
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  for (const node of nodes) {
    if (UNSUPPORTED_PREVIEW_NODE_TYPES.has(node.type || '')) {
      return { nodeId: node.id, message: 'Este card antigo não pode ser publicado. Remova-o antes de continuar.' };
    }
    if (node.type === 'message') {
      const message = String(node.data.message || '').trim();
      if (!message) return { nodeId: node.id, message: 'Preencha a mensagem deste card.' };
      if (unknownAutomationTemplateVariables(message).length > 0) {
        return { nodeId: node.id, message: 'Esta mensagem contém uma variável inválida ou incompleta.' };
      }
    }
    if (['image', 'audio', 'video'].includes(node.type || '') && !String(node.data.media_path || '').trim()) {
      return { nodeId: node.id, message: 'Selecione um arquivo de mídia para este card.' };
    }
    if (['image', 'audio', 'video'].includes(node.type || '')) {
      const caption = String(node.data.caption || '');
      if (unknownAutomationTemplateVariables(caption).length > 0) {
        return { nodeId: node.id, message: 'A legenda contém uma variável inválida ou incompleta.' };
      }
    }
    if (node.type === 'webhook') {
      try {
        const target = new URL(String(node.data.webhook_url || ''));
        if (target.protocol !== 'https:') throw new Error('invalid');
      } catch {
        return { nodeId: node.id, message: 'Informe uma URL HTTPS válida para o webhook.' };
      }
    }
    if (node.type === 'tag' && !String(node.data.tag_id || '').trim()) {
      return { nodeId: node.id, message: 'Selecione uma tag para este card.' };
    }
    if (node.type === 'move_stage' && (!node.data.move_pipeline_id || !node.data.move_stage_id)) {
      return { nodeId: node.id, message: 'Selecione a pipeline e a etapa de destino.' };
    }
    if (node.type === 'wait') {
      const nodeEdges = outgoing.get(node.id) ?? [];
      const branches = new Set(nodeEdges.map((edge) => edge.sourceHandle).filter(Boolean));
      if (node.data.stop_on_reply === true && (
        nodeEdges.length !== 2 || !branches.has('replied') || !branches.has('no_reply')
      )) {
        return { nodeId: node.id, message: 'A espera por resposta precisa das saídas “Respondeu” e “Timeout”.' };
      }
    }
    if (node.type === 'condition') {
      const nodeEdges = outgoing.get(node.id) ?? [];
      const branches = new Set(nodeEdges.map((edge) => edge.sourceHandle).filter(Boolean));
      const conditionType = node.data.condition_type || 'custom';
      if (conditionType === 'response_sentiment') {
        if (nodeEdges.length !== 3 || !branches.has('true') || !branches.has('false') || !branches.has('unknown')) {
          return { nodeId: node.id, message: 'A condição de resposta precisa das saídas “Positiva”, “Negativa” e “Incerta”.' };
        }
        const parentEdges = incoming.get(node.id) ?? [];
        const hasReplyParent = parentEdges.length === 1 && parentEdges.some((edge) => {
          const parent = nodeById.get(edge.source);
          return parent?.type === 'wait' && parent.data.stop_on_reply === true && edge.sourceHandle === 'replied';
        });
        if (!hasReplyParent) {
          return { nodeId: node.id, message: 'Conecte esta condição diretamente à saída “Respondeu” de uma espera.' };
        }
      } else {
        if (nodeEdges.length !== 2 || !branches.has('true') || !branches.has('false')) {
          return { nodeId: node.id, message: 'A condição personalizada precisa das saídas “Sim” e “Não”.' };
        }
        if (!AUTOMATION_CUSTOM_VARIABLES.some((item) => item.value === node.data.variable)) {
          return { nodeId: node.id, message: 'Selecione uma variável válida, sem usar {{chaves}}.' };
        }
        if (!CUSTOM_CONDITION_OPERATORS.has(String(node.data.operator || ''))) {
          return { nodeId: node.id, message: 'Selecione um operador válido para a condição.' };
        }
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return false;
    if (visited.has(nodeId)) return true;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (!visit(edge.target)) return false;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };
  if (!visit(startNodes[0].id)) return { nodeId: startNodes[0].id, message: 'O fluxo possui um ciclo e não pode ser simulado.' };
  if (visited.size !== nodes.length) return { message: 'Todos os cards precisam estar conectados ao Início.' };
  return null;
}



export function FlowSimulator({ nodes, edges, onClose, onHighlightNode }: FlowSimulatorProps) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [, setIsRunning] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [canReply, setCanReply] = useState(false);
  const [currentWaitNodeId, setCurrentWaitNodeId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [waitCountdown, setWaitCountdown] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track visited nodes for persistent highlighting
  const visitedNodesRef = useRef<Set<string>>(new Set());
  const processedNodesRef = useRef<Set<string>>(new Set());
  const replyContentRef = useRef<string | null | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const highlightNode = useCallback((nodeId: string) => {
    visitedNodesRef.current.add(nodeId);
    onHighlightNode?.(nodeId);
  }, [onHighlightNode]);

  const clearHighlight = useCallback(() => {
    onHighlightNode?.(null);
  }, [onHighlightNode]);

  const addMessage = useCallback((msg: Omit<SimMessage, 'id' | 'timestamp'>) => {
    const newMsg: SimMessage = { ...msg, id: createClientId('sim-message'), timestamp: new Date() };
    setMessages(prev => [...prev, newMsg]);
    return newMsg;
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    addMessage({ type: 'system', content });
  }, [addMessage]);

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const startCountdown = useCallback((seconds: number) => {
    setWaitCountdown(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setWaitCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setWaitCountdown(null);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const getNextNodes = useCallback((nodeId: string, sourceHandle?: string): Node[] => {
    const outEdges = edges.filter(e => {
      if (e.source !== nodeId) return false;
      if (sourceHandle) {
        // If we're looking for a specific handle, match it exactly OR match null if it's the default
        // For wait nodes, null sourceHandle should act as 'no_reply' or default
        return e.sourceHandle === sourceHandle || (!e.sourceHandle && (sourceHandle === 'no_reply' || sourceHandle === 'default'));
      }
      return true;
    });
    return outEdges
      .map(e => nodes.find(n => n.id === e.target))
      .filter(Boolean) as Node[];
  }, [nodes, edges]);

  const getStartNodes = useCallback((): Node[] => {
    return nodes.filter(n => n.type === 'start');
  }, [nodes]);

  // Friendly trigger labels
  const getTriggerLabel = (node: Node): string => {
    const triggerType = node.data.trigger_type || 'manual';
    const labels: Record<string, string> = {
      'message_received': 'Mensagem recebida',
      'lead_created': 'Lead criado',
      'lead_stage_changed': 'Mudou de etapa',
      'tag_added': 'Tag adicionada',
      'manual': 'Gatilho manual',
      'inactivity': 'Inatividade',
      'scheduled': 'Agendamento',
    };
    let label = labels[triggerType] || triggerType;

    // Add context details
    if (triggerType === 'lead_stage_changed') {
      const stageName = node.data.stage_name || node.data.trigger_stage_name;
      const pipelineName = node.data.pipeline_name || node.data.trigger_pipeline_name;
      if (stageName) label += ` → ${stageName}`;
      if (pipelineName) label += ` (${pipelineName})`;
    }
    if (triggerType === 'tag_added') {
      const tagName = node.data.tag_name || node.data.trigger_tag_name;
      if (tagName) label += `: ${tagName}`;
    }
    return label;
  };

  const processNode = useCallback(async (node: Node): Promise<void> => {
    if (abortRef.current) return;
    // Skip already-processed nodes to avoid duplicates
    if (processedNodesRef.current.has(node.id)) return;
    processedNodesRef.current.add(node.id);

    // Highlight the node on canvas
    highlightNode(node.id);

    switch (node.type) {
      case 'start': {
        addSystemMessage(`▶ Início: ${getTriggerLabel(node)}`);
        break;
      }

      case 'message': {
        setIsTyping(true);
        await delay(800);
        if (abortRef.current) return;
        setIsTyping(false);
        const content = String(node.data.content || node.data.message || 'Mensagem sem conteúdo');
        const parsed = renderAutomationTemplate(content, previewContext(replyContentRef.current));
        addMessage({ type: 'bot', content: parsed });
        break;
      }

      case 'image': {
        setIsTyping(true);
        await delay(600);
        if (abortRef.current) return;
        setIsTyping(false);
        addMessage({
          type: 'bot',
          content: renderAutomationTemplate(String(node.data.caption || '📷 Imagem enviada'), previewContext(replyContentRef.current)),
          mediaType: 'image',
          mediaUrl: node.data.image_preview_url || node.data.image_url,
        });
        break;
      }

      case 'audio': {
        setIsTyping(true);
        await delay(600);
        if (abortRef.current) return;
        setIsTyping(false);
        addMessage({ type: 'bot', content: '🎤 Áudio enviado', mediaType: 'audio', mediaUrl: node.data.audio_preview_url || node.data.audio_url });
        break;
      }

      case 'video': {
        setIsTyping(true);
        await delay(600);
        if (abortRef.current) return;
        setIsTyping(false);
        addMessage({
          type: 'bot',
          content: '🎬 Vídeo enviado',
          mediaType: 'video',
          mediaUrl: node.data.video_preview_url || node.data.video_url,
        });
        break;
      }

      case 'wait': {
        const value = node.data.wait_value || node.data.delay_value || 1;
        const type = node.data.wait_type || node.data.delay_type || 'days';
        const unitLabels: Record<string, string> = { seconds: 'segundo(s)', minutes: 'minuto(s)', hours: 'hora(s)', days: 'dia(s)' };

        // Calculate actual duration in seconds
        let totalSeconds = value;
        if (type === 'minutes') totalSeconds *= 60;
        else if (type === 'hours') totalSeconds *= 3600;
        else if (type === 'days') totalSeconds *= 86400;

        const simulationSeconds = Math.min(totalSeconds, PREVIEW_WAIT_LIMIT_SECONDS);

        addSystemMessage(`⏳ Aguardando ${value} ${unitLabels[type] || type} — preview: ${simulationSeconds}s`);

        // Start countdown with the calculated time
        startCountdown(simulationSeconds);
        setWaitingForReply(true);
        setCanReply(node.data.stop_on_reply === true);
        setCurrentWaitNodeId(node.id);
        return; // Pause here
      }

      case 'condition': {
        const condType = node.data.condition_type || 'custom';
        const conditionConfig = condType === 'response_sentiment'
          ? { ...node.data, ...resolveReplyKeywordConfig(node.data) }
          : node.data;
        const evaluation = evaluateAutomationCondition(
          conditionConfig,
          previewContext(replyContentRef.current),
        );
        if (evaluation.classification) {
          const labels = { positive: 'Positiva', negative: 'Negativa', uncertain: 'Incerta' } as const;
          addSystemMessage(`🔀 Resposta ${labels[evaluation.classification]}`);
        } else {
          const result = evaluation.branch === 'true' ? 'Sim' : 'Não';
          addSystemMessage(`🔀 Condição: ${node.data.variable || '?'} ${node.data.operator || 'equals'} ${node.data.value || ''} → ${result}`);
        }
        const nextNodes = getNextNodes(node.id, evaluation.branch);
        for (const next of nextNodes) {
          // eslint-disable-next-line react-hooks/immutability -- Recursive flow traversal intentionally continues through connected nodes.
          await processNode(next);
        }
        if (nextNodes.length === 0) addSystemMessage(`ℹ️ Sem caminho conectado para "${evaluation.branch}".`);
        return;
      }

      case 'tag': {
        const action = node.data.tag_action === 'remove' ? 'removida' : 'adicionada';
        addSystemMessage(`🏷️ Tag ${action}: ${node.data.tag_name || node.data.tag_id || '?'}`);
        break;
      }

      case 'move_stage': {
        addSystemMessage(`📋 Mudou de etapa: ${node.data.stage_name || node.data.move_stage_id || '?'}`);
        break;
      }

      case 'assign_user': {
        addSystemMessage(`👤 Responsável: ${node.data.user_name || node.data.assign_user_id || '?'}`);
        break;
      }

      case 'property_interest': {
        addSystemMessage(`🏠 Imóvel de interesse: ${node.data.property_name || '?'}`);
        break;
      }

      case 'deal_status': {
        const statusLabels: Record<string, string> = { open: 'Aberto', won: 'Ganho', lost: 'Perdido' };
        addSystemMessage(`⚪ Status: ${statusLabels[node.data.deal_status] || node.data.deal_status || '?'}`);
        break;
      }

      case 'webhook': {
        addSystemMessage(`🔗 Webhook: ${node.data.webhook_url || '?'}`);
        break;
      }

      default:
        addSystemMessage(`⚙️ Nó executado: ${node.type}`);
    }

    if (abortRef.current) return;

    // Process next nodes
    const nextNodes = getNextNodes(node.id);
    for (const next of nextNodes) {
      await delay(500);
      await processNode(next);
    }
  }, [addMessage, addSystemMessage, getNextNodes, highlightNode, startCountdown]);

  // Continue flow after wait/condition resolves (no "simulação concluída" spam)
  const continueAfterNode = useCallback(async (nodeId: string, branch: string | null) => {
    const nextNodes = branch ? getNextNodes(nodeId, branch) : getNextNodes(nodeId);

    if (nextNodes.length > 0) {
      for (const next of nextNodes) {
        await delay(400);
        await processNode(next);
      }
    } else if (branch) {
      const branchLabel = branch === 'replied' ? 'Respondeu' : branch === 'no_reply' ? 'Timeout' : branch;
      addSystemMessage(`ℹ️ Sem caminho conectado para "${branchLabel}".`);
    }

    // Only mark done if there's truly nothing more
    if (!abortRef.current && !waitingForReply) {
      addSystemMessage('✅ Fluxo finalizado.');
      setIsRunning(false);
      clearHighlight();
    }
  }, [getNextNodes, processNode, addSystemMessage, clearHighlight, waitingForReply]);

  const startSimulation = useCallback(async () => {
    abortRef.current = false;
    setMessages([]);
    setIsRunning(true);
    setWaitingForReply(false);
    setCanReply(false);
    setCurrentWaitNodeId(null);
    setIsTyping(false);
    stopCountdown();
    visitedNodesRef.current.clear();
    processedNodesRef.current.clear();
    replyContentRef.current = undefined;

    const validationIssue = validatePreviewFlow(nodes, edges);
    if (validationIssue) {
      addSystemMessage(`❌ ${validationIssue.message}`);
      if (validationIssue.nodeId) highlightNode(validationIssue.nodeId);
      setIsRunning(false);
      return;
    }

    const startNodes = getStartNodes();
    if (startNodes.length === 0) {
      addSystemMessage('❌ Nenhum nó de Início encontrado.');
      setIsRunning(false);
      return;
    }

    await processNode(startNodes[0]);

    // If flow ended without hitting a wait node
    if (!abortRef.current && !waitingForReply && !currentWaitNodeId) {
      // processNode already handled next nodes, check if we're still not waiting
    }
  }, [nodes, edges, getStartNodes, processNode, addSystemMessage, stopCountdown, waitingForReply, currentWaitNodeId, highlightNode]);

  const handleUserReply = useCallback(async (text: string) => {
    if (!currentWaitNodeId || !canReply || !text.trim()) return;

    addMessage({ type: 'user', content: text.trim() });
    setWaitingForReply(false);
    setCanReply(false);
    stopCountdown();
    const nodeId = currentWaitNodeId;
    setCurrentWaitNodeId(null);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    await delay(400);

    if (node.type === 'wait') {
      if (node.data.stop_on_reply) {
        replyContentRef.current = text.trim();
        addSystemMessage('✅ Lead respondeu!');
        await continueAfterNode(nodeId, 'replied');
      }
    }
  }, [currentWaitNodeId, canReply, nodes, addMessage, addSystemMessage, stopCountdown, continueAfterNode]);

  // Timeout for wait nodes - follows dynamic time cap
  useEffect(() => {
    if (!waitingForReply || !currentWaitNodeId) return;
    const node = nodes.find(n => n.id === currentWaitNodeId);
    if (!node || node.type !== 'wait') return;

    const value = node.data.wait_value || node.data.delay_value || 1;
    const type = node.data.wait_type || node.data.delay_type || 'days';

    let totalSeconds = value;
    if (type === 'minutes') totalSeconds *= 60;
    else if (type === 'hours') totalSeconds *= 3600;
    else if (type === 'days') totalSeconds *= 86400;

    const simulationSeconds = Math.min(totalSeconds, PREVIEW_WAIT_LIMIT_SECONDS);

    const timer = setTimeout(async () => {
      if (!waitingForReply) return;
      setWaitingForReply(false);
      setCanReply(false);
      stopCountdown();
      const nodeId = currentWaitNodeId;
      setCurrentWaitNodeId(null);

      if (node.data.stop_on_reply) {
        replyContentRef.current = undefined;
        addSystemMessage('⏰ Timeout — lead não respondeu.');
        await continueAfterNode(nodeId, 'no_reply');
      } else {
        addSystemMessage('⏰ Espera concluída.');
        await continueAfterNode(nodeId, null);
      }
    }, simulationSeconds * 1000);

    return () => clearTimeout(timer);
  }, [waitingForReply, currentWaitNodeId, nodes, stopCountdown, addSystemMessage, continueAfterNode]);

  const handleRestart = useCallback(() => {
    abortRef.current = true;
    setMessages([]);
    setIsRunning(false);
    setWaitingForReply(false);
    setCanReply(false);
    setCurrentWaitNodeId(null);
    setIsTyping(false);
    stopCountdown();
    visitedNodesRef.current.clear();
    processedNodesRef.current.clear();
    clearHighlight();
    setTimeout(() => startSimulation(), 100);
  }, [startSimulation, stopCountdown, clearHighlight]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    stopCountdown();
    clearHighlight();
    onClose();
  }, [onClose, stopCountdown, clearHighlight]);

  // Auto-start on mount
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- Simulator should start once on mount; adding stateful callbacks would restart active previews. */
  useEffect(() => {
    startSimulation();
    return () => {
      abortRef.current = true;
      clearHighlight();
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const handleSend = () => {
    if (canReply && userInput.trim()) {
      handleUserReply(userInput);
      setUserInput('');
    }
  };

  return (
    <div className="automation-preview-panel flex h-full w-[360px] max-w-[38vw] flex-col border-l border-[var(--app-border)] bg-[var(--app-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-hover)] px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Globe className="h-3 w-3" />
            Preview
          </div>
          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--app-surface-hover)]"
          >
            <RotateCcw className="h-3 w-3" />
            Reiniciar
          </button>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="automation-preview-scroll flex-1 space-y-3 overflow-y-auto bg-[var(--app-background)] p-4"
      >
        {messages.map((msg) => (
          <div key={msg.id} className={cn(
            'max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300',
            msg.type === 'user' ? 'ml-auto' : '',
            msg.type === 'system' ? 'mx-auto max-w-full' : '',
          )}>
            {msg.type === 'system' ? (
              <div className="rounded-[6px] bg-[var(--app-surface-muted)] px-3 py-1 text-center text-[11px] text-muted-foreground">
                {msg.content}
              </div>
            ) : msg.type === 'bot' ? (
              <div className="rounded-[8px] rounded-tl-sm border border-[var(--app-border)] bg-[var(--app-surface)] px-3.5 py-2.5 shadow-none">
                {msg.mediaType === 'image' && msg.mediaUrl && (
                  <div className="mb-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-muted)]">
                    <NextImage
                      src={msg.mediaUrl}
                      alt="Imagem enviada"
                      width={320}
                      height={192}
                      className="h-auto max-h-48 w-full object-cover"
                      unoptimized
                    />
                  </div>
                )}
                {msg.mediaType === 'image' && !msg.mediaUrl && (
                  <div className="mb-2 flex h-32 items-center justify-center rounded-[8px] bg-[var(--app-surface-muted)]">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
                {msg.mediaType === 'audio' && msg.mediaUrl && (
                  <div className="mb-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-muted)] px-3 py-2">
                    <audio controls src={msg.mediaUrl} className="w-full h-8" style={{ minWidth: 200 }} />
                  </div>
                )}
                {msg.mediaType === 'audio' && !msg.mediaUrl && (
                  <div className="mb-2 flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-muted)] px-3 py-2">
                    <Headphones className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 h-1 bg-muted-foreground/20 rounded-full">
                      <div className="h-full w-2/3 bg-primary rounded-full" />
                    </div>
                    <span className="text-[10px] text-muted-foreground">0:15</span>
                  </div>
                )}
                {msg.mediaType === 'video' && msg.mediaUrl && (
                  <div className="mb-2 overflow-hidden rounded-[8px] bg-[var(--app-surface-muted)]">
                    <video controls src={msg.mediaUrl} className="max-h-48 w-full" />
                  </div>
                )}
                {msg.mediaType === 'video' && !msg.mediaUrl && (
                  <div className="mb-2 flex h-32 items-center justify-center rounded-[8px] bg-[var(--app-surface-muted)]">
                    <Video className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
                <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              <div className="rounded-[8px] rounded-tr-sm bg-primary px-3.5 py-2.5 text-primary-foreground shadow-none">
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="max-w-[85%] animate-in fade-in">
            <div className="inline-flex items-center gap-1 rounded-[8px] rounded-tl-sm border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3 shadow-none">
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Wait countdown bar */}
      {waitCountdown !== null && (
        <div className="flex items-center gap-2 border-t border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-surface-hover)]">
            <div
              className="h-full bg-primary rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${(waitCountdown / PREVIEW_WAIT_LIMIT_SECONDS) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
            {waitCountdown}s
          </span>
        </div>
      )}

      {/* Input */}
      <form
        className="border-t border-[var(--app-border)] bg-[var(--app-surface)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <div className="flex items-center gap-2 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-background)] px-3 py-2">
          <input
            value={userInput}
            onChange={(event) => setUserInput(event.target.value)}
            placeholder={canReply ? 'Digite sua resposta...' : waitingForReply ? 'Simulando espera...' : 'Aguardando...'}
            disabled={!canReply}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <Button type="submit" size="icon" className="h-8 w-8" disabled={!canReply || !userInput.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </form>
    </div>
  );
}
