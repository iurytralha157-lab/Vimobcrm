import { useState, useEffect, useCallback } from 'react';
import NextImage from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Property, useProperty, useUpdateProperty } from '@/hooks/use-properties';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { getPropertyCaptor } from '@/lib/api/property-support';
import { cleanPropertyDescription } from '@/lib/property-description';
import useEmblaCarousel from 'embla-carousel-react';
import {
  MapPin,
  Bed,
  Bath,
  Car,
  Ruler,
  Star,
  Building2,
  Calendar,
  Sofa,
  PawPrint,
  ChevronLeft,
  ChevronRight,
  Check,
  XCircle,
  Home,
  Layers,
  Maximize2,
  Video,
  User,
  Phone,
  Mail,
} from 'lucide-react';

interface PropertyPreviewDialogProps {
  property: Property | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatPrice: (value: number | null, tipo: string | null) => string;
}

export function PropertyPreviewDialog({
  property: propertyFromList,
  open,
  onOpenChange,
  formatPrice,
}: PropertyPreviewDialogProps) {
  const isMobile = useIsMobile();
  const [imageSelection, setImageSelection] = useState<{ propertyId: string | null; index: number }>({
    propertyId: null,
    index: 0,
  });
  const updateProperty = useUpdateProperty();

  // Embla carousel com transição suave e drag
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    duration: 25, // Transição mais suave
  });

  // Fetch full property data including gallery
  const { data: fullProperty, isLoading } = useProperty(open ? propertyFromList?.id ?? null : null);

  // Use full property if available, otherwise fallback to list property
  const property = fullProperty || propertyFromList;
  const propertyId = property?.id ?? null;
  const currentImageIndex = imageSelection.propertyId === propertyId ? imageSelection.index : 0;
  const cadastroUserId = property?.cadastrado_por && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(property.cadastrado_por)
    ? property.cadastrado_por
    : null;
  const captorUserId = property?.corretor_id || cadastroUserId;
  const { data: captorUser } = useQuery({
    queryKey: ['property-captor', property?.organization_id, captorUserId],
    queryFn: async () => {
      if (!captorUserId) return null;
      return getPropertyCaptor(captorUserId, property?.organization_id);
    },
    enabled: open && !!captorUserId && !!property?.organization_id,
  });

  // Sync embla with currentIndex
  useEffect(() => {
    if (emblaApi) {
      const updateSelectedImage = () => {
        setImageSelection({
          propertyId,
          index: emblaApi.selectedScrollSnap(),
        });
      };

      emblaApi.on('select', updateSelectedImage);
      return () => {
        emblaApi.off('select', updateSelectedImage);
      };
    }
  }, [emblaApi, propertyId]);

  // Reset and scroll to first image when property changes
  useEffect(() => {
    if (emblaApi) {
      emblaApi.scrollTo(0, true);
    }
  }, [propertyId, emblaApi]);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  if (!property && !isLoading) return null;

  // Combine main image and gallery
  const allImages: string[] = [];
  if (property?.imagem_principal) {
    allImages.push(property.imagem_principal);
  }
  if (property?.fotos && Array.isArray(property.fotos)) {
    const galleryImages = property.fotos as string[];
    galleryImages.forEach(img => {
      if (img && !allImages.includes(img)) {
        allImages.push(img);
      }
    });
  }

  const isActive = property?.status !== 'inativo';
  const dealType = (property?.tipo_de_negocio || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const propertyType = (property?.tipo_de_imovel || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isLand = propertyType === 'terreno' || propertyType === 'lote';
  const displayPrice = dealType === 'aluguel' || dealType === 'locacao' || dealType === 'temporada'
    ? property?.valor_locacao || property?.preco || null
    : property?.preco || null;
  const displayArea = isLand ? property?.area_total : (property?.area_util || property?.area_total);
  const cleanDescription = cleanPropertyDescription(property?.descricao);
  const ownerPhone = property?.owner_cellphone || property?.owner_phone_commercial || property?.owner_phone_residential || null;
  const captorName = captorUser?.name || (cadastroUserId ? null : property?.cadastrado_por) || null;
  const captorContact = captorUser?.whatsapp || captorUser?.email || null;
  const hasOwnerInfo = !!(property?.owner_name || ownerPhone || property?.owner_email);
  const hasCaptorInfo = !!(captorName || captorContact);
  const extraDetails = property?.detalhes_extras ?? [];
  const proximities = property?.proximidades ?? [];
  const formatCurrency = (value?: number | null) => value
    ? `R$ ${value.toLocaleString('pt-BR')}`
    : null;
  const formatBoolean = (value?: boolean | null) => {
    if (value === null || value === undefined) return null;
    return value ? 'Sim' : 'Não';
  };

  const handleToggleStatus = () => {
    if (!property) return;
    updateProperty.mutate({
      id: property.id,
      status: isActive ? 'inativo' : 'ativo',
    });
  };

  const propertyDetailsSection = property ? (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Detalhes do Imóvel
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {property.tipo_de_imovel && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Home className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Tipo:</span>
            <span className="font-medium ml-auto">{property.tipo_de_imovel}</span>
          </div>
        )}
        {property.suites !== null && property.suites !== undefined && property.suites > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Bed className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Suítes:</span>
            <span className="font-medium ml-auto">{property.suites}</span>
          </div>
        )}
        {property.andar && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Andar:</span>
            <span className="font-medium ml-auto">{property.andar}º</span>
          </div>
        )}
        {property.area_total && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Área Total:</span>
            <span className="font-medium ml-auto">{property.area_total}m²</span>
          </div>
        )}
        {property.ano_construcao && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Ano:</span>
            <span className="font-medium ml-auto">{property.ano_construcao}</span>
          </div>
        )}
        {property.mobilia && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <Sofa className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Mobília:</span>
            <span className="font-medium ml-auto">{property.mobilia}</span>
          </div>
        )}
        {property.regra_pet !== null && property.regra_pet !== undefined && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045]">
            <PawPrint className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Pet:</span>
            <span className={`font-medium ml-auto flex items-center gap-1 ${property.regra_pet ? 'text-green-600' : ''}`}>
              {property.regra_pet ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {property.regra_pet ? 'Sim' : 'Não'}
            </span>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const extraDetailItems = property ? [
    { icon: Bed, label: 'Quartos', value: property.quartos },
    { icon: Bath, label: 'Banheiros', value: property.banheiros },
    { icon: Car, label: 'Vagas', value: property.vagas },
    { icon: Ruler, label: 'Área útil', value: property.area_util ? `${property.area_util}m²` : null },
    { icon: Calendar, label: 'Ano reforma', value: property.ano_reforma },
    { icon: Building2, label: 'Padrão', value: property.padrao },
    { icon: MapPin, label: 'Posição', value: property.posicao_localizacao },
    { icon: Home, label: 'Situação', value: property.situacao_imovel },
    { icon: User, label: 'Ocupação', value: property.ocupacao },
    { icon: Check, label: 'Financiamento', value: formatBoolean(property.aceita_financiamento) },
    { icon: Check, label: 'FGTS', value: formatBoolean(property.usou_fgts) },
    { icon: Check, label: 'Exclusividade', value: formatBoolean(property.exclusividade) },
    { icon: Check, label: 'Placa no local', value: formatBoolean(property.placa_no_local) },
    { icon: Calendar, label: 'IPTU', value: formatCurrency(property.iptu) },
    { icon: Calendar, label: 'Condomínio', value: formatCurrency(property.condominio) },
    { icon: Calendar, label: 'Seguro fiança', value: formatCurrency(property.valor_seguro_fianca) },
    { icon: Calendar, label: 'Seguro incêndio', value: formatCurrency(property.seguro_incendio) },
    { icon: Calendar, label: 'Taxa serviço', value: formatCurrency(property.taxa_de_servico) },
  ].filter((item) => item.value !== null && item.value !== undefined && item.value !== '') : [];

  const extraDetailsSection = extraDetailItems.length > 0 ? (
    <div className="mt-4 space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Características e valores
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {extraDetailItems.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.045] min-w-0">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{label}:</span>
            <span className="font-medium ml-auto min-w-0 truncate text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const monthlyCostsSection = property && (property.condominio || property.iptu || property.seguro_incendio || property.taxa_de_servico) ? (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Custos Mensais
      </h3>
      <div className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {property.condominio && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.045] px-2.5 py-2">
            <span className="text-xs text-muted-foreground block">Condomínio</span>
            <span className="font-semibold text-primary">
              R$ {property.condominio.toLocaleString('pt-BR')}
            </span>
          </div>
        )}
        {property.iptu && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.045] px-2.5 py-2">
            <span className="text-xs text-muted-foreground block">IPTU</span>
            <span className="font-semibold text-primary">
              R$ {property.iptu.toLocaleString('pt-BR')}
            </span>
          </div>
        )}
        {property.seguro_incendio && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.045] px-2.5 py-2">
            <span className="text-xs text-muted-foreground block">Seguro incêndio</span>
            <span className="font-semibold text-primary">
              R$ {property.seguro_incendio.toLocaleString('pt-BR')}
            </span>
          </div>
        )}
        {property.taxa_de_servico && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.045] px-2.5 py-2">
            <span className="text-xs text-muted-foreground block">Taxa de serviço</span>
            <span className="font-semibold text-primary">
              R$ {property.taxa_de_servico.toLocaleString('pt-BR')}
            </span>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const propertySummarySection = property ? (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {property.code}
            </Badge>
            <Badge variant={property.tipo_de_negocio === 'Venda' ? 'default' : 'secondary'}>
              {property.tipo_de_negocio}
            </Badge>
            {property.destaque && (
              <Badge className="bg-amber-500 text-white">
                <Star className="h-3 w-3 mr-1 fill-current" />
                Destaque
              </Badge>
            )}
          </div>
          <h2 className="text-base font-bold leading-tight lg:text-lg">
            {property.title || `${property.tipo_de_imovel} em ${property.bairro || 'Localização'}`}
          </h2>
        </div>

        <div className="shrink-0 pt-1">
          <Switch
            checked={isActive}
            onCheckedChange={handleToggleStatus}
            disabled={updateProperty.isPending}
          />
        </div>
      </div>

      {(property.endereco || property.bairro || property.cidade) && (
        <div className="flex items-start gap-2 text-muted-foreground">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="text-sm">
            {[property.endereco, property.numero, property.bairro, property.cidade, property.uf]
              .filter(Boolean)
              .join(', ')}
            {property.cep && <span className="text-xs ml-1">- CEP: {property.cep}</span>}
          </span>
        </div>
      )}

      <div>
        <p className="text-xl font-bold text-primary lg:text-2xl">
          {formatPrice(displayPrice, property.tipo_de_negocio)}
        </p>
        {property.tipo_de_negocio === 'Aluguel' && (
          <p className="text-sm text-muted-foreground">por mês</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {property.quartos !== null && property.quartos !== undefined && property.quartos > 0 && (
          <div className="flex min-h-[54px] items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-2.5 py-2">
            <Bed className="h-5 w-5 shrink-0 text-primary" />
            <div className="text-right leading-tight">
              <span className="block font-bold">{property.quartos}</span>
              <span className="block text-[10px] text-muted-foreground">Quartos</span>
            </div>
          </div>
        )}
        {property.banheiros !== null && property.banheiros !== undefined && property.banheiros > 0 && (
          <div className="flex min-h-[54px] items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-2.5 py-2">
            <Bath className="h-5 w-5 shrink-0 text-primary" />
            <div className="text-right leading-tight">
              <span className="block font-bold">{property.banheiros}</span>
              <span className="block text-[10px] text-muted-foreground">Banheiros</span>
            </div>
          </div>
        )}
        {property.vagas !== null && property.vagas !== undefined && property.vagas > 0 && (
          <div className="flex min-h-[54px] items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-2.5 py-2">
            <Car className="h-5 w-5 shrink-0 text-primary" />
            <div className="text-right leading-tight">
              <span className="block font-bold">{property.vagas}</span>
              <span className="block text-[10px] text-muted-foreground">Vagas</span>
            </div>
          </div>
        )}
        {displayArea && (
          <div className="flex min-h-[54px] items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-2.5 py-2">
            <Ruler className="h-5 w-5 shrink-0 text-primary" />
            <div className="text-right leading-tight">
              <span className="block font-bold">{displayArea}</span>
              <span className="block text-[10px] text-muted-foreground">{isLand ? 'm² total' : 'm²'}</span>
            </div>
          </div>
        )}
      </div>

      {monthlyCostsSection}
    </div>
  ) : null;

  const responsibleSection = property && (hasOwnerInfo || hasCaptorInfo) ? (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Responsáveis
      </h3>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {hasOwnerInfo && (
          <div className="space-y-2 rounded-lg border border-white/[0.055] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 font-medium">
              <User className="h-4 w-4 text-primary" />
              Proprietário
            </div>
            {property.owner_name && <p className="text-foreground">{property.owner_name}</p>}
            {ownerPhone && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                {ownerPhone}
              </p>
            )}
            {property.owner_email && (
              <p className="flex items-center gap-2 break-all text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {property.owner_email}
              </p>
            )}
          </div>
        )}

        {hasCaptorInfo && (
          <div className="space-y-2 rounded-lg border border-white/[0.055] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 font-medium">
              <Avatar className="h-7 w-7">
                <AvatarImage src={captorUser?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                  {(captorName || 'C').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              Captador
            </div>
            {captorName && <p className="text-foreground">{captorName}</p>}
            {captorContact && (
              <p className="flex items-center gap-2 break-all text-muted-foreground">
                {captorContact.includes('@') ? <Mail className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                {captorContact}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const content = isLoading ? (
    <div className="flex h-full min-h-0 flex-col lg:flex-row gap-4 lg:gap-5">
      <div className="lg:w-[52%] min-h-0 lg:overflow-y-auto">
        <Skeleton className={cn("w-full rounded-xl", isMobile ? "aspect-[16/10]" : "aspect-video")} />
      </div>
      <div className="lg:w-[48%] min-h-0 space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  ) : property ? (
    <div className="flex h-full min-h-0 flex-col lg:flex-row gap-4 lg:gap-5">
      {/* Left Side - Image Gallery */}
      <div className="lg:w-[52%] min-h-0 flex flex-col lg:overflow-y-auto lg:pr-1">
        {/* Main Image with Embla Carousel */}
        <div className={cn(
          "relative shrink-0 rounded-xl overflow-hidden bg-white/[0.045] group",
          isMobile ? "aspect-[16/10] w-full shadow-sm" : "aspect-video"
        )}>
          {allImages.length > 0 ? (
            <>
              {/* Embla Carousel */}
              <div
                className="overflow-hidden h-full cursor-grab active:cursor-grabbing"
                ref={emblaRef}
              >
                <div className="flex h-full">
                  {allImages.map((img, index) => (
                    <div key={index} className="relative flex-[0_0_100%] min-w-0 h-full">
                      <NextImage
                        src={img}
                        alt={`${property.title || 'Imóvel'} - Foto ${index + 1}`}
                        fill
                        sizes="100vw"
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation Arrows */}
              {allImages.length > 1 && (
                <>
                  <button
                    onClick={scrollPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                    type="button"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={scrollNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                    type="button"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}

              {/* Image Counter */}
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-full">
                {currentImageIndex + 1} / {allImages.length}
              </div>

              {/* Main Badge */}
              {currentImageIndex === 0 && property.imagem_principal && (
                <Badge className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs">
                  <Star className="h-3 w-3 mr-1 fill-current" />
                  Principal
                </Badge>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
              <Building2 className="h-16 w-16 mb-2 opacity-30" />
              <p className="text-sm">Sem imagens</p>
            </div>
          )}
        </div>

        <div className="mt-5 hidden space-y-5 lg:block">
          {propertySummarySection}
        </div>
      </div>

      {/* Right Side - Property Details */}
      <div className="lg:w-[48%] min-h-0">
        <ScrollArea className="h-auto pr-0 lg:h-full lg:pr-3">
          <div className="space-y-5">
            <div className="lg:hidden">
              {propertySummarySection}
            </div>

            {responsibleSection}
            {propertyDetailsSection}
            {extraDetailsSection}

            {/* Description */}
            {cleanDescription && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Descrição
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {cleanDescription}
                </p>
              </div>
            )}

            {/* Detalhes Extras */}
            {extraDetails.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Detalhes Extras
                </h3>
                <div className="flex flex-wrap gap-2">
                  {extraDetails.map((item, index) => (
                    <div key={index} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-sm">
                      <Check className="h-3 w-3 text-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Proximidades */}
            {proximities.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Proximidades
                </h3>
                <div className="flex flex-wrap gap-2">
                  {proximities.map((item, index) => (
                    <div key={index} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] text-sm">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Video Link */}
            {property.video_imovel && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Vídeo
                </h3>
                <a
                  href={property.video_imovel}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Video className="h-4 w-4" />
                  Assistir vídeo do imóvel
                </a>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="left-2 right-2 bottom-2 h-[90vh] w-auto overflow-hidden rounded-t-[1.5rem] border p-0">
          <SheetHeader className="px-4 pb-3 pt-4">
            <SheetTitle>Visualizar Imóvel</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(90vh-72px)] px-4 pb-4">
            {content}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[80vh] w-[80vw] max-w-[80vw] max-h-[80vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Visualizar Imóvel</DialogTitle>
        </DialogHeader>
        <div className="h-[calc(80vh-73px)] min-h-0 overflow-hidden p-5">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
}
