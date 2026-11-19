# packages/contracts

Contrato HTTP compartilhado do Vimob CRM. A especificação mantida é
[`openapi/v1.yaml`](openapi/v1.yaml); os testes de contrato estão ao lado dela
em `openapi/*.test.mjs`.

## Estado atual

Na base `05ff562c`, conferida em 18/11/2026, o OpenAPI declara **232 paths e
301 operações HTTP**. A própria especificação se apresenta como parcial:
esses números não são o inventário completo das rotas da API.

O arquivo já inclui operações de leads, funil, equipes, agenda, imóveis,
WhatsApp, integrações e outras áreas. A fonte para saber se um método e caminho
estão descritos é o YAML, não uma lista reduzida de endpoints neste README.

Os clientes e parte dos tipos HTTP do frontend continuam mantidos em
`lib/api/` e `lib/validation/`. Não há geração automática de clientes ou tipos
configurada neste pacote. `integrations/supabase/types.ts` descreve o banco e
não substitui os contratos HTTP.

## Responsabilidades e consumidores

- O domínio dono mantém o contrato público ao alterar sua rota, payload ou
  resposta. A composição atual das rotas fica em
  `apps/api/internal/app/routes.go`; handlers e tipos ficam nos pacotes donos.
- `lib/api/` consome a API HTTP; validação Zod e tipos existentes devem manter
  compatibilidade com as respostas e os erros documentados.
- Os testes neste diretório verificam contratos específicos. A CI executa
  esses testes, mas ainda não há uma comparação geral automática entre todas
  as rotas do Go e o OpenAPI.

Novas rotas devem entrar no YAML junto da implementação. Uma extração de
arquivos dentro do mesmo domínio não deve modificar o contrato HTTP.

## Verificação

Na raiz do repositório:

```powershell
node --test packages/contracts/openapi/*.test.mjs
```

Também conferir os testes e consumidores do domínio afetado. Um resultado
aprovado nesses testes não comprova cobertura integral das rotas nem
compatibilidade de uma migração de banco ou de uma stack em execução.
