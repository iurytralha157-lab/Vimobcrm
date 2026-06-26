/**
 * Category Detector - Detecção inteligente de categorias financeiras
 * Analisa descrições e sugere categoria, tipo, recorrência e valor
 */

interface CategoryMatch {
  category: string;
  type: 'payable' | 'receivable';
  confidence: number;
  isRecurring: boolean;
  recurringType?: 'monthly' | 'weekly' | 'yearly';
}

interface DetectionResult {
  category: string | null;
  type: 'payable' | 'receivable' | null;
  confidence: number;
  isRecurring: boolean;
  recurringType?: 'monthly' | 'weekly' | 'yearly';
  extractedValue: number | null;
}

// Dicionário de palavras-chave para detecção
const CATEGORY_RULES: CategoryMatch[] = [
  // Despesas recorrentes
  { category: 'Aluguel', type: 'payable', confidence: 90, isRecurring: true, recurringType: 'monthly' },
  { category: 'Energia Elétrica', type: 'payable', confidence: 85, isRecurring: true, recurringType: 'monthly' },
  { category: 'Água', type: 'payable', confidence: 85, isRecurring: true, recurringType: 'monthly' },
  { category: 'Internet', type: 'payable', confidence: 85, isRecurring: true, recurringType: 'monthly' },
  { category: 'Telefone', type: 'payable', confidence: 80, isRecurring: true, recurringType: 'monthly' },
  { category: 'Salários', type: 'payable', confidence: 90, isRecurring: true, recurringType: 'monthly' },
  { category: 'IPTU', type: 'payable', confidence: 85, isRecurring: true, recurringType: 'yearly' },
  { category: 'Condomínio', type: 'payable', confidence: 85, isRecurring: true, recurringType: 'monthly' },
  { category: 'Seguro', type: 'payable', confidence: 80, isRecurring: true, recurringType: 'monthly' },
  { category: 'Contabilidade', type: 'payable', confidence: 80, isRecurring: true, recurringType: 'monthly' },
  // Despesas pontuais
  { category: 'Material de Escritório', type: 'payable', confidence: 75, isRecurring: false },
  { category: 'Manutenção', type: 'payable', confidence: 75, isRecurring: false },
  { category: 'Marketing', type: 'payable', confidence: 75, isRecurring: false },
  { category: 'Imposto', type: 'payable', confidence: 80, isRecurring: false },
  { category: 'Taxa', type: 'payable', confidence: 70, isRecurring: false },
  { category: 'Frete', type: 'payable', confidence: 75, isRecurring: false },
  // Receitas
  { category: 'Comissão', type: 'receivable', confidence: 85, isRecurring: false },
  { category: 'Venda', type: 'receivable', confidence: 80, isRecurring: false },
  { category: 'Aluguel Recebido', type: 'receivable', confidence: 85, isRecurring: true, recurringType: 'monthly' },
  { category: 'Honorários', type: 'receivable', confidence: 80, isRecurring: false },
  { category: 'Consultoria', type: 'receivable', confidence: 75, isRecurring: false },
];

// Mapeamento de palavras-chave para categorias
const KEYWORDS: Record<string, string[]> = {
  'Aluguel': ['aluguel', 'locação', 'locacao', 'aluga'],
  'Energia Elétrica': ['energia', 'luz', 'elétrica', 'eletrica', 'cemig', 'enel', 'cpfl', 'celpe', 'coelba', 'copel', 'light'],
  'Água': ['água', 'agua', 'saneamento', 'sabesp', 'copasa', 'caesb', 'compesa'],
  'Internet': ['internet', 'wifi', 'banda larga', 'fibra', 'provedor'],
  'Telefone': ['telefone', 'celular', 'vivo', 'claro', 'tim', 'oi'],
  'Salários': ['salário', 'salario', 'folha', 'pagamento funcionário', 'funcionario', 'holerite', 'pró-labore', 'pro-labore'],
  'IPTU': ['iptu', 'imposto predial', 'imposto territorial'],
  'Condomínio': ['condomínio', 'condominio', 'cond.', 'taxa condominial'],
  'Seguro': ['seguro', 'apólice', 'apolice', 'sinistro'],
  'Contabilidade': ['contabilidade', 'contador', 'contábil', 'contabil'],
  'Material de Escritório': ['material', 'escritório', 'escritorio', 'papelaria', 'toner', 'cartucho'],
  'Manutenção': ['manutenção', 'manutencao', 'reparo', 'conserto', 'reforma'],
  'Marketing': ['marketing', 'propaganda', 'publicidade', 'anúncio', 'anuncio', 'mídia', 'midia', 'google ads', 'facebook ads', 'meta ads'],
  'Imposto': ['imposto', 'tributo', 'irpf', 'irpj', 'csll', 'cofins', 'pis', 'iss', 'icms', 'darf'],
  'Taxa': ['taxa', 'tarifa', 'anuidade', 'creci', 'crea'],
  'Frete': ['frete', 'transporte', 'mudança', 'mudanca', 'envio', 'entrega'],
  'Comissão': ['comissão', 'comissao', 'comissões', 'comissoes', 'bonificação', 'bonificacao'],
  'Venda': ['venda', 'vendas', 'receita venda', 'faturamento'],
  'Aluguel Recebido': ['aluguel recebido', 'recebimento aluguel', 'receita aluguel', 'locação recebida'],
  'Honorários': ['honorário', 'honorarios', 'honorários'],
  'Consultoria': ['consultoria', 'assessoria', 'consultadoria'],
};

// Palavras que indicam recorrência
const RECURRING_KEYWORDS = ['mensal', 'mensal', 'semanal', 'anual', 'recorrente', 'fixo', 'fixa', 'todo mês', 'toda semana', 'todo ano'];
const MONTHLY_KEYWORDS = ['mensal', 'todo mês', 'por mês', 'mensalidade'];
const WEEKLY_KEYWORDS = ['semanal', 'toda semana', 'por semana'];
const YEARLY_KEYWORDS = ['anual', 'todo ano', 'por ano', 'anuidade'];

/**
 * Extrai valor monetário de um texto
 * Exemplos: "R$ 5.000", "R$5000,00", "5.000,00", "R$ 1.234,56"
 */
export function extractValue(text: string): number | null {
  if (!text) return null;

  // Padrões para valores monetários em pt-BR
  const patterns = [
    /R\$\s*([\d.,]+)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
    /(\d+(?:,\d{2})?)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let value = match[1];
      // Converter formato brasileiro para número
      value = value.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        return num;
      }
    }
  }

  return null;
}

/**
 * Detecta se o texto indica recorrência e qual tipo
 */
function detectRecurrence(text: string): { isRecurring: boolean; recurringType?: 'monthly' | 'weekly' | 'yearly' } {
  const lower = text.toLowerCase();

  if (WEEKLY_KEYWORDS.some(k => lower.includes(k))) {
    return { isRecurring: true, recurringType: 'weekly' };
  }
  if (YEARLY_KEYWORDS.some(k => lower.includes(k))) {
    return { isRecurring: true, recurringType: 'yearly' };
  }
  if (MONTHLY_KEYWORDS.some(k => lower.includes(k))) {
    return { isRecurring: true, recurringType: 'monthly' };
  }
  if (RECURRING_KEYWORDS.some(k => lower.includes(k))) {
    return { isRecurring: true, recurringType: 'monthly' };
  }

  return { isRecurring: false };
}

/**
 * Detecta categoria, tipo e recorrência a partir de uma descrição
 */
export function detectCategory(description: string): DetectionResult {
  if (!description || description.trim().length < 3) {
    return {
      category: null,
      type: null,
      confidence: 0,
      isRecurring: false,
      extractedValue: null,
    };
  }

  const lower = description.toLowerCase().trim();
  let bestMatch: CategoryMatch | null = null;
  let bestScore = 0;

  // Buscar correspondência por palavras-chave
  for (const [category, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        const rule = CATEGORY_RULES.find(r => r.category === category);
        if (rule && rule.confidence > bestScore) {
          bestMatch = rule;
          bestScore = rule.confidence;
        }
      }
    }
  }

  // Detectar recorrência do texto (pode sobrescrever regra padrão)
  const recurrence = detectRecurrence(lower);

  // Extrair valor
  const extractedValue = extractValue(description);

  if (bestMatch) {
    return {
      category: bestMatch.category,
      type: bestMatch.type,
      confidence: bestMatch.confidence,
      isRecurring: recurrence.isRecurring || bestMatch.isRecurring,
      recurringType: recurrence.recurringType || bestMatch.recurringType,
      extractedValue,
    };
  }

  // Sem correspondência encontrada
  return {
    category: null,
    type: null,
    confidence: 0,
    isRecurring: recurrence.isRecurring,
    recurringType: recurrence.recurringType,
    extractedValue,
  };
}

/**
 * Retorna nível de confiança textual
 */
export function getConfidenceLabel(confidence: number): { label: string; color: string } {
  if (confidence >= 85) return { label: 'Alta', color: 'text-green-600' };
  if (confidence >= 70) return { label: 'Média', color: 'text-yellow-600' };
  if (confidence >= 50) return { label: 'Baixa', color: 'text-orange-600' };
  return { label: 'Sem detecção', color: 'text-muted-foreground' };
}
