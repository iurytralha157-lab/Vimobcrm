import { useState, useCallback, useEffect, useRef } from 'react';
import NextImage from 'next/image';
import { Node, Edge } from 'reactflow';
import { X, RotateCcw, Globe, Image as ImageIcon, Headphones, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageBox } from '@/components/ui/message-box';
import { cn } from '@/lib/utils';

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



export function FlowSimulator({ nodes, edges, onClose, onHighlightNode }: FlowSimulatorProps) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [, setIsRunning] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [currentWaitNodeId, setCurrentWaitNodeId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [waitCountdown, setWaitCountdown] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track visited nodes for persistent highlighting
  const visitedNodesRef = useRef<Set<string>>(new Set());
  const processedNodesRef = useRef<Set<string>>(new Set());

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
    const newMsg: SimMessage = { ...msg, id: crypto.randomUUID(), timestamp: new Date() };
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
      'stage_changed': 'Mudou de etapa',
      'tag_added': 'Tag adicionada',
      'tag_removed': 'Tag removida',
      'manual': 'Gatilho manual',
      'inactivity': 'Inatividade',
    };
    let label = labels[triggerType] || triggerType;

    // Add context details
    if (triggerType === 'stage_changed') {
      const stageName = node.data.stage_name || node.data.trigger_stage_name;
      const pipelineName = node.data.pipeline_name || node.data.trigger_pipeline_name;
      if (stageName) label += ` → ${stageName}`;
      if (pipelineName) label += ` (${pipelineName})`;
    }
    if (triggerType === 'tag_added' || triggerType === 'tag_removed') {
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
        const content = node.data.content || node.data.message || 'Mensagem sem conteúdo';
        const parsed = content
          .replace(/\{\{lead\.name\}\}/g, 'João Silva')
          .replace(/\{\{lead\.phone\}\}/g, '(31) 99999-0000')
          .replace(/\{\{lead\.email\}\}/g, 'joao@email.com')
          .replace(/\{\{organization\.name\}\}/g, 'Minha Empresa')
          .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('pt-BR'));
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
          content: node.data.caption || '📷 Imagem enviada',
          mediaType: 'image',
          mediaUrl: node.data.image_url,
        });
        break;
      }

      case 'audio': {
        setIsTyping(true);
        await delay(600);
        if (abortRef.current) return;
        setIsTyping(false);
        addMessage({ type: 'bot', content: '🎤 Áudio enviado', mediaType: 'audio', mediaUrl: node.data.audio_url });
        break;
      }

      case 'video': {
        setIsTyping(true);
        await delay(600);
        if (abortRef.current) return;
        setIsTyping(false);
        addMessage({ type: 'bot', content: '🎬 Vídeo enviado', mediaType: 'video' });
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

        // Cap at 60 seconds for simulation, unless it's already shorter
        const simulationSeconds = Math.min(totalSeconds, 60);

        addSystemMessage(`⏳ Aguardando ${value} ${unitLabels[type] || type} — preview: ${simulationSeconds}s`);

        // Start countdown with the calculated time
        startCountdown(simulationSeconds);
        setWaitingForReply(true);
        setCurrentWaitNodeId(node.id);
        return; // Pause here
      }

      case 'condition': {
        const condType = node.data.condition_type || 'custom';
        if (condType === 'response_sentiment') {
          addSystemMessage('🔀 Condição: Resposta do lead');
          setWaitingForReply(true);
          setCurrentWaitNodeId(node.id);
          return;
        } else {
          const variable = node.data.variable || '?';
          const operator = node.data.operator || 'equals';
          const value = node.data.value || '?';
          addSystemMessage(`🔀 Condição: ${variable} ${operator} ${value} → Sim`);
          const trueNodes = getNextNodes(node.id, 'true');
          for (const next of trueNodes) {
            // eslint-disable-next-line react-hooks/immutability -- Recursive flow traversal intentionally continues through connected nodes.
            await processNode(next);
          }
          return;
        }
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
    setCurrentWaitNodeId(null);
    setIsTyping(false);
    stopCountdown();
    visitedNodesRef.current.clear();
    processedNodesRef.current.clear();

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
  }, [getStartNodes, processNode, addSystemMessage, stopCountdown, waitingForReply, currentWaitNodeId]);

  const handleUserReply = useCallback(async (text: string) => {
    if (!currentWaitNodeId || !text.trim()) return;

    addMessage({ type: 'user', content: text.trim() });
    setWaitingForReply(false);
    stopCountdown();
    const nodeId = currentWaitNodeId;
    setCurrentWaitNodeId(null);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    await delay(400);

    if (node.type === 'wait') {
      if (node.data.stop_on_reply) {
        addSystemMessage('✅ Lead respondeu!');
        await continueAfterNode(nodeId, 'replied');
      } else {
        addSystemMessage('⏩ Espera pulada.');
        await continueAfterNode(nodeId, null);
      }
    } else if (node.type === 'condition') {
      const positiveWords = ['sim', 'quero', 'interesse', 'gostei', 'ok', 'ótimo', 'bom', 'claro', 'aceito', 'vamos'];
      const isPositive = positiveWords.some(w => text.toLowerCase().includes(w));
      const branch = isPositive ? 'true' : 'false';
      addSystemMessage(`🔀 ${isPositive ? 'Positivo' : 'Negativo'} → ${isPositive ? 'Sim' : 'Não'}`);
      await continueAfterNode(nodeId, branch);
    }
  }, [currentWaitNodeId, nodes, addMessage, addSystemMessage, stopCountdown, continueAfterNode]);

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

    const simulationSeconds = Math.min(totalSeconds, 60);

    const timer = setTimeout(async () => {
      if (!waitingForReply) return;
      setWaitingForReply(false);
      stopCountdown();
      const nodeId = currentWaitNodeId;
      setCurrentWaitNodeId(null);

      if (node.data.stop_on_reply) {
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
    if (waitingForReply && userInput.trim()) {
      handleUserReply(userInput);
      setUserInput('');
    }
  };

  return (
    <div className="w-[360px] flex flex-col h-full border-l border-white/[0.055] bg-[var(--app-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.055] bg-white/[0.035]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] text-xs font-medium text-muted-foreground">
            <Globe className="h-3 w-3" />
            Preview
          </div>
          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:bg-white/[0.06] transition-colors"
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
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-[var(--app-background)]"
      >
        {messages.map((msg) => (
          <div key={msg.id} className={cn(
            'max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300',
            msg.type === 'user' ? 'ml-auto' : '',
            msg.type === 'system' ? 'mx-auto max-w-full' : '',
          )}>
            {msg.type === 'system' ? (
              <div className="text-[11px] text-muted-foreground text-center py-1 px-3 bg-white/[0.055] rounded-lg">
                {msg.content}
              </div>
            ) : msg.type === 'bot' ? (
              <div className="bg-white/[0.045] border border-white/[0.055] rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm">
                {msg.mediaType === 'image' && msg.mediaUrl && (
                  <div className="mb-2 rounded-xl overflow-hidden bg-white/[0.06]">
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
                  <div className="mb-2 rounded-xl bg-white/[0.06] flex items-center justify-center h-32">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
                {msg.mediaType === 'audio' && msg.mediaUrl && (
                  <div className="mb-2 rounded-xl overflow-hidden bg-white/[0.06] px-3 py-2">
                    <audio controls src={msg.mediaUrl} className="w-full h-8" style={{ minWidth: 200 }} />
                  </div>
                )}
                {msg.mediaType === 'audio' && !msg.mediaUrl && (
                  <div className="mb-2 flex items-center gap-2 bg-white/[0.06] rounded-xl px-3 py-2">
                    <Headphones className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 h-1 bg-muted-foreground/20 rounded-full">
                      <div className="h-full w-2/3 bg-primary rounded-full" />
                    </div>
                    <span className="text-[10px] text-muted-foreground">0:15</span>
                  </div>
                )}
                {msg.mediaType === 'video' && (
                  <div className="mb-2 rounded-xl bg-white/[0.06] flex items-center justify-center h-32">
                    <Video className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
                <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2.5 shadow-sm">
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="max-w-[85%] animate-in fade-in">
            <div className="bg-white/[0.045] border border-white/[0.055] rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm inline-flex items-center gap-1">
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Wait countdown bar */}
      {waitCountdown !== null && (
        <div className="px-4 py-2 border-t border-white/[0.055] bg-white/[0.035] flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${(waitCountdown / 60) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
            {waitCountdown}s
          </span>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-white/[0.055] bg-[var(--app-surface)]">
        <MessageBox
          value={userInput}
          onChange={setUserInput}
          onSend={handleSend}
          placeholder={waitingForReply ? 'Digite sua resposta...' : 'Aguardando...'}
          disabled={!waitingForReply}
          compact
        />
      </div>
    </div>
  );
}
