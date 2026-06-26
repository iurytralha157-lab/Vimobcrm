"use client";

import { useState } from 'react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, MapPin, Building2, Home, Search, Loader2 } from 'lucide-react';
import {
  usePropertyCities, useCreateCity, useDeleteCity,
  usePropertyNeighborhoods, useCreateNeighborhood, useDeleteNeighborhood,
  usePropertyCondominiums, useCreateCondominium, useDeleteCondominium
} from '@/hooks/use-property-locations';
import { toast } from 'sonner';

export default function PropertyLocations() {
  const [tab, setTab] = useState('cities');
  const [search, setSearch] = useState('');
  const [selectedCityId, setSelectedCityId] = useState<string>('');
  const [selectedNeighborhoodId, setSelectedNeighborhoodId] = useState<string>('');

  // Dialogs
  const [cityDialog, setCityDialog] = useState(false);
  const [neighborhoodDialog, setNeighborhoodDialog] = useState(false);
  const [condominiumDialog, setCondominiumDialog] = useState(false);

  // Form data
  const [cityForm, setCityForm] = useState({ name: '', uf: '' });
  const [neighborhoodForm, setNeighborhoodForm] = useState({ name: '', city_id: '' });
  const [condominiumForm, setCondominiumForm] = useState({
    name: '',
    city_id: '',
    neighborhood_id: '',
    address: ''
  });

  // Hooks
  const { data: cities = [], isLoading: loadingCities } = usePropertyCities();
  const { data: neighborhoods = [], isLoading: loadingNeighborhoods } = usePropertyNeighborhoods(selectedCityId || undefined);
  const { data: condominiums = [], isLoading: loadingCondominiums } = usePropertyCondominiums(selectedNeighborhoodId || undefined);

  const createCity = useCreateCity();
  const deleteCity = useDeleteCity();
  const createNeighborhood = useCreateNeighborhood();
  const deleteNeighborhood = useDeleteNeighborhood();
  const createCondominium = useCreateCondominium();
  const deleteCondominium = useDeleteCondominium();

  // Filtered data
  const filteredCities = cities.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredNeighborhoods = neighborhoods.filter(n =>
    n.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredCondominiums = condominiums.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateCity = async () => {
    if (!cityForm.name.trim()) {
      toast.error('Nome da cidade é obrigatório');
      return;
    }
    await createCity.mutateAsync(cityForm);
    setCityForm({ name: '', uf: '' });
    setCityDialog(false);
  };

  const handleCreateNeighborhood = async () => {
    if (!neighborhoodForm.name.trim() || !neighborhoodForm.city_id) {
      toast.error('Nome e cidade são obrigatórios');
      return;
    }
    await createNeighborhood.mutateAsync(neighborhoodForm);
    setNeighborhoodForm({ name: '', city_id: '' });
    setNeighborhoodDialog(false);
  };

  const handleCreateCondominium = async () => {
    if (!condominiumForm.name.trim()) {
      toast.error('Nome do condomínio é obrigatório');
      return;
    }
    await createCondominium.mutateAsync(condominiumForm);
    setCondominiumForm({ name: '', city_id: '', neighborhood_id: '', address: '' });
    setCondominiumDialog(false);
  };

  const UF_OPTIONS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
    'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
    'SP', 'SE', 'TO'
  ];

  return (
    <AppLayout title="Localidades">
      <div className="space-y-6 animate-in">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
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
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{cities.length}</p>
                <p className="text-sm text-muted-foreground">Cidades</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-chart-2/10 flex items-center justify-center">
                <Home className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold">{neighborhoods.length}</p>
                <p className="text-sm text-muted-foreground">Bairros</p>
              </div>
            </CardContent>
          </Card>
          <Card className="app-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-chart-3/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-chart-3" />
              </div>
              <div>
                <p className="text-2xl font-bold">{condominiums.length}</p>
                <p className="text-sm text-muted-foreground">Condomínios</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="cities">Cidades</TabsTrigger>
            <TabsTrigger value="neighborhoods">Bairros</TabsTrigger>
            <TabsTrigger value="condominiums">Condomínios</TabsTrigger>
          </TabsList>

          {/* Cities Tab */}
          <TabsContent value="cities" className="mt-4">
            <Card className="app-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Cidades Cadastradas</CardTitle>
                <Dialog open={cityDialog} onOpenChange={setCityDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Nova Cidade
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Nova Cidade</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Nome da Cidade *</Label>
                        <Input
                          value={cityForm.name}
                          onChange={(e) => setCityForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Ex: São Paulo"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>UF</Label>
                        <Select
                          value={cityForm.uf}
                          onValueChange={(v) => setCityForm(prev => ({ ...prev, uf: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o estado" />
                          </SelectTrigger>
                          <SelectContent>
                            {UF_OPTIONS.map(uf => (
                              <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => setCityDialog(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleCreateCity} disabled={createCity.isPending}>
                          {createCity.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingCities ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCities.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma cidade cadastrada
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cidade</TableHead>
                        <TableHead>UF</TableHead>
                        <TableHead className="w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCities.map(city => (
                        <TableRow key={city.id}>
                          <TableCell className="font-medium">{city.name}</TableCell>
                          <TableCell>
                            {city.uf && <Badge variant="outline">{city.uf}</Badge>}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteCity.mutate(city.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Neighborhoods Tab */}
          <TabsContent value="neighborhoods" className="mt-4">
            <Card className="app-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-4">
                  <CardTitle className="text-lg">Bairros</CardTitle>
                  <Select value={selectedCityId || "__all__"} onValueChange={(v) => setSelectedCityId(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Filtrar por cidade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas as cidades</SelectItem>
                      {cities.map(city => (
                        <SelectItem key={city.id} value={city.id}>
                          {city.name} {city.uf && `(${city.uf})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Dialog open={neighborhoodDialog} onOpenChange={setNeighborhoodDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Novo Bairro
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Novo Bairro</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Cidade *</Label>
                        <Select
                          value={neighborhoodForm.city_id}
                          onValueChange={(v) => setNeighborhoodForm(prev => ({ ...prev, city_id: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a cidade" />
                          </SelectTrigger>
                          <SelectContent>
                            {cities.map(city => (
                              <SelectItem key={city.id} value={city.id}>
                                {city.name} {city.uf && `(${city.uf})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nome do Bairro *</Label>
                        <Input
                          value={neighborhoodForm.name}
                          onChange={(e) => setNeighborhoodForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Ex: Centro"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => setNeighborhoodDialog(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleCreateNeighborhood} disabled={createNeighborhood.isPending}>
                          {createNeighborhood.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingNeighborhoods ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredNeighborhoods.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum bairro cadastrado
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bairro</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead className="w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNeighborhoods.map(neighborhood => (
                        <TableRow key={neighborhood.id}>
                          <TableCell className="font-medium">{neighborhood.name}</TableCell>
                          <TableCell>
                            {neighborhood.city?.name}
                            {neighborhood.city?.uf && ` (${neighborhood.city.uf})`}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteNeighborhood.mutate(neighborhood.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Condominiums Tab */}
          <TabsContent value="condominiums" className="mt-4">
            <Card className="app-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-4">
                  <CardTitle className="text-lg">Condomínios</CardTitle>
                  <Select value={selectedNeighborhoodId || "__all__"} onValueChange={(v) => setSelectedNeighborhoodId(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Filtrar por bairro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os bairros</SelectItem>
                      {neighborhoods.map(n => (
                        <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Dialog open={condominiumDialog} onOpenChange={setCondominiumDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Novo Condomínio
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Novo Condomínio</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Nome do Condomínio *</Label>
                        <Input
                          value={condominiumForm.name}
                          onChange={(e) => setCondominiumForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Ex: Residencial das Flores"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cidade</Label>
                        <Select
                          value={condominiumForm.city_id}
                          onValueChange={(v) => setCondominiumForm(prev => ({ ...prev, city_id: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a cidade" />
                          </SelectTrigger>
                          <SelectContent>
                            {cities.map(city => (
                              <SelectItem key={city.id} value={city.id}>
                                {city.name} {city.uf && `(${city.uf})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Bairro</Label>
                        <Select
                          value={condominiumForm.neighborhood_id}
                          onValueChange={(v) => setCondominiumForm(prev => ({ ...prev, neighborhood_id: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o bairro" />
                          </SelectTrigger>
                          <SelectContent>
                            {neighborhoods.map(n => (
                              <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Endereço</Label>
                        <Input
                          value={condominiumForm.address}
                          onChange={(e) => setCondominiumForm(prev => ({ ...prev, address: e.target.value }))}
                          placeholder="Ex: Rua das Flores, 123"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => setCondominiumDialog(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleCreateCondominium} disabled={createCondominium.isPending}>
                          {createCondominium.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Cadastrar
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingCondominiums ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCondominiums.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum condomínio cadastrado
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Condomínio</TableHead>
                        <TableHead>Bairro</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead className="w-20">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCondominiums.map(condo => (
                        <TableRow key={condo.id}>
                          <TableCell className="font-medium">{condo.name}</TableCell>
                          <TableCell>{condo.neighborhood?.name || '-'}</TableCell>
                          <TableCell>
                            {condo.city?.name}
                            {condo.city?.uf && ` (${condo.city.uf})`}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteCondominium.mutate(condo.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
