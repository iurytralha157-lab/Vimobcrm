# packages/contracts

Contrato HTTP compartilhado do Vimob CRM. A especificação mantida é
[`openapi/v1.yaml`](openapi/v1.yaml); os testes de contrato estão ao lado dela
em `openapi/*.test.mjs`.

## Estado atual

No roteador da base `8839b384`, conferido em 20/11/2026, o OpenAPI cobre
**304 das 621 operações Go**. O
[registro de paridade](openapi/router-parity-baseline.json) identifica as 315
lacunas históricas e os dois comandos operacionais privados com token dedicado.

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
- Os testes neste diretório verificam contratos específicos. A CI também
  compara os registros do roteador Go com os métodos e caminhos do OpenAPI.
  O gate bloqueia lacunas novas, operações sem rota e registros históricos que
  precisam ser removidos depois de resolvidos.

Novas rotas devem entrar no YAML junto da implementação. Uma extração de
arquivos dentro do mesmo domínio não deve modificar o contrato HTTP.

## Verificação

Na raiz do repositório:

```powershell
node --test packages/contracts/openapi/*.test.mjs
node scripts/architecture/check-openapi-parity.mjs
node --test scripts/architecture/openapi-parity.test.mjs
```

Também conferir os testes e consumidores do domínio afetado. Um resultado
aprovado nesses testes não comprova cobertura integral das rotas nem
compatibilidade de uma migração de banco ou de uma stack em execução.
