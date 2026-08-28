import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { financialCalendarDateSchema } from '@/lib/validation';
import { Loader2 } from 'lucide-react';

const optionalCalendarDateSchema = z.union([
  financialCalendarDateSchema,
  z.literal(''),
]);

const formSchema = z
  .object({
    type: z.enum(['sale', 'rental', 'service']),
    client_name: z.string().trim().min(1, 'Nome do cliente é obrigatório').max(180),
    client_email: z.string().trim().email('Email inválido').max(320).optional().or(z.literal('')),
    client_phone: z.string().trim().max(40).optional(),
    client_document: z.string().trim().max(40).optional(),
    property_id: z.string().optional(),
    lead_id: z.string().optional(),
    total_value: z.number().finite().positive('Valor deve ser maior que zero'),
    down_payment: z.number().finite().min(0).optional(),
    installments: z.number().int().min(1).max(360).optional(),
    payment_conditions: z.string().trim().max(4_000).optional(),
    start_date: optionalCalendarDateSchema.optional(),
    end_date: optionalCalendarDateSchema.optional(),
    signing_date: optionalCalendarDateSchema.optional(),
    notes: z.string().trim().max(4_000).optional(),
  })
  .superRefine((values, context) => {
    if (
      values.down_payment !== undefined &&
      values.down_payment > values.total_value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['down_payment'],
        message: 'A entrada não pode exceder o valor total',
      });
    }
    if (
      values.start_date &&
      values.end_date &&
      values.end_date < values.start_date
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: 'A data final deve ser igual ou posterior à inicial',
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

type ContractFormRecord = Contract;

interface ContractFormProps {
  contract?: ContractFormRecord;
  onSuccess: () => void;
  onCancel: () => void;
  onPendingChange?: (pending: boolean) => void;
}

function normalizeContractType(type: string | null | undefined): FormValues['type'] {
  if (type === 'sale' || type === 'rental' || type === 'service') return type;
  if (type === 'rent') return 'rental';
  return 'sale';
}

export function ContractForm({
  contract,
  onSuccess,
  onCancel,
  onPendingChange,
}: ContractFormProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('general');
  const shouldLoadRelations =
    activeTab === 'property' ||
    Boolean(contract?.property_id) ||
    Boolean(contract?.lead_id);
  const {
    data: properties,
    isFetching: propertiesLoading,
    error: propertiesError,
    refetch: refetchProperties,
  } = useProperties(undefined, {}, { enabled: shouldLoadRelations });
  const {
    data: leads,
    isFetching: leadsLoading,
    error: leadsError,
    refetch: refetchLeads,
  } = useLeads(undefined, { enabled: shouldLoadRelations });
  const createContract = useCreateContract();
  const updateContract = useUpdateContract();
  const isLoading = createContract.isPending || updateContract.isPending;
  const [brokerError, setBrokerError] = useState<string | null>(null);

  useEffect(() => {
    onPendingChange?.(isLoading);
    return () => onPendingChange?.(false);
  }, [isLoading, onPendingChange]);

  const [brokers, setBrokers] = useState<BrokerEntry[]>(
    contract?.brokers?.map((b) => ({
      user_id: b.user_id,
      commission_percentage: b.commission_percentage,
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
    },
  });

  const onSubmit = async (values: FormValues) => {
    setBrokerError(null);
    if (brokers.some((broker) => !broker.user_id)) {
      setBrokerError('Selecione um usuário em todos os corretores adicionados.');
      setActiveTab(isMobile ? 'general' : 'brokers');
      return;
    }
    if (
      brokers.some(
        (broker) =>
          !Number.isFinite(broker.commission_percentage) ||
          broker.commission_percentage < 0 ||
          broker.commission_percentage > 100,
      )
    ) {
      setBrokerError('Informe percentuais entre 0% e 100%.');
      setActiveTab(isMobile ? 'general' : 'brokers');
      return;
    }
    const brokerIds = brokers.map((broker) => broker.user_id);
    if (new Set(brokerIds).size !== brokerIds.length) {
      setBrokerError('O mesmo corretor não pode ser adicionado mais de uma vez.');
      setActiveTab(isMobile ? 'general' : 'brokers');
      return;
    }
    if (
      brokers.reduce(
        (total, broker) => total + broker.commission_percentage,
        0,
      ) > 100
    ) {
      setBrokerError('A soma das comissões não pode exceder 100%.');
      setActiveTab(isMobile ? 'general' : 'brokers');
      return;
    }

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
    };

    const brokerData = brokers.map(b => ({
      user_id: b.user_id,
      commission_percentage: b.commission_percentage,
    }));

    try {
      if (contract) {
        await updateContract.mutateAsync({ ...contractData, id: contract.id, brokers: brokerData });
      } else {
        await createContract.mutateAsync({ ...contractData, brokers: brokerData });
      }
      onSuccess();
    } catch (error) {
      form.setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Não foi possível salvar o contrato.',
      });
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) => {
          const fields = Object.keys(errors);
          if (fields.some((field) => ['property_id', 'lead_id'].includes(field))) {
            setActiveTab('property');
          } else if (
            fields.some((field) =>
              ['total_value', 'down_payment', 'installments', 'payment_conditions'].includes(field),
            )
          ) {
            setActiveTab('values');
          } else if (
            !isMobile &&
            fields.some((field) =>
              ['start_date', 'end_date', 'signing_date', 'notes'].includes(field),
            )
          ) {
            setActiveTab('dates');
          } else {
            setActiveTab('general');
          }
        })}
        className="space-y-4"
        aria-busy={isLoading}
      >
        <fieldset disabled={isLoading} className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
            {isMobile && <div className="space-y-4 border-t pt-4">
              <h4 className="font-medium text-sm">Corretores</h4>
              <BrokerSelector
                brokers={brokers}
                onChange={(nextBrokers) => {
                  setBrokers(nextBrokers);
                  setBrokerError(null);
                }}
                disabled={isLoading}
                error={brokerError || undefined}
              />
            </div>}

            {isMobile && <div className="space-y-4 border-t pt-4">
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
            </div>}
          </TabsContent>

          <TabsContent value="property" className="space-y-4 pt-2">
            {(propertiesLoading || leadsLoading) && (
              <p className="text-xs text-muted-foreground" role="status">
                Carregando imóveis e leads...
              </p>
            )}
            {(propertiesError || leadsError) && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive"
                role="alert"
              >
                <span>Não foi possível carregar todos os vínculos.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (propertiesError) void refetchProperties();
                    if (leadsError) void refetchLeads();
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            )}
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
                      min="0.01"
                      value={field.value || ''}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      onChange={e =>
                        field.onChange(
                          e.target.value === '' ? 0 : Number(e.target.value),
                        )
                      }
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
          </TabsContent>

          <TabsContent value="brokers" className="pt-2 hidden sm:block">
            <BrokerSelector
              brokers={brokers}
              onChange={(nextBrokers) => {
                setBrokers(nextBrokers);
                setBrokerError(null);
              }}
              disabled={isLoading}
              error={brokerError || undefined}
            />
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

        {form.formState.errors.root?.message && (
          <p className="text-sm text-destructive" role="alert">
            {form.formState.errors.root.message}
          </p>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading} className="w-[40%] rounded-lg">
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading} className="w-[60%] rounded-lg">
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {contract ? 'Salvar Alterações' : 'Criar Contrato'}
          </Button>
        </div>
        </fieldset>
      </form>
    </Form>
  );
}
