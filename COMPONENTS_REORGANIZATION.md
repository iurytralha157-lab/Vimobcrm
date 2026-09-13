# Reorganização de componentes

Este documento registra a direção da reorganização; não é uma declaração de
que todo o frontend já está concluído ou livre de dívida técnica.

## Estrutura adotada

```text
components/
  features/{dominio}/   UI e composição específicas do domínio
  shared/               componentes usados por mais de um domínio
  providers/            infraestrutura React global ou do grupo protegido
  ui/                   primitivas shadcn/Radix

hooks/{dominio}/        cache, estado e efeitos do domínio
lib/api/{dominio}.ts    transporte para a API Go
lib/validation/         contratos Zod e tipos derivados
```

As rotas em `app/` devem ser finas: elas importam a tela do domínio, aplicam a
boundary necessária e resolvem parâmetros/redirects. Regras de negócio não
devem migrar para `page.tsx`.

## Critério de extração

Um arquivo grande é recortado quando existem responsabilidades coesas que
podem ser nomeadas e verificadas, por exemplo:

- tipos e mapeamentos puros;
- seção visual com props explícitas;
- hook de query/mutation;
- estado de fluxo independente;
- regra pura coberta por teste.

Número de linhas sozinho não autoriza separar código. A extração deve preservar
UI, ordem de efeitos, permissões, cache keys, payloads e estados de erro/loading.

## Barrels

`index.ts` é permitido quando representa a API pública real do domínio. Não
exporte componentes sem consumidor apenas “por precaução”: isso esconde código
morto e faz o grafo estático superestimar dependências.

## Duplicações

Antes de unificar, compare todos os callers e documente diferenças de:

- vazio versus `null`;
- trim e normalização;
- limites de payload e compressão;
- mensagens/códigos de erro;
- permissões e escopo de organização;
- fallback e compatibilidade legada.

Quando as políticas diferirem, use opções ou funções com nomes explícitos. Não
substitua comportamentos diferentes por um helper genérico silencioso.

## Validação

Para cada lote:

1. buscar import direto, barrel e import lazy/dynamic;
2. executar teste focado da regra extraída;
3. executar typecheck e lint;
4. rodar os contratos gerais e o build antes do handoff;
5. regenerar inventários somente depois que o lote estiver estável.

Consulte `ARCHITECTURE.md` e `QUICK_REFERENCE.md` para o estado atual.
