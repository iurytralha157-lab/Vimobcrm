"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function CommissionsSection() {
  const {
    formData, set, users
  } = usePropertyFormSections();

  return (
  <TabsContent value="commissions">
    <Card
      data-tour="property-commissions-section"
      className="app-card"
    >
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Comissões e Condições
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-commission-type">Tipo de Comissão</Label>
            <Select
              value={formData.tipo_comissao}
              onValueChange={(v) => set("tipo_comissao", v)}
            >
              <SelectTrigger id="property-commission-type">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">Percentual</SelectItem>
                <SelectItem value="valor_fixo">Valor Fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-broker">Corretor</Label>
            <Select
              value={formData.corretor_id}
              onValueChange={(v) => set("corretor_id", v)}
            >
              <SelectTrigger id="property-broker">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-sale-commission">Comissão Venda (%)</Label>
            <Input
              id="property-sale-commission"
              type="number"
              step="0.1"
              value={formData.comissao_venda}
              onChange={(e) => set("comissao_venda", e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-rental-commission">Comissão Locação (%)</Label>
            <Input
              id="property-rental-commission"
              type="number"
              step="0.1"
              value={formData.comissao_locacao}
              onChange={(e) =>
                set("comissao_locacao", e.target.value)
              }
              placeholder="100"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-commission-start-date">Data de Início</Label>
            <Input
              id="property-commission-start-date"
              type="date"
              value={formData.data_inicio_comissao}
              onChange={(e) =>
                set("data_inicio_comissao", e.target.value)
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="property-commercial-condition">Condição Comercial</Label>
          <Textarea
            id="property-commercial-condition"
            value={formData.condicao_comercial}
            onChange={(e) =>
              set("condicao_comercial", e.target.value)
            }
            placeholder="Condições especiais..."
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  </TabsContent>
  );
}
