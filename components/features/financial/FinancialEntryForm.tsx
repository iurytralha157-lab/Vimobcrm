import React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateFinancialEntry, useUpdateFinancialEntry, useFinancialCategories } from '@/hooks/use-financial';
import type { FinancialEntry } from '@/hooks/use-financial';
import { useContracts } from '@/hooks/use-contracts';
import { Loader2, Repeat } from 'lucide-react';

const formSchema = z.object({
  type: z.enum(['receivable', 'payable']),
  category: z.string().min(1, 'Categoria é obrigatória'),
  description: z.string().min(1, 'Descrição é obrigatória'),
  amount: z.coerce.number().min(0.01, 'Valor deve ser maior que zero'),
  due_date: z.string().min(1, 'Data de vencimento é obrigatória'),
  payment_method: z.string().optional(),
  contract_id: z.string().optional(),
  notes: z.string().optional(),
  // Installments
  has_installments: z.boolean().optional(),
  total_installments: z.coerce.number().min(2).max(120).optional(),
  // Recurring
  is_recurring: z.boolean().optional(),
  recurring_type: z.enum(['monthly', 'weekly', 'yearly']).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface FinancialEntryFormProps {
  entry?: FinancialEntry;
  onSuccess: () => void;
  onCancel: () => void;
}

export function FinancialEntryForm({ entry, onSuccess, onCancel }: FinancialEntryFormProps) {
  const { data: contracts } = useContracts();
  const { data: financialCategories } = useFinancialCategories();
  const createEntry = useCreateFinancialEntry();
  const updateEntry = useUpdateFinancialEntry();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: entry?.type || 'receivable',
      category: entry?.category || '',
      description: entry?.description || '',
      amount: entry?.amount || undefined,
      due_date: entry?.due_date?.split('T')[0] || '',
      payment_method: entry?.payment_method || '',
      contract_id: entry?.contract_id || '',
      notes: entry?.notes || '',
      has_installments: (entry?.total_installments && entry.total_installments > 1) || false,
      total_installments: entry?.total_installments || undefined,
      is_recurring: entry?.is_recurring || false,
      recurring_type: entry?.recurring_type || undefined,
    },
  });

  const watchType = useWatch({ control: form.control, name: 'type' });
  const watchHasInstallments = useWatch({ control: form.control, name: 'has_installments' });
  const watchIsRecurring = useWatch({ control: form.control, name: 'is_recurring' });

  const fallbackOptions = watchType === 'receivable'
    ? ['Vendas', 'Comissões', 'Aluguéis', 'Outros Recebimentos']
    : ['Despesas Operacionais', 'Marketing', 'Folha de Pagamento', 'Impostos', 'Outros Pagamentos'];

  const dbCategoryNames = (financialCategories || [])
    .filter((c) => c.type === (watchType === 'receivable' ? 'income' : 'expense'))
    .map((c) => c.name);

  const categoryOptions = dbCategoryNames.length > 0
    ? Array.from(new Set([...dbCategoryNames, ...fallbackOptions]))
    : fallbackOptions;

  // Reset conflicting fields
  React.useEffect(() => {
    if (watchHasInstallments) {
      form.setValue('is_recurring', false);
      form.setValue('recurring_type', undefined);
    }
  }, [watchHasInstallments, form]);

  React.useEffect(() => {
    if (watchIsRecurring) {
      form.setValue('has_installments', false);
      form.setValue('total_installments', undefined);
    }
  }, [watchIsRecurring, form]);

  const onSubmit = async (values: FormValues) => {
    const selectedCategoryObj = financialCategories?.find(c => c.name === values.category);

    const basePayload = {
      type: values.type,
      category: values.category || null,
      category_group: selectedCategoryObj?.category_group || null,
      description: values.description,
      amount: values.amount,
      due_date: values.due_date,
      payment_method: values.payment_method || null,
      contract_id: values.contract_id || null,
      notes: values.notes || null,
      status: 'pending',
      is_recurring: values.is_recurring || false,
      recurring_type: values.is_recurring ? values.recurring_type : null,
      total_installments: values.has_installments ? values.total_installments : null,
      installment_number: values.has_installments ? 1 : null,
    };

    if (entry) {
      await updateEntry.mutateAsync({ id: entry.id, ...basePayload });
    } else {
      // If has installments, create multiple entries
      if (values.has_installments && values.total_installments && values.total_installments > 1) {
        const baseDate = new Date(values.due_date);
        for (let i = 0; i < values.total_installments; i++) {
          const dueDate = new Date(baseDate);
          dueDate.setMonth(dueDate.getMonth() + i);
          await createEntry.mutateAsync({
            ...basePayload,
            due_date: dueDate.toISOString().split('T')[0],
            installment_number: i + 1,
            description: `${values.description} (${i + 1}/${values.total_installments})`,
          });
        }
      } else {
        await createEntry.mutateAsync(basePayload);
      }
    }
    onSuccess();
  };

  const isLoading = createEntry.isPending || updateEntry.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="receivable">A Receber</SelectItem>
                    <SelectItem value="payable">A Pagar</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoria</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categoryOptions.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descrição</FormLabel>
              <FormControl>
                <Input placeholder="Descrição do lançamento" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valor (R$)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0,00"
                    value={field.value ?? ''}
                    onChange={e => {
                      const val = e.target.value;
                      field.onChange(val === '' ? undefined : parseFloat(val));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="due_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vencimento</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="payment_method"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Forma de Pagamento</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="transfer">Transferência</SelectItem>
                    <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                    <SelectItem value="debit_card">Cartão de Débito</SelectItem>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contract_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contrato (opcional)</FormLabel>
                <Select onValueChange={(val) => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {contracts?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.contract_number || c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Installments & Recurring Section */}
        <div className="border border-white/[0.055] rounded-lg p-4 space-y-4 bg-white/[0.035]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Repeat className="h-4 w-4" />
            <span>Parcelamento e Recorrência</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Installments */}
            <FormField
              control={form.control}
              name="has_installments"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Parcelar</FormLabel>
                    <FormDescription className="text-xs">
                      Dividir em várias parcelas
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={watchIsRecurring}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {watchHasInstallments && (
              <FormField
                control={form.control}
                name="total_installments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de Parcelas</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={2}
                        max={120}
                        placeholder="Ex: 12"
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Recurring */}
            <FormField
              control={form.control}
              name="is_recurring"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Conta Recorrente</FormLabel>
                    <FormDescription className="text-xs">
                      Repete automaticamente
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={watchHasInstallments}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {watchIsRecurring && (
              <FormField
                control={form.control}
                name="recurring_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequência</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="yearly">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        </div>

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

        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel} className="w-[40%] rounded-xl">
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading} className="w-[60%] rounded-xl">
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {entry ? 'Salvar' : 'Criar Lançamento'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
