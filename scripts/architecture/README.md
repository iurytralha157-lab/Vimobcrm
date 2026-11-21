# Verificações de arquitetura

Os workflows de imagens da main e da homologação executam os gates após instalar Node, as dependências do projeto e Go.

| Gate | O que verifica |
| --- | --- |
| `node scripts/architecture/check-openapi-parity.mjs` | Métodos e caminhos do `http.ServeMux` em `apps/api/internal/app` contra as operações do OpenAPI v1. Compara a forma dos parâmetros, preserva o método e distingue caminho exato de captura de múltiplos segmentos. Registro sem string literal falha com arquivo e linha. |
| `node scripts/architecture/check-import-boundaries.mjs` | Imports de produção com AST de Go e TypeScript. As regras seguem a [arquitetura](../../ARCHITECTURE.md#5-regras-de-dependência). |
| `node --test scripts/architecture/*.test.mjs` | Casos de paridade, parsing e fronteira com fontes sintéticas. |

No frontend, `components/features/<domínio>` e `hooks/<domínio>` importam outro domínio pela sua entrada pública `index` ou pelo transporte de `lib/api`. Componentes compartilhados seguem a restrição de imports de features e primitivas de UI evitam dependências nas camadas do produto. Dashboard usa o transporte quando precisa de outro domínio. O scanner lê imports, exports e carregamentos com especificadores literais, resolvendo `@/` e caminhos relativos. A classificação das pastas deixa a atribuição dos hooks legados ainda soltos na raiz para a migração por domínio.

No Go, `internal/app` compõe os serviços. Os domínios compartilham os pacotes de infraestrutura da arquitetura e `distribution` atende os consumidores documentados. A unidade controlada é a aresta entre pacotes, de modo que dividir um arquivo no mesmo pacote preserva suas dependências.

## Registros de base

- [Imports legados](import-boundary-baseline.json) capturados de uma cópia do commit `36885bb7`. O recorte contém 196 imports do frontend e 65 arestas Go.
- [Paridade parcial do OpenAPI](../../packages/contracts/openapi/router-parity-baseline.json) capturada do roteador do commit `8839b384`. Das 621 operações registradas, 304 têm contrato. O registro contém as 315 lacunas legadas e os dois comandos operacionais privados com token dedicado.

Cada gate falha para desvios novos e indica entradas superadas para remover do registro no mesmo diff. O modo `--report` imprime os achados para revisão. Uma rota pública nova entra no YAML com seu contrato. Um comando privado exige uma exceção explícita por método e caminho. Uma dependência nova cruza o domínio pela interface pública.
