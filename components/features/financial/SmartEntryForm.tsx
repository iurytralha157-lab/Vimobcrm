import React, { useEffect, useState, useCallback } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { detectCategory, getConfidenceLabel } from '@/lib/category-detector';
import { useCreateFinancialEntry, useFinancialCategories } from '@/hooks/use-financial';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Wand2 } from 'lucide-react';

const formSchema = z.object({
  description: z.string().min(3, 'Descrição obrigatória (mínimo 3 caracteres)'),
  type: z.enum(['payable', 'receivable']),
  category: z.string().min(1, 'Categoria é obrigatória'),
  amount: z.number().min(0.01, 'Valor deve ser maior que zero'),
  due_date: z.string().optional(),
  payment_method: z.string().optional(),
  is_recurring: z.boolean().default(false),
  recurring_type: z.enum(['monthly', 'weekly', 'yearly']).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface SmartEntryFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  initialData?: Partial<FormValues>;
}

export function SmartEntryForm({ onSuccess, onCancel, initialData }: SmartEntryFormProps) {
  const [autoFillEnabled, setAutoFillEnabled] = useState(true);
  const [detection, setDetection] = useState<ReturnType<typeof detectCategory> | null>(null);
  const createEntry = useCreateFinancialEntry();
  const { data: categories } = useFinancialCategories();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: '',
      type: 'payable',
      category: '',
      amount: 0,
      due_date: new Date().toISOString().split('T')[0],
      payment_method: '',
      is_recurring: false,
      recurring_type: undefined,
      notes: '',
      ...initialData,
    },
  });

  const description = useWatch({ control: form.control, name: 'description' });

  // Detecção em tempo real
  const handleDetection = useCallback(
    (desc: string) => {
      if (!autoFillEnabled || !desc || desc.length < 3) {
        setDetection(null);
        return;
      }

      const result = detectCategory(desc);
      setDetection(result);

      if (result.confidence > 0) {
        // Auto-preencher tipo
        if (result.type) {
          form.setValue('type', result.type, { shouldValidate: true });
        }

        // Auto-preencher categoria (se existe nas categorias do banco)
        if (result.category) {
          const matchingCategory = categories?.find(
            (c) => c.name.toLowerCase() === result.category?.toLowerCase()
          );
          if (matchingCategory) {
            form.setValue('category', matchingCategory.name, { shouldValidate: true });
          } else {
            form.setValue('category', result.category, { shouldValidate: true });
          }
        }

        // Auto-preencher recorrência
        if (result.isRecurring) {
          form.setValue('is_recurring', true);
          if (result.recurringType) {
            form.setValue('recurring_type', result.recurringType);
          }
        }

        // Auto-preencher valor extraído
        if (result.extractedValue && result.extractedValue > 0) {
          const currentAmount = form.getValues('amount');
          if (!currentAmount || currentAmount === 0) {
            form.setValue('amount', result.extractedValue, { shouldValidate: true });
          }
        }
      }
    },
    [autoFillEnabled, categories, form]
  );

  useEffect(() => {
    const timeout = setTimeout(() => handleDetection(description), 300);
    return () => clearTimeout(timeout);
  }, [description, handleDetection]);

  const onSubmit = async (values: FormValues) => {
    const selectedCategoryObj = categories?.find(c => c.name === values.category);

    try {
      await createEntry.mutateAsync({
        type: values.type,
        category: values.category,
        category_group: selectedCategoryObj?.category_group || null,
        description: values.description,
        amount: values.amount,
        due_date: values.due_date,
        payment_method: values.payment_method,
        is_recurring: values.is_recurring,
        recurring_type: values.recurring_type,
        notes: values.notes,
        status: 'pending',
      });
      form.reset();
      setDetection(null);
      onSuccess?.();
    } catch {
      // error handled by hook
    }
  };

  const confidenceInfo = detection ? getConfidenceLabel(detection.confidence) : null;
  const isRecurring = useWatch({ control: form.control, name: 'is_recurring' });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Header com toggle de auto-fill */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Preenchimento inteligente</span>
          </div>
          <Switch
            checked={autoFillEnabled}
            onCheckedChange={setAutoFillEnabled}
          />
        </div>

        {/* Badge de confiança */}
        {detection && detection.confidence > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Wand2 className="h-3 w-3" />
              {detection.category}
            </Badge>
            <Badge variant="outline" className={confidenceInfo?.color}>
              Confiança: {confidenceInfo?.label}
            </Badge>
            {detection.isRecurring && (
              <Badge variant="outline" className="text-primary">
                Recorrente ({detection.recurringType === 'monthly' ? 'Mensal' : detection.recurringType === 'weekly' ? 'Semanal' : 'Anual'})
              </Badge>
            )}
          </div>
        )}

        {/* Descrição */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descrição</FormLabel>
              <FormControl>
                <Input
                  placeholder='Ex: "Aluguel escritório matriz - R$ 5.000"'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Tipo e Categoria */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="payable">A Pagar</SelectItem>
                    <SelectItem value="receivable">A Receber</SelectItem>
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
                <FormControl>
                  <Input placeholder="Ex: Aluguel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Valor e Vencimento */}
        <div className="grid grid-cols-2 gap-4">
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
                    min="0"
                    placeholder="0,00"
                    {...field}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
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

        {/* Método de pagamento */}
        <FormField
          control={form.control}
          name="payment_method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Método de Pagamento</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                  <SelectItem value="debit_card">Cartão de Débito</SelectItem>
                  <SelectItem value="transfer">Transferência</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="check">Cheque</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Recorrência */}
        <div className="flex items-center gap-4">
          <FormField
            control={form.control}
            name="is_recurring"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="!mt-0">Recorrente</FormLabel>
              </FormItem>
            )}
          />

          {isRecurring && (
            <FormField
              control={form.control}
              name="recurring_type"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <Select onValueChange={field.onChange} value={field.value || ''}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Frequência" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          )}
        </div>

        {/* Observações */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observações</FormLabel>
              <FormControl>
                <Textarea placeholder="Notas adicionais..." rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Botões */}
        <div className="flex gap-2 justify-end pt-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={createEntry.isPending}>
            {createEntry.isPending ? 'Salvando...' : 'Salvar Lançamento'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
