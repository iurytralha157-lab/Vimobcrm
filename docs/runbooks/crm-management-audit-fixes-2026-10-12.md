# Gestão CRM: ajustes locais da auditoria

Data: 12/10/2026. Checkout: `D:\Vimob\workspaces\vimob-crm`, branch `main`.
HEAD de referência: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.

Os ajustes abrangem Gestão → Equipes, Distribuição, Tags e vínculos de Pipelines.
Foram feitos no checkout principal, sem commit, push, deploy, migração remota ou
acesso ao banco de produção. O checkout já continha centenas de alterações de
outras tarefas; este documento não atribui essas alterações à auditoria.

## Terceira rodada: correções autorizadas em 13/10/2026

Pedido: "Ajusta todos esses pontos com cuidado". As alterações desta rodada
continuam no checkout principal, sem commit, push, deploy, migração aplicada,
serviço iniciado ou consulta ao banco do CRM. Os backups seletivos ficam em
`D:\Vimob\_safety\management-third-fixes-20261013-003428`,
`teams-final-fixes-20261013-003401-029`,
`distribution-third-pass-fixes-20261013-003321-53a1a8c4` e
`management-third-audit-tags-20261013-003449-b7b07ebb`.

### Participação, autorização e transporte

- Peso/posição não mencionam `is_active` no SQL quando não há ativação explícita.
  Isso preserva a geração antiga de um corretor removido/reconvidado. Ativar
  explicitamente continua vinculando a geração vigente; não houve backfill.
- Uma nova migração restringe SELECT de filas, regras e participantes à sessão
  ativa, organização selecionada, permissão efetiva `distribution_manage` e
  alcance do gateway. Líderes continuam limitados às filas criadas por eles,
  relacionadas às equipes, pessoas e pipelines liderados. Overrides, funções
  customizadas, wildcard, vínculos inativos e gerações são considerados.
- As escritas de equipes, disponibilidade, vínculos de pipelines, distribuição
  e tags usam `managementAPIRequest`. Ator e session ID são fixados antes da
  resolução/renovação do token; um 401 não pode reenviar a intenção como outro
  login. Resposta antiga também não é apresentada como sucesso do novo ator.
  O transporte genérico e as leituras conservam sua política anterior.
- O editor de equipes fixa a intenção antes do upload, propaga-a pela mutation,
  verifica-a após awaits e cancela submit/recarga ao desmontar. A intenção é
  removida do corpo HTTP antes da validação; não cria autorização no browser.
- Recuperar a criação que tornou o criador líder consulta o ledger do próprio
  ator/organização/key, exige autorização atual sobre o resultado e não permite
  nova criação a um líder. Resultado removido não é recriado.

### Equipes, escalas e vínculos

- A sincronização legada considera os resultados efetivos dos INSERTs antes
  de apagar o último vínculo de equipe. Membros ocultos e colisões com usuários
  diretamente inscritos não fazem a equipe perder sua âncora.
- O formato de relógio do Go foi alinhado a `HH:mm(:ss)?`. Frações, horas sem
  dois dígitos e conteúdo extra são rejeitados. O resumo preserva segundos
  relevantes e continua compacto quando os segundos são zero.
- Uma migração forward exclui dias inteiros do ramo que atravessa meia-noite
  no picker; o predicado Go usa a mesma regra. Horários antigos não são
  reescritos. Dias inteiros valem no próprio dia; jornadas noturnas normais,
  membros diretos e a opção explícita de ignorar horários são preservados.
- Vínculos de pipelines publicam `team.pipeline.linked/unlinked` após commit,
  com organização e IDs. Falha, rollback e no-op não publicam alteração.
- A sincronização materializada usa o mesmo limite público de participantes
  da distribuição. Crescimento real acima de 500 ou posição sem espaço em int4
  falha explicitamente e faz rollback da alteração de equipe. Não converte
  grupos nem modifica pesos automaticamente para contornar o limite.

### Editores e roteamento de distribuição

- GET detalhado/readback pode retornar `eligibleUserCount`, deduplicado e
  calculado pelo mesmo SQL da validação. Listas podem omiti-lo, evitando N+1.
  A UI diferencia alcance editável de capacidade completa. Quando uma edição
  não permite calcular a capacidade com segurança, exibe "Validado ao salvar"
  e usa a validação obrigatória da transação; pessoas preservadas não ficam
  editáveis incidentalmente.
- Criação e acréscimos individuais são limitados a 500 participantes/200 regras
  sob o lock do pai. Snapshots legados maiores podem ser preservados ou reduzidos
  sem inclusão/alteração enquanto o resultado permanece acima do limite.
  Ao retornar ao limite, a validação normal volta a permitir edição.
- Renomeações omitem coleções semanticamente inalteradas. As flags de
  preservação são internas ao form/hook e não entram no HTTP. Isso também
  evita materializar regras virtuais de vínculos Meta numa alteração de nome.
- Filas globais/sem regras podem preservar destino e critérios existentes.
  Os requisitos de criação não obrigam uma renomeação a mudar o roteamento.
- PATCH semanticamente idêntico mantém o CSV legado; leituras de matcher usam
  `conditions.match || match`, inclusive conflitos. Alterações de metadados
  preservam o matcher/condições. Prioridade zero explícita é mantida.
- O armazenamento de rascunhos aceita valores/fingerprints e coleções válidos
  maiores, ainda sujeito ao teto do JSON serializado. Falha/quota bloqueada gera aviso e
  confirmação de saída sem prometer recuperação inexistente.
- Jobs `source=lead_attention` mantêm prazo e limite da atenção/SLA. A fila
  precisa existir e estar ativa; seu toggle/prazo/limite de inatividade não
  sobrescreve a política desses jobs. Jobs normais continuam reconciliados.

### Tags e consistência entre sessões

- Um trigger AFTER grava `lead.tagged/lead.untagged` no bus durável existente
  apenas para o efeito de automação correspondente, execução corrente, mesmo
  tenant/lead/tag, node e status. Associação e evento são atômicos; rollback,
  repetição e no-op não publicam duplicatas. Nenhum endpoint/grant público novo.
- Gestão reconcilia a contagem a cada 60 segundos enquanto a aba estiver ativa;
  não faz polling em background, após desmontar ou nos seletores comuns. Isso
  recupera a contagem mesmo se um evento se perder no bus existente. Não houve
  redesenho do cursor global de realtime.
- Mover um filho para outro pai no mesmo tenant revalida as referências de
  tags. IDs inalterados não podem ressuscitar uma tag já removida.
- A confirmação de exclusão tem limite de `90dvh` e rolagem. A regressão com
  CSS real reproduziu a falha antes do ajuste numa viewport de 300 px e passou
  depois nos dois temas. Primitivas de UI foram preservadas.

### SQL local pendente e verificação

Novos arquivos: `20261013033722_management_distribution_read_authorization.sql`,
`20261013033953_management_tag_reparent_and_automation_events.sql` e
`20261013034403_management_all_day_overnight_eligibility.sql`.

A execução SQL encontrou dois aliases de coluna ausentes em
`20261012212837_management_tag_reference_integrity.sql`, da primeira rodada.
Esse arquivo é local, não rastreado e ainda pendente conforme o histórico desta
tarefa; apenas os dois aliases foram corrigidos para `reference(value)`, com
backup. Nenhuma baseline ou migração aplicada foi reescrita. O source-lock foi
atualizado seletivamente para esses quatro arquivos, preservando os demais hashes.

- Transporte/schemas/OpenAPI/snapshot: 49 testes Node passaram, sem skips. Cobrem retry
  com troca de ator/login, resposta antiga, precisão e contratos de limites.
- Tags: 8 helpers, 8 testes React/Radix com CSS real e 6 testes do código real
  da ação Edge por AST passaram. O runtime Edge permaneceu byte a byte como antes.
- SQL: 30 grupos passaram em PostgreSQL 18.6/PGlite 0.5.9, em memória, executando
  as três novas migrações e os precursores de tags, com funções/RPC canônicos.
  Há casos de duas organizações, sessão revogada/recovery, overrides, liderança,
  rollback/no-op de tags, reparent e geração/escala. O schema de apoio é mínimo:
  isso não representa reset da cadeia inteira, pgTAP, concorrência ou produção.
- Integridade: source-lock com 220 migrações passou; manifest Edge com 41 live,
  26 tombstones e 15 retired passou na execução desta rodada.
- Distribuição: 115 testes Go selecionados e 35 Node passaram, sem skips.
  Equipes/availability: 65 testes Go de Teams e 19 de Distribution passaram;
  testes VM de hook real, resumo e snapshot também passaram. Houve revisão
  independente entre as frentes, sem novo defeito concreto nos deltas finais.
- Go ampliado: 1.626 casos passaram e 83 integrações foram puladas por ausência
  de ambiente descartável autorizado. Seis pacotes passaram; o pacote `app`
  falhou apenas em `TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue`,
  já observado antes desta rodada e fora dos arquivos de Gestão. A primeira
  invocação também incluiu por engano o pacote inexistente `internal/tags`;
  ele é uma falha de configuração do comando, não um teste aprovado/falho de
  produto. O domínio de tags em Go está em `leads`, incluído na execução.
- Typecheck global: `npm run typecheck -- --pretty false` não concluiu na
  primeira tentativa. O compiler API foi executado com o MESMO
  `tsconfig.typecheck.json`, todos os 1.848 roots e opções originais, sem mudar
  excludes/checks: concluiu com dois diagnósticos fora de Gestão, em
  `SdrDistributionButton.tsx:74` e `property-form-session.test.mts:4`.
  O último guard opcional de cache de equipes também tem teste de regressão.
- Lint global: zero erros e sete avisos fora de Gestão; o modo estrito
  `--max-warnings=0` retorna exit 1 por esses avisos. Não foram removidos nem
  suprimidos. Lint focado dos 23 arquivos finais passou com zero erros e zero
  avisos (`--max-warnings=0`), incluindo o último guard de cache e seu teste.

Reprodução do SQL: instale PGlite 0.5.9 num diretório de ferramentas fora do
checkout, sem alterar dependências da aplicação, defina
`VIMOB_MANAGEMENT_PGLITE_MODULE` com o caminho absoluto de `dist/index.js` e rode
`node scripts/tests/management-postgres-fixture.mjs`. Módulo ausente faz o
verificador falhar; não gera aprovação por skip.

A futura publicação exige ordem das migrações pendentes, validação da cadeia
completa num banco descartável compatível, revisão de leituras legítimas e
verificação de duas sessões reais. Reversão deve reaplicar seletivamente os
deltas desta rodada sobre os backups, preservando mudanças simultâneas; para
SQL, use uma migração forward revisada conforme comentários de cada arquivo.
Nada deste documento autoriza aplicação/deploy.

## Segunda rodada: correções e revisão independente

Esta seção registra a rodada autorizada por “Pode ajustar”. As seções seguintes
preservam o histórico da primeira rodada, inclusive seus resultados naquele
momento; os gates globais precisam ser lidos pela execução mais recente.

### Equipes, visibilidade e disponibilidade

- GET de disponibilidade passa por `team_view` e pelo escopo da equipe, assim
  como os demais catálogos. Não basta ter uma organização ativa.
- Um co-líder globalmente inativo não bloqueia o salvamento de outro líder. O
  vínculo oculto é preservado; a edição não o apaga incidentalmente.
- Horários legados nulos ou inválidos em dias ativos exigem regularização
  explícita. O formulário deixa de substituir silenciosamente o horário por
  08h–18h. Minutos arbitrários e segundos existentes permanecem no payload,
  preview, indicador de disponibilidade e histórico. Uma janela 08:00:01–08:00:02
  continua válida; 08:00–08:00:00 continua sendo uma janela vazia.
- O vínculo lógico de uma equipe numa fila legada permanece ao retirar todos
  os integrantes. Reincluí-los volta a sincronizar a expansão daquela equipe.
- A migração de leitura adiciona três políticas SELECT restritivas para
  `teams`, `team_members` e `team_pipelines`, preservando os grants e políticas
  permissivas existentes. A interseção exige sessão ativa, organização,
  permissões efetivas, liderança e geração vigente do vínculo. Helpers privados
  evitam recursão das próprias políticas; não usam cargo fornecido pelo cliente.
- A resolução de permissões existente é preservada. Grants de `settings_manage`
  expandem permissões, mas esse alias composto em overrides é ignorado pelo Go
  atual e pelo SQL novo. Overrides canônicos e aliases simples seguem o contrato
  atual; implicações são reaplicadas depois das negações. Linhas legadas com
  aliases simples contraditórios falham fechadas na leitura direta do banco,
  sem escolher uma autorização ao acaso nem alterar esses dados.

### Distribuição e critérios

- A reconciliação autoriza cada alteração e remoção sob lock. Omitir um
  participante fora do escopo não o remove; mudar peso, atividade ou vínculo
  também é negado. Seu lugar permanece reservado. O editor impede essas ações
  e arrastar participantes através dessas posições; renomear a fila preservando
  o snapshot autorizado continua funcionando.
- `isActive:false` é transportado e persistido ao criar um participante nos
  três caminhos de inserção. A ausência do campo conserva o default anterior.
- Critérios de 17 ou 100 tags sobrevivem a criar, ler e renomear. Valores novos
  ou alterados aceitam até 18.099 caracteres; um snapshot maior só permanece
  quando o backend compara o matcher com o registro persistido e confirma que
  não mudou. ID inventado ou de outra fila não dispensa a validação.
- `form` e `meta_form` têm o mesmo comportamento de conflito e sincronização;
  regras históricas conservam seu tipo armazenado. Posições aceitam somente
  inteiros entre zero e 2.147.483.647, também na inserção e no OpenAPI.
- Campanhas novas ou editadas guardam
  `match.campaign_name_contains_literals` como uma lista de textos literais.
  “Torre A,Torre B” não equivale às duas campanhas separadas. Regras antigas
  sem o marcador conservam CSV e suas alternativas. `%` permanece texto, sem
  virar wildcard. Os seletores de intake Go e de leads existentes usam o mesmo
  helper SQL; marcadores malformados não retornam silenciosamente para CSV.
- A fila removida já tinha constraint validada que exige `is_active=false` e
  trigger que impede reativação. A hipótese de tombstone sombrear outra fila
  foi descartada por essa evidência; não houve alteração incidental desse fluxo.

### Concorrência e avisos de redistribuição

- O worker mantém o fence da organização e tenta bloquear fila, lead e job
  nessa ordem. Fila e lead ocupados são adiados com `SKIP LOCKED`; não se espera
  pelo lead segurando a fila. Isso cobre também a ordem inversa do ingresso
  legado WhatsApp e a leitura compartilhada da fila pelo webhook.
- Um job movido para outra fila durante reentrada aguarda o próximo ciclo para
  bloquear a fila correta. Um lead ocupado não é confundido com lead removido.
  Os contadores e o algoritmo de seleção permanecem os mesmos.
- A chave do aviso considera ciclo de inscrição, destinatário, tentativa e
  política de prazo/aviso. Alterar o prazo permite um aviso pertinente novo;
  aguardar disponibilidade ou alterar apenas o teto de tentativas não repete
  o aviso. O formato da chave não provoca replay indiscriminado de avisos antigos.
- A revisão independente identificou que atualizar apenas os primeiros 50 jobs
  não protege um candidato selecionado fora desse lote. Cada candidato agora
  reconcilia a política corrente e reavalia a elegibilidade sob os mesmos locks
  antes do aviso ou da transferência. O batch continua sendo uma otimização,
  sem definir qual prazo efetivo será aplicado. A inscrição inicial WhatsApp
  mantém seu ciclo próprio, separado da redistribuição por inatividade.
- Três cursores em memória, privados da instância do worker, avançam a página
  mesmo quando seus 50 registros estão ocupados. A página curta/vazia reinicia
  a varredura. Não alteram os prazos para rotacionar registros nem adicionam
  locks de filas durante a seleção. Chamadas manuais permanecem sem cursor;
  cada réplica tem estado próprio e o fence global continua limitando a execução.
  Mudanças na lista ou rollback podem adiar uma visita até a próxima volta;
  isso oferece progresso entre páginas, sem promessa de ordem estrita ou SLA.

### Tags, rascunhos e caches

- Recargas antigas não sobrescrevem outro rascunho nem fecham uma confirmação
  posterior, inclusive ao reabrir a mesma tag. O controle considera a sessão
  do diálogo e a identidade do objeto.
- As consultas de detalhe da conversa, uso da tag e contagens são invalidadas
  na organização correta. Add/remove capturam a organização no início da
  mutação e mantêm `Promise<void>`; uma troca de organização durante o pedido
  não publica o evento nem invalida o cache do tenant novo por engano.
- Eventos de associação/criação/remoção de leads atualizam contagens; mensagens
  comuns de WhatsApp não causam esse recarregamento desnecessário.
- O extrator SQL lê campos consumidos por cada produtor: critérios e auto-tags
  de filas, tags alvo de webhooks, configurações Meta, nós de tag, triggers,
  versões publicadas e versões fixadas por execuções ativas. `field_mapping`,
  variáveis, labels e dados opacos não são tratados como dependência de tag.
  Mantidos os locks de referência, isolamento, restauração e reativação.

### Migrações adicionais e limite da entrega

Três arquivos forward adicionais, criados pelo CLI e ainda não aplicados:

1. `20261013003930_management_tag_semantic_references.sql`.
2. `20261013004040_harden_management_team_data_api_reads.sql`.
3. `20261013004750_management_literal_campaign_matching.sql`.

São sete migrações locais de gestão contando a primeira rodada. O resultado
não significa que RLS, grants, referências ou concorrência já foram homologados
em PostgreSQL. Fixtures com rollback foram preparadas para permissões negativas,
duas organizações, referências semânticas e campanhas literais; não foram
executadas. O teste Go de intake é opt-in, restrito a loopback e rollback, e
foi atualizado para respeitar a proteção de referências da nova migração.

O snapshot seletivo desta rodada está em
`D:\Vimob\_safety\management-second-audit-fixes-20261012-213255`, com 655 arquivos
e manifesto. A cópia ocorreu durante o trabalho concorrente e não representa
um instante congelado de todos os arquivos. Substituições necessárias de arquivos
bloqueados usaram staging no mesmo diretório, conferência imediata do conteúdo
original e backup individual. Nenhum diretório foi restaurado integralmente.

Resultados já confirmados desta segunda rodada:

| Verificação | Resultado e limite |
| --- | --- |
| Helpers e schemas de gestão, equipes, filas e tags, execução conjunta | 66/66 passaram, zero skips. Inclui listas grandes, criação congelada, precisão de horários, escopo, snapshots e caches. |
| Contrato OpenAPI com validação Ajv e todas as referências locais | 11/11 passaram na conferência mais recente. Uma referência de anexos que falhava durante alterações paralelas já estava resolvida nessa execução; não foi corrigida por esta auditoria. |
| Fronteiras de API e precisão de disponibilidade | 24/24 passaram. Três casos de precisão também estão no grupo de 66; não somar os grupos como testes únicos. |
| React/Radix com LeadRealtimeBus e hooks reais de tags | 6/6 passaram, zero skips. Dados sintéticos, sem pedidos reais ao backend. Prova das sessões de diálogo, troca de organização durante mutação e eventos de contagem; não é E2E autenticado. |
| Go: pacote completo `distribution` | Passou após ajustar o contrato de casefold dos dois seletores. O intake normaliza o input; o seletor legado normaliza ao comparar. Integração opt-in permaneceu sem execução. |
| Go: conferência final conjunta de sete pacotes | Seis pacotes passaram integralmente: `leads`, `roundrobin`, `teams`, `httpserver`, `managementintent`, `distribution`. A execução registrou 737 testes de topo e 800 subcasos aprovados, 41 testes de topo e 38 subcasos pulados e uma falha em `app`, fora da gestão. Não declarar a suíte global aprovada. Log e resumo em `go-second-round-final-tests.jsonl` e `go-second-round-final-summary.json` na cópia de segurança. |
| Go: equipes e filas | 54 testes puros de equipes e 105 de filas passaram nas execuções dos responsáveis, incluindo negações e zero writes nos casos rejeitados. |
| Go: política por candidato, cursor, locks e recarga de jobs | 26 testes de topo e 20 subcasos passaram, zero skips. Inclui 50 registros ocupados → candidato 51 em dois ciclos, wrap, overflow e falha de leitura sem avançar o cursor. |
| Revisão independente das migrações de referências e de leitura de equipes | Sem bloqueador concreto no recorte revisado. Três contratos de fonte da leitura de equipes passaram; isso não equivale a executar SQL/RLS. |
| Source lock de migrações | Os três novos hashes foram registrados e as demais entradas preservadas, inclusive sua ordem. O gate mais recente passou com 215 migrações não vazias; o arquivo de anexos de outra tarefa já estava registrado nessa conferência. |
| Diff de arquivos da gestão | `git diff --check` passou; o aviso de conversão CRLF/LF do OpenAPI é informativo. Stagings de substituição foram consumidos. |
| TypeScript global | Duas tentativas ficaram sem diagnóstico por tempo prolongado e foram interrompidas. A última permaneceu mais de 15 minutos sem resultado. Nenhuma aprovação de typecheck nesta rodada. |
| ESLint | A tentativa global e as conferências focadas ficaram sem diagnóstico conclusivo. As execuções sem resultado foram interrompidas; não há aprovação de lint nesta rodada. Isso não representa um erro de lint identificado nos arquivos da gestão. |

A falha de `app` é
`TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue`, em
`apps/api/internal/app/notification_worker_contract_test.go:87`. O teste procura
a declaração antiga `const whatsappPushProtocol = "|wa_push_v2"`; a implementação
atual de notificações usa `const pushProtocols = "|push_device_v3|wa_push_v2"`.
O sufixo esperado pela migração está presente, mas o contrato de fonte exige o
nome/texto antigo. Esse teste e o fluxo de notificações não foram alterados nesta
auditoria. A falha não comprova quebra de entrega WhatsApp em produção; continua
sendo um bloqueio da suíte global que precisa ser reconciliado com o trabalho
de notificações.

A execução conjunta Go removeu do ambiente apenas do subprocesso as variáveis
opt-in de testes/integração de banco e Supabase. Nenhum arquivo de ambiente foi
alterado. Os pulos de integração são esperados e não comprovam comportamento
de banco, RLS ou entrega em produção.

Continuam pendentes banco descartável com duas sessões concorrentes,
E2E autenticado, inspeção visual completa e carga; não declarar 100% de
homologação com base apenas nos testes locais.

## Equipes e horários

- A edição e a alteração de disponibilidade exigem a permissão efetiva
  `team_manage`, inclusive para líderes. Uma negação explícita não é substituída
  pelo vínculo de liderança. A API repete a autorização e o escopo da equipe.
- Snapshots de disponibilidade retornam a revisão da equipe. PATCH e PUT exigem
  `expected_revision`; uma edição concorrente retorna conflito e preserva o
  rascunho. Atualização automática não substitui o formulário aberto.
- Horários têm validação completa; turnos que atravessam meia-noite continuam
  válidos. Campos malformados em dias inativos também são rejeitados.
- Trocar organização, usuário ou fechar o editor invalida efeitos tardios da
  operação. O cache da organização de origem ainda é reconciliado.
- Criação usa intenção com UUID e payload congelado, gravados antes do envio.
  O servidor reserva a intenção na mesma transação da equipe. Repetir o pedido
  não cria outra equipe. Recuperação após reload é explícita; uma intenção
  expirada perde o payload e exige conferir a lista antes de nova criação.
- Readbacks necessários para a resposta acontecem antes do commit. Isso evita
  apresentar uma falha de leitura posterior como se a gravação tivesse falhado.
- Sincronização de membros mantém participações diretas já cadastradas. Equipes
  e filas usam a mesma trava de configuração por organização antes de adquirir
  os locks de pais e filhos, em ordem consistente.
- Histórico tem paginação, repetição segura e detalhes de antes/depois. Os sete
  dias alterados de uma escala não são descartados da consulta.

## Distribuição

- A fila tem revisão própria. Edições do agregado e de participantes/regras
  exigem essa revisão; DELETE usa `If-Match`. Contadores de atendimento e rotação
  não invalidam um editor de configuração aberto.
- Criação usa a mesma reserva transacional por organização, usuário e intenção.
  A reserva armazena hashes e identidade do resultado, sem payload de cadastro.
- O limite do rascunho suporta os 500 participantes permitidos no formulário,
  incluindo nomes de exibição usados na recuperação, sem aceitar armazenamento
  ilimitado. Um teste específico cobre o conjunto máximo.
- Regras antigas mantêm identidade, tipo, match, prioridade e estado quando não
  são alteradas. Regras desconhecidas são exibidas para revisão, sem conversão
  automática para outro critério. Acrescentar um critério não muda indevidamente
  a prioridade dos anteriores.
- Participação inativa não é reativada por uma alteração de peso/nome. A tela
  distingue quantidade configurada de quantidade efetivamente ativa.
- API valida referências, escopo dos participantes e capacidade mínima da
  redistribuição também nas alterações individuais. Pesos e prazos têm limites
  inteiros; prioridades respeitam o `integer` do PostgreSQL.
- Escolha concorrente de um mesmo critério por duas filas é serializada por
  organização. Mudanças de pesos são atômicas, sem várias gravações paralelas
  que poderiam deixar o conjunto parcialmente atualizado.
- As origens usam os aliases já existentes do sistema. `campaign_contains`
  compara texto literal; `%` e `_` deixam de atuar como curingas de SQL.
- Falha de consulta não vira lista vazia bem-sucedida. Escopo de liderança inclui
  vínculos de pipeline e usa roster atualizado em vez de unir permissões antigas.
- Rascunhos são separados por organização, usuário e fila. Recuperação mantém a
  revisão original e exige uma ação explícita; ela não incorpora silenciosamente
  a revisão mais nova. Sair da sessão remove os rascunhos do usuário anterior.
- Histórico permite carregar mais registros; o filtro descreve os eventos já
  carregados e apresenta falhas de paginação com possibilidade de tentar de novo.

## Redistribuição de leads já pendentes

- O worker confere a fila antes de avisar/transferir e mantém o lock da
  configuração até concluir a transação. Fila removida, inativa ou com
  redistribuição desativada encerra os trabalhos de inatividade pertinentes.
- Novos prazos/limites alcançam trabalhos pendentes em lotes de até 50 por ciclo.
  O vencimento usa `enrolled_at` ou `last_redistributed_at`; mudar a duração não
  reinicia o relógio de inatividade.
- Valores inteiros antigos representados como strings são aceitos. Políticas
  equivalentes não apagam avisos nem regravam o mesmo trabalho a cada ciclo.
- O contador é relido depois dos locks. Uma reentrada concorrente que resetou o
  trabalho não é encerrada com base no contador antigo.
- Avisos e transferências também releem o trabalho completo após os locks,
  incluindo fila atual, contador, prazos e metadados da distribuição inicial.
  Se uma organização estiver sendo editada, o lote inteiro é desfeito e
  retentado silenciosamente no ciclo seguinte, antes de gravar efeitos duráveis.
- Retry de distribuição inicial tem outro ciclo de vida e não é cancelado por
  desativar a redistribuição por inatividade. Trabalhos terminais não são reabertos.

## Tags e pipelines da gestão

- Cancelar uma edição de tag e abrir criação limpa a identidade anterior.
  PATCH exige o `updated_at` observado; DELETE exige esse timestamp em `If-Match`.
- Nome repetido, revisão alterada e tag referenciada têm conflitos específicos.
  Uma exclusão bloqueada não remove os vínculos com leads antes de verificar as
  dependências. O servidor repete a verificação dentro da transação.
- A consulta de uso informa contagens de filas/regras, automações e versões em
  execução, etapas, Meta e webhooks; não revela nomes de configurações fora do
  escopo de `tag_manage`.
- Configurações desativadas ainda contam, pois podem voltar a operar. Filas
  removidas não bloqueiam uma tag para sempre. Restauração/troca de tenant
  revalida referências do pai e de filhos, inclusive dados legados híbridos.
- Go e banco usam o mesmo extrator semântico de referências. Uma ocorrência de
  UUID em texto livre não basta para classificar uma dependência de tag.
- Alterações de tags invalidam consumidores por organização, incluindo filtros,
  cartões, automações, distribuição e dashboard. Eventos `tag.created/updated/deleted`
  são publicados depois do sucesso da operação para outros clientes.
- Gestão → Pipelines mostra erros e carregamento de suas consultas. Ações seguem
  `pipeline_manage` e o escopo de liderança; desvinculação tem feedback de falha.
  Textos descrevem o vínculo sem prometer uma restrição de acesso que ele sozinho
  não garante.

## Aparência e fronteiras preservadas

Tipografia, tamanhos mínimos e cores semânticas foram centralizados no escopo
`.crm-management-surface` e `[data-management-editor]`, incluindo diálogos
portados. Os botões principais usam cores próprias para tema claro/escuro.
A conferência numérica de contraste dos estados normal/hover resultou em
aproximadamente 7,38/5,70 no claro e 8,37/5,76 no escuro. Isso não substitui
inspeção visual com navegador nem uma auditoria completa de acessibilidade.

Não foram alteradas primitivas de `components/ui`, o board operacional da
pipeline, os filtros globais ou o desenho do dashboard. Os caches desses módulos
são consumidores necessários dos ajustes de tags/equipes. A observação de logout
fica em um componente próprio sob o AuthProvider; o fluxo de autenticação não
foi reescrito.

Mantidos: condições da fila usam OR; destino e pipeline corrente conservam a
semântica existente; a seleção da redistribuição conserva o algoritmo atual.
Textos da gestão foram ajustados para explicar essas regras, sem mudar a operação
comercial como efeito incidental da auditoria.

## Migrações preparadas, ainda não aplicadas

Criadas pelo Supabase CLI, sem editar migrações históricas:

1. `20261012212827_lock_management_writes_to_backend_gateway.sql`: bloqueia
   escrita direta de tags/filas/regras/membros por anon/authenticated, preserva
   leitura autorizada e a proibição de hard delete de filas para service_role.
2. `20261012212832_management_revisions_and_create_intents.sql`: revisões,
   triggers de configuração e ledger privado de criação.
3. `20261012212837_management_tag_reference_integrity.sql`: dependências e
   guardas de referências/deleção. Consulta de uso VOLATILE para checagem após
   lock em READ COMMITTED; extractor IMMUTABLE.
4. `20261012212843_management_distribution_matching_and_pending_settings.sql`:
   normalização de origens e comparação literal de campanhas.

Limites de lock/statement estão explícitos. `supabase/README.md` continua bloqueando
`db push` automático. Os quatro hashes desta auditoria no source lock foram
atualizados e conferidos, preservando as entradas de outras tarefas. O gate
global ainda aponta duas migrações de notificações push fora deste escopo,
detalhadas abaixo.
A coluna de revisão de tags usa default `now()` na criação; a atualização usa
`clock_timestamp()` monotônico. Isso evita o default volátil no `ADD COLUMN`,
que exigiria atualizar as linhas existentes. [PostgreSQL 17: alteração de tabelas](https://www.postgresql.org/docs/17/ddl-alter.html).

Uma publicação futura exige autorização separada e validação isolada: migrações
primeiro, API compatível em todas as réplicas, depois Web. Clientes anteriores
não enviam as novas precondições e precisarão atualizar a sessão/interface.
Não liberar o frontend novo contra API/banco antigos.

## Verificação e pendências de homologação

Resultados da rodada final:

| Verificação | Resultado e limite |
| --- | --- |
| Go: `leads`, `roundrobin`, `teams`, `httpserver`, `managementintent`, `distribution` e `app` | Sete pacotes passaram: 656 testes de topo e 743 subtestes aprovados; 53 pulados, zero falhas. Inclui regressões existentes, não apenas testes novos. Saída JSON arquivada na cópia de segurança como `go-final-tests.jsonl`. |
| Contratos/helpers Node da gestão, OpenAPI e atualização de acesso | 44/44 passaram. Contratos de precondições e exemplos inválidos incluídos. |
| Helpers de criação/disponibilidade de equipes | 23/23 passaram. |
| Schemas de domínio | 63/63 passaram, incluindo revisões obrigatórias e horários malformados. |
| Fronteiras de API e previews SSR reais | 24/24 passaram: 21 fronteiras e três previews. |
| Capacidade e recuperação do rascunho de distribuição | 11/11 passaram. Inclui fila válida de 500 participantes, nomes longos e recuperação da intenção congelada. Alguns testes repetem a suite de helpers acima; não somar os grupos como testes únicos. |
| ESLint focado nos arquivos de gestão | Passou com `--max-warnings 0`; helper e teste de capacidade também passaram após o último ajuste. |
| TypeScript global | Quatro erros fora da gestão: três em `ContactsScreen.tsx` (export, retorno do hook e props) e um em `ConversationsScreen.tsx` (export ausente). Nenhum diagnóstico da gestão na última execução. |
| ESLint global | Oito erros fora do escopo, em importação de contatos, manutenção/mídia de empreendimentos e teste de calendário. Avisos próprios encontrados na rodada global foram corrigidos e conferidos no lint focado. Não declarar o gate global aprovado. |
| Source lock de migrações | Os quatro arquivos desta auditoria têm hashes correspondentes. Gate global bloqueado por conteúdo alterado de `20261012223833_push_device_user_owned_delivery_scope.sql` e pela nova `20261012232821_push_device_endpoint_owner_exclusivity.sql`, ainda sem entrada no lock. Não foram aceitos hashes de outra tarefa para liberar o gate. |
| Manifesto de Edge Functions | Bloqueado por diferença de hash de `evolution-go-webhook`, fora deste ajuste. Manifesto não foi regenerado para aceitar código de outra tarefa. |
| Inventário CRM/Home | Suite global com 3/4 aprovados; comparação do índice salvo falhou com fontes alteradas em paralelo. Investigação independente encontrou oito arquivos com conteúdo alterado durante a comparação, entre automações, cadências e pipeline. Não foi modificado o gate para ignorar a diferença. |
| Banco, navegador e build de produção | Não executados/aprovados. Ver pendências abaixo. |

A investigação do inventário comparou 1.650 arquivos. O `sourceDigest` salvo
era `11346511b061c5ceebdd5cdfe4a640b9fba612ebb86973e46c16aa6d0e32f14f`;
antes da comparação era
`8561d08faeb80dd6e29c700cc719ce032b5e34647d11f92e841ad132bd4857b1`.
A geração nova e a leitura final concordaram em
`1fa863a084ce88c90821b99e4e1e5aa66c1236783f12ae072fd90753d40f2402`.
O gerador terminou com código zero. Isso comprova mudança de entradas e
desatualização do artefato; não demonstra falha de determinismo com entradas
iguais nem regressão de runtime da gestão.

Testes com executores sintéticos validam controle de fluxo e contratos, sem
comprovar concorrência do PostgreSQL. Integrações Go opt-in foram puladas por
ausência de ambiente; esses pulos não são aprovação de banco.

Não verificados neste trabalho: aplicação das migrações em PostgreSQL isolado,
duas sessões concorrentes de referências/deleção de tags, isolamento nos níveis
REPEATABLE READ/SERIALIZABLE, RLS/grants efetivamente implantados, E2E autenticado,
inspeção visual de todas as telas e carga de 5–6 mil usuários.

O PostgreSQL de teste em loopback `127.0.0.1:57922` apresentou timeout. Nenhuma
base compartilhada foi alterada, clonada ou usada para fixtures. Não houve restart
do Docker nem de serviços de outras tarefas. O contrato SQL de duas organizações
foi preparado em `supabase/tests/management_gateway_revisions_and_tags.sql`, mas
não foi executado.

## Reversão local e futura

Existe uma cópia de segurança anterior aos ajustes em
`D:\Vimob\_safety\management-audit-fixes-20261012-182255`, com manifesto de hashes.
Ela serve para comparação e recuperação seletiva; restaurar diretórios inteiros
apagaria alterações simultâneas de outros trabalhos.

Antes de qualquer rollout, testar o pacote completo em fixture descartável e
revisar duas organizações e fluxos negativos de permissões. Se houver reversão
após publicação, coordenar API e Web antes de remover precondições. Não apagar
ledger/revisões enquanto alguma réplica os utiliza; manter as proteções de
escrita e tombstones. Alterar schema/grants exige uma migração de reversão
revisada separadamente, não reescrever os quatro arquivos após aplicação.
