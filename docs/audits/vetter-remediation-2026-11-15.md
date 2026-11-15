# Ajustes da auditoria Vetter co. - Taskmaster

Pedido de 15/11/2026: corrigir os ajustes da auditoria com Taskmaster e Ponytail.
Base de código: `279d4053`; branch `codex/vetter-audit-remediation-20261115`.
Organização da auditoria: Vetter co. Dados e destinatários dos testes são sintéticos.

## Critério de conclusão

Cada correção deve reproduzir a causa, alcançar os consumidores afetados, ter
verificação pertinente e registrar seu limite. Código validado localmente e
comportamento validado em produção são estados distintos. A revisão não permite
declarar que os quatro convites pendentes já são usuários ativos.

Os gates de front são `npm run typecheck`, `npm run lint` e os testes focados.
Go exige testes dos pacotes alterados. SQL precisa de execução em banco
descartável; teste opt-in pulado continua pendente. Não alterar migrations
históricas nem executar `supabase db push`, conforme `supabase/README.md`.

## Ajustes e decisões

| Task | Prioridade | Estado atual | Escopo e critério de aceite |
|---|---|---|---|
| F00 | P1 | Concluída em produção | Prelude protegido e migration canônica de recibos aplicados; índice composto existente reutilizado. Contratos de RLS, grants e captura passaram. A intenção original recuperou AP0378: um imóvel, um recibo, proprietário vinculado e uma foto persistida após F5. Rascunho, sem versão publicada. Fronteiras existentes preservadas. |
| F01 | P2 | Código e PostgreSQL local aprovados | Arquivar coluna: projeção legada corrigida para `automation_nodes.node_config` no guard compartilhado. Casos de fluxo ativo, versão publicada, execução pendente, etapa irmã e outra organização executados. Canário de produção pendente. |
| F02 | P2 | Schema/runtime reparados; bloqueada pelo OAuth original | Duas migrations canônicas aplicadas e nove arquivos Google conferidos no runtime. Invoker interno corrigiu falha de transporte: HTTP 200 e consumidor executado. Duas cabeças falharam por `Missing GOOGLE_CLIENT_ID`; faltam também SECRET e REDIRECT_URI. Recuperar configuração do cliente OAuth original para concluir canário e scheduler. Cron não criado; 24 pulls mortos comprovadamente inalterados. |
| F03 | P2 | Código e testes locais aprovados | GTM/GA4/Search Console: contrato comum de leitura corrigido por F08. Falha de leitura permanece visível e pode ser retentada. Canário externo de telemetria pendente. |
| F04 | P3 | Código e testes locais aprovados | Equipes: cache invalidado refaz a leitura ao reabrir lista ou catálogo. Regressão de criação/renomeio e duas organizações passou. |
| F05 | P3 | Código e runtime local aprovados | Menu e diálogo reais reutilizam PATCH e revisão capturada. Nome validado em português, concorrência, retry, cache da organização e troca de seleção/sessão/ator/permissão cobertos. Revogação não reabre o diálogo ao restaurar acesso. |
| F06 | P3 | Código e testes locais aprovados | Meta Marketing: catálogo reflete módulo e disponibilidade retornada pelo servidor. Falha de leitura, não conectado e indisponibilidade têm estados distintos; CTA bloqueado quando indisponível. |
| F07 | P3 | Código e testes locais aprovados | Exclusão de coluna: mensagem de concorrência só para `pipeline_stages_changed`; demais HTTP 409 preservam a causa. Seis casos de confirmação passaram, incluindo callbacks antigos e quatro causas de dependência. |
| F08 | P2 | Código e PostgreSQL local aprovados | Site: vazio/whitespace legado normalizado somente na projeção da resposta. Escrita estrita preservada; SELECT, RETURNING e fallback conferidos, cinco fixtures PostgreSQL executadas. |
| F09 | P2 | Regra aprovada; código e PostgreSQL local aprovados | Saldo aberto de receber/pagar com vencimento anterior ao dia em Brasília, estados reconhecidos e pagamentos deduplicados; carteira inteira na Dashboard e recortes nas demais telas. Inadimplência usa saldo vencido dos recebíveis sobre nominal dos recebíveis já vencidos, incluindo liquidados e excluindo cancelados, base zero em 0%. Nenhum status é atualizado automaticamente. Contas, Relatórios e exports alinhados. |
| F10 | P3 | Código e testes locais aprovados | Histórico compara status, preços e publicação com snapshot anterior; comentário com formulário completo fica genérico. Detalhe igual ao título é suprimido. Testes Go, persistência PostgreSQL e renderização passaram. |
| F11 | P3 | Código e runtime local aprovados | Área útil respeita banner em 1762x957 e 390x844, rolagem normal e interna, resize e desmontagem nos dois sentidos entre avisos. Última ação alcançável e preferências preservadas. Singular/plural corrigido. |
| F12 | P1 histórico | Encerrada fora do escopo por decisão do usuário | Em15/11/2026 o usuário informou que o domínio venceu e não pertence mais à operação e pediu abandoná-lo. Não recuperar registro, alterar DNS ou publicar canário nesse domínio. A evidência DNS anterior fica histórica. |

## Retestes associados

Os retestes abaixo distinguem verificações concluídas, canceladas e ainda
pendentes em produção, integração externa ou dispositivo. Testes locais
relacionados não encerram verificações externas.

| Task | Dependência | Evidência necessária para encerrar |
|---|---|---|
| RET01 | Convites | Os quatro logs já comprovaram Resend HTTP 422 por `example.com`. Usar caixa recebível em teste próprio e verificar aceite do provedor, entrega, aceite do convite e sessão. Não reenviar para endereços fictícios. |
| RET02 | RET01 | Sessões de administrador, líder e dois usuários, com leitura/escrita e escopos próprios/equipe; autorização conferida no servidor. |
| RET03 | RET02 | Avatar individual dos novos usuários persistido após reabertura/F5, com upload e leitura autorizados. |
| RET04 | F01 | Arquivar e reativar coluna vazia pela UI; quadro e gerenciamento coerentes, histórico preservado. |
| RET05 | F01/F07 | Histórico, automação/rota ativa, revisão antiga e concorrência produzem bloqueio e mensagem corretos. |
| RET06 | F04 | Escala/participantes/fila persistidos; janelas aberta/fechada e elegibilidade executadas com critério sintético exclusivo. |
| RET07 | RET06 | Expiração/redistribuição com próximo participante, respeito à escala e ausência de duplicidade. |
| RET08 | Cadência | Esperar prazo de um dia configurado, confirmar evento e leitura pelo destinatário autorizado. Teste de relógio local não comprova entrega externa. |
| RET09 | Dispositivo/provedor | Som/push observado em dispositivo habilitado; WhatsApp distingue aceite, entrega e recibo no CRM. Preservar worker Go e failover Edge aposentado. |
| RET10 | RET02 | Anexo já persistido disponível aos perfis autorizados e negado aos demais escopos. |
| RET11 | F02 | Compromisso canário presente no calendário correto, fila/recibos e CRM reconciliados. |
| RET12 | F03/F08 | Consulta de configuração bem-sucedida e canário autorizado de telemetria no site. |
| RET13 | F00/RET12 | Inventário e telemetria externos reconciliados; reuniões sintéticas já reconciliadas na auditoria original. |
| RET14 | F00 | Concluído: intenção original recuperada como AP0378, um imóvel/recibo, proprietário da mesma organização e uma foto após recarga. Não houve replay HTTP adicional após a criação. |
| RET15 | F12 | Cancelado o reteste externo nesse domínio por decisão do usuário. A ressalva histórica sobre localização de AP0377 permanece documentada; não alterá-la incidentalmente durante F00/F02. |
| RET16 | F09 | Regra aprovada, implementação e comparação entre telas/exports no mesmo recorte, cobrindo duas organizações. |
| RET17 | F02 | Desfechos Realizada/No-show e recorrência persistidos; chegada externa verificada separadamente. |

## Ambiente e execução

- Checkout principal preservado com `.agents/` preexistente não rastreado.
- Worktree separada; dependências existentes reutilizadas sem alteração de lockfile.
- PostgreSQL 17.11 descartável criado em loopback 127.0.0.1:57924 pelo harness
  canônico existente. Cada integração cria somente seu DB aleatório próprio.
  Ao encerrar, verificaram-se zero DBs de aplicação remanescentes e o cluster
  foi parado pelo harness após conferência da identidade. Nenhuma credencial real foi usada.
- Conversas permanece fora do escopo pedido. Conexões Meta existentes,
  permissões externas e modos do WhatsApp não são alterados incidentalmente.
- O corte autorizado F00/F02 foi executado e está registrado abaixo e nos
  runbooks. API/Web e as demais correções locais não foram publicados neste corte.

## Registro de resultados

### Gates e regressões

| Verificação | Resultado e limite |
|---|---|
| `npm run typecheck` | Exit 0, projeto completo. |
| `npm run lint` | Exit 0, zero erros, oito avisos em arquivos não alterados. Nenhuma supressão adicionada. |
| `git diff --check` | Exit 0. |
| Go pipeline com banco habilitado | 289 testes/subtestes aprovados, zero pulos. SQLSTATE 42703 reproduzido antes do ajuste da consulta usando fixture com a coluna canônica. |
| Runtime pipeline pelo runner canônico, sete arquivos afetados | 208 testes, zero falhas/pulos/TODO. Suíte de renomeio recebeu ainda os asserts finais de restauração de permissão e passou 45/45. |
| Go properties | 362 testes/subtestes aprovados; 26 integrações preexistentes exigiam outros harnesses e foram puladas. Os três casos novos de PostgreSQL executaram sem pulo. |
| HistoryTab real | 2/2, regressão vermelha antes e verde após correção. |
| Go site e financial | Pacotes passaram; opt-ins de banco foram executados separadamente e não confundidos com pulos do comando comum. |
| PostgreSQL site | Cinco fixtures: nulo, vazio, whitespace, configurado e inválido não vazio. |
| PostgreSQL financeiro | Um teste e quatro subcasos: duas organizações, pagamentos espelhados, parciais, datas, virada de Brasília em fusos de sessão diferentes, estados desconhecidos e base zero. Sem escrita nos lançamentos. |
| Modelo/export financeiro | 9/9; validação financeira/integrações 38/38. Arquivo Excel real não inspecionado nesta rodada. |
| Catálogo de integrações real | 6/6, disponibilidade, erro/retry e ação autorizada. |
| Equipes e filtros | 14 testes de hooks e cinco de filtros, incluindo segunda organização. |
| PWA real com shell | 7/7, desktop/mobile, dois modos de rolagem e preservação da reserva do aviso sobrevivente. |
| Agenda real com serviços sintéticos | 40/40, incluindo erro histórico 404 e falha outbound 503, com atualização somente de leitura. |
| Source-lock de migrations | 286 fontes conferidas, nenhuma migration histórica alterada. |

Logs de integração e gates em `D:/Vimob/outputs/vetter-remediation-20261115/`.
Capturas locais de PWA/renomeio em
`D:/Vimob/outputs/vetter-qa-remediation-20261115/`. Os totais das suítes acima
não devem ser somados, pois há testes e camadas compartilhados.

### Fronteiras, impacto e reversão

As correções de pipeline usam o mesmo guard para arquivar/excluir e o mesmo
contrato de revisão e intenção de acesso. Imóveis preservam a transação e a
idempotência. Site normaliza apenas a resposta, inclusive RETURNING. Financeiro
exige publicar API compatível e consumidores web coordenadamente; a regra muda
o significado do filtro Vencido, sem reclassificar linhas do banco. A reserva
do banner alcança todo AppLayout e foi verificada com rolagem normal/interna.

Os arquivos legados grandes receberam alterações nos pontos donos para evitar
refatoração incidental. Uma divisão posterior deve extrair classificação do
histórico, apresentação do catálogo e modelo de indicadores financeiros em
tarefas próprias, preservando permissões e contratos. Nenhuma store ou camada
global paralela foi criada.

Reversão e canários constam nos runbooks de pipeline, recibos, site/Agenda e
Financeiro. A reversão do schema de recibos não pode apagar tombstones ou
reservas idempotentes. Não executar replay em massa dos jobs Google mortos.

### Corte de produção F00/F02 em 15/11/2026

O alvo self-hosted e a organização foram conferidos. Houve backup protegido
de schema, Functions e dados Google/Vault no próprio host. O ensaio isolado
recuperou as cinco tabelas Google com fingerprints iguais aos dados de produção
antes do corte e avaliou a descriptografia dos 61 segredos do Vault. Não foi
uma restauração integral do CRM, de FKs externas ou das funções do dump completo.
As duas migrations Google também passaram sobre esse clone reduzido, usando
a definição real do claim legado. Nenhum segredo aparece neste relatório.

F00 recebeu o prelude `20261115_prepare_property_creation_receipts.sql` e a
migration canônica inalterada `20261012223804_persist_property_creation_receipts.sql`.
Não houve foundation, `db push` ou ledger Supabase inventado. Os contratos
pós-corte passaram. Owners, ACLs, RLS, constraints, políticas e os 20 triggers
preexistentes de imóveis coincidiram com a preimage; foram adicionados somente
os objetos previstos. A recuperação visual confirmou AP0378, ID
`8c51c4c1-9f21-471e-8ed3-26396a941c15`: um cadastro com esse título na organização,
um recibo, proprietário da mesma organização, uma foto e zero versões publicadas.
Edição e foto permaneceram após recarregar. O recibo deve ser preservado em
qualquer reversão; não apagar reservas ou tombstones.

F02 recebeu `20261012212128_harden_google_calendar_outbound_protocol.sql` em
transação única e `20261013000127_harden_google_calendar_activation_status_and_export.sql`
separadamente. O runtime antigo foi parado e reiniciado numa janela medida de
15 segundos; nove arquivos Google foram conferidos no destino. Quatro arquivos
existentes mudaram e um módulo novo foi adicionado; os demais já coincidiam.
Router, políticas, outros arquivos, imagem, ambiente e mounts ficaram iguais
ao backup. O serviço retornou saudável e o GET sync respondeu 405.

A primeira chamada canônica, pg_net 3933, falhou antes do worker: o DB não
alcançava o endpoint público. A definição privada do helper foi preservada e
apenas seu literal de destino mudou para a rota interna de Functions; a
autenticação por segredo do Vault permaneceu. O diff da definição confirmou
essa única substituição. A chamada 3934 retornou HTTP 200 e executou duas
cabeças da fila, ambas com uma tentativa e erro `Missing GOOGLE_CLIENT_ID`.
Faltam no runtime as três configurações exigidas pelo refresh: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` e `GOOGLE_CALENDAR_REDIRECT_URI`. As fontes existentes
pesquisadas não forneceram um par utilizável; um candidato histórico em
quarentena pertence a outro cliente e não foi usado. O console Google mostrava
somente segredos mascarados, sem recuperação do valor original.

Estado final conferido às 17:39 UTC: duas intenções upsert em failed/1 tentativa,
dois upserts e um delete em queued/0 tentativas; zero jobs running, zero HTTP
Google pendente, zero jobs de outra organização e nenhum Cron Google criado.
Os 24 pulls mortos mantiveram exatamente o fingerprint anterior. Os dois links
existentes não são prova de envio novo. Nenhuma chegada ou estado final no
Google foi confirmado. Não houve replay, reset de tentativas, novo cliente,
conexão OAuth, alteração de allowlist ou atalho de despacho imediato.

O container de restauração isolado foi removido após conferir nome, imagem,
rede sem acesso e mounts somente de leitura. O cluster PostgreSQL local foi
parado pelo harness. Evidências saneadas e capturas:
`D:/Vimob/outputs/vetter-production-closure-20261115/`. Backups com dados reais
permanecem privados no host; não fazem parte dos artefatos compartilhados.

[Estado final saneado em JSON](D:/Vimob/outputs/vetter-production-closure-20261115/production-final-status.json),
[captura do imóvel persistido](D:/Vimob/outputs/vetter-production-closure-20261115/f00-ap0378-persistido.jpg)
e [bloqueio OAuth na Agenda](D:/Vimob/outputs/vetter-production-closure-20261115/f02-configuracao-ausente.jpg).
No encerramento, `git diff --check`, o source-lock das 286 migrations e o
manifesto Edge passaram. Não foi repetida a suíte inteira de API/Web após as
edições somente documentais desta etapa; seus resultados locais estão acima.

### Próximas tarefas que exigem operação externa

1. F02: recuperar o par OAuth original e o redirect URI, instalar de forma
   protegida no runtime e repetir preflight/canário sem forçar a fila. Comprovar
   o estado final no Google antes de ativar o Cron outbound e observar seus ciclos.
2. Implantar API/Web compatíveis e executar os demais canários pendentes.
   No corte operacional F00/F02 acima não houve commit, push ou build de imagem;
   a publicação Git solicitada depois está discriminada abaixo.
3. F12 foi retirada do escopo pelo usuário, que informou a expiração e o fim
   do uso do domínio. Não executar a recuperação anteriormente proposta.
4. RET01/RET02: fornecer caixas recebíveis de teste e concluir convite/sessões.
   Não houve novo envio, aceite fictício ou criação de credenciais nesta rodada.

No encerramento daquele corte operacional, build completo, release de API/Web,
matriz real dos quatro perfis e entrega em Google/dispositivos permaneciam sem
aprovação por teste. F00 e o reparo de schema/runtime/transporte de F02 têm as
provas de produção descritas acima.

## Publicação Git solicitada em 15/11/2026

O usuário autorizou explicitamente publicar o conjunto na `main`. Esta entrega
reúne os ajustes de aplicação F01 e F03–F11, os testes e os registros das
operações F00/F02. F12 continua cancelada. As migrations históricas mantêm seus
hashes; não há execução automática de SQL ou reativação do Cron Google pelo push.

A revisão final de Financeiro/site, pipeline/imóveis e interfaces não encontrou
bloqueador de aplicação. Foram corrigidas duas falhas nos novos harnesses:
as conexões PostgreSQL de teste agora rejeitam também fallbacks remotos e o
empacotador rejeita um filho interno cujo nome começa por dois pontos. Essas
regressões foram demonstradas antes da correção e passaram depois, sem conexão
remota ou gravação indevida. O empacotamento externo real confere os hashes.

Verificações frescas antes do commit:

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado, zero erros e os oito avisos preexistentes.
- `npm run validation:test`: 814 contratos, três contratos adicionais e 84
  pós-validações aprovados, sem falhas ou pulos nos grupos reportados.
- `go test ./apps/api/... ./packages/auth/... ./packages/db/...`: aprovado;
  testes opt-in não habilitados nesse comando não são cobertura positiva.
- Pipeline/imóveis com seus opt-ins PostgreSQL, Financeiro e projeção Google
  com banco próprio: aprovados no cluster descartável novo, com identidade
  conferida e remoção dos bancos próprios. Fixtures legadas não habilitadas
  permanecem fora da cobertura positiva.
- Interfaces e planner: 128 testes aprovados; cinco grupos de preflight SQL
  em memória. Os harnesses usam transporte e autenticação sintéticos.
- PostgreSQL Google nativo: rollback injetado, migrations canônicas em ordem,
  duas suítes SQL e contratos aprovados; zero chamadas ao provedor.
- Empacotador: dois testes aprovados. Source-lock das 286 migrations,
  manifesto Edge e `git diff --check`: aprovados.
- `npm run audit:check`: aprovado após regenerar os inventários canônicos.
  O diálogo de renomear funil acrescenta um overlay/formulário e, com o botão
  de atualizar status, três CTAs; não houve edição das regras do verificador.
- Auditoria de dependências do release: nenhum advisory alto ou crítico.

Logs locais em `D:/Vimob/outputs/vetter-main-publication-20261115/`. O workflow
`Docker Images` da main executa os gates e publica imagens API/Web no GHCR.
Ele não atualiza a stack Portainer. O resultado desse workflow deve ser
conferido para o SHA desta entrega; aprovação local não equivale ao CI concluído
ou ao canário de produção. Na implantação, manter a API compatível antes da Web.
O envio ao Google segue bloqueado pelo par OAuth original, sem Cron habilitado.
