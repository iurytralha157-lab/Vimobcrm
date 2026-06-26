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
import { useCreateLead } from '@/hooks/use-leads';
import { useTeams } from '@/hooks/use-teams';
import { useTags, useCreateTag } from '@/hooks/use-tags';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import { cn } from '@/lib/utils';
import { contactsAPI } from '@/lib/api/contacts';
import { pipelinesAPI } from '@/lib/api/pipelines';

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
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null);
  const [isAutoDistribute, setIsAutoDistribute] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>('none');
  const [dynamicSources, setDynamicSources] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: pipelines = [] } = usePipelines();
  const { data: stagesData = [] } = useStages(selectedPipeline || undefined);
  const { data: users = [] } = useOrganizationUsers();
  const { data: teams = [] } = useTeams();
  const { data: allTags = [] } = useTags();
  const createLead = useCreateLead();
  const createTag = useCreateTag();
  const { organization } = useAuth();

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
    const fetchSources = async () => {
      if (!organization?.id) {
        setDynamicSources([]);
        return;
      }

      const contacts = await contactsAPI.list({ page: 1, limit: 200 });
      const uniqueSources = Array.from(new Set(contacts.map(contact => contact.source))).filter(Boolean);
      setDynamicSources(uniqueSources);
    };
    fetchSources();
  }, [organization?.id]);

  const handleFileChange = (selectedFile: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv'
    ];

    if (!validTypes.includes(selectedFile.type) &&
        !selectedFile.name.endsWith('.csv') &&
        !selectedFile.name.endsWith('.xlsx') &&
        !selectedFile.name.endsWith('.xls')) {
      toast.error('Formato inválido. Use arquivos .xlsx, .xls ou .csv');
      return;
    }

    setFile(selectedFile);
    parseFile(selectedFile);
  };

  const parseFile = async (file: File) => {
    try {
      const jsonData: Record<string, string>[] = [];

      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length < 2) {
          toast.error('Arquivo CSV vazio ou inválido');
          return;
        }

        const headers = lines[0].split(/[,;]/).map(h => h.replace(/^["']|["']$/g, '').toLowerCase().trim());

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(/[,;]/).map(v => v.replace(/^["']|["']$/g, '').trim());
          const row: Record<string, string> = {};
          headers.forEach((header, index) => {
            if (header && values[index] !== undefined) {
              row[header] = values[index];
            }
          });
          if (Object.keys(row).length > 0) {
            jsonData.push(row);
          }
        }
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

    setIsImporting(true);
    let success = 0;
    let failed = 0;

    // Cache common lookups
    const pipelineMap = new Map<string, string>();
    pipelines.forEach(p => pipelineMap.set(p.name.toLowerCase(), p.id));

    const usersMap = new Map<string, string>();
    users.forEach(u => {
      usersMap.set(u.name.toLowerCase(), u.id);
      if (u.email) usersMap.set(u.email.toLowerCase(), u.id);
    });

    const tagsMap = new Map<string, string>();
    allTags.forEach(t => tagsMap.set(t.name.toLowerCase(), t.id));

    // Default values from modal
    const defaultPipelineId = selectedPipeline;
    const sortedDefaultStages = [...stagesData].sort((a, b) => (a.position || 0) - (b.position || 0));
    const defaultStageId = sortedDefaultStages.length > 0 ? sortedDefaultStages[0].id : undefined;
    const defaultAssigneeId = selectedAssignee !== 'none' ? selectedAssignee : undefined;
    const finalSource = selectedSource === 'custom' ? customSource : selectedSource;
    const stagesByPipeline = new Map<string, typeof stagesData>();
    stagesByPipeline.set(defaultPipelineId, sortedDefaultStages);

    const getStagesForPipeline = async (pipelineId: string) => {
      const cached = stagesByPipeline.get(pipelineId);
      if (cached) return cached;

      const stages = await pipelinesAPI.getStages(pipelineId, organization?.id);
      const sorted = [...stages].sort((a, b) => getStagePosition(a) - getStagePosition(b));
      stagesByPipeline.set(pipelineId, sorted);
      return sorted;
    };

    for (const contact of parsedData) {
      try {
        // 1. Resolve Pipeline
        let contactPipelineId = defaultPipelineId;
        if (contact.pipeline) {
          const found = pipelineMap.get(contact.pipeline.toLowerCase());
          if (found) contactPipelineId = found;
        }

        // 2. Resolve Stage
        let contactStageId = defaultStageId;
        if (contact.estagio) {
          const contactStages = await getStagesForPipeline(contactPipelineId);

          if (contactStages.length > 0) {
            const found = contactStages.find(s => s.name.toLowerCase() === contact.estagio?.toLowerCase());
            if (found) {
              contactStageId = found.id;
            } else {
              // Default to first stage of this pipeline
              const first = contactStages[0];
              if (first) contactStageId = first.id;
            }
          }
        }

        // 3. Resolve Assignee
        let contactAssigneeId = defaultAssigneeId;
        if (contact.responsavel) {
          const found = usersMap.get(contact.responsavel.toLowerCase());
          if (found) contactAssigneeId = found;
        }

        // 4. Resolve Tags
        const tagIds: string[] = [];
        if (contact.tags) {
          const tagNames = contact.tags.split(',').map(t => t.trim()).filter(Boolean);
          for (const tagName of tagNames) {
            let tagId = tagsMap.get(tagName.toLowerCase());
            if (!tagId) {
              // Create new tag
              try {
                const newTag = await createTag.mutateAsync({ name: tagName, color: '#6b7280' });
                tagId = newTag.id;
                tagsMap.set(tagName.toLowerCase(), tagId);
              } catch (e) {
                console.error('Error creating tag:', e);
              }
            }
            if (tagId) tagIds.push(tagId);
          }
        }

        // 5. Status mapping
        let dealStatus = 'open';
        if (contact.status?.toLowerCase().includes('ganho')) dealStatus = 'won';
        else if (contact.status?.toLowerCase().includes('perdido')) dealStatus = 'lost';

        // 6. Distribution logic (if applicable)
        let finalAssigneeId = contactAssigneeId;
        if (isAutoDistribute && !contactAssigneeId) {
          if (selectedTeam !== 'none') {
            const team = teams.find(t => t.id === selectedTeam);
            if (team && team.members && team.members.length > 0) {
              // Simple balanced distribution for import
              const memberIndex = success % team.members.length;
              finalAssigneeId = team.members[memberIndex].user_id;
            }
          }
        }

        await createLead.mutateAsync({
          name: contact.nome,
          phone: contact.telefone,
          email: contact.email,
          message: contact.mensagem,
          source: contact.fonte || finalSource,
          pipeline_id: contactPipelineId,
          stage_id: contactStageId,
          assigned_user_id: finalAssigneeId,
          tag_ids: tagIds,
          deal_status: dealStatus,
          lost_reason: contact.motivo_perda,
        });
        success++;
      } catch (error) {
        console.error('Failed to import row:', contact, error);
        failed++;
      }
    }

    setImportResult({ success, failed });
    setIsImporting(false);

    if (success > 0) {
      toast.success(`${success} contatos importados com sucesso!`);
    }
    if (failed > 0) {
      toast.error(`${failed} contatos falharam na importação`);
    }
  };

  const downloadSample = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contatos');

    worksheet.columns = [
      { header: 'Nome', key: 'Nome', width: 25 },
      { header: 'Telefone', key: 'Telefone', width: 18 },
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
        Telefone: '5511999998888',
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
        Telefone: '5511977776666',
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
        Telefone: '5511955554444',
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
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao_completa_crm.xlsx';
    link.click();
    URL.revokeObjectURL(link.href);
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
    if (!open) {
      resetDialog();
    }
    onOpenChange(open);
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-[94%] sm:w-[560px] sm:max-w-[560px] p-0 flex flex-col h-full border-0 bg-[var(--app-background)]">
        <div className="p-5 bg-[var(--app-surface)]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <Upload className="h-5 w-5 text-primary" />
              Importar contatos/leads
            </SheetTitle>
            <SheetDescription className="text-xs">
              Importe uma planilha mantendo pipeline, estágio, responsável, origem e tags.
            </SheetDescription>
          </SheetHeader>
        </div>

        {importResult ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-5">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-xl font-bold">Importação concluída!</p>
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">{importResult.success}</span> contatos importados com sucesso
                {importResult.failed > 0 && (
                  <span className="block mt-1 text-red-500">
                    <span className="font-semibold">{importResult.failed}</span> falharam durante o processo
                  </span>
                )}
              </p>
            </div>
            <Button onClick={() => handleClose(false)} className="h-10 rounded-lg px-6 shadow-none">
              Concluir e ver leads
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Drop Zone */}
              <div
                className={cn(
                  "rounded-lg p-5 text-center transition-colors duration-200 cursor-pointer group bg-[var(--app-surface-soft)]",
                  isDragging ? "bg-primary/10 ring-2 ring-primary/15" : "hover:bg-[var(--app-hover)]",
                  file && "bg-primary/10"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                  className="hidden"
                />

                {file ? (
                  <div className="space-y-3">
                    <div className="h-11 w-11 bg-primary/15 rounded-lg flex items-center justify-center mx-auto">
                      <FileSpreadsheet className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-base truncate max-w-[300px] mx-auto">{file.name}</p>
                      <p className="text-sm text-primary font-medium mt-1">{parsedData.length} contatos encontrados para importar</p>
                    </div>
                    <Button variant="secondary" size="sm" className="h-8 text-xs rounded-lg mt-2 border-0 shadow-none">Alterar arquivo</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="h-11 w-11 bg-[var(--app-surface)] rounded-lg flex items-center justify-center mx-auto group-hover:bg-primary/10 transition-colors">
                      <Upload className="h-6 w-6 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-base">Arraste sua planilha aqui</p>
                      <p className="text-sm text-muted-foreground mt-1">Compatível com Excel (.xlsx) e CSV</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Pipeline Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    Pipeline Padrão
                  </Label>
                  <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
                    <SelectTrigger className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none">
                      <SelectValue placeholder="Selecione o funil de destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground leading-tight italic">
                    * Se não houver pipeline na planilha, usaremos esta.
                  </p>
                </div>

                {/* Source Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <Upload className="h-4 w-4 text-primary" />
                    Origem Padrão
                  </Label>
                  {showCustomSourceInput ? (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Nome da origem..."
                        className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none"
                        value={customSource}
                        onChange={(e) => setCustomSource(e.target.value)}
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 px-3"
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
                        setShowCustomSourceInput(true);
                      } else {
                        setSelectedSource(val);
                      }
                    }}>
                      <SelectTrigger className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none">
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
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between rounded-lg bg-[var(--app-surface-soft)] p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold">Distribuição automática</p>
                      <p className="text-[11px] text-muted-foreground">Dividir leads entre equipe ou usuário</p>
                    </div>
                  </div>
                  <Switch checked={isAutoDistribute} onCheckedChange={setIsAutoDistribute} />
                </div>

                {isAutoDistribute ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Distribuir para Equipe</Label>
                      <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                        <SelectTrigger className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none">
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
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Ou Usuário Específico</Label>
                      <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                        <SelectTrigger className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none">
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
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold flex items-center gap-2">
                      <UserIcon className="h-4 w-4 text-primary" />
                      Responsável Único
                    </Label>
                    <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                      <SelectTrigger className="h-10 rounded-lg border-0 bg-[var(--app-surface-soft)] shadow-none">
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

              {/* Sample Download Card */}
              <div className="relative group overflow-hidden rounded-lg bg-primary/10 p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <TagIcon className="h-4 w-4 text-primary" />
                      <p className="text-sm font-bold text-primary">Baixe nosso novo modelo</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed pr-8">
                      Compatível com tags separadas por vírgula, status, pipeline, estágio, origem e responsável.
                    </p>
                  </div>
                  <Button
                    variant="link"
                    className="p-0 h-auto text-primary group-hover:scale-110 transition-transform"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadSample();
                    }}
                  >
                    <Download className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!importResult && (
          <div className="p-5 bg-[var(--app-surface)] flex gap-3">
            <Button variant="ghost" className="flex-1 h-10 rounded-lg border-0 shadow-none" onClick={() => handleClose(false)}>
              Cancelar
            </Button>
            <Button
              className="flex-[2] h-10 rounded-lg font-bold shadow-none"
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
