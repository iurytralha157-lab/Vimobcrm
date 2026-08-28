import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
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
import { useImportLeads, type CreateLeadInput, type ImportLeadsResult } from '@/hooks/use-leads';
import { useTeams } from '@/hooks/use-teams';
import { useTags, useCreateTag } from '@/hooks/use-tags';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import { cn } from '@/lib/utils';
import { contactsAPI } from '@/lib/api/contacts';
import { pipelinesAPI } from '@/lib/api/pipelines';
import { parseContactsCSV } from './parse-contacts-csv';
import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedContact {
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
  [key: string]: string | undefined;
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2_000;

const getStagePosition = (stage: object) => {
  if (!('position' in stage)) return 0;

  const value = (stage as { position?: unknown }).position;
  return typeof value === 'number' ? value : 0;
};

export function ImportContactsDialog({ open, onOpenChange }: ImportContactsDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedContact[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('');
  const [selectedAssignee, setSelectedAssignee] = useState<string>('none');
  const [selectedSource, setSelectedSource] = useState<string>('import');
  const [customSource, setCustomSource] = useState<string>('');
  const [showCustomSourceInput, setShowCustomSourceInput] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<ImportLeadsResult | null>(null);
  const [isAutoDistribute, setIsAutoDistribute] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>('none');
  const [dynamicSources, setDynamicSources] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { hasPermission } = useUserPermissions();
  const canAssignImportedLeads = hasPermission('lead_operate');
  const canManageTags = hasPermission('tag_manage');

  const { data: pipelines = [] } = usePipelines();
  const { data: stagesData = [] } = useStages(selectedPipeline || undefined);
  const { data: users = [] } = useOrganizationUsers({
    enabled: open && canAssignImportedLeads,
  });
  const { data: teams = [] } = useTeams({
    enabled: open && canAssignImportedLeads && hasPermission('team_view'),
  });
  const { data: allTags = [] } = useTags({ enabled: open });
  const importLeads = useImportLeads();
  const createTag = useCreateTag();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;

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
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv'
    ];

    const normalizedName = selectedFile.name.toLowerCase();

    if (!validTypes.includes(selectedFile.type) &&
        !normalizedName.endsWith('.csv') &&
        !normalizedName.endsWith('.xlsx')) {
      toast.error('Formato inválido. Use arquivos .xlsx ou .csv');
      return;
    }

    if (selectedFile.size > MAX_IMPORT_FILE_BYTES) {
      toast.error('O arquivo deve ter no máximo 10 MB');
      return;
    }

    setFile(selectedFile);
    parseFile(selectedFile);
  };

  const parseFile = async (file: File) => {
    try {
      const jsonData: Record<string, string>[] = [];

      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        const parsedRows = parseContactsCSV(text);
        if (parsedRows.length === 0) {
          toast.error('Arquivo CSV vazio ou inválido');
          return;
        }
        jsonData.push(...parsedRows);
      } else {
        const workbook = new ExcelJS.Workbook();
        const arrayBuffer = await file.arrayBuffer();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          toast.error('Planilha vazia ou inválida');
          return;
        }

        const headers: string[] = [];

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) {
            row.eachCell((cell, colNumber) => {
              headers[colNumber - 1] = String(cell.value || '').toLowerCase().trim();
            });
          } else {
            const rowData: Record<string, string> = {};
            row.eachCell((cell, colNumber) => {
              const header = headers[colNumber - 1];
              if (header) {
                rowData[header] = String(cell.value || '');
              }
            });
            if (Object.keys(rowData).length > 0) {
              jsonData.push(rowData);
            }
          }
        });
      }

      if (jsonData.length > MAX_IMPORT_ROWS) {
        setFile(null);
        setParsedData([]);
        toast.error(`A importação aceita até ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} contatos por arquivo`);
        return;
      }

      const normalizedData = jsonData.map(row => {
        const normalized: ParsedContact = { nome: '' };
        Object.entries(row).forEach(([key, value]) => {
          const lowerKey = key.toLowerCase().trim();
          if (lowerKey === 'nome' || lowerKey === 'name') {
            normalized.nome = String(value || '');
          } else if (lowerKey === 'telefone' || lowerKey === 'phone' || lowerKey === 'tel') {
            normalized.telefone = String(value || '');
          } else if (lowerKey === 'email' || lowerKey === 'e-mail') {
            normalized.email = String(value || '');
          } else if (lowerKey === 'status' || lowerKey === 'situacao' || lowerKey === 'situação') {
            normalized.status = String(value || '');
          } else if (lowerKey === 'pipeline' || lowerKey === 'funil') {
            normalized.pipeline = String(value || '');
          } else if (lowerKey === 'estagio' || lowerKey === 'estágio' || lowerKey === 'stage' || lowerKey === 'fase') {
            normalized.estagio = String(value || '');
          } else if (lowerKey === 'responsavel' || lowerKey === 'responsável' || lowerKey === 'corretor' || lowerKey === 'assignee') {
            normalized.responsavel = String(value || '');
          } else if (lowerKey === 'tags' || lowerKey === 'etiquetas') {
            normalized.tags = String(value || '');
          } else if (lowerKey === 'fonte' || lowerKey === 'origem' || lowerKey === 'source') {
            normalized.fonte = String(value || '');
          } else if (lowerKey === 'motivo de perda' || lowerKey === 'motivo_perda' || lowerKey === 'loss_reason') {
            normalized.motivo_perda = String(value || '');
          } else if (lowerKey === 'mensagem' || lowerKey === 'message' || lowerKey === 'observacao' || lowerKey === 'observação' || lowerKey === 'note') {
            normalized.mensagem = String(value || '');
          } else {
            normalized[lowerKey] = String(value || '');
          }
        });
        return normalized;
      }).filter(row => row.nome);

      setParsedData(normalizedData);

      if (normalizedData.length === 0) {
        toast.error('Nenhum contato válido encontrado. Verifique se a coluna "nome" existe.');
      } else {
        toast.success(`${normalizedData.length} contatos encontrados`);
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      setFile(null);
      setParsedData([]);
      toast.error('Erro ao processar arquivo');
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileChange(droppedFile);
    }
  };

  const handleImport = async () => {
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

    setIsImporting(true);
    try {
      const pipelineMap = new Map<string, string>();
      pipelines.forEach(p => pipelineMap.set(p.name.toLowerCase(), p.id));

      const usersMap = new Map<string, string>();
      if (canAssignImportedLeads) {
        users.forEach(u => {
          usersMap.set(u.name.toLowerCase(), u.id);
          if (u.email) usersMap.set(u.email.toLowerCase(), u.id);
        });
      }

      const tagsMap = new Map<string, string>();
      allTags.forEach(t => tagsMap.set(t.name.toLowerCase(), t.id));

      const defaultPipelineId = selectedPipeline;
      const sortedDefaultStages = [...stagesData].sort((a, b) => (a.position || 0) - (b.position || 0));
      const defaultStageId = sortedDefaultStages[0]?.id;
      const defaultAssigneeId =
        canAssignImportedLeads && selectedAssignee !== 'none'
          ? selectedAssignee
          : undefined;
      const finalSource = selectedSource === 'custom' ? customSource.trim() : selectedSource;
      const stagesByPipeline = new Map<string, typeof stagesData>();
      stagesByPipeline.set(defaultPipelineId, sortedDefaultStages);

      const getStagesForPipeline = async (pipelineId: string) => {
        const cached = stagesByPipeline.get(pipelineId);
        if (cached) return cached;

        const stages = await pipelinesAPI.getStages(pipelineId, organizationId);
        const sorted = [...stages].sort((a, b) => getStagePosition(a) - getStagePosition(b));
        stagesByPipeline.set(pipelineId, sorted);
        return sorted;
      };

      const rows: CreateLeadInput[] = [];
      const skippedTagNames = new Set<string>();
      for (const contact of parsedData) {
        let contactPipelineId = defaultPipelineId;
        if (contact.pipeline) {
          contactPipelineId = pipelineMap.get(contact.pipeline.toLowerCase()) || defaultPipelineId;
        }

        const contactStages = await getStagesForPipeline(contactPipelineId);
        const contactStageId = contact.estagio
          ? contactStages.find(stage => stage.name.toLowerCase() === contact.estagio?.toLowerCase())?.id
            || contactStages[0]?.id
          : contactPipelineId === defaultPipelineId
            ? defaultStageId
            : contactStages[0]?.id;

        let contactAssigneeId = defaultAssigneeId;
        if (canAssignImportedLeads && contact.responsavel) {
          contactAssigneeId = usersMap.get(contact.responsavel.toLowerCase()) || defaultAssigneeId;
        }

        const tagIds: string[] = [];
        if (contact.tags) {
          const tagNames = Array.from(
            new Set(contact.tags.split(',').map(tag => tag.trim()).filter(Boolean)),
          );
          for (const tagName of tagNames) {
            let tagId = tagsMap.get(tagName.toLowerCase());
            if (!tagId && canManageTags) {
              try {
                const newTag = await createTag.mutateAsync({ name: tagName, color: DEFAULT_TAG_COLOR });
                tagId = newTag.id;
                tagsMap.set(tagName.toLowerCase(), tagId);
              } catch (error) {
                console.error('Error creating tag:', error);
              }
            }
            if (!tagId) skippedTagNames.add(tagName);
            if (tagId) tagIds.push(tagId);
          }
        }

        let dealStatus: 'open' | 'won' | 'lost' = 'open';
        if (contact.status?.toLowerCase().includes('ganho')) dealStatus = 'won';
        else if (contact.status?.toLowerCase().includes('perdido')) dealStatus = 'lost';

        rows.push({
          name: contact.nome,
          phone: contact.telefone,
          email: contact.email,
          message: contact.mensagem,
          source: contact.fonte || finalSource,
          pipeline_id: contactPipelineId,
          stage_id: contactStageId,
          assigned_user_id: contactAssigneeId,
          team_id:
            canAssignImportedLeads &&
            isAutoDistribute &&
            !contactAssigneeId &&
            selectedTeam !== 'none'
              ? selectedTeam
              : undefined,
          tag_ids: tagIds,
          deal_status: dealStatus,
          lost_reason:
            dealStatus === 'lost'
              ? contact.motivo_perda?.trim() || 'Outros: Importado sem motivo informado'
              : undefined,
          import_mode: true,
        });
      }

      if (skippedTagNames.size > 0) {
        toast.info(
          `${skippedTagNames.size} tag(s) nova(s) foram ignoradas por falta de permissão ou falha na criação`,
        );
      }

      const result = await importLeads.mutateAsync(rows);
      setImportResult(result);

      if (result.success > 0) {
        toast.success(`${result.success} contatos importados com sucesso!`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} contatos falharam na importação`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir a importação');
    } finally {
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
    setFile(null);
    setParsedData([]);
    setSelectedPipeline('');
    setSelectedAssignee('none');
    setSelectedSource('import');
    setCustomSource('');
    setShowCustomSourceInput(false);
    setIsAutoDistribute(false);
    setSelectedTeam('none');
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
            <SheetDescription className="pl-[46px] text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              Importe uma planilha mantendo pipeline, estágio, responsável, origem e tags.
            </SheetDescription>
          </SheetHeader>
        </div>

        {importResult ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-[14px] font-medium text-[var(--app-text-primary)]">Importação concluída!</p>
              <p className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                <span className="font-normal text-foreground">{importResult.success}</span> contatos importados com sucesso
                {importResult.failed > 0 && (
                  <>
                    <span className="mt-1 block text-red-500">
                      <span className="font-normal">{importResult.failed}</span> falharam durante o processo
                    </span>
                    <span className="mt-1 block max-w-[420px] text-[11px] text-[var(--app-text-tertiary)]">
                      {importResult.failures.slice(0, 3).map(failure => failure.name).join(', ')}
                      {importResult.failures.length > 3 ? ` e mais ${importResult.failures.length - 3}` : ''}
                    </span>
                  </>
                )}
              </p>
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
                  file && "bg-primary/10"
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
                      <FileSpreadsheet className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="mx-auto max-w-[300px] truncate text-[14px] font-medium text-[var(--app-text-primary)]">{file.name}</p>
                      <p className="mt-1 text-[12px] font-light text-primary">{parsedData.length} contatos encontrados para importar</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2 h-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                      onClick={() => fileInputRef.current?.click()}
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
                  <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
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
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 rounded-[6px] px-3 text-[11px] font-light"
                        onClick={() => {
                          setShowCustomSourceInput(false);
                          setSelectedSource('import');
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Select value={selectedSource} onValueChange={(val) => {
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
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Aplicar as regras e horários da equipe</p>
                      </div>
                    </div>
                    <Switch
                      checked={isAutoDistribute}
                      onCheckedChange={setIsAutoDistribute}
                      aria-label="Ativar distribuição automática dos contatos importados"
                    />
                  </div>

                  {isAutoDistribute ? (
                    <div className="grid grid-cols-1 gap-4 animate-in fade-in slide-in-from-top-2 duration-300 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-light">Distribuir para equipe</Label>
                        <Select
                          value={selectedTeam}
                          onValueChange={(value) => {
                            setSelectedTeam(value);
                            if (value !== 'none') setSelectedAssignee('none');
                          }}
                        >
                          <SelectTrigger aria-label="Equipe para distribuição automática" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                            <SelectValue placeholder="Selecione a equipe" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhuma equipe</SelectItem>
                            {teams.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-light">Ou usuário específico</Label>
                        <Select
                          value={selectedAssignee}
                          onValueChange={(value) => {
                            setSelectedAssignee(value);
                            if (value !== 'none') setSelectedTeam('none');
                          }}
                        >
                          <SelectTrigger aria-label="Responsável específico da importação" className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                            <SelectValue placeholder="Nenhum" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {users.map(u => (
                              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-2 text-[12px] font-light">
                        <UserIcon className="h-4 w-4 text-primary" />
                        Responsável único
                      </Label>
                      <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
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
              disabled={!file || !selectedPipeline || parsedData.length === 0 || isImporting}
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processando {parsedData.length} leads...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 mr-2" />
                  Iniciar importação {parsedData.length > 0 ? `(${parsedData.length})` : ''}
                </>
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
