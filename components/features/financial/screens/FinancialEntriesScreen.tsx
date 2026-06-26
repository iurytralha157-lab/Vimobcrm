'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EntryStatusBadge } from '@/components/features/financial/EntryStatusBadge';
import { FinancialEntryForm } from '@/components/features/financial/FinancialEntryForm';
import { FinancialDrawer } from '@/components/features/financial/FinancialDrawer';

import { useFinancialEntries, useMarkEntryAsPaid, useDeleteFinancialEntry, type FinancialEntry } from '@/hooks/use-financial';
import { formatCurrency, formatDate, exportToExcel, prepareFinancialEntriesExport } from '@/lib/export-financial';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Plus,
  Search,
  MoreHorizontal,
  CheckCircle2,
  Pencil,
  Trash2,
  Download,
  TrendingUp,
  TrendingDown,
  Calendar,
  SlidersHorizontal
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

type FinancialEntryListItem = FinancialEntry & {
  related_person_name?: string | null;
};

// Mobile Entry Card Component - Melhorado para mobile
function EntryCard({ entry, onPay, onEdit, onDelete }: {
  entry: FinancialEntryListItem;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="app-card-soft mb-2 sm:mb-3">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {entry.type === 'receivable' ? (
                <TrendingUp className="h-3.5 w-3.5 text-success shrink-0" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />
              )}
              <span className="font-medium text-xs sm:text-sm truncate">{entry.description}</span>
            </div>
            {entry.related_person_name && (
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1.5 truncate">{entry.related_person_name}</p>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant={entry.type === 'receivable' ? 'default' : 'secondary'} className="text-[10px] sm:text-xs h-5">
                {entry.type === 'receivable' ? 'Receber' : 'Pagar'}
              </Badge>
              <EntryStatusBadge status={entry.status} />
              {entry.installment_number && entry.total_installments && (
                <Badge variant="outline" className="text-[10px] sm:text-xs h-5">
                  {entry.installment_number}/{entry.total_installments}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={`font-bold text-sm sm:text-base ${entry.type === 'receivable' ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(entry.amount)}
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center justify-end gap-1 mt-0.5">
              <Calendar className="h-3 w-3" />
              {formatDate(entry.due_date)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-white/[0.055]">
          {entry.status === 'pending' && (
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onPay}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Pagar
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FinancialEntries() {
  const isMobile = useIsMobile();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinancialEntry | null>(null);
  const [payDialog, setPayDialog] = useState<{ open: boolean; entry: FinancialEntry | null }>({ open: false, entry: null });
  const [paidValue, setPaidValue] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data: entries, isLoading } = useFinancialEntries({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  const markAsPaid = useMarkEntryAsPaid();
  const deleteEntry = useDeleteFinancialEntry();

  const filteredEntries = entries?.filter(entry =>
    entry.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.category?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleExport = () => {
    if (!filteredEntries.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    const data = prepareFinancialEntriesExport(filteredEntries);
    exportToExcel(data, `contas-${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success('Arquivo exportado com sucesso');
  };

  const handlePay = async () => {
    if (!payDialog.entry) return;
    await markAsPaid.mutateAsync({
      id: payDialog.entry.id,
      paid_value: parseFloat(paidValue) || payDialog.entry.amount,
    });
    setPayDialog({ open: false, entry: null });
    setPaidValue('');
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir este lançamento?')) {
      await deleteEntry.mutateAsync(id);
    }
  };

  const handleEdit = (entry: FinancialEntry) => {
    setEditingEntry(entry);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingEntry(null);
  };

  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  return (
    <AppLayout title="Contas">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Gerencie seus lançamentos financeiros</p>
          <div className="flex gap-2">
            <Button variant="outline" size={isMobile ? "sm" : "default"} onClick={handleExport}>
              <Download className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
            <Button size={isMobile ? "sm" : "default"} onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Novo Lançamento</span>
              <span className="sm:hidden">Novo</span>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="app-card">
          <CardContent className="p-3 md:p-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {isMobile ? (
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="w-full sm:w-auto"
                >
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Filtros
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-2">{activeFilterCount}</Badge>
                  )}
                </Button>
              ) : (
                <>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="receivable">A Receber</SelectItem>
                      <SelectItem value="payable">A Pagar</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="paid">Pago</SelectItem>
                      <SelectItem value="overdue">Vencido</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {/* Mobile Filters Expanded */}
            {isMobile && showFilters && (
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/[0.055]">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="receivable">A Receber</SelectItem>
                    <SelectItem value="payable">A Pagar</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">Todos status</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="paid">Pago</SelectItem>
                    <SelectItem value="overdue">Vencido</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 md:h-12" />)}
          </div>
        ) : isMobile ? (
          // Mobile Cards
          <div>
            {filteredEntries.length === 0 ? (
              <Card className="app-card">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Nenhum lançamento encontrado
                </CardContent>
              </Card>
            ) : (
              filteredEntries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onPay={() => {
                    setPaidValue(entry.amount.toString());
                    setPayDialog({ open: true, entry });
                  }}
                  onEdit={() => handleEdit(entry)}
                  onDelete={() => handleDelete(entry.id)}
                />
              ))
            )}
          </div>
        ) : (
          // Desktop Table
          <Card className="app-card">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nenhum lançamento encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{entry.description}</p>
                            {entry.category && (
                              <p className="text-xs text-muted-foreground">{entry.category}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={entry.type === 'receivable' ? 'text-success' : 'text-destructive'}>
                            {entry.type === 'receivable' ? 'Receber' : 'Pagar'}
                          </span>
                        </TableCell>
                        <TableCell>{entry.category || '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(entry.amount)}
                        </TableCell>
                        <TableCell>{formatDate(entry.due_date)}</TableCell>
                        <TableCell>
                          <EntryStatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell>-</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover">
                              {entry.status === 'pending' && (
                                <DropdownMenuItem onClick={() => {
                                  setPaidValue(entry.amount.toString());
                                  setPayDialog({ open: true, entry });
                                }}>
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Marcar como Pago
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(entry)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(entry.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Form Drawer */}
        <FinancialDrawer
          open={isFormOpen}
          onOpenChange={(open) => {
            setIsFormOpen(open);
            if (!open) setEditingEntry(null);
          }}
          title={editingEntry ? 'Editar Lançamento' : 'Novo Lançamento'}
          description={editingEntry ? 'Altere os dados do lançamento' : 'Preencha os dados do novo lançamento'}
        >
          <FinancialEntryForm
            entry={editingEntry ?? undefined}
            onSuccess={handleFormSuccess}
            onCancel={() => {
              setIsFormOpen(false);
              setEditingEntry(null);
            }}
          />
        </FinancialDrawer>


        {/* Pay Dialog */}
        <Dialog open={payDialog.open} onOpenChange={(open) => setPayDialog({ open, entry: null })}>
          <DialogContent className="w-[95vw] max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar Pagamento</DialogTitle>
              <DialogDescription>
                Informe o valor pago para: {payDialog.entry?.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Valor Pago (R$)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={paidValue}
                  onChange={(e) => setPaidValue(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPayDialog({ open: false, entry: null })}>
                Cancelar
              </Button>
              <Button onClick={handlePay} disabled={markAsPaid.isPending}>
                Confirmar Pagamento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
