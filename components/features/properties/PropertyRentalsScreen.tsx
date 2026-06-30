"use client";

import { useState, useDeferredValue } from 'react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Search,
  Loader2,
  Home,
  Building2
} from 'lucide-react';
import { useProperties, Property } from '@/hooks/use-properties';
import { PropertyCard } from '@/components/features/properties/PropertyCard';
import { PropertyPreviewDialog } from '@/components/features/properties/PropertyPreviewDialog';

const formatPrice = (value: number | null, tipo: string | null) => {
  if (!value) return 'Preço não informado';
  if (tipo === 'Aluguel') {
    return `R$ ${value.toLocaleString('pt-BR')}/mês`;
  }
  return `R$ ${value.toLocaleString('pt-BR')}`;
};

export default function PropertyRentals() {
  const [search, setSearch] = useState('');
  const [previewProperty, setPreviewProperty] = useState<Property | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const deferredSearch = useDeferredValue(search);

  const { data: allProperties = [], isLoading } = useProperties(deferredSearch);

  // Filter only rentals
  const properties = allProperties.filter(p => p.tipo_de_negocio === 'Aluguel');

  const stats = {
    total: properties.length,
    ativos: properties.filter(p => p.status === 'ativo').length,
    destaque: properties.filter(p => p.destaque).length,
  };

  if (isLoading) {
    return (
      <AppLayout title="Imóveis para Aluguel">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Imóveis para Aluguel">
      <div className="space-y-6 animate-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar imóveis para aluguel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="app-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Home className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Aluguel</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.ativos}</p>
                <p className="text-sm text-muted-foreground">Ativos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.destaque}</p>
                <p className="text-sm text-muted-foreground">Em Destaque</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Empty State */}
        {properties.length === 0 && (
          <Card className="app-card">
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-surface-soft)]">
                <Home className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-2">Nenhum imóvel para aluguel</h3>
              <p className="text-muted-foreground">
                Cadastre imóveis com tipo de negócio &quot;Aluguel&quot; para vê-los aqui
              </p>
            </CardContent>
          </Card>
        )}

        {/* Properties Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {properties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              onEdit={() => {}}
              onDelete={() => {}}
              onPreview={(p) => {
                setPreviewProperty(p);
                setPreviewOpen(true);
              }}
              formatPrice={formatPrice}
            />
          ))}
        </div>

        {/* Preview Dialog */}
        <PropertyPreviewDialog
          property={previewProperty}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          formatPrice={formatPrice}
        />
      </div>
    </AppLayout>
  );
}
