# Retestes por perfil — registro técnico parcial de 15/11/2026

Este registro descreve seis correções sobre a base `fbd08e89`, publicadas na
main em `30d47ce4`, e a correção adicional identificada pelo gate dessa publicação.
Não encerra a auditoria: a UI de produção ainda executava essa base durante as
observações, e o reteste visual das correções permanece pendente de publicação.
A matriz Taskmaster de **668 casos por perfil** e as evidências saneadas ficam
nos artefatos externos da rodada `vetter-role-retests-20261115`, fora do Git.
Não se deve converter teste local aprovado em caso visual de produção aprovado.

## Achados e limites de comprovação

### 1. R2-AUTH-BOOTSTRAP — inicialização de sessão obsoleta

- **Causa:** o retorno inicial de `getSession` podia substituir uma visita de
  autenticação mais nova. A revisão encontrou também `TOKEN_REFRESHED` com
  outro usuário/SID sem assumir a carga do contexto, deixando o bootstrap
  incompleto até o timeout de segurança.
- **Mudança:** `contexts/AuthContext.tsx` aposenta o bootstrap inicial quando
  outro handler assume, reutiliza a inicialização de `SIGNED_IN` para sessão
  substituta e cerca timer, organizações e conclusão pela geração existente.
  Renovação na mesma SID preserva o trabalho corrente; sessão nula usa a limpeza
  já existente. Nenhum novo store ou mecanismo de sessão foi introduzido.
- **RED/GREEN:** callbacks reais executados com SDK/API sintéticos reproduziram
  a substituição e o loading incompleto; os **26 casos** finais passaram,
  incluindo retorno inicial antigo/nulo/erro, mesma SID e conclusão antiga.
  Isso comprova o comportamento local; a corrida não foi observada visualmente
  em produção.

### 2. R2-API-IDENTITY — identidade padrão no transporte autenticado

- **Causa:** chamadas sem intenção explícita podiam repetir um comando após
  `401` com outro ator/SID ou aceitar a conclusão de uma sessão antiga.
- **Mudança:** `lib/api/vimob-client.ts` copia as opções e captura a identidade
  conhecida antes do primeiro `await`; no bootstrap, fixa a primeira sessão
  resolvida. Verifica a identidade antes da tentativa/repetição e após a
  resposta. Intenções explícitas nulas continuam rejeitadas; chamadas públicas
  anônimas mantêm seu contrato.
- **RED/GREEN:** Settings, validação Zod e transporte reais em harness offline
  demonstraram replay e conclusão indevidos antes do ajuste. Os **37 testes de
  transporte** passaram depois. Uma escrita já enviada pode ter sido aceita
  pelo servidor mesmo quando sua conclusão local é rejeitada: não há rollback
  remoto nem garantia de idempotência acrescentada por esta correção.

### 3. R2-TEAM-COMMAND — excluir/status capturavam identidade tarde

- **Causa:** os dois hooks capturavam UID/SID somente ao iniciar o transporte,
  depois da espera do React Query. Uma pausa sintética em `onMutate` permitiu
  reproduzir gesto de A chegando ao transporte como B.
- **Mudança:** `hooks/use-teams.ts` captura intenção e cópia do comando em
  `mutate`/`mutateAsync`, usando os guardas existentes de gestão e QueryClient.
  `lib/api/teams.ts` encaminha essa intenção em excluir/status. Callbacks
  obsoletos são retirados; uma conclusão aceita após fechar a tela ainda
  invalida o cache dono quando o acesso permanece válido.
- **RED/GREEN:** o teste contra a fonte anterior não rejeitou a troca de ator;
  **32 casos novos** com MutationObserver real passaram, cobrindo SID, tenant,
  acesso, desmontagem, A→B→A e renovação na mesma SID. A janela foi induzida
  offline; não foi reproduzida como gesto humano normal em produção.

### 4. R2-WEEKLY-A11Y — switches da escala sem identificação

- **Causa observada na UI:** habilitação dos dias sem nome acessível e controles
  `24h` indistinguíveis.
- **Mudança:** cinco `aria-label` nos callers `TeamEditorScreen.tsx` e
  `MemberAvailabilityDialog.tsx`, identificando dia, atendimento 24h e opção
  global. A primitiva compartilhada e os handlers de escala foram preservados.
- **RED/GREEN:** a fonte anterior não expunha `Ativar Domingo`; **cinco testes**
  renderizando o JSX dos callers e Switch Radix real em Chromium isolado
  passaram, com nomes únicos, clique e teclado. Rede e banco não participam.

### 5. Dashboard — evolução com um único intervalo

- **Causa comprovada:** com um só bucket, a consulta produzia `CASE ELSE 0 END`
  sem `WHEN`, causando PostgreSQL `42601`. A falha foi correlacionada ao card
  de evolução de produção e reproduzida no SQL real do repositório.
- **Mudança:** `apps/api/internal/leads/dashboard.go` acrescenta
  `WHEN true THEN 0` somente para um intervalo. Filtros, tenant, papéis, período
  e comportamento de múltiplos intervalos permanecem no caminho existente.
- **RED/GREEN:** **11 subcenários PostgreSQL** passaram sem pulos: zero/um card,
  timestamps iguais, limite temporal, múltiplos buckets, admin/líder/próprio,
  duas organizações e geração de membership obsoleta. Fixture aleatória própria,
  pool de consulta read-only e resíduo de bancos próprios igual a zero.
  O schema mínimo de teste não comprova RLS nem schema integral de produção.

### 6. R2-PROFILE-AVATAR-A11Y — botão de foto sem nome

- **Causa observada na UI:** botão apenas com ícone, sem texto/title/aria-label,
  no perfil. Upload, recorte e persistência funcionaram no fluxo observado.
- **Mudança:** um `aria-label="Alterar foto do perfil"` no botão de
  `components/features/settings/AccountTab.tsx`. Upload, permissões, estado
  disabled e recorte não foram alterados. Logo da organização fica fora deste
  ajuste até verificação específica.
- **Verificação:** causa confirmada no DOM e no caller; lint focado aprovado.
  Não foi criado harness que apenas espelhasse esse atributo trivial. O nome
  acessível corrigido ainda precisa de reteste visual após publicação.

### 7. R2-API-TERMINAL401-REGRESSION — renovação recusada mascarada como mudança de identidade

- **Reprodução:** a CI de `30d47ce4` (run `43768446406`) bloqueou os builds no
  caso original `401 without a refreshed session retires history without
  signing out another scope`. O mesmo harness local passou 17 de 18 casos;
  o histórico sintético permaneceu após a renovação sem sessão. Não foi falha
  de infraestrutura e o teste original não foi alterado.
- **Causa:** a renovação recusada limpa a identidade ativa. O novo fence final
  do transporte transformava o `401` original em `409 api_request_identity_changed`;
  os consumidores de histórico tratam a revogação terminal e o erro transitório
  de forma diferente. Essa dependência do transporte global exigiu executar o
  harness de WhatsApp, sem abrir Conversas ou enviar mensagem real.
- **Mudança mínima:** preservar o `401` somente quando a identidade ativa ficou
  nula. Com usuário ou SID substituto, o fence continua retornando `409`; respostas
  antigas bem-sucedidas também continuam cercadas. Validação antes de envio e
  replay não mudou. Nenhum logout global ou outro consumidor foi acrescentado.
- **RED/GREEN:** seis casos novos no transporte reproduzem renovação sem sessão,
  com erro e com exceção; troca para outro usuário ou SID em microtask após a
  limpeza; e `401` genuíno após renovar a mesma SID. Antes do patch, três falharam
  com o `409` incorreto. Depois, transporte **43/43** e harness original **18/18**,
  sem pulos. Os casos de troca mantêm a identidade substituta e não fazem replay.
- **Tarefa e reteste:** implementação, revisão independente e regressão local
  concluídas. Na retomada, `validation:auth-admin` passou com 266/266 na etapa
  Auth; typecheck e lint terminaram com exit0 (zero erros/oito avisos legados);
  inventários regenerados e `audit:check` passaram com quatro contratos. A CI
  completa ainda deve aprovar o commit complementar antes de publicar imagens.
  Reteste visual depende do novo release. A tentativa CI anterior
  permanece registrada como falha, sem liberar build ou enfraquecer o gate.

## Comandos e resultados registrados

Os números abaixo pertencem a execuções distintas e **não formam um total
aditivo**. Os gates globais devem ser repetidos após o último rótulo de conta e
este registro, antes da publicação.

| Comando | Resultado registrado |
| --- | --- |
| `npm run validation:auth-admin` | 41 contratos e etapa `test:auth-recovery` com 260/260; os 26 de bootstrap e 37 de transporte estão incluídos nos 260. |
| `node --test lib/api/vimob-client.test.mjs` | 37/37 na execução focada; não somar novamente à suíte Auth. |
| `npm run test:form-wizards` | 46/46, sem pulos; inclui 32 de identidade de equipe, cinco de acessibilidade e nove de previews. |
| `npm run validation:test` | Fases 814/814, localização 3/3 e `postvalidation:test` 84/84, sem pulos registrados. |
| `npm run typecheck` | Aprovado nos logs da rodada. |
| `npm run lint` | Zero erros; oito warnings legados fora dos ajustes. |
| `npm run audit:check` | Inventários conferidos e quatro contratos aprovados. |
| `go test ./apps/api/... ./packages/auth/... ./packages/db/...` | Pacotes aprovados; opt-ins de banco exigem execução separada. |
| `go test -count=1 -v ./apps/api/internal/leads -run '^TestDashboardEvolutionSingleBucketPostgres$'` | 11 subcenários aprovados no PostgreSQL descartável, sem pulos. |

O comando PostgreSQL exige o opt-in
`VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS=LOCAL_WRITE_TEST` e
`PIPELINE_ARCHIVE_TEST_DATABASE_URL` fornecida fora deste documento, apontando
para servidor descartável verificado. Não utilizar credenciais de produção.

Uma fixture de preview usava `isLegacy` removido e omitia `available`; a mesma
falha foi preservada no checkout base antes da atualização do teste. A fixture
agora verifica escala opcional disponível e estado indisponível sem controles,
sem enfraquecer asserts ou alterar produto/copy. Há também cinco falhas de
harnesses de callers não relacionados, confirmadas na base: imports do teste
de convite e fixtures de catálogo de tags/equipes desatualizadas. Não foram
suprimidas nem declaradas aprovadas; ver `api-callers-baseline-unrelated.log`
nos artefatos externos.

## CI, manutenção e reversão

O workflow `docker-images.yml` executa o gate de formulários no job que já
instala Chromium, sem duplicar instalação. O teste PostgreSQL da evolução usa
o serviço descartável já existente em `membership-access-integration`.
`build-and-push` continua dependendo desses jobs. Auth é coberto por
`validation:auth-admin`. Configuração de gate não equivale a CI Linux executada:
o resultado remoto ainda deve ser conferido.

`AuthContext.tsx` é legado com mais de 800 linhas; o diff acrescenta 39 linhas
líquidas no dono atual do fluxo. A mudança localizada evita uma extração de
autenticação durante correção de concorrência. A divisão de responsabilidades
permanece dívida técnica identificada, a tratar separadamente com os testes de
sessão preservados. Os inventários gerados devem corresponder ao código final;
este Markdown não entra nos digests de fontes TS/TSX.

Não há migration, alteração de schema, backfill ou correção de dados nesta
rodada. Para reverter, identificar o(s) commit(s) de integração, aplicar
`git revert` ao conjunto necessário e republicar as imagens anteriores pelo
procedimento normal. Manter testes/CI coerentes com o código revertido e
conferir API, web e workers. Reverter código não desfaz comandos já aceitos nem
fixtures sintéticas criadas nos testes visuais; sua eventual remoção exige
inventário e alvo próprios. O QA por perfil, cadências com espera real,
automações isoladas e demais casos da matriz continuam em execução.
