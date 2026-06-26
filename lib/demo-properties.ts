import type { TablesInsert } from '@/integrations/supabase/types';
import { propertiesAPI } from '@/lib/api/properties';

const DEMO_PROPERTIES = [
  {
    code: 'DEMO01',
    title: 'Apartamento Garden com Varanda Gourmet',
    tipo_de_imovel: 'Apartamento',
    tipo_de_negocio: 'Venda',
    status: 'ativo',
    destaque: true,
    bairro: 'Jardins',
    cidade: 'Sao Paulo',
    uf: 'SP',
    quartos: 3,
    suites: 1,
    banheiros: 2,
    vagas: 2,
    area_util: 120,
    area_total: 145,
    preco: 980000,
    condominio: 1200,
    iptu: 450,
    descricao: 'Apartamento garden com varanda gourmet, acabamento de alto padrao e area de lazer completa.',
    imagem_principal: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
    fotos: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80',
      'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?w=800&q=80',
    ],
    is_demo: true,
  },
  {
    code: 'DEMO02',
    title: 'Casa Moderna com Piscina e Churrasqueira',
    tipo_de_imovel: 'Casa',
    tipo_de_negocio: 'Venda',
    status: 'ativo',
    destaque: true,
    bairro: 'Alphaville',
    cidade: 'Barueri',
    uf: 'SP',
    quartos: 4,
    suites: 2,
    banheiros: 4,
    vagas: 3,
    area_util: 280,
    area_total: 450,
    preco: 1850000,
    condominio: 2500,
    iptu: 800,
    descricao: 'Casa em condominio fechado com piscina, churrasqueira gourmet, home office e seguranca 24h.',
    imagem_principal: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
    fotos: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
    ],
    is_demo: true,
  },
  {
    code: 'DEMO03',
    title: 'Cobertura Duplex com Vista Panoramica',
    tipo_de_imovel: 'Cobertura',
    tipo_de_negocio: 'Venda',
    status: 'ativo',
    destaque: false,
    bairro: 'Barra da Tijuca',
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    quartos: 3,
    suites: 3,
    banheiros: 4,
    vagas: 3,
    area_util: 220,
    area_total: 260,
    preco: 2400000,
    condominio: 3200,
    iptu: 950,
    descricao: 'Cobertura duplex com terraco, jacuzzi, sala com pe-direito duplo e cozinha integrada.',
    imagem_principal: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
    fotos: [
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
      'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&q=80',
    ],
    is_demo: true,
  },
];

export async function seedDemoProperties(organizationId: string) {
  for (const property of DEMO_PROPERTIES) {
    const { error } = await propertiesAPI.createProperty(
      organizationId,
      property as unknown as Partial<TablesInsert<'properties'>>,
    );

    if (error) {
      console.error('Erro ao criar imovel de demonstracao:', error);
    }
  }
}

export async function removeDemoProperties(organizationId: string) {
  const { data: properties, error } = await propertiesAPI.getProperties(organizationId, {
    limit: 200,
  });

  if (error) {
    console.error('Erro ao carregar imoveis de demonstracao:', error);
    return;
  }

  for (const property of properties.filter((item) => item.is_demo)) {
    const { error: deleteError } = await propertiesAPI.deleteProperty(property.id, organizationId);

    if (deleteError) {
      console.error('Erro ao remover imovel de demonstracao:', deleteError);
    }
  }
}
