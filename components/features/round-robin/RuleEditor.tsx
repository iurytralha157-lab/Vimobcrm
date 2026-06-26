import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { X, Plus, Clock, Loader2 } from 'lucide-react';
import { usePipelines } from '@/hooks/use-stages';
import { useTags } from '@/hooks/use-tags';
import { RuleMatch } from '@/hooks/use-round-robin-rules';

const SOURCES = [
  { value: 'meta', label: 'Meta Ads' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'manual', label: 'Manual' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'site', label: 'Site' },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

interface RuleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (rule: { name: string; match: RuleMatch; priority: number; is_active: boolean }) => void;
  initialData?: {
    name?: string;
    match?: RuleMatch;
    priority?: number;
    is_active?: boolean;
  };
  isLoading?: boolean;
}

export function RuleEditor({
  open,
  onOpenChange,
  onSave,
  initialData,
  isLoading
}: RuleEditorProps) {
  const { data: pipelines = [] } = usePipelines();
  const { data: tags = [] } = useTags();

  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [isActive, setIsActive] = useState(true);

  // Match fields
  const [pipelineId, setPipelineId] = useState<string>('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [campaignContains, setCampaignContains] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [newCity, setNewCity] = useState('');

  // Schedule
  const [useSchedule, setUseSchedule] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleStart, setScheduleStart] = useState('08:00');
  const [scheduleEnd, setScheduleEnd] = useState('18:00');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (initialData) {
        setName(initialData.name || '');
        setPriority(initialData.priority || 100);
        setIsActive(initialData.is_active ?? true);

        const match = initialData.match || {};
        setPipelineId(match.pipeline_id || '');
        setSelectedSources(match.source || []);
        setCampaignContains(match.campaign_name_contains || '');
        setSelectedTags(match.tag_in || []);
        setCities(match.city_in || []);

        if (match.schedule) {
          setUseSchedule(true);
          setScheduleDays(match.schedule.days || [1, 2, 3, 4, 5]);
          setScheduleStart(match.schedule.start || '08:00');
          setScheduleEnd(match.schedule.end || '18:00');
        } else {
          setUseSchedule(false);
        }
      } else {
        // Reset form
        setName('');
        setPriority(100);
        setIsActive(true);
        setPipelineId('');
        setSelectedSources([]);
        setCampaignContains('');
        setSelectedTags([]);
        setCities([]);
        setUseSchedule(false);
        setScheduleDays([1, 2, 3, 4, 5]);
        setScheduleStart('08:00');
        setScheduleEnd('18:00');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, initialData]);

  const handleSave = () => {
    const match: RuleMatch = {};

    if (pipelineId) match.pipeline_id = pipelineId;
    if (selectedSources.length > 0) match.source = selectedSources;
    if (campaignContains) match.campaign_name_contains = campaignContains;
    if (selectedTags.length > 0) match.tag_in = selectedTags;
    if (cities.length > 0) match.city_in = cities.map(c => c.toLowerCase());

    if (useSchedule) {
      match.schedule = {
        days: scheduleDays,
        start: scheduleStart,
        end: scheduleEnd,
      };
    }

    onSave({
      name,
      match,
      priority,
      is_active: isActive,
    });
  };

  const toggleSource = (source: string) => {
    setSelectedSources(prev =>
      prev.includes(source)
        ? prev.filter(s => s !== source)
        : [...prev, source]
    );
  };

  const toggleTag = (tagName: string) => {
    setSelectedTags(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const toggleDay = (day: number) => {
    setScheduleDays(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day].sort()
    );
  };

  const addCity = () => {
    if (newCity.trim() && !cities.includes(newCity.trim())) {
      setCities([...cities, newCity.trim()]);
      setNewCity('');
    }
  };

  const removeCity = (city: string) => {
    setCities(cities.filter(c => c !== city));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {initialData ? 'Editar Regra' : 'Nova Regra de Distribuição'}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome da Regra</Label>
              <Input
                placeholder="Ex: Leads Meta - Campanha X"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Prioridade (menor = primeiro)</Label>
              <Input
                type="number"
                min={1}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 100)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Regra ativa</Label>
          </div>

          {/* Pipeline */}
          <div className="space-y-2">
            <Label>Pipeline (opcional)</Label>
            <Select value={pipelineId || "__none__"} onValueChange={(v) => setPipelineId(v === "__none__" ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Qualquer pipeline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Qualquer pipeline</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sources */}
          <div className="space-y-2">
            <Label>Fontes</Label>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => (
                <Badge
                  key={source.value}
                  variant={selectedSources.includes(source.value) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleSource(source.value)}
                >
                  {source.label}
                </Badge>
              ))}
            </div>
            {selectedSources.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma selecionada = todas as fontes</p>
            )}
          </div>

          {/* Campaign Contains */}
          <div className="space-y-2">
            <Label>Nome da campanha contém</Label>
            <Input
              placeholder="Ex: ALPHAVILLE"
              value={campaignContains}
              onChange={(e) => setCampaignContains(e.target.value)}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags (lead deve ter alguma)</Label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant={selectedTags.includes(tag.name) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  style={{
                    backgroundColor: selectedTags.includes(tag.name) ? tag.color : 'transparent',
                    borderColor: tag.color,
                    color: selectedTags.includes(tag.name) ? 'white' : tag.color,
                  }}
                  onClick={() => toggleTag(tag.name)}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Cities */}
          <div className="space-y-2">
            <Label>Cidades</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Adicionar cidade..."
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCity())}
              />
              <Button type="button" variant="outline" onClick={addCity}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {cities.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {cities.map((city) => (
                  <Badge key={city} variant="secondary" className="gap-1">
                    {city}
                    <button onClick={() => removeCity(city)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="space-y-4 p-4 border rounded-lg">
            <div className="flex items-center gap-2">
              <Checkbox
                id="use-schedule"
                checked={useSchedule}
                onCheckedChange={(checked) => setUseSchedule(!!checked)}
              />
              <Label htmlFor="use-schedule" className="flex items-center gap-2 cursor-pointer">
                <Clock className="h-4 w-4" />
                Limitar por horário
              </Label>
            </div>

            {useSchedule && (
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label className="text-sm">Dias da semana</Label>
                  <div className="flex gap-1">
                    {DAYS_OF_WEEK.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={scheduleDays.includes(day.value) ? 'default' : 'outline'}
                        size="sm"
                        className="w-10"
                        onClick={() => toggleDay(day.value)}
                      >
                        {day.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Início</Label>
                    <Input
                      type="time"
                      value={scheduleStart}
                      onChange={(e) => setScheduleStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Fim</Label>
                    <Input
                      type="time"
                      value={scheduleEnd}
                      onChange={(e) => setScheduleEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="w-[60%] rounded-xl" onClick={handleSave} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
