import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BrokerSelector, BrokerEntry } from './BrokerSelector';
import { useCreateContract, useUpdateContract, type Contract } from '@/hooks/use-contracts';
import { useProperties } from '@/hooks/use-properties';
import { useLeads } from '@/hooks/use-leads';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  type: z.enum(['sale', 'rental', 'service']),
  client_name: z.string().min(1, 'Nome do cliente é obrigatório'),
  client_email: z.string().email().optional().or(z.literal('')),
  client_phone: z.string().optional(),
  client_document: z.string().optional(),
  property_id: z.string().optional(),
  lead_id: z.string().optional(),
  total_value: z.number().min(0, 'Valor deve ser maior que zero'),
  down_payment: z.number().min(0).optional(),
  installments: z.number().min(1).max(360).optional(),
  payment_conditions: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  signing_date: z.string().optional(),
  notes: z.string().optional(),
  client_has_own_resources: z.enum(['yes', 'no', 'partial']).optional().default('no'),
  available_resource_value: z.number().min(0).optional().default(0),
  expected_entry_value: z.number().min(0).optional().default(0),
});

type FormValues = z.infer<typeof formSchema>;

type ContractFormRecord = Contract & {
  client_has_own_resources?: FormValues['client_has_own_resources'] | null;
  available_resource_value?: number | null;
  expected_entry_value?: number | null;
};

interface ContractFormProps {
  contract?: ContractFormRecord;
  onSuccess: () => void;
  onCancel: () => void;
}

function normalizeContractType(type: string | null | undefined): FormValues['type'] {
  if (type === 'sale' || type === 'rental' || type === 'service') return type;
  if (type === 'rent') return 'rental';
  return 'sale';
}

export function ContractForm({ contract, onSuccess, onCancel }: ContractFormProps) {
  const { data: properties } = useProperties();
  const { data: leads } = useLeads();
  const createContract = useCreateContract();
  const updateContract = useUpdateContract();

  const [brokers, setBrokers] = useState<BrokerEntry[]>(
    contract?.brokers?.map((b) => ({
      user_id: b.user_id,
      commission_percentage: b.commission_percentage,
      role: b.role,
    })) || []
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: normalizeContractType(contract?.contract_type),
      client_name: contract?.client_name || '',
      client_email: contract?.client_email || '',
      client_phone: contract?.client_phone || '',
      client_document: contract?.client_document || '',
      property_id: contract?.property_id || '',
      lead_id: contract?.lead_id || '',
      total_value: contract?.value || 0,
      down_payment: contract?.down_payment || 0,
      installments: contract?.installments || 1,
      payment_conditions: contract?.payment_conditions || '',
      start_date: contract?.start_date?.split('T')[0] || '',
      end_date: contract?.end_date?.split('T')[0] || '',
      signing_date: contract?.signing_date?.split('T')[0] || '',
      notes: contract?.notes || '',
      client_has_own_resources: (contract?.client_has_own_resources as 'yes' | 'no' | 'partial') || 'no',
      available_resource_value: contract?.available_resource_value || 0,
      expected_entry_value: contract?.expected_entry_value || 0,
    },
  });
  const clientHasOwnResources = useWatch({ control: form.control, name: 'client_has_own_resources' });

  const onSubmit = async (values: FormValues) => {
    const contractData = {
      contract_type: values.type, // Mapeia 'type' do form para 'contract_type' no banco
      client_name: values.client_name,
      client_email: values.client_email || null,
      client_phone: values.client_phone || null,
      client_document: values.client_document || null,
      property_id: values.property_id || null,
      lead_id: values.lead_id || null,
      value: values.total_value, // Mapeia 'total_value' do form para 'value' no banco
      down_payment: values.down_payment || null,
      installments: values.installments || null,
      payment_conditions: values.payment_conditions || null,
      start_date: values.start_date || null,
      end_date: values.end_date || null,
      signing_date: values.signing_date || null,
      notes: values.notes || null,
      client_has_own_resources: values.client_has_own_resources,
      available_resource_value: values.available_resource_value,
      expected_entry_value: values.expected_entry_value,
    };

    const brokerData = brokers.filter(b => b.user_id).map(b => ({
      user_id: b.user_id,
      commission_percentage: b.commission_percentage,
    }));

    if (contract) {
      await updateContract.mutateAsync({ ...contractData, id: contract.id, brokers: brokerData });
    } else {
      await createContract.mutateAsync({ ...contractData, brokers: brokerData });
    }
    onSuccess();
  };

  const isLoading = createContract.isPending || updateContract.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Tabs defaultValue="general" className="w-full">
          <ScrollArea className="w-full">
            <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5 mb-2">
              <TabsTrigger value="general" className="text-xs sm:text-sm">Geral</TabsTrigger>
              <TabsTrigger value="property" className="text-xs sm:text-sm">Imóvel</TabsTrigger>
              <TabsTrigger value="values" className="text-xs sm:text-sm">Valores</TabsTrigger>
              <TabsTrigger value="brokers" className="text-xs sm:text-sm hidden sm:flex">Corretores</TabsTrigger>
              <TabsTrigger value="dates" className="text-xs sm:text-sm hidden sm:flex">Datas</TabsTrigger>
            </TabsList>
          </ScrollArea>

          <TabsContent value="general" className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Contrato</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="sale">Venda</SelectItem>
                      <SelectItem value="rental">Locação</SelectItem>
                      <SelectItem value="service">Serviço</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="client_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Cliente</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome completo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="client_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="email@exemplo.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="client_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input placeholder="(00) 00000-0000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="client_document"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF/CNPJ</FormLabel>
                  <FormControl>
                    <Input placeholder="000.000.000-00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Mobile only: show brokers and dates here */}
            <div className="sm:hidden space-y-4 pt-4 border-t">
              <h4 className="font-medium text-sm">Corretores</h4>
              <BrokerSelector brokers={brokers} onChange={setBrokers} />
            </div>

            <div className="sm:hidden space-y-4 pt-4 border-t">
              <h4 className="font-medium text-sm">Datas</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data de Início</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data de Término</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="signing_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Assinatura</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Observações adicionais..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="property" className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="property_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Imóvel</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um imóvel..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {properties?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code} - {p.title || p.endereco || 'Sem título'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lead_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Vinculado</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um lead..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {leads?.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} {l.email ? `- ${l.email}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="values" className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="total_value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor Total (R$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      {...field}
                      onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="down_payment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Entrada (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...field}
                        onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="installments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de Parcelas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="360"
                        {...field}
                        onChange={e => field.onChange(parseInt(e.target.value) || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="payment_conditions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Condições de Pagamento</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Descreva as condições..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="pt-4 border-t space-y-4">
              <h4 className="font-medium">Análise de Crédito / Recurso</h4>
              <FormField
                control={form.control}
                name="client_has_own_resources"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente possui recurso próprio?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="yes">Sim</SelectItem>
                        <SelectItem value="no">Não (Financiamento Total)</SelectItem>
                        <SelectItem value="partial">Parcial (Entrada Prevista)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {clientHasOwnResources === 'yes' && (
                <FormField
                  control={form.control}
                  name="available_resource_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor Disponível (R$)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {clientHasOwnResources === 'partial' && (
                <FormField
                  control={form.control}
                  name="expected_entry_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor da Entrada Prevista (R$)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="brokers" className="pt-2 hidden sm:block">
            <BrokerSelector brokers={brokers} onChange={setBrokers} />
          </TabsContent>

          <TabsContent value="dates" className="space-y-4 pt-2 hidden sm:block">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Início</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Término</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="signing_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de Assinatura</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Observações adicionais..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel} className="w-[40%] rounded-xl">
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading} className="w-[60%] rounded-xl">
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {contract ? 'Salvar Alterações' : 'Criar Contrato'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
