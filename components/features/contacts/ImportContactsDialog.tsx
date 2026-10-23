import { useState, useCallback, useRef, useEffect, useLayoutEffect, useId, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormWizardLayout } from '@/components/shared/forms/FormWizardLayout';
import { FORM_WIZARD_DIALOG_CLASS_NAME, FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from '@/config/form-wizard';
import { ContactImportPreview } from '@/components/features/contacts/ContactImportPreview';
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
import { useTags } from '@/hooks/use-tags';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import { cn } from '@/lib/utils';
import styles from '@/components/features/contacts/ContactTransferDialog.module.css';
import { contactsAPI } from '@/lib/api/contacts';
import { pipelinesAPI } from '@/lib/api/pipelines';
import {
  decodeContactsCSV,
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
import { createImportTagResolver, importTagOutcomeUnknown, resolveImportRowTagsIfValid } from '@/components/features/contacts/import-contacts-validation';
import { assignContactImportKeys, ContactImportFileError, ignoredContactImportColumns, normalizeContactImportLookup, normalizeContactImportRows, resolveContactImportReference, type ParsedContact } from '@/components/features/contacts/contact-import-columns';
import { parseContactsWorksheet } from '@/components/features/contacts/parse-contacts-xlsx';
import { parseContactTags } from '@/lib/contact-tag-transfer';
import { contactImportTagAdapter } from '@/lib/api/contact-import-tags';
import { invalidateTagConsumers } from '@/lib/tags/management';
import { contactImportFailureReport, isConfirmedContactImportFailure } from '@/components/features/contacts/contact-import-result';
import { buildContactExportCSV } from '@/lib/export-contacts-csv';
import { DEFAULT_LEAD_SOURCE_OPTIONS } from '@/lib/lead-source-options';
import { resolveContactImportSource } from '@/components/features/contacts/contact-import-source';
import { contactImportRecovery } from '@/components/features/contacts/contact-import-recovery';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId } from '@/lib/api/vimob-client';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const getStagePosition = (stage: object) => {
  if (!('position' in stage)) return 0;

  const value = (stage as { position?: unknown }).position;
  return typeof value === 'number' ? value : 0;
};

const normalizeLookupValue = normalizeContactImportLookup;

const resolveDealStatus = (value?: string) => {
  const normalized = normalizeLookupValue(value || '');
  if (!normalized || normalized === 'open' || normalized === 'aberto' || normalized === 'em aberto') {
    return { status: 'open' as const };
  }
  if (normalized === 'won' || normalized === 'ganho') return { status: 'won' as const };
  if (normalized === 'lost' || normalized === 'perdido') return { status: 'lost' as const };
  return {
    status: 'open' as const,
    error: `Status "${value?.trim()}" não reconhecido`,
  };
};

export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const wizardId = useId();
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
  const [activeStep, setActiveStep] = useState('file');
  const [ignoredColumns, setIgnoredColumns] = useState<string[]>([]);
  const [preparationProgress, setPreparationProgress] = useState({ processed: 0, createdTags: 0 });
  const [preparationIssue, setPreparationIssue] = useState<string | null>(null);
  const [failurePage, setFailurePage] = useState(0);
  const [unknownPreparationRows, setUnknownPreparationRows] = useState<ReadonlySet<number>>(() => new Set());
  const unknownPreparationRowsRef = useRef(new Set<number>());
  const importScopeActiveRef = useRef(true);
  const importRunRef = useRef<AbortController | null>(null);
  const [dialogScope] = useState(createLeadImportScope);
  const queryClient = useQueryClient();

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
  const { data: users = [], isLoading: isLoadingUsers, error: usersError, refetch: refetchUsers } = useOrganizationUsers({
    enabled: open && canAssignImportedLeads,
  });
  const {
    data: roundRobins = [],
    isLoading: isLoadingRoundRobins,
    error: roundRobinsError,
    refetch: refetchRoundRobins,
  } = useRoundRobins({
    enabled: open && isAutoDistribute && canSelectDistributionQueue,
  });
  const { isLoading: isLoadingTags, error: tagsError, refetch: refetchTags } = useTags({ enabled: open });
  const importLeads = useImportLeads();
  const { activeOrganization, user, session } = useAuth();
  const organizationId = activeOrganization.organizationId ?? null;
  const sessionId = getGlobalSignOutSessionId(session);
  const scopeKey = contactImportScopeKey(organizationId, user?.id, sessionId);
  useLayoutEffect(() => {
    const deactivate = dialogScope.activate(open ? scopeKey : null);
    importScopeActiveRef.current = open;
    return () => {
      deactivate();
      importScopeActiveRef.current = false;
      parseRequestRef.current += 1;
      importRunRef.current?.abort();
      importRunRef.current = null;
    };
  }, [dialogScope, open, scopeKey]);
  useEffect(() => {
    if (!open || !scopeKey) return;
    const restore = (resetIfMissing = false) => {
      const saved = contactImportRecovery.get(scopeKey);
      if (!saved) {
        if (!resetIfMissing) return;
        setFile(null); setParsedData([]); setIgnoredColumns([]);
        setIsParsing(false);
        setSelectedPipeline(''); setSelectedAssignee('none'); setSelectedSource('import');
        setCustomSource(''); setShowCustomSourceInput(false); setIsAutoDistribute(false); setSelectedRoundRobin('automatic');
        setIsImporting(false); setImportPhase(null); setImportProgress(null); setImportResult(null);
        setPreparationProgress({ processed: 0, createdTags: 0 }); setPreparationIssue(null); setUnknownPreparationRows(new Set()); setActiveStep('file');
        return;
      }
      setFile(saved.file);
      setIsParsing(false);
      setParsedData(saved.rows);
      setIgnoredColumns(saved.ignoredColumns || []);
      setPreparationIssue(saved.preparationIssue || null);
      setSelectedPipeline(saved.destination.pipeline);
      setSelectedAssignee(canAssignImportedLeads ? saved.destination.assignee : 'none');
      setSelectedSource(saved.destination.source);
      setCustomSource(saved.destination.customSource);
      setShowCustomSourceInput(saved.destination.source === 'custom');
      setIsAutoDistribute(canAssignImportedLeads && saved.destination.autoDistribute);
      setSelectedRoundRobin(canSelectDistributionQueue ? saved.destination.roundRobin : 'automatic');
      setIsImporting(saved.pending);
      setImportPhase(saved.phase);
      setImportProgress(saved.progress);
      setImportResult(saved.result);
      setUnknownPreparationRows(new Set(saved.unknownPreparationRows));
      setPreparationProgress({ processed: saved.preparedRows, createdTags: saved.createdTags });
      setActiveStep(saved.result ? 'result' : 'review');
    };
    restore(true);
    return contactImportRecovery.subscribe(scopeKey, () => restore());
  }, [open, scopeKey, canAssignImportedLeads, canSelectDistributionQueue]);
  const activeRoundRobins = roundRobins.filter(
    roundRobin => roundRobin.is_active !== false,
  );
  const selectedQueueIssue = !isAutoDistribute || selectedRoundRobin === 'automatic'
    ? null
    : !canSelectDistributionQueue
      ? 'Você não possui permissão para selecionar uma fila específica. Escolha as regras automáticas.'
      : isLoadingRoundRobins
        ? 'Aguarde o carregamento da fila de distribuição selecionada.'
        : roundRobinsError
          ? 'Não foi possível validar a fila selecionada. Recarregue as filas antes de importar.'
          : !activeRoundRobins.some(queue => queue.id === selectedRoundRobin)
            ? 'A fila selecionada não está mais disponível. Escolha outra fila ou as regras automáticas.'
            : null;
  const needsTags = useMemo(() => parsedData.some((row) => parseContactTags(row.tags || '').names.length > 0), [parsedData]);
  const needsUsers = canAssignImportedLeads && !isAutoDistribute && (selectedAssignee !== 'none' || parsedData.some((row) => row.responsavel || row.assigned_user_id));
  const cataloguesPending = (needsTags && isLoadingTags) || (needsUsers && isLoadingUsers);
  const cataloguesFailed = (needsTags && Boolean(tagsError)) || (needsUsers && Boolean(usersError));
  const confirmedFailures = importResult?.failures.filter((failure) => isConfirmedContactImportFailure(failure, unknownPreparationRows)) || [];

  const sourceOptions = [
    ...DEFAULT_LEAD_SOURCE_OPTIONS,
    ...dynamicSources.filter(s => s !== 'custom' && !DEFAULT_LEAD_SOURCE_OPTIONS.some((source) => source.value === s.toLowerCase())).map(s => ({ value: s, label: s })),
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
    setIgnoredColumns([]);

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
    setIgnoredColumns([]);
    setImportResult(null);
    setImportProgress(null);
    setIsParsing(true);
    void parseFile(selectedFile, requestId);
  };

  const parseFile = async (file: File, requestId: number) => {
    try {
      let sourceRows: Array<{ rowNumber: number; values: Record<string, string> }> = [];

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
        sourceRows = parsedRows;
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

        sourceRows = parseContactsWorksheet(worksheet);
      }

      const normalizedData = assignContactImportKeys(normalizeContactImportRows(sourceRows), () => crypto.randomUUID());

      if (parseRequestRef.current !== requestId) return;
      setParsedData(normalizedData);
      setIgnoredColumns(ignoredContactImportColumns(Object.keys(sourceRows[0]?.values || {})));

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
      setIgnoredColumns([]);
      toast.error(error instanceof ContactImportFileError ? error.message : 'Erro ao processar arquivo. Confira o formato e as aspas das células.');
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
    if (isImporting || importRunRef.current) return;
    const controller = new AbortController();
    const isCurrentDialog = dialogScope.capture(scopeKey);
    const isCurrentScope = () => isCurrentDialog() && importScopeActiveRef.current && !controller.signal.aborted
      && getVimobAPIAccessTokenUserId() === user?.id
      && getVimobAPIAccessTokenSessionId() === sessionId;
    const assertImportScope = () => {
      if (!isCurrentScope()) throw Object.assign(new Error('A sessão ou organização mudou. A importação foi interrompida antes de iniciar novas linhas.'), { code: 'contact_import_scope_changed' });
    };
    if (cataloguesPending || cataloguesFailed) {
      toast.error('Aguarde ou recarregue os catálogos de tags e responsáveis necessários para este arquivo');
      return;
    }
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
    if (!user?.id) {
      toast.error('Sua sessão não está disponível. Entre novamente antes de importar.');
      return;
    }
    if (!scopeKey || !isCurrentScope()) {
      toast.error('Sua sessão mudou ou não pôde ser confirmada. Reabra a importação antes de continuar.');
      return;
    }

    if (selectedSource === 'custom' && !customSource.trim()) {
      toast.error('Informe o nome da origem personalizada');
      return;
    }
    const sourceResolution = resolveContactImportSource(selectedSource === 'custom' ? customSource : selectedSource);
    if (!sourceResolution.success) {
      toast.error(sourceResolution.error);
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
      if (selectedQueueIssue) {
        toast.error(selectedQueueIssue);
        return;
      }
    } else if (
      selectedAssignee !== 'none'
      && !users.some(user => user.id === selectedAssignee && user.is_active)
    ) {
      toast.error('O responsável selecionado não está mais disponível');
      return;
    }

    const run = contactImportRecovery.start(scopeKey, {
      rows: parsedData, file, ignoredColumns,
      destination: { pipeline: selectedPipeline, assignee: selectedAssignee, source: selectedSource, customSource, autoDistribute: isAutoDistribute, roundRobin: selectedRoundRobin },
      pending: true, phase: 'preparing', progress: null, result: null,
      unknownPreparationRows: [], preparedRows: 0, createdTags: 0,
    });
    if (!run) { toast.info('Uma importação deste contexto ainda está finalizando as linhas enviadas.'); return; }
    importRunRef.current = controller;
    setIsImporting(true);
    setImportPhase('preparing');
    setImportResult(null);
    setFailurePage(0);
    const unknownRows = new Set<number>();
    unknownPreparationRowsRef.current = unknownRows;
    setUnknownPreparationRows(new Set());
    setPreparationProgress({ processed: 0, createdTags: 0 });
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
    let createdTags = 0;
    let preparedRows = 0;
    let dispatchStarted = false;
    try {
      const activePipelines = pipelines.filter((pipeline) => pipeline.is_active !== false);
      const pipelineNameById = new Map<string, string>();
      activePipelines
        .forEach(pipeline => {
          pipelineNameById.set(pipeline.id, pipeline.name);
        });

      const activeUsers = users.filter((user) => user.is_active);

      assertImportScope();
      const originalTagAdapter = contactImportTagAdapter(organizationId, user.id, sessionId);
      const tagAdapter = { load: originalTagAdapter.load, create: (name: string) => { assertImportScope(); return originalTagAdapter.create(name); } };
      // A fresh read distinguishes a stale/error catalogue from an absent tag.
      const importTags = needsTags ? await tagAdapter.load() : [];
      const tagsMap = new Map<string, string>();
      importTags.forEach(tag => tagsMap.set(normalizeLookupValue(tag.name), tag.id));
      const resolveTagIds = createImportTagResolver(organizationId, importTags, tagAdapter, () => {
        createdTags += 1;
        contactImportRecovery.update(scopeKey, run, { preparedRows, createdTags });
        if (isCurrentScope()) setPreparationProgress({ processed: preparedRows, createdTags });
      });

      const defaultPipelineId = selectedPipeline;
      const defaultStageId = sortedDefaultStages[0]?.id;
      const defaultAssigneeId =
        canAssignImportedLeads && !isAutoDistribute && selectedAssignee !== 'none'
          ? selectedAssignee
          : undefined;
      const finalSource = sourceResolution.value;
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
        assertImportScope();
        const validationErrors: string[] = [];
        const contactName = contact.nome.trim();
        if (contactName.length < 2) {
          validationErrors.push('Nome ausente ou com menos de 2 caracteres');
        }

        let contactPipelineId = defaultPipelineId;
        if (contact.pipeline || contact.pipeline_id) {
          const reference = resolveContactImportReference(contact.pipeline, contact.pipeline_id, activePipelines, 'Funil');
          if (reference.id) contactPipelineId = reference.id;
          if (reference.error) validationErrors.push(reference.error);
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
        if (contact.estagio || contact.stage_id) {
          const reference = resolveContactImportReference(contact.estagio, contact.stage_id, stageLookup.stages, 'Estágio');
          if (reference.id) contactStageId = reference.id;
          if (reference.error) validationErrors.push(reference.error);
        }

        let contactAssigneeId = defaultAssigneeId;
        if (!isAutoDistribute && (contact.responsavel || contact.assigned_user_id)) {
          if (!canAssignImportedLeads) {
            validationErrors.push(`Responsável "${contact.responsavel}" não pode ser aplicado com sua permissão`);
          } else {
            const reference = resolveContactImportReference(contact.responsavel, contact.assigned_user_id, activeUsers, 'Responsável');
            if (reference.id) contactAssigneeId = reference.id;
            if (reference.error) validationErrors.push(reference.error);
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

        const rowSource = resolveContactImportSource(contact.fonte?.trim() || finalSource);
        if (!rowSource.success) validationErrors.push(`Origem: ${rowSource.error}`);
        const contactSource = rowSource.success ? rowSource.value : contact.fonte?.trim() || finalSource;
        if (validationErrors.length === 0) {
          const leadValidation = leadCreateInputSchema.safeParse({
            name: contactName,
            phone: contact.telefone?.trim() || undefined,
            email: contact.email?.trim() || undefined,
            message: contact.mensagem?.trim() || undefined,
            source: contactSource,
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
        const parsedTags = parseContactTags(contact.tags || '');
        const tagNames = parsedTags.names;
        if (parsedTags.error) validationErrors.push(parsedTags.error);
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
            if (!tagsMap.has(normalizedTagName) && !canManageTags) {
              const reason = `Tag "${tagName}" não existe e você não possui permissão para criá-la`;
              validationErrors.push(reason);
            }
          }
        }

        const resolvedTagIds = await resolveImportRowTagsIfValid(validationErrors, async () => {
          try {
            return await resolveTagIds(tagNames);
          } catch (error) {
            if (importTagOutcomeUnknown(error)) unknownRows.add(contact.rowNumber);
            validationErrors.push(error instanceof Error ? error.message : 'Não foi possível resolver as tags desta linha');
            return [];
          }
        });
        if (resolvedTagIds && validationErrors.length === 0) tagIds.push(...resolvedTagIds);

        rows.push({
          name: contactName,
          phone: contact.telefone?.trim() || undefined,
          email: contact.email?.trim() || undefined,
          message: contact.mensagem?.trim() || undefined,
          source: contactSource,
          pipeline_id: contactPipelineId,
          stage_id: contactStageId,
          assigned_user_id: isAutoDistribute ? undefined : contactAssigneeId,
          tag_ids: tagIds,
          deal_status: dealStatus,
          lost_reason: lostReason,
          import_mode: true,
          import_request_key: contact.importRequestKey,
          auto_distribute: isAutoDistribute,
          round_robin_id: roundRobinId,
          import_row_number: contact.rowNumber,
          import_validation_error: validationErrors.length > 0
            ? validationErrors.join('; ')
            : undefined,
        });
        preparedRows += 1;
        if (preparedRows === parsedData.length || preparedRows % 50 === 0) {
          contactImportRecovery.update(scopeKey, run, { preparedRows, createdTags });
          if (isCurrentScope()) setPreparationProgress({ processed: preparedRows, createdTags });
        }
        if (preparedRows % 50 === 0) {
          // Let navigation/session changes run even when every lookup is cached.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          assertImportScope();
        }
      }

      setImportPhase('importing');
      assertImportScope();
      contactImportRecovery.update(scopeKey, run, { phase: 'importing', preparedRows, createdTags });
      lastProgressUpdateRef.current = 0;
      dispatchStarted = true;
      const result = await importLeads.mutateAsync({
        rows,
        signal: controller.signal,
        shouldContinue: isCurrentScope,
        onProgress: progress => {
          const now = Date.now();
          if (
            progress.processed === progress.total
            || now - lastProgressUpdateRef.current >= 100
          ) {
            lastProgressUpdateRef.current = now;
            contactImportRecovery.update(scopeKey, run, { progress });
            if (isCurrentScope()) setImportProgress(progress);
          }
        },
      });
      contactImportRecovery.update(scopeKey, run, {
        result, pending: false, phase: null, preparedRows, createdTags,
        unknownPreparationRows: [...unknownRows],
        progress: { total: result.total, processed: result.processed, success: result.success, failed: result.failed, remaining: result.remaining, created: result.created, reentered: result.reentered, distribution: result.distribution },
      });
      if (!isCurrentScope()) return;
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
      setUnknownPreparationRows(new Set(unknownRows));
      setImportResult(result);
      if (result.stopped) toast.info(`${formatPtBRNumber(result.remaining)} linha(s) não iniciada(s). Revise o resultado parcial antes de continuar.`);

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
      contactImportRecovery.update(scopeKey, run, {
        pending: false, phase: null, preparedRows, createdTags,
        unknownPreparationRows: [...unknownRows],
        preparationIssue: dispatchStarted
          ? 'O resultado não pôde ser concluído. Confira os contatos já enviados antes de repetir qualquer linha.'
          : 'Preparação interrompida; contatos não enviados. Revise o catálogo de tags antes de confirmar uma nova tentativa.',
      });
      if (isCurrentScope()) toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a importação');
    } finally {
      if (createdTags > 0) void invalidateTagConsumers(queryClient, organizationId);
      else if (needsTags) void queryClient.invalidateQueries({ queryKey: ['tags', organizationId] });
      if (isCurrentScope()) { setImportPhase(null); setIsImporting(false); }
      if (importRunRef.current === controller) importRunRef.current = null;
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
      const sampleUser = users.find((user) => user.id === selectedAssignee && user.is_active);
      const sampleAssignee = sampleUser?.email || sampleUser?.id || '';
      const firstPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipeline && pipeline.is_active !== false)?.name || '';
      const firstStage = firstPipeline ? [...stagesData].filter((stage) => stage.is_active !== false).sort((left, right) => getStagePosition(left) - getStagePosition(right))[0]?.name || '' : '';

      worksheet.addRows([
      {
        Nome: 'João Silva',
        Telefone: '+5511999998888',
        Email: 'joao@email.com',
        Status: 'Aberto',
        Pipeline: firstPipeline,
        Estagio: firstStage,
        Responsavel: sampleAssignee,
        Tags: '',
        Fonte: 'Facebook Ads',
        'Motivo de perda': '',
        Mensagem: 'Interessado no imóvel de alto padrão'
      },
      {
        Nome: 'Maria Souza',
        Telefone: '+14155552671',
        Email: 'maria@email.com',
        Status: 'Aberto',
        Pipeline: firstPipeline,
        Estagio: firstStage,
        Responsavel: sampleAssignee,
        Tags: '',
        Fonte: 'Indicação',
        'Motivo de perda': '',
        Mensagem: 'Cliente interessado em uma visita'
      },
      {
        Nome: 'Pedro Oliveira',
        Telefone: '+351912345678',
        Email: 'pedro@email.com',
        Status: 'Aberto',
        Pipeline: firstPipeline,
        Estagio: firstStage,
        Responsavel: sampleAssignee,
        Tags: '',
        Fonte: 'Instagram',
        'Motivo de perda': '',
        Mensagem: 'Busca opções compatíveis com seu orçamento'
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
    if (scopeKey) contactImportRecovery.clear(scopeKey);
    setActiveStep('file');
    parseRequestRef.current += 1;
    setFile(null);
    setParsedData([]);
    setIgnoredColumns([]);
    setFailurePage(0);
    setPreparationProgress({ processed: 0, createdTags: 0 });
    setPreparationIssue(null);
    unknownPreparationRowsRef.current = new Set();
    setUnknownPreparationRows(new Set());
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

  const downloadFailures = () => {
    if (!importResult) return;
    try {
      const csv = buildContactExportCSV(['Linha', 'Nome', 'Código', 'Motivo', 'Resultado'], contactImportFailureReport(importResult.failures, unknownPreparationRows));
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.href = url;
      link.download = 'falhas-importacao-contatos.csv';
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível gerar o relatório de falhas');
    }
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

  const isFileStep = activeStep === 'file' && !isImporting && !importResult;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn(FORM_WIZARD_DIALOG_CLASS_NAME, styles.dialog)}
        onEscapeKeyDown={(event) => { if (isImporting) event.preventDefault(); }}
        onInteractOutside={(event) => { if (isImporting) event.preventDefault(); }}
      >
        <div className="bg-[var(--app-surface-solid)] p-4 pr-12">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2.5 text-[14px] font-medium">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
                <Upload className="h-4 w-4" />
              </span>
              Importar contatos/leads
            </DialogTitle>
            <DialogDescription className="sr-only">
              Envie uma planilha para importar contatos e acompanhe o processamento.
            </DialogDescription>
          </DialogHeader>
        </div>

        <FormWizardLayout
          className={styles.wizard}
          contentClassName={isFileStep ? styles.fileContent : undefined}
          newsButtonClassName={styles.newsButton}
          steps={[
            { id: 'file', label: 'Arquivo', icon: FileSpreadsheet, disabled: isImporting || Boolean(importResult), buttonId: `${wizardId}-tab-file`, panelId: `${wizardId}-panel` },
            { id: 'destination', label: 'Destino e origem', icon: Upload, disabled: isImporting || Boolean(importResult), buttonId: `${wizardId}-tab-destination`, panelId: `${wizardId}-panel` },
            { id: 'assignment', label: 'Atribuição', icon: Users, disabled: isImporting || Boolean(importResult), buttonId: `${wizardId}-tab-assignment`, panelId: `${wizardId}-panel` },
            { id: 'review', label: 'Revisão', icon: CheckCircle2, disabled: isImporting || Boolean(importResult), buttonId: `${wizardId}-tab-review`, panelId: `${wizardId}-panel` },
            ...(importResult ? [{ id: 'result', label: 'Resultado', icon: CheckCircle2, buttonId: `${wizardId}-tab-result`, panelId: `${wizardId}-panel` }] : []),
          ]}
          activeStep={importResult ? 'result' : activeStep}
          onStepChange={(step) => { if (!isImporting && !importResult) setActiveStep(step); }}
          asideTitle="Prévia da importação"
          aside={<ContactImportPreview
            fileName={file?.name}
            rows={parsedData}
            ignoredColumns={ignoredColumns}
            isParsing={isParsing}
            pipelineName={pipelines.find((pipeline) => pipeline.id === selectedPipeline)?.name || ''}
            sourceName={selectedSource === 'custom' ? customSource : sourceOptions.find((source) => source.value === selectedSource)?.label || selectedSource}
            assignment={!canAssignImportedLeads ? { mode: 'protected' } : isAutoDistribute
              ? { mode: 'automatic', explicitQueue: selectedRoundRobin !== 'automatic', queueName: activeRoundRobins.find((queue) => queue.id === selectedRoundRobin)?.name, issue: selectedQueueIssue }
              : { mode: 'manual', selected: selectedAssignee !== 'none', name: users.find((user) => user.id === selectedAssignee)?.name }}
          />}
          footer={importResult ? <Button type="button" className={cn(FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, styles.primaryButton)} onClick={() => handleClose(false)}>Concluir</Button> : <>
            <Button type="button" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={isImporting} onClick={() => {
              const steps = ['file', 'destination', 'assignment', 'review'];
              const index = steps.indexOf(activeStep);
              if (index <= 0) handleClose(false); else setActiveStep(steps[index - 1]);
            }}>{activeStep === 'file' ? 'Cancelar' : 'Voltar'}</Button>
            {activeStep !== 'review' ? <Button type="button" className={cn(FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, styles.primaryButton)}
              disabled={isImporting || isParsing || (activeStep === 'file' && (!file || parsedData.length === 0)) || (activeStep === 'destination' && (!selectedPipeline || isLoadingStages)) || (activeStep === 'assignment' && Boolean(selectedQueueIssue))}
              onClick={() => { const steps = ['file', 'destination', 'assignment', 'review']; setActiveStep(steps[steps.indexOf(activeStep) + 1]); }}
            >Avançar</Button> : <Button type="button" className={cn(FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, styles.primaryButton)}
              onClick={() => { void handleImport(); }}
              disabled={!file || !selectedPipeline || parsedData.length === 0 || isParsing || isLoadingStages || isImporting || cataloguesPending || cataloguesFailed || Boolean(selectedQueueIssue)}
            >{isImporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{importPhase === 'preparing' ? 'Preparando linhas...' : 'Importando...'}</> : `Iniciar importação (${formatPtBRNumber(parsedData.length)})`}</Button>}
          </>}
        >
        <div id={`${wizardId}-panel`} role="tabpanel" aria-labelledby={`${wizardId}-tab-${importResult ? 'result' : activeStep}`} className={isFileStep ? styles.filePanel : undefined}>
        {!importResult && !isImporting && preparationIssue && <p className="mb-3 break-words rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[11px] text-amber-700">{preparationIssue}{unknownPreparationRows.size > 0 ? ' Há criação de tag sem confirmação; confira o catálogo antes de repetir.' : ''}</p>}
        {!importResult && !isImporting && preparationProgress.createdTags > 0 && <p className="mb-3 break-words text-[11px] text-[var(--app-text-tertiary)]">{formatPtBRNumber(preparationProgress.createdTags)} tag(s) já foram criadas durante a preparação anterior e permanecem no catálogo.</p>}
        {!importResult && (cataloguesPending || cataloguesFailed) && <div className="mb-3 space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px]" role="status">
          <p>{cataloguesPending ? 'Carregando tags e responsáveis necessários para este arquivo...' : 'Não foi possível validar o catálogo necessário. Recarregue antes de iniciar.'}</p>
          {cataloguesFailed && <Button type="button" variant="secondary" size="sm" disabled={isImporting} onClick={() => { if (needsTags) void refetchTags(); if (needsUsers) void refetchUsers(); }}>Recarregar catálogos</Button>}
        </div>}
        {!importResult && isImporting && importProgress && (
          <div
            className="space-y-2 bg-[var(--app-surface-solid)] px-4 pb-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-[11px] font-light text-[var(--app-text-tertiary)]">
              <span>{importPhase === 'preparing' ? 'Preparando linhas' : 'Importando contatos'}</span>
              <span>
                {formatPtBRNumber(importPhase === 'preparing' ? preparationProgress.processed : importProgress.processed)} de {formatPtBRNumber(importProgress.total)}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-soft)]"
              role="progressbar"
              aria-label="Progresso da importação"
              aria-valuemin={0}
              aria-valuemax={importProgress.total}
              aria-valuenow={importPhase === 'preparing' ? preparationProgress.processed : importProgress.processed}
            >
              <div
                className="h-full rounded-full bg-primary/50 transition-[width] duration-200"
                style={{
                  width: importProgress.total > 0
                    ? `${Math.round(((importPhase === 'preparing' ? preparationProgress.processed : importProgress.processed) / importProgress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            {importPhase === 'preparing' && <p className="text-[11px] text-[var(--app-text-tertiary)]">Linhas preparadas: {formatPtBRNumber(preparationProgress.processed)} · Tags criadas: {formatPtBRNumber(preparationProgress.createdTags)}</p>}
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
                  ['Aguardando no bolsão', importProgress.distribution.pooled],
                  ['Fora do horário da fila', importProgress.distribution.queue_closed],
                  ['Aguardando na fila', importProgress.distribution.queue_waiting],
                  ['Limite da rotação atingido', importProgress.distribution.queue_limit_reached],
                  ['Atendimento preservado', importProgress.distribution.queue_protected],
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
              <p className="text-[14px] font-medium text-[var(--app-text-primary)]">{importResult.stopped ? 'Importação interrompida' : 'Importação concluída!'}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Total', importResult.total],
                  ['Criados', importResult.created],
                  ['Reentradas', importResult.reentered],
                  ['Falhas', importResult.failed],
                  ...(importResult.remaining > 0 ? [['Não iniciadas', importResult.remaining]] : []),
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
              {importResult.remaining > 0 && <div className="space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-left text-[11px]">
                <p>As linhas já enviadas mantêm o resultado recebido. As demais não foram enviadas. Este relatório fica apenas nesta aba e será perdido ao recarregá-la.</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => {
                  const rowNumbers = new Set(importResult.unstarted.map(row => row.rowNumber));
                  setParsedData(rows => rows.filter(row => rowNumbers.has(row.rowNumber)));
                  if (scopeKey) contactImportRecovery.clear(scopeKey);
                  setImportResult(null); setActiveStep('review');
                }}>Revisar {formatPtBRNumber(importResult.remaining)} linha(s) não iniciada(s)</Button>
              </div>}
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
                      code: 'pooled', count: importResult.distribution.pooled,
                      message: 'Aguardando no bolsão da fila', warning: false,
                    },
                    {
                      code: 'queue_closed', count: importResult.distribution.queue_closed,
                      message: 'Fila fora do horário: aguardando no bolsão', warning: false,
                    },
                    {
                      code: 'queue_waiting', count: importResult.distribution.queue_waiting,
                      message: 'Aguardando disponibilidade na fila', warning: false,
                    },
                    {
                      code: 'queue_limit_reached', count: importResult.distribution.queue_limit_reached,
                      message: 'Limite da rotação atingido; revise o bolsão da fila', warning: true,
                    },
                    {
                      code: 'queue_protected', count: importResult.distribution.queue_protected,
                      message: 'Atendimento humano ou atribuição manual preservados', warning: false,
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
              {preparationProgress.createdTags > 0 && <p className="text-[11px] text-[var(--app-text-tertiary)]">{formatPtBRNumber(preparationProgress.createdTags)} tag(s) criada(s) no catálogo durante a preparação.</p>}
              {importResult.failures.length > 0 && <section className="space-y-3 text-left" aria-label="Todas as falhas da importação">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-normal">Falhas por linha ({formatPtBRNumber(importResult.failures.length)})</p>
                  <Button type="button" variant="secondary" size="sm" onClick={downloadFailures}>Baixar falhas</Button>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                  {importResult.failures.slice(failurePage * 50, (failurePage + 1) * 50).map((failure) => <div key={`${failure.rowNumber}:${failure.index}`} className="space-y-1 break-words text-[11px]">
                    <p className="font-normal">Linha {failure.rowNumber} · {failure.name || 'Sem nome'}</p>
                    <p className="text-destructive">{failure.message}</p>
                    {!isConfirmedContactImportFailure(failure, unknownPreparationRows) && <p className="text-amber-600">{unknownPreparationRows.has(failure.rowNumber) ? 'Criação de tag sem confirmação; contato não enviado. Confira o catálogo antes de repetir.' : failure.code === 'lead_import_request_conflict' ? 'A identificação pertence a uma tentativa com dados diferentes. Revise a operação; este botão não repetirá a linha.' : 'Resultado sem confirmação. Confira se a linha foi gravada antes de repetir.'}</p>}
                  </div>)}
                </div>
                {importResult.failures.length > 50 && <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <Button type="button" variant="secondary" size="sm" disabled={failurePage === 0} onClick={() => setFailurePage((page) => page - 1)}>Anterior</Button>
                  <span>Página {failurePage + 1} de {Math.ceil(importResult.failures.length / 50)}</span>
                  <Button type="button" variant="secondary" size="sm" disabled={(failurePage + 1) * 50 >= importResult.failures.length} onClick={() => setFailurePage((page) => page + 1)}>Próxima</Button>
                </div>}
                {confirmedFailures.length > 0 && <Button type="button" variant="secondary" className="h-auto min-h-9 whitespace-normal text-left text-[12px]" onClick={() => {
                  const rowNumbers = new Set(confirmedFailures.map((failure) => failure.rowNumber));
                  setParsedData((rows) => rows.filter((row) => rowNumbers.has(row.rowNumber)));
                  if (scopeKey) contactImportRecovery.clear(scopeKey);
                  setFailurePage(0);
                  setImportResult(null);
                  setActiveStep('review');
                }}>Revisar nova tentativa: {formatPtBRNumber(confirmedFailures.length)} falha(s) confirmada(s)</Button>}
                <p className="text-[11px] text-[var(--app-text-tertiary)]">A nova tentativa exige confirmação e conserva a identificação de cada linha. Sucessos e resultados sem confirmação não são repetidos por este botão.</p>
              </section>}
            </div>
          </div>
        ) : (
          <div className={cn("min-w-0", isFileStep && styles.fileStage)}>
            <div className={isFileStep ? styles.fileStack : "space-y-4"}>
              {/* Drop Zone */}
              <div
                hidden={activeStep !== 'file'}
                data-highlighted={Boolean(file || isDragging)}
                className={cn(
                  "group rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-center transition-colors duration-200",
                  styles.uploadArea,
                  isDragging && "ring-1 ring-primary/25",
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
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors">
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

              <div hidden={activeStep !== 'destination'} className={activeStep === 'destination' ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'hidden'}>
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
              <div hidden={activeStep !== 'assignment'}>
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
                          {selectedRoundRobin !== 'automatic' && !activeRoundRobins.some(queue => queue.id === selectedRoundRobin) && (
                            <SelectItem value={selectedRoundRobin} disabled>
                              {isLoadingRoundRobins ? 'Carregando fila selecionada...' : roundRobinsError ? 'Fila selecionada sem validação' : 'Fila selecionada indisponível'}
                            </SelectItem>
                          )}
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
                      {!canSelectDistributionQueue && <p className="text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">Você pode usar as regras automáticas. A escolha de uma fila específica exige permissão para gerenciar a distribuição.</p>}
                      {canSelectDistributionQueue && isLoadingRoundRobins && <p role="status" className="text-[11px] font-light text-[var(--app-text-secondary)]">Carregando filas de distribuição...</p>}
                      {canSelectDistributionQueue && roundRobinsError && <div role="alert" className="space-y-2 text-[11px] font-light text-[var(--app-text-secondary)]">
                        <p>Não foi possível carregar as filas. Você ainda pode escolher as regras automáticas.</p>
                        <Button type="button" variant="secondary" size="sm" disabled={isImporting || isLoadingRoundRobins} onClick={() => { void refetchRoundRobins(); }}>Recarregar filas</Button>
                      </div>}
                      {canSelectDistributionQueue && !isLoadingRoundRobins && !roundRobinsError && activeRoundRobins.length === 0 && <p role="status" className="text-[11px] font-light text-[var(--app-text-secondary)]">Nenhuma fila ativa está disponível para seleção. Você pode usar as regras automáticas ou desativar a distribuição para definir um responsável.</p>}
                      {selectedQueueIssue && !isLoadingRoundRobins && !roundRobinsError && <p role="alert" className="text-[11px] font-light text-[var(--app-text-secondary)]">{selectedQueueIssue}</p>}
                      {selectedQueueIssue && <Button type="button" variant="secondary" size="sm" disabled={isImporting} onClick={() => setSelectedRoundRobin('automatic')}>Usar regras automáticas</Button>}
                      <p className="text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
                        {selectedRoundRobin === 'automatic'
                          ? 'O CRM tentará selecionar uma fila ativa pelas regras do contato e pelo funil. Sem fila correspondente ou membro disponível, o resultado indicará a atribuição pendente. Responsáveis da planilha não serão aplicados.'
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
              </div>

              {activeStep === 'review' && <section className="space-y-4 text-[12px] font-light" aria-label="Revisar importação">
                <h2 className="text-[14px] font-normal">Revisar importação</h2>
                <dl className="space-y-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                  <div><dt className="text-[var(--app-text-tertiary)]">Arquivo</dt><dd className="break-words">{file?.name || 'Não selecionado'}</dd></div>
                  <div><dt className="text-[var(--app-text-tertiary)]">Linhas encontradas</dt><dd>{formatPtBRNumber(parsedData.length)}</dd></div>
                  <div><dt className="text-[var(--app-text-tertiary)]">Pipeline padrão</dt><dd>{pipelines.find((pipeline) => pipeline.id === selectedPipeline)?.name || 'Não selecionada'}</dd></div>
                  <div><dt className="text-[var(--app-text-tertiary)]">Origem padrão</dt><dd>{selectedSource === 'custom' ? customSource || 'Não informada' : sourceOptions.find((source) => source.value === selectedSource)?.label || selectedSource}</dd></div>
                </dl>
                <p className="text-[var(--app-text-secondary)]">A amostra ao lado verifica apenas o nome e o formato dos contatos. Cada linha ainda terá seu destino, responsável, tags e permissões validados ao importar.</p>
                <p className="text-[var(--app-text-tertiary)]">O processamento pode criar contatos, registrar reentradas e criar tags permitidas. O resultado mostrará também falhas e atribuições pendentes.</p>
              </section>}

              {/* Sample Download Card */}
              <div hidden={activeStep !== 'file'} className={cn("group relative overflow-hidden rounded-[6px] bg-[var(--app-surface-soft)] p-3", styles.sampleCard)}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <TagIcon className="h-4 w-4 shrink-0 text-primary" />
                      <p className="min-w-0 break-words text-[12px] font-medium text-primary">Baixe nosso novo modelo</p>
                    </div>
                    <p className="text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                      Use telefone internacional (+DDI e número). Também aceita tags, status, pipeline, estágio, origem e responsável.
                      {' '}Para preservar separadores no nome de uma tag, use uma lista JSON de nomes. Listas antigas por vírgula, ponto e vírgula ou | continuam aceitas.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    aria-label="Baixar modelo de importação"
                    className="h-9 w-9 shrink-0 self-center rounded-[6px] bg-primary/50 p-2 text-white shadow-none transition-colors hover:bg-primary/50 hover:text-white"
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

        </div>
        </FormWizardLayout>
      </DialogContent>
    </Dialog>
  );
}
