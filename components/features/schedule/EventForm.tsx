import { useState, useEffect } from 'react';
import { format, addMinutes, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Phone,
  Mail,
  Calendar as CalendarIcon,
  CheckSquare,
  MessageSquare,
  MapPin,
  X,
  Trash2,
  Edit2,
  User,
  Search,
  Clock
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn, getCurrentTimeForInput, getBrasiliaTime } from '@/lib/utils';
import { useCreateScheduleEvent, useUpdateScheduleEvent, useDeleteScheduleEvent, EventType, ScheduleEvent } from '@/hooks/use-schedule-events';
import { useUsers } from '@/hooks/use-users';
import { useLeads } from '@/hooks/use-leads';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

const eventTypes: { type: EventType; label: string; icon: React.ElementType }[] = [
  { type: 'call', label: 'Ligar', icon: Phone },
  { type: 'email', label: 'E-mail', icon: Mail },
  { type: 'meeting', label: 'Reunião', icon: CalendarIcon },
  { type: 'task', label: 'Tarefa', icon: CheckSquare },
  { type: 'message', label: 'Mensagem', icon: MessageSquare },
  { type: 'visit', label: 'Visita', icon: MapPin },
];

const durationOptions = [
  { value: 15, label: '15 min.' },
  { value: 20, label: '20 min.' },
  { value: 30, label: '30 min.' },
  { value: 45, label: '45 min.' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
];

interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: ScheduleEvent | null;
  leadId?: string;
  leadName?: string;
  defaultUserId?: string;
  defaultDate?: Date;
  defaultType?: EventType;
}

export function EventForm({ open, onOpenChange, event, leadId, leadName, defaultUserId, defaultDate, defaultType }: EventFormProps) {
  const { data: users = [] } = useUsers();
  const createEvent = useCreateScheduleEvent();
  const updateEvent = useUpdateScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();

  const [selectedType, setSelectedType] = useState<EventType>('call');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);

  // Lead search states
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadName, setSelectedLeadName] = useState<string | null>(null);
  const [showLeadSelector, setShowLeadSelector] = useState(false);

  const { data: searchedLeads = [] } = useLeads({ search: leadSearch, limit: 5 });

  // Reset form when event changes or dialog opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (event) {
        // Editing existing event - Start in View Mode
        setIsViewMode(true);
        setSelectedType((event.event_type as EventType) || 'call');
        setTitle(event.title || '');
        setDescription(event.description || '');
        setSelectedUserId(event.user_id || defaultUserId || '');
        setDate(event.start_time ? new Date(event.start_time) : getBrasiliaTime());
        setTime(event.start_time ? format(new Date(event.start_time), 'HH:mm') : getCurrentTimeForInput());
        setSelectedLeadId(event.lead_id || null);
        setSelectedLeadName(event.lead?.name || null);

        if (event.start_time && event.end_time) {
          const calculatedDuration = differenceInMinutes(new Date(event.end_time), new Date(event.start_time));
          setDuration(calculatedDuration > 0 ? calculatedDuration : 30);
        } else {
          setDuration(30);
        }
        setIsCompleted(event.status === 'completed');
      } else {
        // Creating new event - Start in Edit Mode
        setIsViewMode(false);
        const initialType = defaultType || 'call';
        setSelectedType(initialType);
        setTitle('');
        setDescription('');
        setSelectedUserId(defaultUserId || '');
        setDate(defaultDate || getBrasiliaTime());
        setTime(defaultDate ? format(defaultDate, 'HH:mm') : getCurrentTimeForInput());
        setSelectedLeadId(leadId || null);
        setSelectedLeadName(leadName || null);
        setDuration(initialType === 'visit' ? 60 : 30);
        setIsCompleted(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, event, defaultUserId, defaultDate, leadId, leadName, defaultType]);

  // Update duration automatically when type changes to 'visit' for NEW events
  useEffect(() => {
    if (event || isViewMode || selectedType !== 'visit') return;

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setDuration(60);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedType, event, isViewMode]);

  const maxDescriptionLength = 280;
  const remainingChars = maxDescriptionLength - (description?.length || 0);

  const handleSubmit = async () => {
    if (!title.trim() || !date || !selectedUserId) return;

    const [hours, minutes] = time.split(':').map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);
    const endTime = addMinutes(startTime, duration);

    const eventData = {
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: selectedType,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      is_all_day: false,
      user_id: selectedUserId,
      lead_id: selectedLeadId || undefined,
    };

    if (event) {
      await updateEvent.mutateAsync({ id: event.id, ...eventData, status: isCompleted ? 'completed' : 'scheduled' });
    } else {
      await createEvent.mutateAsync(eventData);
    }

    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!event) return;
    await deleteEvent.mutateAsync({ id: event.id });
    onOpenChange(false);
  };

  const isLoading = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;
  const currentEventType = eventTypes.find(t => t.type === selectedType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90%] sm:max-w-[550px] sm:w-full rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
        <DialogHeader className={cn(
          "px-8 py-6 text-white",
          isViewMode ? "bg-slate-800" : "bg-primary"
        )}>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
              {isViewMode ? (
                <>
                  <Clock className="h-6 w-6" />
                  Detalhes da Atividade
                </>
              ) : (
                <>
                  {event ? <Edit2 className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
                  {event ? 'Editar Atividade' : 'Novo Agendamento'}
                </>
              )}
            </DialogTitle>
            {isViewMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsViewMode(false)}
                className="text-white hover:bg-white/10 rounded-xl font-bold gap-2"
              >
                <Edit2 className="h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="p-8 space-y-6 bg-background">
          {/* Lead Selection */}
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
              Lead Relacionado
            </Label>
            {isViewMode ? (
              <div className="flex items-center gap-3 p-4 bg-white/[0.045] rounded-2xl border border-white/[0.055]">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-black">{selectedLeadName || 'Sem lead vinculado'}</p>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Atribuído ao lead</p>
                </div>
              </div>
            ) : (
              <div className="relative">
                {selectedLeadId ? (
                  <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/20 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <User className="h-5 w-5 text-primary" />
                      <span className="text-sm font-bold">{selectedLeadName}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-primary/10"
                      onClick={() => {
                        setSelectedLeadId(null);
                        setSelectedLeadName(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Popover open={showLeadSelector} onOpenChange={setShowLeadSelector}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start rounded-2xl h-12 border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 text-muted-foreground font-bold">
                        <Search className="mr-2 h-4 w-4" />
                        Vincular um lead...
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[400px]" align="start">
                      <Command className="rounded-xl">
                        <CommandInput
                          placeholder="Buscar por nome, telefone ou email..."
                          value={leadSearch}
                          onValueChange={setLeadSearch}
                        />
                        <CommandList>
                          <CommandEmpty>Nenhum lead encontrado.</CommandEmpty>
                          <CommandGroup>
                            {searchedLeads.map((lead) => (
                              <CommandItem
                                key={lead.id}
                                onSelect={() => {
                                  setSelectedLeadId(lead.id);
                                  setSelectedLeadName(lead.name);
                                  setShowLeadSelector(false);
                                }}
                                className="flex items-center gap-3 p-3 cursor-pointer"
                              >
                                <div className="h-8 w-8 rounded-lg bg-white/[0.06] flex items-center justify-center">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-sm">{lead.name}</span>
                                  <span className="text-[10px] text-muted-foreground">{lead.phone || lead.email}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>

          {/* Event Type */}
          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
              Tipo de Atividade
            </Label>
            {isViewMode ? (
              <div className="flex items-center gap-3 p-2">
                <div className={cn(
                  "h-12 w-12 rounded-2xl flex items-center justify-center text-white shadow-lg",
                  selectedType === 'call' && "bg-blue-600 shadow-blue-500/20",
                  selectedType === 'meeting' && "bg-purple-600 shadow-purple-500/20",
                  selectedType === 'message' && "bg-emerald-600 shadow-emerald-500/20",
                  selectedType === 'visit' && "bg-pink-600 shadow-pink-500/20",
                  selectedType === 'task' && "bg-amber-500 shadow-amber-500/20",
                  selectedType === 'email' && "bg-orange-500 shadow-orange-500/20",
                )}>
                  {currentEventType && <currentEventType.icon className="h-6 w-6" />}
                </div>
                <span className="text-lg font-black">{currentEventType?.label}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {eventTypes.map(({ type, label, icon: Icon }) => (
                  <Button
                    key={type}
                    type="button"
                    variant={selectedType === type ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      "rounded-xl h-10 font-bold gap-2 transition-all",
                      selectedType === type ? "shadow-md scale-105" : "bg-white/[0.035] border-white/[0.055] hover:bg-white/[0.055]"
                    )}
                    onClick={() => setSelectedType(type)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Assunto</Label>
              {isViewMode ? (
                <p className="text-base font-bold p-1">{title}</p>
              ) : (
                <Input
                  placeholder="Ex: Ligar para cliente"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-xl h-12 border-white/[0.055] font-bold"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Responsável</Label>
              {isViewMode ? (
                <p className="text-base font-bold p-1">
                  {users.find(u => u.id === selectedUserId)?.name || 'Nenhum'}
                </p>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="rounded-xl h-12 border-white/[0.055] font-bold">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id} className="font-bold">
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Data</Label>
              {isViewMode ? (
                <p className="text-sm font-bold p-1">{date ? format(date, 'dd/MM/yyyy') : '-'}</p>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start rounded-xl h-12 border-white/[0.055] font-bold",
                        !date && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, 'dd/MM/yy') : 'Selecione'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Hora</Label>
              {isViewMode ? (
                <p className="text-sm font-bold p-1">{time}</p>
              ) : (
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rounded-xl h-12 border-white/[0.055] font-bold"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Duração</Label>
              {isViewMode ? (
                <p className="text-sm font-bold p-1">{durationOptions.find(o => o.value === duration)?.label}</p>
              ) : (
                <Select value={duration.toString()} onValueChange={(v) => setDuration(Number(v))}>
                  <SelectTrigger className="rounded-xl h-12 border-white/[0.055] font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {durationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()} className="font-bold">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Descrição</Label>
            {isViewMode ? (
              <p className="text-sm font-medium p-1 text-muted-foreground italic">
                {description || 'Sem descrição'}
              </p>
            ) : (
              <>
                <Textarea
                  placeholder="Adicione observações importantes..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, maxDescriptionLength))}
                  rows={3}
                  className="rounded-2xl border-white/[0.055] font-medium"
                />
                <p className="text-[10px] text-muted-foreground text-right font-black uppercase tracking-tighter">
                  {remainingChars} caracteres restantes
                </p>
              </>
            )}
          </div>

          {!isViewMode && (
            <div className="flex items-center gap-3 p-4 bg-white/[0.035] rounded-2xl border border-dashed border-white/[0.08]">
              <Checkbox
                id="completed"
                checked={isCompleted}
                onCheckedChange={(checked) => setIsCompleted(checked as boolean)}
                className="h-5 w-5 rounded-md"
              />
              <Label htmlFor="completed" className="text-sm font-bold cursor-pointer">
                Marcar esta atividade como concluída agora
              </Label>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 gap-4">
            {event && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl font-bold gap-2">
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-3xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-black uppercase tracking-tight">Excluir atividade?</AlertDialogTitle>
                    <AlertDialogDescription className="font-medium">
                      Esta ação não pode ser desfeita. A atividade será removida permanentemente da agenda.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl font-bold">Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl font-bold">
                      Confirmar Exclusão
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {!isViewMode && (
              <div className="flex gap-3 ml-auto w-full md:w-auto">
                <Button
                  variant="outline"
                  className="flex-1 md:flex-none md:min-w-[120px] rounded-xl font-bold"
                  onClick={() => event ? setIsViewMode(true) : onOpenChange(false)}
                  disabled={isLoading}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 md:flex-none md:min-w-[150px] rounded-xl font-black uppercase tracking-tight shadow-lg shadow-primary/20"
                  onClick={handleSubmit}
                  disabled={isLoading || !title.trim() || !selectedUserId}
                >
                  {isLoading ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Plus = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);
