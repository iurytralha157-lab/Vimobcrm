import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, UserPlus, Building2 } from "lucide-react";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useCreateLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactPhone?: string;
  contactName?: string;
  conversationId?: string;
}

export function CreateLeadDialog({
  open,
  onOpenChange,
  contactPhone,
  contactName,
  conversationId,
}: CreateLeadDialogProps) {
  const { profile } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");

  const { data: pipelines = [], isLoading: loadingPipelines } = usePipelines();
  const { data: stages = [], isLoading: loadingStages } = useStages(selectedPipelineId || undefined);
  const { data: properties = [], isLoading: loadingProperties } = useProperties();
  const createLead = useCreateLead();

  // Set initial values when dialog opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setName(contactName || "");
      setPhone(contactPhone || "");
      setEmail("");
      setMessage("");
      setSelectedPropertyId("");

      // Select default pipeline
      const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
      if (defaultPipeline) {
        setSelectedPipelineId(defaultPipeline.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, contactName, contactPhone, pipelines]);

  // Select first stage when pipeline changes
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (stages.length > 0) {
        const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
        setSelectedStageId(firstStage.id);
      } else {
        setSelectedStageId("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Por favor, informe o nome do lead",
        variant: "destructive",
      });
      return;
    }

    try {
      // Get property code if property is selected
      const selectedProperty = properties.find(p => p.id === selectedPropertyId);

      await createLead.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        message: message.trim() || undefined,
        pipeline_id: selectedPipelineId || undefined,
        stage_id: selectedStageId || undefined,
        property_code: selectedProperty?.code || undefined,
        property_id: selectedPropertyId || undefined,
        source: "whatsapp",
        assigned_user_id: profile?.id,
        conversation_id: conversationId,
      });

      toast({
        title: "Lead criado",
        description: "O lead foi criado com sucesso",
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Error creating lead:", error);
      toast({
        title: "Erro ao criar lead",
        description: "Não foi possível criar o lead",
        variant: "destructive",
      });
    }
  };

  // Format property display
  const formatPropertyOption = (property: { code: string; title?: string | null; endereco?: string | null; bairro?: string | null; cidade?: string | null }) => {
    const parts = [property.code];
    if (property.title) parts.push(property.title);
    else if (property.endereco) parts.push(property.endereco);
    if (property.bairro) parts.push(property.bairro);
    return parts.join(" - ");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90%] sm:max-w-[500px] sm:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Criar Lead
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Pipeline Selection */}
          <div className="space-y-2">
            <Label>Pipeline</Label>
            <Select
              value={selectedPipelineId}
              onValueChange={setSelectedPipelineId}
              disabled={loadingPipelines}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                    {pipeline.is_default && " (Padrão)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stage Selection */}
          <div className="space-y-2">
            <Label>Etapa</Label>
            <Select
              value={selectedStageId}
              onValueChange={setSelectedStageId}
              disabled={loadingStages || !selectedPipelineId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages
                  .sort((a, b) => a.position - b.position)
                  .map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: stage.color || "#888" }}
                        />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Property Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Imóvel de Interesse
            </Label>
            <Select
              value={selectedPropertyId}
              onValueChange={(value) => setSelectedPropertyId(value === "none" ? "" : value)}
              disabled={loadingProperties}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um imóvel (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {formatPropertyOption(property)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do lead"
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
            />
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Observação</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Observações sobre o lead..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-[40%] rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="w-[60%] rounded-xl" disabled={createLead.isPending}>
              {createLead.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Criar Lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
