# Vimob CRM — auditoria de prontidão para publicação

Data do snapshot: 16/08/2026

Ambiente observado: código local + produção em modo somente leitura

Status: **NO-GO**

## Resumo executivo

O CRM avançou de forma material: a API Go passa em todos os pacotes, a validação principal passa em 362/362 testes e os seis contratos adicionais de pós-validação passam. Também foram corrigidos bloqueadores em Equipes, distribuição, notificações, automações, Agenda, Google Calendar, onboarding/autenticação, financeiro, imóveis, Marketing, Configurações, WhatsApp e nas superfícies públicas. O build integrado posterior às mudanças de identidade de release foi aprovado em 79/79 páginas, com BUILD_ID local `bMRGgl8uEwOSGnoDdg0rY`. Como o worktree continua sujo, esse identificador comprova a compilação do snapshot local, mas ainda não constitui um artefato reproduzível de release.

Ainda não existe base honesta para afirmar 90% de confiança para publicação. Os bloqueadores são objetivos:

- os P0 financeiros code-only conhecidos foram fechados, mas as funções corrigidas ainda não estão versionadas/implantadas; bundle Deno, migration/RPC, decisão do livro canônico e smoke no sandbox Asaas também não foram executados;
- o schema/RPC necessário para parte das correções ainda não foi ensaiado nem aplicado;
- o artefato publicado não corresponde ao código local auditado;
- versões legadas de Edge Functions privilegiadas foram fechadas no worktree, mas o manifesto disponível é histórico e o bundle remoto atual não foi verificado nem substituído;
- o executor fail-closed de cleanup das personas foi preparado e testado, mas ainda não foi executado com uma sessão superadmin e um secret server-only autorizados;
- não houve passagem autenticada completa, em dois viewports, de todas as rotas, ações e overlays;
- o worktree possui centenas de alterações sem um SHA reproduzível de release.

Nenhuma migration, SQL mutante, deploy, criação de organização de QA ou alteração de dados de produção foi executada nesta auditoria.

## Execução local segura

O frontend local foi iniciado em `http://localhost:3000` atrás de dois proxies fail-closed. O proxy da API permite somente `GET`, `HEAD` e `OPTIONS`; o proxy Supabase permite esses métodos e `POST /auth/v1/token` apenas para login/refresh. WebSocket e qualquer outra mutação são bloqueados antes de alcançar o ambiente remoto. Nenhuma API Go local foi executada: a inicialização normal possui workers que fazem escrita, portanto subi-la contra produção não seria segura.

O Next local recebeu URLs dos proxies e teve secrets server-only, conexão de banco e credenciais de provedores removidos do processo. Health checks GET passaram. Na repetição final, o servidor e os proxies ficaram prontos, mas o controlador de navegador falhou antes da navegação ao inicializar seus próprios artefatos (`failed to write kernel assets`, erro de caminho no host). A política da ferramenta foi respeitada e a falha não foi contornada com Playwright avulso. Nenhuma página chegou a abrir e todos os processos temporários foram encerrados, com as portas 3000, 8081 e 8082 confirmadas como livres. Consequentemente, o isolamento está comprovado, mas a cobertura visual em navegador deste snapshot continua não comprovada.

O isolamento foi transformado em harness reproduzível em `scripts/qa/read-only-proxy.mjs`, com 10/10 testes para métodos, caminhos Auth, loopback, redirects, WebSocket, limite de corpo e redação de logs. Os listeners temporários foram encerrados após o diagnóstico. Para abrir rotas protegidas ainda é necessária autenticação consciente no navegador local. Não foram copiados cookies, tokens ou credenciais da produção, e nenhuma organização de QA foi criada.

Como segunda camada, `scripts/qa/release-readonly-smoke.mjs` executa somente GET, usa redirects manuais, não envia credenciais nem lê corpos sensíveis e exige aceite explícito para hosts remotos. O modo `--summary` produziu no ambiente publicado 78 aprovações em 88 checks, com 10 desvios detalhados. O script também aceita um SHA completo esperado e, após um deploy, comprova que o Web e a API respondem com o mesmo commit.

## Evidências verdes

| Gate | Resultado |
|---|---|
| `npm run build` | Aprovado após a identidade de release; 79/79 páginas; BUILD_ID `bMRGgl8uEwOSGnoDdg0rY` |
| `npm run validation:test` | 362/362 aprovados; pós-validação 6/6 |
| `npx tsc --noEmit` | Aprovado |
| `npm run lint` | Aprovado com 0 erros e 295 avisos legados |
| `go test ./apps/api/... -count=1` | Aprovado em todos os pacotes |
| Identidade/configuração de release | Web/API usam o mesmo `github.sha`; 15/15 contratos de identidade/smoke/config/OpenAPI aprovados; Go health/vet aprovados |
| Hardening Edge focado | 31/31 contratos distintos aprovados: 11 tombstones públicos, 6 do `message-sender`, 7 do guard de IA e 7 de autenticação/idempotência do proxy Evolution Go |
| Inventário canônico | `--write` e `--check` aprovados; digest `1556ecf709af1887b28de3e808f708d6644d0a169940fda9b1cdac0b14c7bc80` |
| Auditor visual Home | `--write` e `--check` aprovados; 0 candidatos em 0 arquivos, inclusive nas superfícies protegidas; digest `8a648e6c44624b0dc928a6f26f66554993967a7cb1fa9961c955b724475b9bac` |
| Harnesses QA | 30/30 contratos aprovados: 10 do proxy read-only, 13 do cleanup de personas e 7 do smoke de release |
| API publicada `/healthz` e `/readyz` | HTTP 200 |
| API publicada `/v1/public/onboarding/plans` | HTTP 200 |
| Playwright autenticado | 48 testes em 15 specs descobertos; 48 marcados `skipped`, 0 executados/aprovados/falhos atribuíveis |
| Smoke GET-only publicado | 78/88 aprovados: Web público 13/18, fronteira protegida 61/63, API pública 4/7 |

Os 295 avisos do lint estão concentrados principalmente em tipos `any` e símbolos não utilizados das Edge Functions. Eles não bloqueiam o build, mas permanecem como dívida técnica mensurável.

## Correções concluídas no código local

### Equipes e horários

- criadas páginas dedicadas `/crm/management/teams/new` e `/crm/management/teams/[id]/edit`;
- editor responsivo no padrão visual da Página Inicial;
- criação/edição com semana explícita de sete dias;
- padrão seguro de segunda a sexta, 08:00–18:00, com sábado e domingo inativos;
- bloqueio de payload vazio, semana incompleta e todos os dias inativos;
- loading, erro, retry e aviso explícito para escala legada ausente;
- GET escopado de uma equipe e persistência atômica de membros/escala;
- proteção contra salvar dados ainda não carregados;
- correção do envio de `organizationId` em logo e disponibilidade.

### Distribuição

- membros diretos agora preservam o contexto da equipe;
- usuário em mais de uma equipe exige escolha explícita;
- vínculo usuário/equipe é validado no tenant;
- quatro seletores Go passaram a respeitar escala de membros diretos e vínculos ativos;
- webhook WhatsApp deixou o round-robin legado e passou ao distribuidor canônico com idempotência.

Limite atual: a RPC canônica do banco ainda possui semânticas antigas para membro direto, ausência de escala, todos os dias inativos e overnight. A correção completa depende de migration coordenada e não foi aplicada.

### Notificações

- novas notificações de `cadence_task` foram bloqueadas antes da marcação de envio;
- o scheduler deixou de gerar notificações de tarefas de cadência;
- backlog histórico de cadência é filtrado antes do claim e possui guard de runtime;
- workers sensíveis passaram a exigir POST e autenticação privada;
- criação direta de notificação valida que o destinatário pertence ativamente à organização;
- criado kill switch `NOTIFICATION_DISPATCH_WORKER_ENABLED`, desligado por padrão e nas stacks.

Importante: a imagem antiga da API inicia o dispatcher incondicionalmente após sete segundos. Ela não é um rollback seguro enquanto houver backlog. O bloqueio só estará comprovado após publicação coordenada da nova imagem e observação do ambiente.

### Edge Functions privilegiadas

- `message-sender` passou a aceitar somente POST autenticado, autentica antes de acessar o outbox e usa claim condicional `pending → processing`; apenas o worker que recebe a linha pode chamar o provedor;
- transições finais também exigem `processing`, a resposta contém somente contadores agregados e um resultado ambíguo após o provedor permanece em `processing`, evitando retry automático duplicado;
- o ID determinístico de entrega agora atravessa o `evolution-go-proxy` somente em chamada interna autenticada, no formato canônico `^[0-9A-F]{32}$`; chamadas de usuário não conseguem injetá-lo;
- `ai-agent-responder` exige autenticação privada antes do corpo, secrets e cliente admin, e a primeira leitura vincula conversa, organização e sessão antes de IA, agenda, outbox ou WhatsApp;
- `public-site-data`, `instagram-oauth` e `import-wordpress-properties`, sem consumidores ativos no Web/Go atual, viraram tombstones `410` sem banco, rede, secrets, redirect ou projeção de dados.

Essas correções são locais. O `production-manifest.json` é um snapshot histórico e não comprova o estado live; como os slugs legados não pertencem ao conjunto implantável atual, o rollout precisa despublicar versões antigas ou publicar primeiro os tombstones, com verificação posterior. Nenhum deploy foi feito nesta auditoria.

### Imóveis

- ficha ganhou fallback degradado e tenant-safe quando as tabelas normalizadas ainda não existem;
- quick view e histórico foram padronizados e ganharam tratamento de erro;
- status comercial não é mais sobrescrito pelo switch ativo/inativo;
- compartilhamento trata cancelamento nativo corretamente;
- card e menus foram ajustados, sem elementos interativos aninhados;
- formulário, filtros e listagem foram aproximados do padrão Home;
- exclusão recebeu fluxo de confirmação no trabalho local.

### Superfícies operacionais e padrão Home

- Gestão, Marketing e Configurações receberam trilhos de abas alinhados à esquerda, responsivos e acessíveis, com recolhimento para ícones quando o espaço útil diminui;
- Contatos, Pipelines, Agenda, Automações, Conversas, dashboards, Financeiro, Central de Ajuda e Admin ganharam estados explícitos de loading, stale, erro, retry e vazio nas árvores ativas revisadas;
- diálogos destrutivos revisados aguardam a mutação, impedem cliques duplicados e só fecham no sucesso;
- o detalhe ativo do lead e o EventSheet perderam 1.983 linhas de implementações legadas/ocultas, mantendo somente as árvores realmente montadas;
- o site público, login, convite, onboarding e checkout foram alinhados aos tokens, raios 8/6/4 e pesos 300/400;
- mídias do WhatsApp validam esquema, tamanho, nome e download; uploads de conversa e chat flutuante compartilham limite de 5 MiB antes da conversão para base64;
- imagens legadas de imóveis e do site público possuem validação e fallback, evitando que URL malformada derrube o componente de imagem;
- o vídeo do login usa loop nativo, replay defensivo ao terminar e retomada ao voltar para a aba.

Essas correções possuem cobertura estática e unitária proporcional ao risco, mas não substituem a passagem visual autenticada em navegador com as três personas.

### Automações e infraestrutura

- executor de automações agora aguarda o checkpoint durável, em vez de responder 202 antes do processamento;
- testes Admin foram alinhados ao contrato seguro que preserva o principal Auth;
- build deixou de compilar a árvore Deno copiada em `deploy/`;
- workflow deixou de ter fallback silencioso para o Supabase antigo;
- stacks exigem `SUPABASE_SECRET_KEY` apenas no servidor web;
- o workflow injeta o mesmo `${{ github.sha }}` nas imagens Web e API;
- o Web expõe `x-vimob-release-sha` em respostas normais e redirects, e a API expõe o SHA normalizado em `/healthz`, `/readyz` e no header equivalente;
- valores ausentes ou fora do formato hexadecimal completo degradam para `unversioned`, e health/readiness usam `Cache-Control: no-store`.

### Agenda e Google Calendar

- os dois formulários de compromisso bloqueiam horário vazio ou inválido antes de construir timestamps;
- o pull do Google Calendar deixou de duplicar `/calendar/v3` na URL e o retry 401 reutiliza a URL canônica;
- o teste de regressão cobre pull, push, criação de watch e parada do canal;
- o rollout exige redeploy coordenado de `google-calendar-oauth`, `google-calendar-sync` e `google-calendar-webhook`, seguido de smoke em staging.

### Onboarding e autenticação

- todos os proxies públicos limitam o corpo antes do parse, respondem 413 e impedem cache sensível;
- recuperação de cadastro rejeita URLs duplicadas, conflitantes ou grandes demais;
- login só confirma e-mail após evidência real de sessão, não por query string;
- checkout e catálogo de planos possuem timeout, validação de resposta e política explícita de cache;
- o vídeo do login possui loop nativo, replay defensivo e retomada ao voltar para a aba;
- o painel crítico de cadastro foi ajustado aos tokens, raios e pesos do padrão Home;
- a tela de convite foi alinhada ao padrão Home e os links jurídicos deixaram de alternar o consentimento ao abrir;
- quatro cenários públicos E2E foram adicionados sem usar sessão nem banco.

Essas correções existem apenas no worktree. Na aplicação publicada, `/confirmar-email` e os três endpoints novos de onboarding ainda retornam 404.

### Financeiro

- o gate de resiliência passou de 11 aprovados/18 falhos/3 TODO para 32/32 aprovados;
- o sweep completo passou em 165/165 contratos financeiros, incluindo 28 cenários dependentes de Deno validados por shim local sem rede;
- capability, leases, restauração PIX, atualização de cartão, polling, read paths, webhook, recorrência e organização inativa passaram nos contratos;
- a seleção da chave Supabase Admin agora é determinística e fail-closed durante rotação;
- ativação de contrato passou a exigir `draft`, lock e transação, evitando repetição concorrente;
- regeneração não apaga comissões ou lançamentos pagos/aprovados e preserva histórico por cancelamento;
- `skipCommissions` passou a ser respeitado sem apagar histórico anterior;
- criação e edição de lançamentos, contratos, corretores e regras ganharam validação autoritativa no servidor;
- totais excluem comissões canceladas e parcelas preservam centavos exatos e datas civis;
- paginação no servidor foi adicionada sem truncar consumidores que ainda precisam da coleção integral;
- documentos financeiros ganharam lock, escopo tenant, verificação de linhas afetadas e compensação segura entre Storage e Postgres;
- resposta de contrato/comissão inclui a identidade esperada pelo contrato Zod, inclusive com normalização legada;
- ranking por corretor respeita `financial_manage` ou limita a própria identidade; DRE valida grupo no tenant;
- contratos ativos não podem mais ser editados ou excluídos pela UI/API;
- o gerador recorrente legado virou tombstone autenticado e o gerador canônico autentica antes de obter cliente privilegiado;
- nenhum desses resultados substitui bundle Deno, migration/RPC e teste contra banco clonado + sandbox Asaas.

A revisão adversarial posterior encontrou `financial-engine` com service role, lookup de lead por UUID sem tenant e efeitos não transacionais, além de concorrência check-then-insert no gerador recorrente canônico. Localmente, o engine virou tombstone privado sem escrita e a recorrência falha fechada até existir uma operação atômica. Financeiro permanece em NO-GO até essas alterações entrarem no artefato implantado e a recorrência for reativada sobre migration/RPC comprovadamente atômica. Também permanece uma decisão de produto/schema: hoje coexistem o trigger de contrato, a geração Go e a comissão do lead ganho; é necessário definir um único livro canônico antes do rollout.

## Smoke somente leitura na aplicação publicada

O smoke atual foi executado por HTTP, exclusivamente com GET, sem cookies, credenciais, redirect automático ou leitura de corpo sensível. Ele não é um teste visual nem autenticado.

| Grupo | Aprovado | Total | Divergências |
|---|---:|---:|---:|
| Web público | 13 | 18 | 5 |
| Fronteira anônima das rotas protegidas | 61 | 63 | 2 |
| API pública | 4 | 7 | 3 |
| **Total** | **78** | **88** | **10** |

Divergências reproduzidas:

- `/confirmar-email` e `/exclusao-de-dados` retornam 404;
- `/help` e `/help/invalid-audit-slug` redirecionam para `/login`, embora sejam públicas na árvore local;
- `/onboarding` ainda renderiza com 200, enquanto o contrato local o redireciona para `/cadastro`;
- as rotas protegidas `/inicio` e `/marketing` retornam 404 em vez de alcançar a fronteira de autenticação;
- os probes GET de existência de `/v1/public/onboarding/validate-step`, `/v1/public/onboarding/signup/recovery` e `/v1/public/onboarding/email-confirmation/resend` retornam 404, em vez de 405 com `Allow: POST`.

As outras 61 rotas protegidas redirecionaram anonimamente para `/login`, comprovando a fronteira básica de acesso publicada. Isso não comprova renderização, autorização por persona ou funcionamento interno dessas páginas. O resultado confirma uma divergência de artefato: rotas e endpoints presentes no worktree ainda não estão no Web/API publicados.

## Suíte autenticada preparada para staging

Foram adicionados cenários de release para:

- criar, editar, configurar horários e remover uma equipe temporária;
- validar ADM, Líder e Usuário nas páginas dedicadas de Equipes;
- abrir carteira, quick view, histórico e ficha 360° de imóvel;
- validar a Central de Notificações nos três perfis e no mobile;
- concluir o fluxo real de cadência sem gerar notificação de cadência;
- detectar overflow e a transição cliente Pipeline → Agenda.

O harness recusa hosts conhecidos de produção, exige confirmação dupla para staging remoto e mantém workers externos desligados. A descoberta local encontrou 48 testes em 15 arquivos, mas nenhum corpo de teste foi executado: os 48 aparecem como `skipped`. Portanto, a cobertura funcional e visual runtime permanece em zero e esses cenários não contribuem para a meta de 90% até existir staging isolado e cleanup comprovado.

O accounting E2E ganhou IDs canônicos e um piloto com quatro verificações `routeViewport` de desktop (`/login`, `/cadastro`, `/confirmar-email` e `/reset-password`). Manifests continuam sendo apenas planejamento: sem resultado Playwright aprovado e atestação de CI vinculada ao report, commit e digest do inventário, o numerador oficial permanece zero. O piloto não foi executado contra servidor nesta auditoria.

Foi criado ainda `scripts/qa/qa-persona-cleanup.mjs`, um executor sem SQL que exige ledger `VIMOB-QA-...`, exatamente três identidades, confirmação exata do nome e UUID do tenant, aceite explícito da exclusão permanente, sessão superadmin e secret server-only. Ele usa o DELETE oficial da organização, exige `deleted_users: 0` e ausência de warnings, prova a remoção do tenant, apaga somente os três UUIDs de Auth do ledger e comprova a ausência final no Auth e no CRM. Cleanup, proxy read-only e smoke GET-only somam 30/30 testes em memória. Nenhuma execução externa mutante foi feita.

## Gate visual do padrão Home

O auditor `scripts/audits/inventory-home-design-debt.mjs` transforma a padronização visual em um relatório reproduzível. No snapshot atual, todas as regras monitoradas ficaram em zero: sombras fortes/médias, raios acima de 8px, tipografia pesada, cores e superfícies fixas, movimento agressivo, blur de painel e caixa alta/tracking. O resultado é 0 candidatos em 0 arquivos, inclusive 0 nas superfícies protegidas alcançáveis.

O baseline histórico era de 1.234 candidatos, sendo 622 em superfícies protegidas. A redução estática desse conjunto explícito de regras chegou a 100%. Isso comprova a limpeza do padrão detectável pelo auditor, não a correção visual ou funcional em navegador. Breakpoints, recortes, conteúdo real, contraste contextual e todos os estados interativos ainda precisam da matriz autenticada desktop/mobile antes de contribuir para a meta de 90% de prontidão.

## Bloqueadores de publicação

### P0 — Financeiro operacional

Os P0 code-only conhecidos foram fechados: `financial-engine` é um tombstone privado e a recorrência falha fechada sem primitiva atômica. O bloco continua NO-GO operacional porque esses arquivos ainda não pertencem a um release versionado/implantado, Deno não está instalado localmente, as RPCs necessárias existem em migration ainda não ensaiada/aplicada e não houve bundle das Edge Functions nem smoke contra clone do banco e sandbox Asaas. Não publicar funções financeiras isoladamente nem antes da migration compatível.

### P0 — Artefato não reproduzível

O snapshot atual possui 1.149 entradas no worktree: 553 arquivos rastreados alterados e 596 não rastreados, nenhum staged. O diff rastreado soma 95.356 inserções e 31.979 remoções. As correções não estão no HEAD `822349ff832a24b974a0d6c0c33f99ac576105af`, branch `codex/sql-reconciliation`. Um build verde desse diretório não identifica sozinho o conteúdo exato a publicar.

### P0 — Schema/RPC sem ensaio

Há 59 entradas de migrations locais: uma rastreada alterada e 58 não rastreadas. Distribuição, imóveis avançados e financeiro dependem de contratos ainda não ensaiados num clone. Como SQL está proibido nesta etapa, produção deve permanecer intacta.

### P0 — Onboarding publicado incompleto

Os endpoints abaixo retornam 404 no ambiente publicado:

- `/v1/public/onboarding/validate-step`;
- `/v1/public/onboarding/signup/recovery`;
- `/v1/public/onboarding/email-confirmation/resend`.

A página `/confirmar-email` também retorna 404 na imagem Web publicada. A árvore local possui todos esses contratos; o bloqueio é de artefato/deploy coordenado, não uma razão para alterar o banco.

### P0 — Notificações de cadência ainda dependem do artefato novo

Os guards e o kill switch estão no worktree, não no SHA publicado. A API anterior inicia o dispatcher incondicionalmente e não é rollback seguro enquanto existir backlog. O arquivo `production-manifest.json` é apenas um snapshot histórico capturado em 09/08/2026; naquela captura listava 81 funções ativas, 56 com `verify_jwt=false` e 25 com `verify_jwt=true`. Sem consulta live atual, ele não comprova quais funções ou versões continuam implantadas nem se entregas de cadência estão efetivamente interrompidas. O rollout deve manter o dispatcher desligado, publicar API/Edge compatíveis e provar por observação que cadência não gera entrega in-app, push, WhatsApp ou e-mail antes de liberar qualquer worker.

### P0 — Versões privilegiadas de Edge ainda fora do artefato

A auditoria estática do snapshot histórico encontrou versões antigas de workers com service role, efeitos externos ou projeção pública ampla. O código local fechou os caminhos de maior risco em `message-sender`, `ai-agent-responder`, `public-site-data`, `instagram-oauth` e `import-wordpress-properties`, mas não houve bundle Deno, consulta live, deploy ou despublicação. Até um release coordenado comprovar os slugs e hashes efetivos, não se pode assumir que as versões antigas deixaram de aceitar chamadas ou efeitos.

### P0 — Personas ainda não comprovadas em ambiente reversível

A remoção oficial de uma organização preserva usuários no Supabase Auth. O executor server-only de cleanup agora existe e passou em 13/13 testes em memória, preservando esse contrato e apagando depois somente os três UUIDs registrados. A sessão disponível, porém, não comprova autoridade superadmin nem fornece o secret em memória, e o executor ainda não foi validado contra os endpoints reais. Criar as personas antes desses gates continuaria podendo deixar dados órfãos.

### P1 — Cobertura funcional/visual incompleta

- falta executar todas as jornadas como ADM, Líder e Usuário;
- o numerador runtime atual é zero: 48 testes foram descobertos, todos `skipped`, e nenhuma das 19 rotas `/admin` possui prova positiva com uma persona superadmin;
- falta testar cada CTA, menu, popup, formulário e link em desktop e mobile;
- Google Calendar, Meta, WhatsApp, push, e-mail e Asaas ainda precisam de smoke com contas sandbox;
- falta baseline responsiva de todas as rotas protegidas;
- falta teste de carga para 5–6 mil usuários simultâneos;
- a navegação cliente Agenda precisa de diagnóstico e regressão automatizada.

## Critério verificável para declarar pelo menos 90%

O inventário reproduzível em `scripts/audits/inventory-crm-surfaces.mjs` definiu o denominador atual:

- 63 rotas protegidas × 3 personas = 189 verificações de autorização;
- 77 telas renderizáveis × 2 viewports = 154 verificações visuais;
- 7 contratos de aliases/redirect;
- 190 overlays, 46 formulários, 1.167 CTAs internos e 249 controles complementares alcançáveis por rota;
- 16 rotas dinâmicas que exigem fixtures válidas e inválidas;
- integrações e workers como cenários separados, com idempotência e ausência de duplicidade.

O inventário schema 3 agora atribui IDs determinísticos `tipo:<20 hex>` a 84 rotas/aliases e a todas as 1.652 implementações alcançáveis de overlays, formulários, CTAs e controles. São 1.736 IDs globais, sem colisões ou caminhos absolutos, com digest `d70d8932aac65155d36e9c39e656a281d312114dc0c45efa2989c95d5ae2bc6c`. Isso permite que cada futuro resultado E2E aponte exatamente o item coberto, sem usar número de cliques como proxy.

Para liberar:

1. 100% dos cenários P0 aprovados;
2. zero finding de severidade alta aberto;
3. zero TODO/skip em gates críticos;
4. pelo menos 90% de toda a matriz planejada aprovada;
5. build Web e API do mesmo SHA, com digests registrados;
6. smoke das três personas no ambiente isolado e depois no canary.

No snapshot atual, o numerador de execução autenticada/visual continua zero. Specs descobertas, testes estáticos e contratos unitários melhoram a preparação, mas não entram no percentual runtime até que os corpos sejam executados com fixtures e cleanup verificáveis.

O piloto de accounting possui quatro claims planejadas e zero executadas oficialmente. Ele só poderá promover uma claim após prova Playwright válida e atestação pós-execução; JSON avulso, discovery, skip, retry, resultado sem attachments ou digest divergente permanecem fora do numerador.

## Ordem segura de continuação

1. Congelar as alterações em commits pequenos e revisáveis.
2. Produzir Web e API do mesmo SHA e registrar os digests.
3. Preparar staging/clone isolado com o banco novo e secrets próprios.
4. Provar o cleanup completo das três personas antes de criá-las.
5. Ensaiar migrations, pgTAP/security, schema diff, backup e restore no clone.
6. Executar o bundle/runtime Deno, ensaiar a migration/RPC financeira no clone e concluir o smoke no sandbox Asaas.
7. Executar a matriz ADM/Líder/Usuário em desktop e mobile.
8. Fazer smoke das integrações em contas sandbox.
9. Em janela autorizada: snapshot, migrations, API canary com workers desligados, Edge Functions compatíveis, Web do mesmo SHA e smoke final.
10. Habilitar workers um a um; notificações por último e cadências permanecem bloqueadas.

## Rollback

- antes de escritas no schema novo, blue/green pode devolver o tráfego apenas para uma imagem anterior comprovadamente compatível;
- depois de migrations ou primeiras escritas, não voltar para a API antiga, pois ela possui dispatcher sem kill switch e contratos incompatíveis;
- após o ponto de não retorno, usar forward-fix com workers/crons desligados;
- Edge Functions devem avançar ou recuar como conjunto compatível com schema e manifest.

## Conclusão

O código local está mais estável e os gates centrais de tipo, validação, Go, auditoria, lint e build integrado passaram. A publicação ainda seria arriscada e não auditável porque o snapshot não está congelado num SHA limpo. A confiança é inferior a 90% porque faltam o ambiente reversível de personas, o ensaio do schema e do runtime financeiro e a matriz autenticada completa. O próximo marco correto é um release candidate reproduzível em staging isolado, não uma publicação direta em produção.
