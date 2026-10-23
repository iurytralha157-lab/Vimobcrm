# Tags e arquivamento do WhatsApp — validação local

Checkout principal: `D:/Vimob/workspaces/vimob-crm`. Sem acesso ou alterações em produção. Banco descartável verificado em `127.0.0.1:57922`; a porta `55432` é o túnel de produção e não foi usada. Os dados e os contextos de autenticação dos testes são sintéticos.

## Causas reproduzidas e correções

O retorno antigo de `/v1/tags` não contém `updated_at`. A validação completa usada pela gestão exige esse campo: repetir o GET com esse DTO falha novamente. Isso reproduz uma incompatibilidade local; não confirma qual versão está causando o erro na tela publicada.

Os seletores do WhatsApp usam `useTags({ catalog: true })`, com uma projeção de leitura `id/name/color/organization_id`. O modo novo `GET /v1/tags?view=catalog` verifica usuário, organização e vínculo de membro ativos e consulta somente as tags daquela organização, sem contar leads ou exigir a revisão de edição. A cache do seletor distingue organização, usuário e sessão; o GET captura a identidade e aceita cancelamento. Os endpoints de gestão, as respostas completas e a revisão/CAS de edição continuam estritos. O DTO de seleção não inventa uma revisão para editar.

A projeção de leitura aceita também uma resposta antiga completa sem `updated_at`. Isso não corrige uma API que já consulta `t.updated_at` num banco ainda sem essa coluna: ela pode devolver HTTP 500 antes de produzir o DTO. Nesse cenário, a entrega requer a API Go com o modo catálogo junto à interface; não há fallback para acesso direto ao banco nem ocultação de erro.

O arquivamento invalidava apenas a lista e conservava `archived_at` antigo em detalhe, snapshot e conversa do lead. Agora invalida esses registros do escopo capturado, espera a reconciliação das consultas ativas e exige confirmação `{ ok: true }`. Uma interrupção de transporte marca a cache original como desatualizada, sem buscar dados do usuário que substituiu o anterior. Operações sobre o mesmo chat não se sobrepõem entre os widgets do mesmo `QueryClient`. Os controles mostram espera e impedem repetição durante a operação.

O callback do widget flutuante podia fechar o chat depois de sair e retornar a ele, ou depois de o mesmo ID mudar de lead. A conclusão agora confere a visita, o vínculo e a sessão física antes de fechar o chat. As permissões do servidor continuam exigidas. Arquivar permanece uma ação da inbox do CRM; não modifica o FIFO de envio.

## Evidências

Diretório: `D:/Vimob/tmp/whatsapp-tags-archive-local-20261013/`. O manifesto registra hashes, execuções e limites; existência de uma suíte não significa aprovação.

Resultado desta rodada: API do catálogo 4/4, hook/cache 6/6, arquivamento/handlers 7/7, regressão de identidade do transporte existente 17/17, HTTP/SQL local 1/1 e UI compartilhada 5/5 passaram. A UI não tentou requisições externas; as capturas dos dois seletores foram inspecionadas. Lint focado dos seis arquivos de catálogo/lista/helper terminou com código zero. Os gates globais de tipos/lint e o pacote Go completo são coordenados separadamente.

- `lib/api/tag-catalog.runtime.test.mjs`: retorno antigo, DTO restrito, organização incorreta, resposta inválida e proteção da revisão de edição.
- `hooks/tag-catalog.runtime.test.mjs`: `QueryObserver` real, isolamento por usuário/sessão/organização, ausência de autenticação e cancelamento do GET antigo.
- `hooks/whatsapp-archive.runtime.test.mjs`: funções reais extraídas da fonte e `QueryClient` real, invalidação, conclusão tardia, sobreposição, confirmação e isolamento de cache. Essa prova não renderiza o aplicativo.
- `apps/api/internal/whatsapp/local_tags_archive_integration_test.go`: HTTP e SQL reais no banco descartável; catálogo, adição/remoção e GET da tag no lead, middleware de permissão, vínculos/usuário inativos, organização incorreta, arquivamento/restauração e zero itens criados na outbox. O middleware JWT não faz parte dessa prova.
- `components/features/whatsapp/conversations/tags-archive-ui.runtime.test.mjs`: `ConversationList`/`ConversationListItem`, catálogo e hook de arquivamento reais com CSS do produto; DTOs exportados pelo Go. O transporte e os callbacks de associação da UI são simulados. Não é uma navegação autenticada completa na página ou no widget.

## Conferência manual no CRM de testes

1. Abra a lista no widget e na página de Conversas. Adicione uma tag a um lead de teste, confira a faixa, remova e atualize a página para conferir persistência.
2. Em rede lenta, confirme que o menu aguarda a operação e não envia comandos repetidos. Troque de chat e volte enquanto arquiva: a conclusão antiga deve atualizar a lista sem fechar a visita nova.
3. Confira arquivar, filtro de arquivadas e desarquivar. Confirme com um usuário autorizado do compartilhamento e outro sem permissão de operação.
4. Troque organização, usuário ou sessão: o seletor não deve reutilizar nomes de tags do contexto anterior. Um erro de leitura deve permitir nova tentativa sem conceder escrita.

Não houve teste no ambiente publicado nem envio a aparelhos reais nessa etapa. A fila, os vínculos canônicos e as autorizações de operação permanecem no contrato existente.

## Validação posterior da sessão na rota de leitura

O registro `GET /v1/tags` em `apps/api/internal/app/routes.go` passou a usar o wrapper de organização com sessão ativa, tanto para o catálogo quanto para a resposta completa. `apps/api/internal/app/tag_catalog_session_routes_test.go` exercita o registro real da rota e a verificação de JWT assinado: 28 cenários de GET/HEAD, sessão revogada/ausente/incompatível, recuperação, indisponibilidade do checker e troca de organização. O agente revisor informou aprovação da suíte do pacote `app` em 2,557 s; essa execução foi registrada na saída da ferramenta, sem um arquivo de log independente.

Nessa prova, o checker de sessão e a resolução do tenant são simulados. Os casos ativos chegam à proteção de membership incompleto e não equivalem a uma leitura bem-sucedida do catálogo por JWT com checker SQL real. A integração posterior desse checker com o banco descartável é uma evidência separada, coordenada pelo agente do banco. Os limites dos testes HTTP/SQL e da UI anteriores continuam válidos.

Depois do ajuste de lint da variável local do teste, a API do catálogo passou novamente em 4/4; lint do teste terminou sem erros ou avisos. Logs: `D:/Vimob/tmp/local-whatsapp-validation-20261013/root/tag-catalog-api-lint-final.log` e `tag-catalog-test-lint-final.log` no mesmo diretório. Nenhum comando de banco, navegador ou compilador foi executado durante este fechamento documental.

## Integração adicional com checker de sessão SQL real

Em 14/10, `TestLocalTagCatalogWithRealActiveSession` passou em 6,05 s, com o pacote `app` em 7,854 s e código zero, no log `D:/Vimob/tmp/whatsapp-db-validation-20261013/app-tags-real-session-closure.jsonl`. A execução foi realizada pelo agente do banco usando `run-native-api-go.ps1`, que restringe os pacotes a `app/whatsapp`, verifica o clone local e impede exportação de frames.

Esse teste usa JWT sintético assinado, `auth.sessions` e checker SQL reais, resolver de tenant real, mux/registro de rotas e `ListTags` reais. Confere GET 200 sem permissão `TagManage`, POST 403 e, depois de remover o SID, GET/HEAD 401 antes da resolução do tenant. Ao final existem uma tag, zero associações e zero itens na outbox do fixture. Essa prova adicional não modifica os limites dos testes anteriores: o banco contém baseline/cadeia local e dados sintéticos; não houve login no serviço Auth HTTP, leitura em produção ou envio a WhatsApp real.

## Fechamento do pacote local

A repetição serial final do pacote WhatsApp passou em 399,623 s: 616 testes de topo, com 614 aprovados, zero falhas e dois skips por ausência dos serviços Edge e Storage reais. O log é `D:/Vimob/tmp/whatsapp-db-validation-20261013/go-local-full-closure.jsonl`; `full-go-closure-proof.json` registra 227 fontes Go sem alteração de hash durante a execução. As 31 suítes SQL somaram 890 assertions aprovadas, sem falhas ou skips, no resumo `sql-suite-final-green.json` do mesmo diretório.

Essa execução, realizada pelo agente do banco, não exportou novamente os DTOs usados pelas capturas da interface. Os manifestos preservam os resultados anteriores, inclusive falhas históricas, e acrescentam a prova final separadamente. Os gates da interface continuam com seus próprios logs; essa prova local não confirma uma sessão WhatsApp nativa, Edge/Storage reais ou produção.
