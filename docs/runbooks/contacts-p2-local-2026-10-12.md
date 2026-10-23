# Contatos: correções locais P2

Escopo: checkout principal; sem deploy, produção, migração aplicada ou banco
consultado durante esta etapa. As alterações de interface em andamento foram
preservadas. Os testes de banco guardados abaixo ainda precisam ser executados
em um ambiente descartável autorizado.

## Contratos

- `GET /v1/contacts?responseMode=page` retorna `data`, `total`, `page`, `limit`.
  `total` existe também quando a página está vazia. Sem essa opção permanece
  o envelope legado com `data`.
- `mode=full`/`export` com resposta paginada inclui `exportVersion`. A versão
  cobre o conjunto filtrado, dados de leads/Meta, nomes exportados de funil,
  estágio e responsável, fallback de campanha, vínculo/nome de tags e escopo.
  Contagem, assinatura e página usam a mesma transação `REPEATABLE READ`.
  `expectedExportVersion` divergente retorna 409 `contacts_export_changed`.
  O navegador descarta o arquivo e pede nova exportação. Não existe snapshot
  mantido entre requisições; o frontend confere novamente antes do download.
- O hash completo a cada página de 500 linhas aumenta o custo de exportação.
  A mudança não comprova capacidade para 5–6 mil usuários. Medir volume e
  latência no ambiente de teste antes de homologar grandes exportações.
- `PATCH /v1/leads/:id` aceita `expectedUpdatedAt` opcional. Com ele, a API
  verifica a revisão após autorização e lock da linha, antes dos efeitos.
  Conflito retorna 409 `lead_changed`; campos não alterados são omitidos pelo
  editor, preservando referências de imóveis que ele não pode visualizar.
- Importar contato existente acrescenta somente tags válidas da organização,
  sem remover tags anteriores nem redistribuir/reabrir o negócio.
  Na seleção automática de fila, as tags da planilha são combinadas com as
  tags automáticas, sem duplicatas. Mais de 50 tags resultam em erro explícito,
  antes da escrita do contato, sem truncamento. Criação manual mantém a regra
  anterior de tags da fila.

## Recibo durável de importação

`importRequestKey` é um UUID opcional por linha, com `importMode=true`. A nova
migration `20261012224034_add_contact_import_request_receipts.sql` cria apenas
`private.contact_import_request_receipts`, sem alterar dados anteriores. Foi
gerada com `supabase migration new` e **não foi aplicada**. Somente seu registro
no lock de migrations foi atualizado, preservando os demais registros; não
executar `db push`.

A chave é isolada por organização e importador. O ledger guarda SHA256 canônico
v1, ID do lead, booleano de reentrada e resultado de distribuição, sem dados
pessoais do arquivo. Registro, escrita do contato e conclusão compartilham o
mesmo commit. Outra tentativa aguarda o lock e reutiliza o resultado confirmado.
Todas as leituras iniciais de destino, autorização de referências, fila e
identidade utilizam a conexão já retida pelo recibo. Não há aquisição de uma
segunda conexão do pool enquanto essa transação permanece aberta.
Input diferente com a mesma chave recebe 409 `lead_import_request_conflict`.
Sem tabela/permissão/versão compatível, a API retorna 503
`lead_import_idempotency_unavailable` antes de gravar o contato; não há fallback
mutante. Solicitações legadas sem chave mantêm o comportamento anterior.

Replay exige autorização atual de importação e reavalia a visibilidade atual.
Contato fora do escopo recebe recibo limitado, sem PII. Contato excluído depois
do sucesso recebe recibo limitado, sem ser recriado. Não há FK de lead no ledger
para preservar esse marco após exclusão. Replay não reemite evento de criação
nem executa distribuição, notificações ou atividade de reentrada.

Sequência futura: revisar/aplicar a migration isolada no ambiente autorizado,
validar a API nova e somente então habilitar o cliente que envia as chaves.
Cliente novo diante de API antiga rejeita o campo; cliente com chave diante da
API nova sem migration para com erro específico, sem importar a linha.

Ao tentar novamente, manter o UUID e o input da linha. Selecionar outro arquivo
ou mudar a operação é uma nova solicitação. Não repetir POST automaticamente
após timeout nem usar cache em memória como garantia de exatamente uma escrita.
O worker do lote fixa `expectedUserId` no transporte: uma requisição pendente
não pode usar o token de outro usuário depois de logout/login na mesma aba.
Idempotência por linha não torna o lote um job durável: fechar a aba ainda perde
a execução/progresso, e retomada geral continua trabalho futuro.

## Verificação e reversão

Testes unitários/mock cobrem versão/total de página vazia, escopo e mudanças de
dados com contagem igual, referências usadas no hash, telefone formatado,
revisão antiga e precisão temporal, namespace do recibo, conflito de payload,
storage ausente, falha antes do commit, replay após perda de resposta e leitura
restrita. Testes com PostgreSQL não são considerados aprovados se pulados.

Para testes reais preparados, usar exclusivamente banco local descartável de
prefixo `vimob_contacts_p2_`, esquema vazio de dados reais e a migration acima.
Os testes exigem flag explícita `VIMOB_RUN_CONTACTS_P2_DB_TESTS=LOCAL_WRITE_TEST`
e `CONTACTS_P2_TEST_DATABASE_URL` em loopback. Não iniciar serviços ou aplicar
schema como parte da suíte comum. Produção não é um alvo de teste.
O harness usa `MaxConns=1`, timeout no primeiro import com chave, criação e
reentrada com chave e oito solicitações concorrentes, tanto com chaves distintas
quanto com a mesma chave, para detectar regressão de aquisição dupla do pool.

Reversão de código deve remover somente os hunks desta etapa. A tabela isolada
pode permanecer durante reversão para conservar recibos. Não apagá-la enquanto
clientes puderem repetir chaves já confirmadas: remover o ledger perde a prova
de execução e pode permitir duplicação futura se a tabela for recriada vazia.

## Resultado da validação local

- 148 testes distintos de frontend/contratos passaram, sem testes pulados:
  suíte integrada de 141, adapter de tags (1), contratos P2 (3) e novos casos
  de exclusão individual (3). A repetição final dos 14 testes de ações/modelo
  passou após o guard de transição, escopo, organização e usuário. Repetições
  de suítes pelos revisores não foram somadas ao total.
- A suíte Go de `leads`, `authorization` e `distribution` passou após as
  correções de pool e união de tags. Casos PostgreSQL guardados foram pulados
  e não constituem validação de banco. A suíte adicional de `app` falhou em
  `TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue`,
  relacionado ao trabalho paralelo de notificações/WhatsApp; esse código não
  foi alterado por Contatos.
- Uma execução intermediária do typecheck geral passou. A repetição final
  concluiu com falhas em arquivos paralelos de Pipeline: testes de hidratação/
  estágio/disponibilidade, `use-assign-lead-roundrobin`, `use-deal-status-change`
  e `pipeline-status-cache`. Não houve diagnóstico nos arquivos de Contatos
  desta etapa; esses arquivos externos foram preservados. Houve também uma
  execução anterior com erro externo em `PropertyFormScreen` e import de
  extensão no nosso teste; o import foi corrigido e imóveis foi preservado.
- O lint geral concluiu com 7 erros e 5 avisos, em arquivos de automações,
  cache/ações do Pipeline, testes do calendário e viewer/áudio/imóveis. Nenhum
  desses erros estava nos arquivos corrigidos nesta etapa. Não usar `--fix`
  sobre a árvore para resolver falhas de outra conversa.
- O lint dirigido final passou em `ContactsScreen`, `ContactsList`, modelo e
  testes de modelo/ações. Um lint dirigido anterior passou nos 15 arquivos de
  UI/helpers/hooks/runtime da primeira revisão. A tentativa dirigida mais
  ampla subsequente ficou sem diagnóstico e foi interrompida; não foi somada
  às verificações aprovadas.
- `git diff --check` no escopo alterado passou, com aviso de normalização
  CRLF/LF em OpenAPI. A verificação geral de migrations foi executada, mas
  encontrou alterações em andamento de push: primeiro divergência de hash
  em `20261012223833_push_device_user_owned_delivery_scope.sql`, depois uma
  migration nova ainda vazia (`20261012232821_push_device_endpoint_owner_exclusivity.sql`).
  Não houve atualização desses registros ou arquivos por esta etapa.
  O hash da migration de Contatos foi conferido separadamente e coincide com
  seu registro: `c3cc995e3055e9a51416b9a23f00d936638a05a300969d8bd78d837e7b43de5e`.
- A revisão independente confirmou os guards de seleção/exclusão, preservação
  da base de edição, reenvio apenas de arquivos pendentes e conclusão única.
  Outra revisão conferiu recibos, pool, permissões, união de tags e exportação.

Esses resultados são de uma árvore com alterações concorrentes, no checkout
principal em `1539ac4a`; não são um certificado de release reproduzível. Os
checks gerais continuam sem aprovação pelos diagnósticos externos acima. Não
houve commit, push, deploy, acesso a produção ou banco.

Ainda são necessários os testes reais de PostgreSQL preparados, validação
visual/autenticada de Mac/Safari e celular, exportação em Excel/Numbers e medição
de memória/latência com volume. A ferramenta de navegador não abriu a aba
isolada. O arquivo exportado é relatório, não restauração completa do CRM; o
lote de importação ainda não retoma após fechar/recarregar a aba.

Snapshots anteriores aos nossos hunks estão em
`D:\Vimob\_safety\contacts-p2-20261013\{root,import,export,backend}`. Preservar
as correções de filtros, wizard e outras conversas durante qualquer reversão.

## Auditoria complementar: 19 ajustes locais

Esta seção registra a rodada posterior à validação histórica acima. As
prioridades são as das constatações originais: **4 P1, 12 P2 e 3 P3**. Os ajustes
foram implementados no checkout principal, preservando as outras conversas.
Não houve commit, push, deploy, acesso a produção ou execução de banco.

As descrições anteriores de reentrada manual e tags são históricas. Nesta
rodada, cadastrar novamente um telefone existente exige autorização de operação;
negócios ganhos/perdidos preservam seu estado. Negócios abertos ainda podem mudar
de destino ou ser redistribuídos conforme a política da fila existente.

| # | Prioridade | Correção local |
| --- | --- | --- |
| 1 | P1 | Reentrada manual exige `lead_operate` no contato existente, preserva campos ausentes e o estado de negócio fechado. |
| 2 | P1 | Atualização, exclusão individual e em lote fixam ator e `session_id`; callbacks e novas requisições verificam o contexto esperado. |
| 3 | P1 | Anexos autorizam também a origem: documento, caminho e mensagem são derivados pelo servidor; não aceitam caminho arbitrário ou mensagem alheia. |
| 4 | P1 | Prévia PDF verifica MIME, cabeçalho e terminador, gera Blob com MIME PDF e usa iframe isolado; download permanece disponível como alternativa à prévia. |
| 5 | P2 | Respostas 403/404 removem o snapshot negado e ocultam seus dados; falhas transitórias não são confundidas com perda definitiva de acesso. |
| 6 | P2 | Erros de edição, inclusive 409, invalidam os caches do escopo original. A revisão `expectedUpdatedAt` e os campos editados são preservados, sem apagar o rascunho. |
| 7 | P2 | Importação interrompe novas linhas após desmontagem ou mudança de organização, ator ou sessão; conserva respostas recebidas e separa linhas não iniciadas. |
| 8 | P2 | Origem do arquivo e origem padrão usam a mesma validação central: aliases viram códigos canônicos e sentinelas dos filtros são rejeitadas antes das tags. |
| 9 | P2 | Criação manual combina tags explícitas e tags da fila; reentrada acrescenta tags sem apagar as existentes. |
| 10 | P2 | Contatos compactos/completos projetam referências de imóveis pela visibilidade canônica; a versão de exportação inclui essa projeção e seu escopo. |
| 11 | P2 | Proteção CSV é reversível por fórmula constante de texto, com uma camada de decode; fórmulas literais e apóstrofos originais são preservados. |
| 12 | P2 | JSON mantém os lexemas de inteiros, decimais e expoentes: parser sem perda no frontend e `UseNumber` no backend. |
| 13 | P2 | Expansão de dados exporta o conteúdo integral ou recusa explicitamente o orçamento; não corta listas silenciosamente. CPF/RG são redigidos recursivamente nos JSONs do relatório, inclusive no fallback; o perfil sensível usa endpoint separado. |
| 14 | P2 | Formatos e processamento possuem limites explícitos, com alternativas de CSV, JSON bruto, menos colunas ou filtros; nunca truncam para simular sucesso. |
| 15 | P2 | Upload possui recibo por organização/ator/chave e hash, conclusão atômica e replay; COMMIT desconhecido não causa exclusão do objeto. Limpeza exige rollback confirmado e novo lock. |
| 16 | P2 | Origem/destino dos anexos são reautorizados sob locks ordenados; CPF/RG usam SELECT com escopo e operação. Assinatura revalida também a URL externa após consultar a mensagem. |
| 17 | P3 | CSV rejeita lixo após fechar aspas, informando a linha física, em vez de concatenar e alterar o valor silenciosamente. |
| 18 | P3 | Campos dinâmicos usam ID e contexto/caminho quando disponíveis; formulários identificados mantêm identidade ao reordenar. Legados conservam fallback por fonte/rótulo. |
| 19 | P3 | Falha de assinatura retorna `file_url: null` e `availability: signing_unavailable`, sem URL pública enganosa ou fallback de documento privado. A interface orienta atualizar/reabrir. |

### Contratos e migração desta rodada

- O lote de importação mantém as linhas/chaves e o relatório por organização,
  ator e sessão na memória da aba. `processed` conta sucessos e falhas iniciadas;
  `remaining` corresponde às linhas não iniciadas. Requisições já enviadas podem
  terminar e conservam seu resultado real. Recuperação respeita as permissões
  atuais; não retoma após reload nem constitui job durável.
- O endpoint novo `POST /v1/leads/{id}/attachment-uploads` exige
  `uploadRequestKey`. A rota diferente impede que uma réplica antiga ignore a
  chave e grave no Storage. Não há retry automático do upload; a identificação
  é conservada para o mesmo `File` no contexto original, sem garantia após
  recarregar ou selecionar novamente o arquivo.
- `20261013003723_add_lead_attachment_upload_receipts.sql` foi criada e
  **não aplicada**. SHA256:
  `315c05a05ec1747e28e2f088723258da74cce20ff246649c0226ade2b316d364`.
  O source-lock recebeu apenas esse registro, com baseline anterior preservada.
  O gate isolado confirmou 215 migrations não vazias; isso não valida execução
  SQL. A migração de recibos de importação da etapa histórica também não foi
  aplicada por este trabalho.

### Evidência local desta rodada

Resultados por frente, sem somar repetições ou assumir que todos os arquivos
compartilhados são testes distintos entre os pacotes:

| Frente | Resultado concluído | Alcance |
| --- | --- | --- |
| Root/interface | 44 testes Node e os quatro pacotes Go `leads`, `authorization`, `distribution`, `propertyscope` passaram. | Handlers, contratos, autorização e cache locais; casos PostgreSQL guardados continuam pulados. |
| Importação | 47 testes Node distintos passaram, sem skips; o arquivo final de handlers teve 13/13. | Callback antigo após troca de contexto, A-B-A, preparo com catálogos em memória, resultado parcial, recuperação com permissão reduzida, origem e CSV. |
| Exportação | 40 testes Node e quatro testes adicionais de arquivos CSV/XLSX reais em memória passaram. | Serialização/releitura de bytes, telefones/CEP/IDs/números, texto perigoso, JSON bruto e limites; não é teste em Excel/Numbers. |
| Anexos | 8 testes Node e 15 testes Go focados passaram, sem skips nessa suíte focada. | Os 15 são 11 novos e quatro existentes; não somar os 13 da rodada anterior. Inclui transferência antes de assinar URL externa e leitura limitada. |
| Rotas/contratos | `TestContactsP1MutationRoutes` passou no pacote Go `app`; parser/contrato OpenAPI atual passou. | Nova URL e guards de sessão/permissão locais; não representa aprovação da suíte inteira de `app`. |

O foco Go de anexos foi executado em `apps/api`, com `GOPROXY=off`:

```sh
go test ./internal/leads -run '^(TestAttachment|TestSensitiveProfile|TestStoragePathFrom|TestLeadAttachmentStorage)' -count=1 -v
```

A suíte Node de anexos foi:

```sh
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/lead-attachment-upload.test.ts lib/api/lead-attachments.runtime.test.mjs hooks/use-lead-attachments.runtime.test.mjs
```

Os quatro testes originais de parsing/XLSX do diálogo foram preservados, com os
testes de handlers separados para não dependerem do carregamento de ExcelJS.
A execução pesada interrompida não integra os 47 aprovados. A verificação de
diff dos pacotes de código passou no escopo informado por seus responsáveis.

### Gates gerais e limites restantes

O typecheck geral e os lints gerais desta rodada foram encerrados por timeout,
com exit 1 **sem diagnóstico**; não foram aprovados. As repetições sem
incremental/focadas também foram encerradas sem diagnóstico. A tentativa pela
API do ESLint esgotou seu timeout, sem conclusão. Não há gate geral pendente
nem aprovado nesta rodada. O lint próprio de importação foi interrompido após
41,2 minutos sem diagnóstico. Os
erros de outras conversas listados na seção histórica não devem ser tratados
como diagnósticos atuais desta rodada.

- Não foram validados banco real, migrações aplicadas, browser autenticado,
  Mac/Safari, celular ou abertura física em Excel/Numbers. Homologação também
  requer medição de memória/latência e concorrência; testes locais não comprovam
  a meta de 5–6 mil usuários.
- XLSX limita 16.384 colunas, 1.048.575 contatos mais cabeçalho e 32.767 caracteres
  por célula. O processamento no navegador limita 2.000.000 células; expansão
  limita 20.000 colunas, 1.000.000 nós, 64.000.000 caracteres JSON e profundidade
  64. Exceder o orçamento produz erro e alternativa, sem cortes silenciosos.
  No CSV, texto perigoso/número puro protegido acima de 255 caracteres recusa
  a fórmula constante; texto normal e JSON longo não recebem esse bloqueio.
- Arquivo de importação permanece limitado a 10 MB, sem teto arbitrário de
  linhas. Upload de anexo limita o arquivo a 25 MB; multipart pode usar arquivo
  temporário após 1 MB. Objetos pendentes vinculados a recibos não possuem GC
  automático nesta etapa.
- A versão de exportação continua sendo conferência do conjunto entre leituras,
  não um snapshot duradouro. O relatório exportado não restaura todo o CRM.

Backups desta rodada: `D:\Vimob\_safety\contacts-final-20261012`, incluindo o
histórico deste documento em `docs`. Reverter somente os hunks da frente
correspondente; não restaurar integralmente arquivos compartilhados sobre
alterações de outras conversas. Os ledgers não devem ser apagados enquanto
clientes puderem repetir chaves confirmadas.
