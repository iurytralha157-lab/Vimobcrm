import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Globe, FileText, Home, RefreshCw, Route, Tag } from "lucide-react";
import { useProperties } from "@/hooks/use-properties";
import { MetaForm, MetaFormConfig, useSaveFormConfig } from "@/hooks/use-meta-forms";
import { useRoundRobins } from "@/hooks/use-round-robins";
import { InlineTagSelector } from "@/components/ui/tag-selector";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";

interface MetaFormConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: MetaForm | null;
  config?: MetaFormConfig;
  integrationId: string;
  pageName?: string | null;
}

const LEAD_FIELDS = [
  { key: "name", label: "Nome" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone" },
  { key: "message", label: "Mensagem" },
  { key: "cargo", label: "Cargo" },
  { key: "empresa", label: "Empresa" },
  { key: "cidade", label: "Cidade" },
  { key: "bairro", label: "Bairro" },
  { key: "custom", label: "Campo extra" },
];

const FALLBACK_META_FIELDS = [
  { key: "full_name", label: "Full name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone_number", label: "Phone number", type: "phone" },
  { key: "message", label: "Mensagem", type: "text" },
];

const PURPOSE_OPTIONS = ["Venda", "Aluguel", "Temporada", "Permuta"];

const guessLeadField = (question: { key: string; label: string }) => {
  const text = `${question.key} ${question.label}`.toLowerCase();
  if (text.includes("nome") || text.includes("name")) return "name";
  if (text.includes("email") || text.includes("e-mail")) return "email";
  if (text.includes("phone") || text.includes("fone") || text.includes("telefone") || text.includes("whatsapp")) return "phone";
  if (text.includes("mensagem") || text.includes("message") || text.includes("observ")) return "message";
  if (text.includes("cidade") || text.includes("city")) return "cidade";
  if (text.includes("bairro") || text.includes("neighborhood")) return "bairro";
  return "";
};

export function MetaFormConfigDialog({
  open,
  onOpenChange,
  form,
  config,
  integrationId,
  pageName,
}: MetaFormConfigDialogProps) {
  const [propertyId, setPropertyId] = useState("");
  const [roundRobinId, setRoundRobinId] = useState("");
  const [purpose, setPurpose] = useState("Venda");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<string[]>([]);

  const { data: properties } = useProperties();
  const { data: allRoundRobins = [] } = useRoundRobins();
  const saveConfig = useSaveFormConfig();
  const roundRobins = open
    ? allRoundRobins.filter((queue) => queue.is_active).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (config) {
        setPropertyId(config.property_id || "");
        setRoundRobinId(config.round_robin_id || "");
        setPurpose(config.purpose || "Venda");
        setSelectedTags(config.auto_tags || []);
        setFieldMapping(config.field_mapping || {});
        setCustomFields(config.custom_fields_config || []);
        return;
      }

      const questions = form?.questions?.length ? form.questions : FALLBACK_META_FIELDS;
      setPropertyId("");
      setRoundRobinId("");
      setPurpose("Venda");
      setSelectedTags([]);
      setFieldMapping(
        Object.fromEntries(
          questions
            .map((question) => [question.key, guessLeadField(question)])
            .filter(([, value]) => value)
        )
      );
      setCustomFields([]);
    });

    return () => {
      cancelled = true;
    };
  }, [config, form, open]);

  if (!open || !form) return null;

  const formQuestions = form.questions?.length ? form.questions : FALLBACK_META_FIELDS;
  const mappedCount = Object.values(fieldMapping).filter(Boolean).length;

  const updateFieldMapping = (metaField: string, crmField: string) => {
    setFieldMapping((prev) => ({
      ...prev,
      [metaField]: crmField,
    }));

    if (crmField === "custom" && !customFields.includes(metaField)) {
      setCustomFields((prev) => [...prev, metaField]);
    } else if (crmField !== "custom" && customFields.includes(metaField)) {
      setCustomFields((prev) => prev.filter((field) => field !== metaField));
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSave = async () => {
    await saveConfig.mutateAsync({
      integrationId,
      formId: form.id,
      formName: form.name,
      propertyId: propertyId || undefined,
      roundRobinId: roundRobinId || null,
      purpose,
      source: null,
      sourceDetails: null,
      defaultValues: {
        purpose,
        property_id: propertyId || null,
        auto_tags: selectedTags,
      },
      autoTags: selectedTags,
      fieldMapping,
      customFieldsConfig: customFields,
      isActive: true,
    });

    onOpenChange(false);
  };

  return (
    <Dialog key={form.id} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-card w-[96vw] sm:max-w-4xl sm:w-full rounded-xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="border-b border-white/[0.045] px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Globe className="h-5 w-5 text-blue-600" />
            Configurar formulário Meta
          </DialogTitle>
          <DialogDescription>
            {form.name} · {pageName || "Página conectada"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[66vh]">
          <div className="space-y-5 p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Campos do lead
                  </h4>
                  <p className="text-xs text-muted-foreground">Mapeie só o que precisa entrar no CRM.</p>
                </div>
                <Badge variant="outline">{mappedCount}/{formQuestions.length}</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {formQuestions.map((question) => (
                  <div key={question.key} className="app-card-soft space-y-2 p-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{question.label || question.key}</p>
                    </div>
                    <Select
                      value={fieldMapping[question.key] || "_ignore"}
                      onValueChange={(value) => updateFieldMapping(question.key, value === "_ignore" ? "" : value)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_ignore">Ignorar</SelectItem>
                        {LEAD_FIELDS.map((field) => (
                          <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div>
                <h4 className="font-semibold flex items-center gap-2">
                  <Home className="h-4 w-4 text-primary" />
                  Configuração do lead
                </h4>
                <p className="text-xs text-muted-foreground">A origem continua vindo automaticamente da Meta.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Finalidade</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {PURPOSE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Route className="h-3.5 w-3.5 text-primary" />
                    Fila
                  </Label>
                  <Select value={roundRobinId || "_none"} onValueChange={(value) => setRoundRobinId(value === "_none" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma fila" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem fila</SelectItem>
                      {roundRobins.map((queue) => (
                        <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
                <div className="space-y-2">
                  <Label>Imóvel</Label>
                  <div className="flex gap-2">
                    <PropertyPickerDialog
                      properties={properties || []}
                      selectedPropertyId={propertyId || null}
                      onSelect={(property) => setPropertyId(property.id)}
                    />
                    {propertyId && (
                      <Button variant="outline" className="h-10 rounded-xl" onClick={() => setPropertyId("")}>
                        Limpar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    Tags
                  </Label>
                  <InlineTagSelector
                    selectedTagIds={selectedTags}
                    onToggleTag={toggleTag}
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-white/[0.045] p-4 flex-row gap-2 sm:justify-end">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="rounded-xl min-w-[140px]" onClick={handleSave} disabled={saveConfig.isPending}>
            {saveConfig.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
