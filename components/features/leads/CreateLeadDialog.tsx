import { useState, useEffect, useCallback, useRef } from 'react';
import { maskPhone } from '@/lib/masks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TagSelector } from '@/components/ui/tag-selector';
import { Loader2, User, Briefcase, Building2, DollarSign, Trophy, XCircle, CircleDot, FileText, X, Home, ChevronRight } from 'lucide-react';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationUsers } from '@/hooks/use-users';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useProperties } from '@/hooks/use-properties';
import { useCreateLead } from '@/hooks/use-leads';

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStageId?: string | null;
  defaultPipelineId?: string | null;
}

const dealStatusOptions = [
  { value: 'open', label: 'Aberto', icon: CircleDot, color: 'text-blue-500' },
  { value: 'won', label: 'Ganho', icon: Trophy, color: 'text-green-500' },
  { value: 'lost', label: 'Perdido', icon: XCircle, color: 'text-red-500' },
];

export function CreateLeadDialog({
  open,
  onOpenChange,
  defaultStageId,
  defaultPipelineId
}: CreateLeadDialogProps) {
  const { profile, organization } = useAuth();
  const { hasPermission } = useUserPermissions();
  const { data: allUsers = [] } = useOrganizationUsers();
  const users = hasPermission('lead_view_all') ? allUsers : allUsers.filter(u => u.id === profile?.id);
  const { data: pipelines = [] } = usePipelines();
  const { data: properties = [] } = useProperties();
  const createLead = useCreateLead();

  // Form state
  const [activeTab, setActiveTab] = useState('basic');
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = organization?.id ? `lead-draft-${organization.id}` : null;

  const getEmptyFormData = useCallback(() => ({
    name: '',
    phone: '',
    phone2: '',
    email: '',
    message: '',
    source: '',
    cpf: '',
    rg: '',
    birth_date: '',
    is_portability: false,
    mother_name: '',
    uf: '',
    cidade: '',
    bairro: '',
    endereco: '',
    numero: '',
    cep: '',
    plan_id: '',
    due_day: '',
    payment_method: '',
    cargo: '',
    empresa: '',
    profissao: '',
    renda_familiar: '',
    faixa_valor_imovel: '',
    valor_interesse: '',
    assigned_user_id: profile?.id || '',
    pipeline_id: defaultPipelineId || '',
    stage_id: defaultStageId || '',
    property_id: '',
    deal_status: 'open',
    is_own_resource: false,
    tag_ids: [] as string[],

  }), [profile?.id, defaultPipelineId, defaultStageId]);

  const [formData, setFormData] = useState(getEmptyFormData);
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 });
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const dialogPositionRef = useRef({ x: 0, y: 0 });
  const dragFrameRef = useRef<number | null>(null);
  const suppressOutsideCloseUntilRef = useRef(0);

  // Get stages for selected pipeline
  const { data: stages = [] } = useStages(formData.pipeline_id || undefined);

  const isFormEmpty = useCallback((data: typeof formData) => {
    return !data.name.trim()
      && !data.phone
      && !data.phone2
      && !data.email.trim()
      && !data.message.trim()
      && !data.source
      && !data.cpf
      && !data.rg
      && !data.birth_date
      && !data.mother_name
      && !data.uf
      && !data.cidade
      && !data.bairro
      && !data.endereco
      && !data.numero
      && !data.cep
      && !data.plan_id
      && !data.due_day
      && !data.payment_method
      && !data.cargo
      && !data.empresa
      && !data.profissao
      && !data.renda_familiar
      && !data.faixa_valor_imovel
      && !data.valor_interesse
      && !data.property_id
      && data.tag_ids.length === 0
      && !data.is_portability;
  }, []);

  // Save draft to localStorage with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !draftKey) return;

    if (isFormEmpty(formData)) {
      localStorage.removeItem(draftKey);
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ formData, activeTab }));
      } catch { /* quota exceeded - ignore */ }
    }, 500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [formData, activeTab, open, draftKey, isFormEmpty]);

  // Restore draft or reset form when dialog opens
  /* eslint-disable react-hooks/set-state-in-effect -- Syncs the controlled dialog opening with local draft form state. */
  useEffect(() => {
    if (open) {
      setDraftRestored(false);
      setDialogPosition({ x: 0, y: 0 });
      dialogPositionRef.current = { x: 0, y: 0 };

      if (draftKey) {
        try {
          const saved = localStorage.getItem(draftKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.formData && !isFormEmpty(parsed.formData)) {
              setFormData({ ...getEmptyFormData(), ...parsed.formData });
              if (parsed.activeTab) setActiveTab(parsed.activeTab);
              setDraftRestored(true);
              return;
            }
          }
        } catch { /* corrupted data - ignore */ }
      }

      setActiveTab('basic');
      const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
      setFormData({
        ...getEmptyFormData(),
        pipeline_id: defaultPipelineId || defaultPipeline?.id || '',
        stage_id: defaultStageId || '',
      });
    }
  }, [open, pipelines, defaultStageId, defaultPipelineId, draftKey, getEmptyFormData, isFormEmpty]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const discardDraft = useCallback(() => {
    if (draftKey) localStorage.removeItem(draftKey);
    setDraftRestored(false);
    setActiveTab('basic');
    const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
    setFormData({
      ...getEmptyFormData(),
      pipeline_id: defaultPipelineId || defaultPipeline?.id || '',
      stage_id: defaultStageId || '',
    });
  }, [draftKey, pipelines, defaultPipelineId, defaultStageId, getEmptyFormData]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && draftKey && !isFormEmpty(formData)) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ formData, activeTab }));
      } catch { /* quota exceeded - ignore */ }
    }

    onOpenChange(nextOpen);
  }, [activeTab, draftKey, formData, isFormEmpty, onOpenChange]);

  // Prevent accidental close on backdrop click when form has data
  const handleInteractOutside = useCallback((e: Event) => {
    if (dragStateRef.current || Date.now() < suppressOutsideCloseUntilRef.current || !isFormEmpty(formData)) {
      e.preventDefault();
    }
  }, [formData, isFormEmpty]);

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    suppressOutsideCloseUntilRef.current = Date.now() + 1000;

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dialogPositionRef.current.x,
      originY: dialogPositionRef.current.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const clampDialogPosition = useCallback((position: { x: number; y: number }) => {
    const dialog = dialogContentRef.current;
    if (!dialog) return position;

    const margin = 12;
    const rect = dialog.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth / 2 - rect.width / 2 - margin);
    const maxY = Math.max(0, window.innerHeight / 2 - rect.height / 2 - margin);

    return {
      x: Math.min(maxX, Math.max(-maxX, position.x)),
      y: Math.min(maxY, Math.max(-maxY, position.y)),
    };
  }, []);

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    if ((event.buttons & 1) === 0) {
      dragStateRef.current = null;
      suppressOutsideCloseUntilRef.current = Date.now() + 250;
      setDialogPosition(dialogPositionRef.current);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    dialogPositionRef.current = clampDialogPosition({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });

    if (dragFrameRef.current) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      if (!dialogContentRef.current) return;

      const { x, y } = dialogPositionRef.current;
      dialogContentRef.current.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    });
  }, [clampDialogPosition]);

  const handleDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = null;
    suppressOutsideCloseUntilRef.current = Date.now() + 250;
    setDialogPosition(dialogPositionRef.current);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Update stage when pipeline changes
  /* eslint-disable react-hooks/set-state-in-effect -- Uses async stage data to select the first available stage. */
  useEffect(() => {
    if (formData.pipeline_id && stages.length > 0 && !formData.stage_id) {
      setFormData(prev => ({ ...prev, stage_id: stages[0].id }));
    }
  }, [formData.pipeline_id, formData.stage_id, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => {
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (activeTab === 'basic') {
      if (validateBasicStep()) setActiveTab('profile');
      return;
    }

    if (activeTab === 'profile') {
      setActiveTab('management');
      return;
    }

    if (!validateBasicStep()) return;
    if (!validateManagementStep()) return;

    try {
      await createLead.mutateAsync({
        name: formData.name,
        phone: formData.phone || undefined,
        email: formData.email || undefined,
        message: formData.message || undefined,
        pipeline_id: formData.pipeline_id || undefined,
        stage_id: formData.stage_id || undefined,
        assigned_user_id: formData.assigned_user_id || undefined,
        tag_ids: formData.tag_ids.length > 0 ? formData.tag_ids : undefined,
        source: formData.source || 'manual',
        // Profile fields
        cargo: formData.cargo || undefined,
        empresa: formData.empresa || undefined,
        profissao: formData.profissao || undefined,
        renda_familiar: formData.renda_familiar || undefined,
        faixa_valor_imovel: formData.faixa_valor_imovel || undefined,
        valor_interesse: formData.valor_interesse ? parseFloat(formData.valor_interesse) : undefined,
        property_id: formData.property_id || undefined,
        deal_status: formData.deal_status || 'open',
        is_own_resource: false,
      });

      // Clear draft on success
      if (draftKey) localStorage.removeItem(draftKey);
      setDraftRestored(false);
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  const updateField = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const phoneDigits = formData.phone.replace(/\D/g, '');
  const hasValidPhone = !formData.phone || phoneDigits.length >= 10;
  const hasValidEmail = !formData.email.trim() || EMAIL_REGEX.test(formData.email.trim());
  const hasContactChannel = (!!formData.phone && hasValidPhone) || (!!formData.email.trim() && hasValidEmail);
  const hasRequiredLeadIdentity = !!formData.name.trim() && hasContactChannel;
  const hasRequiredManagement = !!formData.assigned_user_id && !!formData.pipeline_id && !!formData.stage_id;
  const selectedLeadProperty = properties.find((property) => property.id === formData.property_id);
  const selectedLeadPropertyLabel = selectedLeadProperty
    ? [selectedLeadProperty.code, selectedLeadProperty.title].filter(Boolean).join(' - ')
    : '';
  const leadDialogSurfaceClass = cn(
    "!left-1/2 !right-auto !top-1/2 !bottom-auto !h-auto max-h-[86vh] !w-[94vw] !border-0 bg-[var(--app-surface)] !p-0 text-[var(--app-text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:!w-[560px] sm:!max-w-[560px]",
    "!duration-0 !transition-none flex flex-col overflow-hidden rounded-none will-change-transform sm:rounded-[24px]",
    "data-[state=open]:!animate-none data-[state=closed]:!animate-none data-[state=closed]:!slide-out-to-right data-[state=open]:!slide-in-from-right",
    "[&_label]:text-[var(--app-text-secondary)] [&_label]:font-medium",
    "[&_input]:h-10 [&_input]:border-0 [&_input]:bg-[var(--app-surface-soft)] [&_input]:text-[var(--app-text-primary)] [&_input]:placeholder:text-[var(--app-text-tertiary)] [&_input]:shadow-none [&_input]:ring-0",
    "[&_textarea]:border-0 [&_textarea]:bg-[var(--app-surface-soft)] [&_textarea]:text-[var(--app-text-primary)] [&_textarea]:placeholder:text-[var(--app-text-tertiary)] [&_textarea]:shadow-none [&_textarea]:ring-0",
    "[&_button[role=combobox]]:h-10 [&_button[role=combobox]]:border-0 [&_button[role=combobox]]:bg-[var(--app-surface-soft)] [&_button[role=combobox]]:text-[var(--app-text-primary)] [&_button[role=combobox]]:shadow-none",
    "[&_[data-radix-collection-item]]:text-sm",
    "[&_input:focus-visible]:ring-1 [&_input:focus-visible]:ring-primary/70",
    "[&_textarea:focus-visible]:ring-1 [&_textarea:focus-visible]:ring-primary/70",
    "[&_button[role=combobox]:focus-visible]:ring-1 [&_button[role=combobox]:focus-visible]:ring-primary/70",
  );

  const validateBasicStep = () => {
    if (!formData.name.trim()) {
      toast.error('Informe o nome do lead');
      setActiveTab('basic');
      return false;
    }

    if (!formData.phone && !formData.email.trim()) {
      toast.error('Informe pelo menos um telefone ou email');
      setActiveTab('basic');
      return false;
    }

    if (formData.phone && !hasValidPhone) {
      toast.error('Telefone inválido. Informe DDD + número (mín. 10 dígitos).');
      setActiveTab('basic');
      return false;
    }

    if (formData.email.trim() && !hasValidEmail) {
      toast.error('Email inválido. Use o formato nome@dominio.com');
      setActiveTab('basic');
      return false;
    }

    return true;
  };

  const validateManagementStep = () => {
    if (!formData.assigned_user_id) {
      toast.error('Selecione o responsável');
      setActiveTab('management');
      return false;
    }

    if (!formData.pipeline_id) {
      toast.error('Selecione a pipeline');
      setActiveTab('management');
      return false;
    }

    if (!formData.stage_id) {
      toast.error('Selecione o estágio');
      setActiveTab('management');
      return false;
    }

    return true;
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || activeTab === 'management') return;

    const target = e.target as HTMLElement;
    if (
      target.tagName === 'TEXTAREA'
      || target.tagName === 'BUTTON'
      || target.closest('[role="combobox"]')
    ) {
      return;
    }

    e.preventDefault();

    if (activeTab === 'basic') {
      if (validateBasicStep()) setActiveTab('profile');
      return;
    }

    if (activeTab === 'profile') {
      setActiveTab('management');
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        data-tour="pipeline-new-lead"
        ref={dialogContentRef}
        side="right"
        className={leadDialogSurfaceClass}
        overlayClassName="!bg-black/18 !backdrop-blur-[1px]"
        onInteractOutside={handleInteractOutside}
        style={{
          transform: `translate(calc(-50% + ${dialogPosition.x}px), calc(-50% + ${dialogPosition.y}px))`,
        }}
      >
        <SheetHeader
          className="shrink-0 cursor-move select-none px-6 pb-0 pt-5"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <SheetTitle className="flex items-center gap-2 pr-9 text-[15px] font-semibold text-[var(--app-text-primary)]">
            <User className="h-4 w-4 text-primary" />
            <span>Novo Lead</span>
          </SheetTitle>
        </SheetHeader>

        {/* Draft restored banner */}
        {draftRestored && (
          <div className="mx-6 mt-2 flex items-center justify-between gap-2 rounded-xl bg-[var(--app-surface-soft)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span>Rascunho restaurado</span>
            </div>
            <button
              type="button"
              onClick={discardDraft}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
            >
              <X className="h-3 w-3" />
              Descartar
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 pb-4 pt-3">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4 grid h-10 w-full grid-cols-3 rounded-xl bg-[var(--app-surface-soft)] p-1">
                  <TabsTrigger value="basic" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Básico</TabsTrigger>
                  <TabsTrigger value="profile" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Perfil</TabsTrigger>
                  <TabsTrigger value="management" className="rounded-lg text-xs text-[var(--app-text-tertiary)] data-[state=active]:bg-primary data-[state=active]:text-white">Gestão</TabsTrigger>
                </TabsList>

                {/* Basic Info Tab */}
                <TabsContent value="basic" className="space-y-4 mt-0">
                    <div className="space-y-4">
                      {/* Real Estate: Basic Info - Clean Layout */}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Nome *</Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => updateField('name', e.target.value)}
                          placeholder="Nome do lead"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">Telefone</Label>
                          <Input
                            value={formData.phone}
                            onChange={(e) => updateField('phone', maskPhone(e.target.value))}
                            placeholder="(00) 00000-0000"
                            inputMode="tel"
                            maxLength={15}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">Email</Label>
                          <Input
                            type="email"
                            value={formData.email}
                            onChange={(e) => updateField('email', e.target.value)}
                            placeholder="email@exemplo.com"
                            pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
                            title="Informe um email válido (ex: nome@dominio.com)"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Fonte</Label>
                        <Select
                          value={formData.source || "__none__"}
                          onValueChange={(v) => updateField('source', v === "__none__" ? '' : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Como conheceu?" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Não informado</SelectItem>
                            <SelectItem value="site">Site</SelectItem>
                            <SelectItem value="indicacao">Indicação</SelectItem>
                            <SelectItem value="portais">Portais</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="facebook">Facebook</SelectItem>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                            <SelectItem value="outro">Outro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Observações</Label>
                        <Textarea
                          value={formData.message}
                          onChange={(e) => updateField('message', e.target.value)}
                          placeholder="Interesse, observações iniciais..."
                          rows={2}
                        />
                      </div>
                    </div>
                </TabsContent>

                {/* Profile/Contract Tab */}
                <TabsContent value="profile" className="space-y-4 mt-0">
                    <>
                      {/* Real Estate: Profile */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Briefcase className="h-3.5 w-3.5" />
                            Cargo
                          </Label>
                          <Input
                            value={formData.cargo}
                            onChange={(e) => updateField('cargo', e.target.value)}
                            placeholder="Ex: Gerente, Diretor..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5" />
                            Empresa
                          </Label>
                          <Input
                            value={formData.empresa}
                            onChange={(e) => updateField('empresa', e.target.value)}
                            placeholder="Nome da empresa"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Profissão</Label>
                        <Input
                          value={formData.profissao}
                          onChange={(e) => updateField('profissao', e.target.value)}
                          placeholder="Área de atuação"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <DollarSign className="h-3.5 w-3.5" />
                          Renda Familiar
                        </Label>
                        <Input
                          value={formData.renda_familiar}
                          onChange={(e) => updateField('renda_familiar', e.target.value)}
                          placeholder="Ex: R$ 10.000"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Valor de Interesse (R$)</Label>
                        <Input
                          type="number"
                          value={formData.valor_interesse}
                          onChange={(e) => updateField('valor_interesse', e.target.value)}
                          placeholder="Ex: 500000"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Home className="h-3.5 w-3.5" />
                          Imóvel de Interesse
                        </Label>
                        <PropertyPickerDialog
                          properties={properties.map((p) => ({
                            id: p.id,
                            code: p.code,
                            title: p.title,
                            bairro: p.bairro,
                            cidade: p.cidade,
                            preco: p.preco,
                            imagem_principal: p.imagem_principal,
                            tipo_de_imovel: p.tipo_de_imovel,
                            tipo_de_negocio: p.tipo_de_negocio,
                            commission_percentage: p.commission_percentage,
                          }))}
                          selectedPropertyId={formData.property_id || null}
                          onSelect={(p) => {
                            updateField('property_id', p.id);
                            if (p.preco && !formData.valor_interesse) {
                              updateField('valor_interesse', String(p.preco));
                            }
                          }}
                          trigger={
                            selectedLeadProperty ? (
                              <button
                                type="button"
                                className="flex min-h-10 w-full items-center gap-2 rounded-xl bg-transparent px-0 text-left text-sm font-medium text-primary hover:text-primary/85"
                              >
                                <Building2 className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" />
                                <span className="truncate">{selectedLeadPropertyLabel}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="flex h-10 w-full items-center justify-between rounded-xl bg-primary/20 px-3 text-left text-xs font-medium text-primary hover:bg-primary/25"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">Selecionar imóvel</span>
                                </span>
                                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                              </button>
                            )
                          }
                        />
                      </div>
                    </>
                </TabsContent>

                {/* Management Tab */}
                <TabsContent value="management" className="space-y-4 mt-0">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        Responsável
                      </Label>
                      <Select
                        value={formData.assigned_user_id}
                        onValueChange={(v) => updateField('assigned_user_id', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map(user => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status do Negócio</Label>
                      <Select
                        value={formData.deal_status}
                        onValueChange={(v) => updateField('deal_status', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dealStatusOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <div className="flex items-center gap-2">
                                <opt.icon className={`h-3.5 w-3.5 ${opt.color}`} />
                                {opt.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Pipeline</Label>
                      <Select
                        value={formData.pipeline_id}
                        onValueChange={(v) => {
                          updateField('pipeline_id', v);
                          updateField('stage_id', '');
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a pipeline" />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Estágio</Label>
                      <Select
                        value={formData.stage_id}
                        onValueChange={(v) => updateField('stage_id', v)}
                        disabled={!formData.pipeline_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o estágio" />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: s.color || "#6b7280" }}
                                />
                                {s.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>


                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <TagSelector
                      selectedTagIds={formData.tag_ids}
                      onSelectTag={(tagId) => {
                        if (!formData.tag_ids.includes(tagId)) {
                          updateField('tag_ids', [...formData.tag_ids, tagId]);
                        }
                      }}
                      onRemoveTag={(tagId) => {
                        updateField('tag_ids', formData.tag_ids.filter(id => id !== tagId));
                      }}
                      placeholder="Adicionar tags..."
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 px-6 pb-6 pt-3">
            <Button type="button" className="h-10 w-[40%] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            {activeTab !== 'management' ? (
              <Button
                type="button"
                className="h-10 w-[60%] bg-primary text-white hover:bg-primary/90"
                onClick={() => {
                  if (activeTab === 'basic') {
                    if (!validateBasicStep()) return;
                    setActiveTab('profile');
                  }
                  else if (activeTab === 'profile') setActiveTab('management');
                }}
              >
                Avançar
              </Button>
            ) : (
              <Button type="submit" className="h-10 w-[60%] bg-primary text-white hover:bg-primary/90" disabled={createLead.isPending || !hasRequiredLeadIdentity || !hasRequiredManagement}>
                {createLead.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar Lead
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
