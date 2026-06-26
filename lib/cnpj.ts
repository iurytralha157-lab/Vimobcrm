export interface CNPJData {
  razao_social: string;
  nome_fantasia?: string;
  cnpj: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  ddd_telefone_1?: string;
  email?: string;
}

export async function fetchCNPJData(cnpj: string): Promise<CNPJData | null> {
  const cleanCNPJ = cnpj.replace(/\D/g, '');
  if (cleanCNPJ.length !== 14) return null;

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCNPJ}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Error fetching CNPJ data:', error);
    return null;
  }
}
