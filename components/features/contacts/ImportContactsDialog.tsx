import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  Users,
  User as UserIcon,
  Tag as TagIcon,
} from 'lucide-react';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useOrganizationUsers } from '@/hooks/use-users';
import {
  useImportLeads,
  type CreateLeadInput,
  type ImportLeadsProgress,
  type ImportLeadsResult,
} from '@/hooks/use-leads';
import { useRoundRobins } from '@/hooks/use-round-robins';
import { useTags, useCreateTag } from '@/hooks/use-tags';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import { cn } from '@/lib/utils';
import { contactsAPI } from '@/lib/api/contacts';
import { pipelinesAPI } from '@/lib/api/pipelines';
import {
  decodeContactsCSV,
  excelCellValueToText,
  parseContactsCSVRecords,
} from './parse-contacts-csv';
import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';
import { formatPtBRNumber } from '@/lib/utils/formatting';
import {
  countPendingDistribution,
  createEmptyImportDistributionSummary,
} from '@/lib/lead-distribution-outcome';
import { createTagInputSchema } from '@/lib/validation/crm-support';
import { leadCreateInputSchema } from '@/lib/validation/leads';
import { resolveImportRowTagsIfValid } from './import-contacts-validation';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedContact {
  rowNumber: number;
  nome: string;
  telefone?: string;
  email?: string;
  status?: string;
  pipeline?: string;
  estagio?: string;
  responsavel?: string;
  tags?: string;
  fonte?: string;
  motivo_perda?: string;
  mensagem?: string;
  [key: string]: string | number | undefined;
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const getStagePosition = (stage: object) => {
  if (!('position' in stage)) return 0;

  const value = (stage as { position?: unknown }).position;
  return typeof value === 'number' ? value : 0;
};

const normalizeLookupValue = (value: string) => value.trim().toLocaleLowerCase('pt-BR');

const resolveDealStatus = (value?: string) => {
  const normalized = normalizeLookupValue(value || '');
  if (!normalized || normalized === 'open' || normalized === 'aberto' || normalized === 'em aberto') {
    return { status: 'open' as const };
  }
  if (normalized === 'won' || normalized.includes('ganho')) return { status: 'won' as const };
  if (normalized === 'lost' || normalized.includes('perdido')) return { status: 'lost' as const };
  return {
    status: 'open' as const,
    error: `Status "${value?.trim()}" não reconhecido`,
  };
};

export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedContact[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [selectedAssignee, setSelectedAssignee] = useState<string>('none');
  const [selectedSource, setSelectedSource] = useState<string>('import');
  const [customSource, setCustomSource] = useState<string>('');
  const [showCustomSourceInput, setShowCustomSourceInput] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<'preparing' | 'importing' | null>(null);
  const [importProgress, setImportProgress] = useState<ImportLeadsProgress | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<ImportLeadsResult | null>(null);
  const [isAutoDistribute, setIsAutoDistribute] = useState(false);
  const [selectedRoundRobin, setSelectedRoundRobin] = useState<string>('automatic');
  const [dynamicSources, setDynamicSources] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseRequestRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);
  const { hasPermission } = useUserPermissions();
  const canAssignImportedLeads = hasPermission('lead_operate');
  const canSelectDistributionQueue =
    canAssignImportedLeads && hasPermission('distribution_manage');
  const canManageTags = hasPermission('tag_manage');

  const { data: pipelines = [] } = usePipelines();
  const {
    data: stagesData = [],
    isLoading: isLoadingStages,
    error: stagesError,
  } = useStages(selectedPipeline || undefined);
  const { data: users = [] } = useOrganizationUsers({
    enabled: open && canAssignImportedLeads,
  });
  const {
    data: roundRobins = [],
    isLoading: isLoadingRoundRobins,
  } = useRoundRobins({
    enabled: open && isAutoDistribute && canSelectDistributionQueue,
  });
  const { data: allTags = [] } = useTags({ enabled: open });
  const importLeads = useImportLeads();
  const createTag = useCreateTag();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId ?? null;
  const activeRoundRobins = roundRobins.filter(
    roundRobin => roundRobin.is_active !== false,
  );

  const sourceOptions = [
    { value: 'import', label: 'Importação' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'google', label: 'Google Ads' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'indicacao', label: 'Indicação' },
    { value: 'manual', label: 'Manual' },
    ...dynamicSources.filter(s => ![ 'import', 'facebook', 'instagram', 'google', 'whatsapp', 'indicacao', 'manual' ].includes(s.toLowerCase())).map(s => ({ value: s, label: s })),
    { value: 'custom', label: '+ Nova Origem' },
  ];

  useEffect(() => {
    const abortController = new AbortController();
    const fetchSources = async () => {
      if (!open || !organizationId) {
        setDynamicSources([]);
        return;
      }

      try {
        const contacts = await contactsAPI.list(
          { page: 1, limit: 100, mode: 'compact' },
          organizationId,
          { signal: abortController.signal },
        );
        const uniqueSources = Array.from(new Set(contacts.map(contact => contact.source))).filter(Boolean);
        setDynamicSources(uniqueSources);
      } catch {
        if (abortController.signal.aborted) return;
        // The predefined and custom source options remain usable when this
        // optional suggestion query is unavailable.
        setDynamicSources([]);
      }
    };
    void fetchSources();
    return () => abortController.abort();
  }, [open, organizationId]);

  const handleFileChange = (selectedFile: File) => {
    if (isImporting) {
      toast.info('Aguarde a importação terminar antes de trocar o arquivo');
      return;
    }

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv'
    ];

    const normalizedName = selectedFile.name.toLowerCase();

    if (!validTypes.includes(selectedFile.type) &&
        !normalizedName.endsWith('.csv') &&
        !normalizedName.endsWith('.xlsx')) {
      parseRequestRef.current += 1;
      setFile(null);
      setParsedData([]);
      setIsParsing(false);
      toast.error('Formato inválido. Use arquivos .xlsx ou .csv');
      return;
    }

    if (selectedFile.size > MAX_IMPORT_FILE_BYTES) {
      parseRequestRef.current += 1;
      setFile(null);
      setParsedData([]);
      setIsParsing(false);
      toast.error('O arquivo deve ter no máximo 10 MB');
      return;
    }

    const requestId = parseRequestRef.current + 1;
    parseRequestRef.current = requestId;
    setFile(selectedFile);
    setParsedData([]);
    setImportResult(null);
    setImportProgress(null);
    setIsParsing(true);
    void parseFile(selectedFile, requestId);
  };

  const parseFile = async (file: File, requestId: number) => {
    try {
      const sourceRows: Array<{ rowNumber: number; values: Record<string, string> }> = [];

      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = decodeContactsCSV(await file.arrayBuffer());
        const parsedRows = parseContactsCSVRecords(text);
        if (parsedRows.length === 0) {
          if (parseRequestRef.current !== requestId) return;
          setFile(null);
          setParsedData([]);
          toast.error('Arquivo CSV vazio ou inválido');
          return;
        }
        sourceRows.push(...parsedRows);
      } else {
        const workbook = new ExcelJS.Workbook();
        const arrayBuffer = await file.arrayBuffer();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          if (parseRequestRef.current !== requestId) return;
          setFile(null);
          setParsedData([]);
          toast.error('Planilha vazia ou inválida');
          return;
        }

        const headers: string[] = [];

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) {
            row.eachCell((cell, colNumber) => {
              headers[colNumber - 1] = excelCellValueToText(cell.value, cell.text).toLowerCase().trim();
            });
          } else {
            const rowData: Record<string, string> = {};
            row.eachCell((cell, colNumber) => {
              const header = headers[colNumber - 1];
              if (header) {
                rowData[header] = excelCellValueToText(cell.value, cell.text);
              }
            });
            if (Object.values(rowData).some(value => value.length > 0)) {
              sourceRows.push({ rowNumber, values: rowData });
            }
          }
        });
      }

      const normalizedData = sourceRows.map(({ rowNumber, values }) => {
        const normalized: ParsedContact = { rowNumber, nome: '' };
        Object.entries(values).forEach(([key, value]) => {
          const lowerKey = key.toLowerCase().trim();
          if (lowerKey === 'nome' || lowerKey === 'name') {
            normalized.nome = value.trim();
          } else if (lowerKey === 'telefone' || lowerKey === 'phone' || lowerKey === 'tel') {
            normalized.telefone = value.trim();
          } else if (lowerKey === 'email' || lowerKey === 'e-mail') {
            normalized.email = value.trim();
          } else if (lowerKey === 'status' || lowerKey === 'situacao' || lowerKey === 'situação') {
            normalized.status = value.trim();
          } else if (lowerKey === 'pipeline' || lowerKey === 'funil') {
            normalized.pipeline = value.trim();
          } else if (lowerKey === 'estagio' || lowerKey === 'estágio' || lowerKey === 'stage' || lowerKey === 'fase') {
            normalized.estagio = value.trim();
          } else if (lowerKey === 'responsavel' || lowerKey === 'responsável' || lowerKey === 'corretor' || lowerKey === 'assignee') {
            normalized.responsavel = value.trim();
          } else if (lowerKey === 'tags' || lowerKey === 'etiquetas') {
            normalized.tags = value.trim();
          } else if (lowerKey === 'fonte' || lowerKey === 'origem' || lowerKey === 'source') {
            normalized.fonte = value.trim();
          } else if (lowerKey === 'motivo de perda' || lowerKey === 'motivo_perda' || lowerKey === 'loss_reason') {
            normalized.motivo_perda = value.trim();
          } else if (lowerKey === 'mensagem' || lowerKey === 'message' || lowerKey === 'observacao' || lowerKey === 'observação' || lowerKey === 'note') {
            normalized.mensagem = value.trim();
          } else {
            normalized[lowerKey] = value.trim();
          }
        });
        return normalized;
      });

      if (parseRequestRef.current !== requestId) return;
      setParsedData(normalizedData);

      if (normalizedData.length === 0) {
        setFile(null);
        toast.error('Nenhuma linha preenchida foi encontrada no arquivo.');
      } else {
        const invalidNames = normalizedData.filter(row => row.nome.trim().length < 2).length;
        toast.success(`${formatPtBRNumber(normalizedData.length)} linhas encontradas`);
        if (invalidNames > 0) {
          toast.info(`${formatPtBRNumber(invalidNames)} linha(s) sem um nome válido serão registradas como falha`);
        }
      }
    } catch (error) {
      if (parseRequestRef.current !== requestId) return;
      console.error('Error parsing file:', error);
      setFile(null);
      setParsedData([]);
      toast.error('Erro ao processar arquivo');
    } finally {
      if (parseRequestRef.current === requestId) setIsParsing(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (isImporting) return;
    setIsDragging(true);
  }, [isImporting]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isImporting) return;
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileChange(droppedFile);
    }
  };

  const handleImport = async () => {
    if (isParsing) {
      toast.info('Aguarde a leitura da planilha terminar');
      return;
    }

    if (!selectedPipeline || parsedData.length === 0) {
      toast.error('Selecione uma pipeline e carregue um arquivo válido');
      return;
    }

    if (!organizationId) {
      toast.error('Não foi possível identificar a organização ativa');
      return;
    }

    if (selectedSource === 'custom' && !customSource.trim()) {
      toast.error('Informe o nome da origem personalizada');
      return;
    }

    const defaultPipeline = pipelines.find(
      pipeline => pipeline.id === selectedPipeline && pipeline.is_active !== false,
    );
    if (!defaultPipeline) {
      toast.error('O funil de destino não está mais disponível. Selecione outro funil.');
      return;
    }

    if (isLoadingStages) {
      toast.info('Aguarde o carregamento dos estágios do funil de destino');
      return;
    }
    if (stagesError) {
      toast.error('Não foi possível validar os estágios do funil de destino');
      return;
    }

    const sortedDefaultStages = [...stagesData]
      .filter(stage => stage.is_active !== false)
      .sort((left, right) => getStagePosition(left) - getStagePosition(right));
    if (sortedDefaultStages.length === 0) {
      toast.error('O funil de destino precisa ter ao menos um estágio ativo');
      return;
    }

    if (isAutoDistribute) {
      if (
        selectedRoundRobin !== 'automatic'
        && (!canSelectDistributionQueue
          || !activeRoundRobins.some(roundRobin => roundRobin.id === selectedRoundRobin))
      ) {
        toast.error('A fila de distribuição selecionada não está mais disponível');
        return;
      }
    } else if (
      selectedAssignee !== 'none'
      && !users.some(user => user.id === selectedAssignee && user.is_active)
    ) {
      toast.error('O responsável selecionado não está mais disponível');
      return;
    }

    setIsImporting(true);
    setImportPhase('preparing');
    setImportResult(null);
    setImportProgress({
      total: parsedData.length,
      processed: 0,
      success: 0,
      failed: 0,
      remaining: parsedData.length,
      created: 0,
      reentered: 0,
      distribution: createEmptyImportDistributionSummary(),
    });
    try {
      const pipelineMap = new Map<string, string>();
      const pipelineNameById = new Map<string, string>();
      pipelines
        .filter(pipeline => pipeline.is_active !== false)
        .forEach(pipeline => {
          pipelineMap.set(normalizeLookupValue(pipeline.name), pipeline.id);
          pipelineNameById.set(pipeline.id, pipeline.name);
        });

      const usersMap = new Map<string, string>();
      if (canAssignImportedLeads) {
        users
          .filter(user => user.is_active)
          .forEach(user => {
            usersMap.set(normalizeLookupValue(user.name), user.id);
            if (user.email) usersMap.set(normalizeLookupValue(user.email), user.id);
          });
      }

      const tagsMap = new Map<string, string>();
      allTags.forEach(tag => tagsMap.set(normalizeLookupValue(tag.name), tag.id));
      const unavailableTags = new Map<string, string>();

      const defaultPipelineId = selectedPipeline;
      const defaultStageId = sortedDefaultStages[0]?.id;
      const defaultAssigneeId =
        canAssignImportedLeads && !isAutoDistribute && selectedAssignee !== 'none'
          ? selectedAssignee
          : undefined;
      const finalSource = selectedSource === 'custom' ? customSource.trim() : selectedSource;
      type StageLookup = { stages: typeof stagesData; error?: string };
      const stagesByPipeline = new Map<string, StageLookup>();
      stagesByPipeline.set(defaultPipelineId, { stages: sortedDefaultStages });

      const getStagesForPipeline = async (pipelineId: string) => {
        const cached = stagesByPipeline.get(pipelineId);
        if (cached) return cached;

        try {
          const stages = await pipelinesAPI.getStages(pipelineId, organizationId);
          const lookup: StageLookup = {
            stages: [...stages]
              .filter(stage => stage.is_active !== false)
              .sort((left, right) => getStagePosition(left) - getStagePosition(right)),
          };
          stagesByPipeline.set(pipelineId, lookup);
          return lookup;
        } catch {
          const lookup: StageLookup = {
            stages: [],
            error: `Não foi possível carregar os estágios do funil "${pipelineNameById.get(pipelineId) || pipelineId}"`,
          };
          stagesByPipeline.set(pipelineId, lookup);
          return lookup;
        }
      };

      const rows: CreateLeadInput[] = [];
      for (const contact of parsedData) {
        const validationErrors: string[] = [];
        const contactName = contact.nome.trim();
        if (contactName.length < 2) {
          validationErrors.push('Nome ausente ou com menos de 2 caracteres');
        }

        let contactPipelineId = defaultPipelineId;
        if (contact.pipeline) {
          const mappedPipelineId = pipelineMap.get(normalizeLookupValue(contact.pipeline));
          if (mappedPipelineId) contactPipelineId = mappedPipelineId;
          else validationErrors.push(`Funil "${contact.pipeline}" não encontrado`);
        }

        const stageLookup = await getStagesForPipeline(contactPipelineId);
        if (stageLookup.error) validationErrors.push(stageLookup.error);
        if (stageLookup.stages.length === 0 && !stageLookup.error) {
          validationErrors.push(
            `O funil "${pipelineNameById.get(contactPipelineId) || contactPipelineId}" não possui estágio ativo`,
          );
        }
        let contactStageId = contactPipelineId === defaultPipelineId
          ? defaultStageId
          : stageLookup.stages[0]?.id;
        if (contact.estagio) {
          const mappedStage = stageLookup.stages.find(
            stage => normalizeLookupValue(stage.name) === normalizeLookupValue(contact.estagio || ''),
          );
          if (mappedStage) contactStageId = mappedStage.id;
          else validationErrors.push(`Estágio "${contact.estagio}" não encontrado no funil informado`);
        }

        let contactAssigneeId = defaultAssigneeId;
        if (!isAutoDistribute && contact.responsavel) {
          if (!canAssignImportedLeads) {
            validationErrors.push(`Responsável "${contact.responsavel}" não pode ser aplicado com sua permissão`);
          } else {
            const mappedAssigneeId = usersMap.get(normalizeLookupValue(contact.responsavel));
            if (mappedAssigneeId) contactAssigneeId = mappedAssigneeId;
            else validationErrors.push(`Responsável "${contact.responsavel}" não encontrado`);
          }
        }

        const statusResolution = resolveDealStatus(contact.status);
        if (statusResolution.error) validationErrors.push(statusResolution.error);
        const dealStatus = statusResolution.status;
        const lostReason = dealStatus === 'lost'
          ? contact.motivo_perda?.trim() || 'Outros: Importado sem motivo informado'
          : undefined;
        const roundRobinId =
          isAutoDistribute && selectedRoundRobin !== 'automatic'
            ? selectedRoundRobin
            : undefined;

        if (validationErrors.length === 0) {
          const leadValidation = leadCreateInputSchema.safeParse({
            name: contactName,
            phone: contact.telefone?.trim() || undefined,
            email: contact.email?.trim() || undefined,
            message: contact.mensagem?.trim() || undefined,
            source: contact.fonte?.trim() || finalSource,
            pipelineId: contactPipelineId,
            stageId: contactStageId,
            assignedUserId: isAutoDistribute ? undefined : contactAssigneeId,
            dealStatus,
            lostReason,
            importMode: true,
            autoDistribute: isAutoDistribute,
            roundRobinId,
          });
          if (!leadValidation.success) {
            leadValidation.error.issues.forEach(issue => {
              const message = issue.message.trim();
              if (message && !validationErrors.includes(message)) validationErrors.push(message);
            });
          }
        }

        const tagIds: string[] = [];
        const tagNames = contact.tags
          ? Array.from(
              new Set(contact.tags.split(/[,;|]/).map(tag => tag.trim()).filter(Boolean)),
            )
          : [];
        if (tagNames.length > 50) {
          validationErrors.push('A linha possui mais de 50 tags');
        }

        if (validationErrors.length === 0) {
          for (const tagName of tagNames) {
            const tagValidation = createTagInputSchema.safeParse({
              name: tagName,
              color: DEFAULT_TAG_COLOR,
            });
            if (!tagValidation.success) {
              validationErrors.push(
                `Tag "${tagName}" inválida: ${tagValidation.error.issues[0]?.message || 'dados inválidos'}`,
              );
              continue;
            }

            const normalizedTagName = normalizeLookupValue(tagName);
            const cachedTagError = unavailableTags.get(normalizedTagName);
            if (cachedTagError) {
              validationErrors.push(cachedTagError);
            } else if (!tagsMap.has(normalizedTagName) && !canManageTags) {
              const reason = `Tag "${tagName}" não existe e você não possui permissão para criá-la`;
              unavailableTags.set(normalizedTagName, reason);
              validationErrors.push(reason);
            }
          }
        }

        const resolvedTagIds = await resolveImportRowTagsIfValid(validationErrors, async () => {
          const ids: string[] = [];
          for (const tagName of tagNames) {
            const normalizedTagName = normalizeLookupValue(tagName);
            let tagId = tagsMap.get(normalizedTagName);
            if (!tagId) {
              try {
                const newTag = await createTag.mutateAsync({ name: tagName, color: DEFAULT_TAG_COLOR });
                tagId = newTag.id;
                tagsMap.set(normalizedTagName, tagId);
              } catch (error) {
                console.error('Error creating tag:', error);
                const reason = error instanceof Error && error.message
                  ? `Tag "${tagName}" não pôde ser criada: ${error.message}`
                  : `Tag "${tagName}" não pôde ser criada`;
                unavailableTags.set(normalizedTagName, reason);
                validationErrors.push(reason);
                break;
              }
            }
            ids.push(tagId);
          }
          return ids;
        });
        if (resolvedTagIds && validationErrors.length === 0) tagIds.push(...resolvedTagIds);

        rows.push({
          name: contactName,
          phone: contact.telefone?.trim() || undefined,
          email: contact.email?.trim() || undefined,
          message: contact.mensagem?.trim() || undefined,
          source: contact.fonte?.trim() || finalSource,
          pipeline_id: contactPipelineId,
          stage_id: contactStageId,
          assigned_user_id: isAutoDistribute ? undefined : contactAssigneeId,
          tag_ids: tagIds,
          deal_status: dealStatus,
          lost_reason: lostReason,
          import_mode: true,
          auto_distribute: isAutoDistribute,
          round_robin_id: roundRobinId,
          import_row_number: contact.rowNumber,
          import_validation_error: validationErrors.length > 0
            ? validationErrors.join('; ')
            : undefined,
        });
      }

      setImportPhase('importing');
      lastProgressUpdateRef.current = 0;
      const result = await importLeads.mutateAsync({
        rows,
        onProgress: progress => {
          const now = Date.now();
          if (
            progress.processed === progress.total
            || now - lastProgressUpdateRef.current >= 100
          ) {
            lastProgressUpdateRef.current = now;
            setImportProgress(progress);
          }
        },
      });
      setImportProgress({
        total: result.total,
        processed: result.processed,
        success: result.success,
        failed: result.failed,
        remaining: result.remaining,
        created: result.created,
        reentered: result.reentered,
        distribution: result.distribution,
      });
      setImportResult(result);

      if (result.success > 0) {
        toast.success(`${formatPtBRNumber(result.success)} contatos processados com sucesso!`);
      }
      if (result.failed > 0) {
        toast.error(`${formatPtBRNumber(result.failed)} contatos falharam na importação`);
      }
      const pendingDistribution = countPendingDistribution(result.distribution);
      if (pendingDistribution > 0) {
        toast.warning(
          `${formatPtBRNumber(pendingDistribution)} contatos foram importados, mas ainda precisam de atribuição`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a importação');
    } finally {
      setImportPhase(null);
      setIsImporting(false);
    }
  };

  const downloadSample = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Contatos');

      worksheet.columns = [
      { header: 'Nome', key: 'Nome', width: 25 },
      { header: 'Telefone', key: 'Telefone', width: 22 },
      { header: 'Email', key: 'Email', width: 30 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Pipeline', key: 'Pipeline', width: 15 },
      { header: 'Estagio', key: 'Estagio', width: 15 },
      { header: 'Responsavel', key: 'Responsavel', width: 25 },
      { header: 'Tags', key: 'Tags', width: 30 },
      { header: 'Fonte', key: 'Fonte', width: 15 },
      { header: 'Motivo de perda', key: 'Motivo de perda', width: 25 },
      { header: 'Mensagem', key: 'Mensagem', width: 40 },
      ];

    // Get a sample user and pipeline for the template
      const sampleUser = users[0]?.name || 'Corretor Exemplo';
      const firstPipeline = pipelines[0]?.name || 'Vendas';
      const firstStage = stagesData[0]?.name || 'Novo Lead';

      worksheet.addRows([
      {
        Nome: 'João Silva',
        Telefone: '+5511999998888',
        Email: 'joao@email.com',
        Status: 'Aberto',
        Pipeline: firstPipeline,
        Estagio: firstStage,
        Responsavel: sampleUser,
        Tags: 'quente, investidor',
        Fonte: 'Facebook Ads',
        'Motivo de perda': '',
        Mensagem: 'Interessado no imóvel de alto padrão'
      },
      {
        Nome: 'Maria Souza',
        Telefone: '+14155552671',
        Email: 'maria@email.com',
        Status: 'Ganho',
        Pipeline: firstPipeline,
        Estagio: 'Contrato Assinado',
        Responsavel: sampleUser,
        Tags: 'imediato',
        Fonte: 'Indicação',
        'Motivo de perda': '',
        Mensagem: 'Cliente já fechou negócio'
      },
      {
        Nome: 'Pedro Oliveira',
        Telefone: '+351912345678',
        Email: 'pedro@email.com',
        Status: 'Perdido',
        Pipeline: firstPipeline,
        Estagio: 'Desqualificado',
        Responsavel: sampleUser,
        Tags: 'curioso',
        Fonte: 'Instagram',
        'Motivo de perda': 'Preço acima do orçamento',
        Mensagem: 'Não possui perfil no momento'
      }
      ]);

      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF000000' }
      };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getColumn('Telefone').numFmt = '@';

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      const objectURL = URL.createObjectURL(blob);
      link.href = objectURL;
      link.download = 'modelo_importacao_completa_crm.xlsx';
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(objectURL);
        link.remove();
      }, 1_000);
    } catch {
      toast.error('Não foi possível gerar o modelo agora');
    }
  };

  const resetDialog = () => {
    parseRequestRef.current += 1;
    setFile(null);
    setParsedData([]);
    setSelectedPipeline('');
    setSelectedAssignee('none');
    setSelectedSource('import');
    setCustomSource('');
    setShowCustomSourceInput(false);
    setIsAutoDistribute(false);
    setSelectedRoundRobin('automatic');
    setIsParsing(false);
    setImportPhase(null);
    setImportProgress(null);
    setIsDragging(false);
    setImportResult(null);
  };

  const handleClose = (open: boolean) => {
    if (!open && isImporting) {
      toast.info('Aguarde a importação terminar antes de fechar');
      return;
    }
    if (!open) {
      resetDialog();
    }
    onOpenChange(open);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="flex h-full w-[94%] flex-col border-0 bg-[var(--app-bg)] p-0 shadow-none sm:w-[560px] sm:max-w-[560px]">
        <div className="bg-[var(--app-surface-solid)] p-4 pr-12">
          <SheetHeader className="space-y-1">
            <SheetTitle className="flex items-center gap-2.5 text-[14px] font-medium">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Upload className="h-4 w-4" />
              </span>
              Importar contatos/leads
            </SheetTitle>
            <SheetDescription className="sr-only">
              Envie uma planilha para importar contatos e acompanhe o processamento.
            </SheetDescription>
          </SheetHeader>
        </div>

        {!importResult && isImporting && importProgress && (
          <div
            className="space-y-2 bg-[var(--app-surface-solid)] px-4 pb-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-[11px] font-light text-[var(--app-text-tertiary)]">
              <span>{importPhase === 'preparing' ? 'Preparando linhas' : 'Importando contatos'}</span>
              <span>
                {formatPtBRNumber(importProgress.processed)} de {formatPtBRNumber(importProgress.total)}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-soft)]"
              role="progressbar"
              aria-label="Progresso da importação"
              aria-valuemin={0}
              aria-valuemax={importProgress.total}
              aria-valuenow={importProgress.processed}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{
                  width: importProgress.total > 0
                    ? `${Math.round((importProgress.processed / importProgress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              {[
                ['Processados', importProgress.processed],
                ['Importados', importProgress.success],
                ['Falhas', importProgress.failed],
                ['Restantes', importProgress.remaining],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-[6px] bg-[var(--app-surface-soft)] px-1 py-1.5">
                  <p className="text-[11px] font-medium text-[var(--app-text-primary)]">
                    {formatPtBRNumber(Number(value))}
                  </p>
                  <p className="text-[9px] font-light text-[var(--app-text-tertiary)]">{label}</p>
                </div>
              ))}
            </div>
            {importPhase === 'importing' && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
                {[
                  ['Distribuídos', importProgress.distribution.assigned],
                  ['Já atribuídos', importProgress.distribution.already_assigned],
                  ['Sem fila', importProgress.distribution.no_matching_queue],
                  ['Sem membros', importProgress.distribution.no_available_members],
                  ['Distribuição desativada', importProgress.distribution.skipped],
                  ['Reentrada mantida', importProgress.distribution.reentry_preserved],
                  ['Sem confirmação', importProgress.distribution.unknown],
                ].filter(([, value]) => Number(value) > 0).map(([label, value]) => (
                  <span key={String(label)}>
                    {label}: <span className="font-medium text-[var(--app-text-secondary)]">{formatPtBRNumber(Number(value))}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {importResult ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="mt-3 w-full max-w-[440px] space-y-3">
              <p className="text-[14px] font-medium text-[var(--app-text-primary)]">Importação concluída!</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Total', importResult.total],
                  ['Criados', importResult.created],
                  ['Reentradas', importResult.reentered],
                  ['Falhas', importResult.failed],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-[6px] bg-[var(--app-surface-soft)] p-2">
                    <p className="text-[14px] font-medium text-[var(--app-text-primary)]">
                      {formatPtBRNumber(Number(value))}
                    </p>
                    <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                <span className="font-normal text-foreground">{formatPtBRNumber(importResult.success)}</span> com sucesso
                {importResult.failed > 0 && (
                  <span className="ml-1 text-red-500">
                    · {formatPtBRNumber(importResult.failed)} não importados
                  </span>
                )}
              </p>
              {importResult.success > 0 && (
                <div className="space-y-1 rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-left">
                  <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--app-text-tertiary)]">
                    Resultado da atribuição
                  </p>
                  {[
                    {
                      code: 'assigned',
                      count: importResult.distribution.assigned,
                      message: 'Distribuídos automaticamente',
                      warning: false,
                    },
                    {
                      code: 'already_assigned',
                      count: importResult.distribution.already_assigned,
                      message: 'Já tinham responsável e foram preservados',
                      warning: false,
                    },
                    {
                      code: 'no_matching_queue',
                      count: importResult.distribution.no_matching_queue,
                      message: 'Criados sem atribuição: nenhuma fila ativa correspondeu às regras',
                      warning: true,
                    },
                    {
                      code: 'no_available_members',
                      count: importResult.distribution.no_available_members,
                      message: 'Criados sem atribuição: a fila não tinha membro disponível',
                      warning: true,
                    },
                    {
                      code: 'skipped',
                      count: importResult.distribution.skipped,
                      message: 'Distribuição automática desativada',
                      warning: false,
                    },
                    {
                      code: 'reentry_preserved',
                      count: importResult.distribution.reentry_preserved,
                      message: 'Reentradas mantiveram o responsável anterior e não foram redistribuídas',
                      warning: false,
                    },
                    {
                      code: 'unknown',
                      count: importResult.distribution.unknown,
                      message: 'Importados, mas sem confirmação do resultado da distribuição',
                      warning: true,
                    },
                  ].filter(item => item.count > 0).map(item => (
                    <div key={item.code} className="flex items-start justify-between gap-3 rounded-[4px] px-1 py-1 text-[11px]">
                      <span className="font-light leading-4 text-[var(--app-text-secondary)]">{item.message}</span>
                      <span className={cn('shrink-0 font-medium', item.warning ? 'text-amber-600' : 'text-primary')}>
                        {formatPtBRNumber(item.count)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {importResult.reasons.length > 0 && (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-[6px] bg-[var(--app-surface-soft)] p-2 text-left">
                  <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--app-text-tertiary)]">
                    Motivos das falhas
                  </p>
                  {importResult.reasons.slice(0, 8).map(reason => (
                    <div key={`${reason.code}:${reason.message}`} className="flex items-start justify-between gap-3 rounded-[4px] px-1 py-1 text-[11px]">
                      <span className="font-light leading-4 text-[var(--app-text-secondary)]">{reason.message}</span>
                      <span className="shrink-0 font-medium text-red-500">{formatPtBRNumber(reason.count)}</span>
                    </div>
                  ))}
                  {importResult.reasons.length > 8 && (
                    <p className="px-1 pt-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
                      Mais {formatPtBRNumber(importResult.reasons.length - 8)} motivo(s) agrupado(s)
                    </p>
                  )}
                </div>
              )}
            </div>
            <Button onClick={() => handleClose(false)} className="mt-4 h-9 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground">
              Concluir e ver leads
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-4 p-4">
              {/* Drop Zone */}
              <div
                className={cn(
                  "group rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-center transition-colors duration-200",
                  isDragging ? "bg-primary/10 ring-1 ring-primary/25" : "hover:bg-[var(--app-surface-hover)]",
                  file && "bg-primary/10",
                  isImporting && "pointer-events-none opacity-60",
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  aria-label="Selecionar planilha de contatos"
                  disabled={isImporting}
                  onChange={(event) => {
                    const selectedFile = event.target.files?.[0];
                    if (selectedFile) handleFileChange(selectedFile);
                    event.currentTarget.value = '';
                  }}
                  className="sr-only"
                />

                {file ? (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                      {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="mx-auto max-w-[300px] truncate text-[14px] font-medium text-[var(--app-text-primary)]">{file.name}</p>
                      <p className="mt-1 text-[12px] font-light text-primary">
                        {isParsing
                          ? 'Lendo e validando a planilha...'
                          : `${formatPtBRNumber(parsedData.length)} linhas encontradas para importar`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2 h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isParsing || isImporting}
                    >
                      Alterar arquivo
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary">
                      <Upload className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-[var(--app-text-primary)]">Arraste sua planilha aqui</p>
                      <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">Compatível com Excel (.xlsx) e CSV</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2 h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                    >
                      Selecionar arquivo
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {/* Pipeline Selection */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-[12px] font-light">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    Pipeline Padrão
                  </Label>
                  <Select value={selectedPipeline} onValueChange={setSelectedPipeline} disabled={isImporting}>
                    <SelectTrigger aria-label="Pipeline padrão da importação" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                      <SelectValue placeholder="Selecione o funil de destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                    * Se não houver pipeline na planilha, usaremos esta.
                  </p>
                </div>

                {/* Source Selection */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-[12px] font-light">
                    <Upload className="h-4 w-4 text-primary" />
                    Origem Padrão
                  </Label>
                  {showCustomSourceInput ? (
                    <div className="flex gap-2">
                      <Input
                        aria-label="Nome da origem personalizada"
                        placeholder="Nome da origem..."
                        className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
                        value={customSource}
                        onChange={(e) => setCustomSource(e.target.value)}
                        disabled={isImporting}
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 rounded-[6px] px-3 text-[11px] font-light"
                        disabled={isImporting}
                        onClick={() => {
                          setShowCustomSourceInput(false);
                          setSelectedSource('import');
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Select value={selectedSource} disabled={isImporting} onValueChange={(val) => {
                      if (val === 'custom') {
                        setSelectedSource('custom');
                        setShowCustomSourceInput(true);
                      } else {
                        setSelectedSource(val);
                      }
                    }}>
                      <SelectTrigger aria-label="Origem padrão da importação" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                        <SelectValue placeholder="Origem dos contatos" />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceOptions.map(s => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Attribution Selection */}
              {canAssignImportedLeads ? (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] p-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                        <Users className="h-3.5 w-3.5" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[13px] font-medium text-[var(--app-text-primary)]">Distribuição automática</p>
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Aplicar filas, regras, disponibilidade e horários configurados</p>
                      </div>
                    </div>
                    <Switch
                      checked={isAutoDistribute}
                      onCheckedChange={(checked) => {
                        setIsAutoDistribute(checked);
                        if (checked) setSelectedAssignee('none');
                        else setSelectedRoundRobin('automatic');
                      }}
                      disabled={isImporting}
                      aria-label="Ativar distribuição automática dos contatos importados"
                    />
                  </div>

                  {isAutoDistribute ? (
                    <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                      <Label className="text-[11px] font-light">Destino da distribuição</Label>
                      <Select
                        value={selectedRoundRobin}
                        onValueChange={setSelectedRoundRobin}
                        disabled={isImporting || isLoadingRoundRobins}
                      >
                        <SelectTrigger aria-label="Fila para distribuição automática" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                          <SelectValue placeholder="Selecione a fila" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="automatic">Pelas regras automáticas</SelectItem>
                          {canSelectDistributionQueue && activeRoundRobins.map(roundRobin => (
                            <SelectItem key={roundRobin.id} value={roundRobin.id}>
                              {roundRobin.name}
                              {roundRobin.target_pipeline?.name
                                ? ` · ${roundRobin.target_pipeline.name}`
                                : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
                        {selectedRoundRobin === 'automatic'
                          ? 'O CRM escolherá uma fila ativa pelas regras do contato e pelo funil. Responsáveis da planilha não serão aplicados.'
                          : 'A fila escolhida será validada e usada explicitamente para todos os contatos do arquivo.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-2 text-[12px] font-light">
                        <UserIcon className="h-4 w-4 text-primary" />
                        Responsável único
                      </Label>
                      <Select value={selectedAssignee} onValueChange={setSelectedAssignee} disabled={isImporting}>
                        <SelectTrigger aria-label="Responsável único da importação" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                          <SelectValue placeholder="Nenhum responsável definido" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem responsável</SelectItem>
                          {users.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                    <UserIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[13px] font-medium text-[var(--app-text-primary)]">Atribuição protegida</p>
                    <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                      Os contatos serão atribuídos a você conforme suas permissões.
                    </p>
                  </div>
                </div>
              )}

              {/* Sample Download Card */}
              <div className="group relative overflow-hidden rounded-[6px] bg-primary/10 p-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <TagIcon className="h-4 w-4 text-primary" />
                      <p className="text-[12px] font-medium text-primary">Baixe nosso novo modelo</p>
                    </div>
                    <p className="pr-8 text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                      Use telefone internacional (+DDI e número). Também aceita tags, status, pipeline, estágio, origem e responsável.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    aria-label="Baixar modelo de importação"
                   className="h-8 w-8 rounded-[6px] bg-primary/50 p-0 text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
                    disabled={isImporting}
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadSample();
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!importResult && (
          <div className="flex gap-2 bg-[var(--app-surface-solid)] p-3">
            <Button type="button" variant="ghost" className="h-9 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]" onClick={() => handleClose(false)} disabled={isImporting}>
              Cancelar
            </Button>
            <Button
              className="h-9 flex-[2] rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground"
              type="button"
              onClick={handleImport}
              disabled={
                !file
                || !selectedPipeline
                || parsedData.length === 0
                || isParsing
                || isLoadingStages
                || isImporting
                || (isAutoDistribute
                  && selectedRoundRobin !== 'automatic'
                  && !activeRoundRobins.some(roundRobin => roundRobin.id === selectedRoundRobin))
              }
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {importPhase === 'preparing'
                    ? `Preparando ${formatPtBRNumber(parsedData.length)} linhas...`
                    : importProgress
                      ? `${formatPtBRNumber(importProgress.processed)}/${formatPtBRNumber(importProgress.total)} · restam ${formatPtBRNumber(importProgress.remaining)}`
                      : 'Importando...'}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Iniciar importação {parsedData.length > 0 ? `(${formatPtBRNumber(parsedData.length)})` : ''}
                </>
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
