"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Lock } from "lucide-react";
import { togglePanelClass } from "../PropertyFormFields";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function ConfidentialSection() {
  const {
    formData, set
  } = usePropertyFormSections();

  return (
  <TabsContent value="confidential">
    <Card
      data-tour="property-confidential-section"
      className="app-card"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
          <Lock className="h-4 w-4" /> Dados Confidenciais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-tax-code">Código IPTU</Label>
            <Input
              id="property-tax-code"
              value={formData.codigo_iptu}
              onChange={(e) => set("codigo_iptu", e.target.value)}
              placeholder="Código IPTU"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-registration-number">Número da Matrícula</Label>
            <Input
              id="property-registration-number"
              value={formData.numero_matricula}
              onChange={(e) =>
                set("numero_matricula", e.target.value)
              }
              placeholder="Matrícula"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-electricity-code">Código da Rede de Eletricidade</Label>
            <Input
              id="property-electricity-code"
              value={formData.codigo_eletricidade}
              onChange={(e) =>
                set("codigo_eletricidade", e.target.value)
              }
              placeholder="Código"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-water-code">Código da Rede de Água</Label>
            <Input
              id="property-water-code"
              value={formData.codigo_agua}
              onChange={(e) => set("codigo_agua", e.target.value)}
              placeholder="Código"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-documentation-status">Status/Descritivo</Label>
            <Input
              id="property-documentation-status"
              value={formData.status_descritivo}
              onChange={(e) =>
                set("status_descritivo", e.target.value)
              }
              placeholder="Descrição"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-environmental-approval">Aprovação Órgão Ambiental</Label>
            <Input
              id="property-environmental-approval"
              value={formData.aprovacao_ambiental}
              onChange={(e) =>
                set("aprovacao_ambiental", e.target.value)
              }
              placeholder="Detalhes"
            />
          </div>
        </div>
        <div className={togglePanelClass}>
          <Label htmlFor="property-project-approved">Projeto Aprovado</Label>
          <Switch
            id="property-project-approved"
            checked={formData.projeto_aprovado}
            onCheckedChange={(v) => set("projeto_aprovado", v)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="property-documentation-notes">Observações de Documentação</Label>
          <Textarea
            id="property-documentation-notes"
            value={formData.observacoes_documentacao}
            onChange={(e) =>
              set("observacoes_documentacao", e.target.value)
            }
            placeholder="Observações sobre documentação..."
            rows={4}
          />
        </div>
      </CardContent>
    </Card>
  </TabsContent>
  );
}
