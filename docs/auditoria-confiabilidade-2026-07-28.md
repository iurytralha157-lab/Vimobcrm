# Auditoria de confiabilidade do Vimob CRM

Data-base: 28/07/2026  
Consolidação final: 29/07/2026  
Escopo: revisão e validação local, sem publicação, commit, push ou alteração de produção.

## Leitura executiva

Os bloqueadores estruturais encontrados no início da revisão foram corrigidos e validados no ambiente local isolado:

- realtime passou de fan-out apenas em memória para log durável no banco, cursor monotônico, replay e propagação entre réplicas;
- distribuição passou a usar uma fronteira canônica, idempotente e auditável, com ticket por fila e seleção IWRR;
- a migração de distribuição para bancos já existentes valida o contrato completo e falha fechada se encontrar divergência;
- organizações sem acesso financeiro passaram a ser bloqueadas também no backend, com carência e allowlist explícitas;
- entradas públicas passaram a ter limites de abuso baseados em identidade derivada no servidor;
- webhooks Meta e Evolution passaram a rejeitar requisições inválidas antes de persistência, consulta privilegiada ou leitura irrestrita do body.

A rodada final aprovou banco, Go, Deno, TypeScript, lint, build, E2E, carga padrão e QA visual isolado. Isso sustenta um patamar local de confiabilidade muito mais alto e remove os antigos P1 acima.

Ainda não é tecnicamente correto declarar certificação para 5–6 mil usuários simultâneos. O ensaio de carga executado valida o cenário padrão definido para esta rodada, não equivale a um teste de capacidade, soak ou caos nesse volume. O rollout de produção também continua dependendo de catálogo de versão, aplicação controlada das migrations, observabilidade e plano de reversão.

## Classificação usada

| Estado | Interpretação |
| --- | --- |
| Preservar | Área estável; não houve justificativa para alteração funcional ampla. |
| Fortalecido | Risco comprovado foi corrigido e recebeu evidência automatizada ou operacional local. |
| Acompanhar | Fluxo utilizável, mas ainda exige matriz adicional, observabilidade ou validação em produção controlada. |
| Residual | Não invalida a rodada, porém precisa permanecer explícito no plano de manutenção. |

## Estado consolidado dos eixos críticos

### Realtime durável e multi-réplica

Estado: **Fortalecido**.

- Eventos de invalidação são gravados em `private.realtime_events`, sem acesso direto do browser.
- Cada evento recebe cursor durável e monotônico.
- Reconexões usam `Last-Event-ID` para replay dentro da janela de retenção.
- Cursor expirado, à frente do log ou replay acima do limite produz reset explícito, sem fingir convergência.
- Réplicas drenam o mesmo log durável; o fan-out não depende mais de o cliente estar conectado ao processo que publicou o evento.
- O teste de integração com duas réplicas comprovou recebimento cruzado, replay e isolamento de evento direcionado por organização/usuário.
- No host isolado de QA, a conexão Supabase Realtime respondeu `101` e não gerou nova telemetria de erro.

O hub local continua existindo para administrar conexões do processo, mas deixou de ser a fonte única dos eventos. Retenção, crescimento da tabela e atraso entre publicação e drenagem passam a ser itens de observabilidade e manutenção, não bloqueadores de arquitetura.

### Distribuição canônica por ticket/IWRR

Estado: **Fortalecido**.

- Entradas cobertas convergem para a fronteira canônica de distribuição.
- A operação possui ledger durável de idempotência por organização e chave do evento.
- Cada fila usa ticket monotônico não transacional; o ticket é mapeado para o membro elegível pelo algoritmo `queue_ticket_iwrr_v1`.
- Peso, escala/disponibilidade, fila, equipe, pipeline e etapa são resolvidos na mesma fronteira auditável.
- A seleção não depende de incrementar uma posição compartilhada sob lock longo da fila.
- Resultado, ticket, versão do algoritmo e evento de distribuição ficam registrados para auditoria e recuperação.
- Contratos cobrem entrada manual e canais integrados, além de concorrência e repetição idempotente.

A migration forward para bancos que já receberam versões anteriores não trata presença parcial como sucesso. Ela adquire lock de migração, verifica função, constraints, ledger e marcadores do algoritmo e interrompe a aplicação quando o estado diverge. Portanto, o upgrade é **fail-closed**.

### Billing, Asaas e gate do backend

Estado: **Fortalecido**.

- O estado de cobrança faz parte do contexto autenticado da organização.
- O pipeline de rotas autenticadas está envolvido pelo gate de billing do backend.
- Organização bloqueada recebe `402`, inclusive em chamada direta à API.
- A carência é calculada de forma explícita e as rotas necessárias para regularização usam allowlist exata, sem liberação por prefixo amplo.
- Webhook Asaas valida segredo dedicado, limita payload e aplica idempotência/ordenação.
- A reconciliação consulta o provedor e converge cobrança, assinatura e organização.
- Cartão não é tratado como pago antes da confirmação real do provedor.

Isso fecha o antigo descompasso em que a UI podia bloquear enquanto a API continuava acessível. Casos operacionais de produção do Asaas continuam listados como risco residual.

### Ingress público e webhooks

Estado: **Fortalecido**.

- Contato e tracking do site usam orçamento de requisição antes do trabalho oneroso, com identidade derivada no servidor; trocar `session_id` não reinicia sozinho o limite.
- Signup público possui limite por origem/identidade e por e-mail normalizado antes da criação administrativa.
- O estado dos limites críticos fica em estrutura privada no banco e pode ser compartilhado entre réplicas.
- Retentativas idempotentes conhecidas são resolvidas antes de consumir novo orçamento quando aplicável.
- Meta valida a presença do secret e a assinatura HMAC do body bruto antes de parsear ou persistir. Assinatura inválida não cria evento; o body está limitado a 1 MiB.
- Evolution Go autentica e limita a entrada antes da leitura integral do body.
- A Edge Function `evolution-go-webhook` rejeita POST sem header de credencial reconhecido, mede bytes reais do stream e limita o body a 32 MiB antes do JSON e de qualquer consulta com service role.

Essas proteções reduzem abuso e custo acidental, mas não substituem CAPTCHA, verificação de propriedade de e-mail, WAF nem uma política distribuída para toda rota pública.

## Resultado por área

| Área | Estado | Resultado consolidado |
| --- | --- | --- |
| Dashboard geral | Preservar | Referência visual mantida. Filtros e KPIs passaram nos gates funcionais da carga final. |
| Dashboard de campanhas | Acompanhar | Permissões preservadas; ainda merece regressão visual dedicada de combinações de filtro e vazio. |
| Dashboard do site | Fortalecido | Página e endpoints privados exigem módulo `site` e permissão. |
| Pipeline | Fortalecido | Cache convergente, movimento otimista serializado por lead, rollback seguro e reconciliação realtime durável. Navegação aquecida de 1,4 s e API do board de 53 ms no QA isolado. |
| Contatos e detalhe do lead | Fortalecido | Lista e detalhe convergem após edição; etapa respeita o pipeline real e a auditoria preserva transições a partir de `null`. |
| Feedback, histórico e tarefas | Acompanhar | Contratos principais passaram; ampliar a matriz E2E por tipo de feedback continua recomendado. |
| Atenção a leads | Fortalecido | Ciclos internos usam privilégio controlado, `search_path` fixo e não são executáveis diretamente pelo browser. |
| Equipes, filas e escala | Fortalecido | Cache por organização, permissões explícitas e distribuição canônica com disponibilidade/escala. |
| Redistribuição | Fortalecido | Compartilha a fronteira idempotente e auditável; gates de lifecycle/distribuição passaram na carga final. |
| WhatsApp e conversas | Fortalecido | Dados crus e mídia privada permanecem atrás da API autorizada; ingress Evolution foi endurecido. |
| Realtime | Fortalecido | Log DB, cursor/replay, reset explícito e teste com duas réplicas substituem o antigo modelo somente em memória. |
| Notificações/PWA | Fortalecido | Organização ativa, responsividade e temas corrigidos; QA encontrou `blackBorders=0` em claro/escuro. |
| Automações | Fortalecido | Histórico concentra alertas/reprocessamento, polling usa tenant ativo e lifecycle passou na carga final. |
| Gamificação | Fortalecido | Privacidade por papel/usuário e contratos do worker foram reforçados; reconciliação operacional permanece residual. |
| Agenda/Google | Acompanhar | Gate corrigido e sincronização preservada; remover URL fixa de cron continua recomendado. |
| Imóveis | Fortalecido | Navegação, páginas, configurações e API exigem módulo explícito. |
| Seletor de imóvel | Fortalecido | Busca, filtros e layout foram alinhados ao catálogo; paginação/virtualização server-side permanece evolução. |
| Site/configuração do site | Fortalecido | Gate de módulo na UI/API e ingress público limitado antes do trabalho oneroso. |
| Integrações Vista/Imoview | Fortalecido | Removidas do catálogo visível; retirada física continua gradual e auditável. |
| Meta Lead Ads | Fortalecido | Ambiguidade de página falha fechada; HMAC antecede qualquer persistência. |
| Grupo OLX | Acompanhar | Mantido sob gate do módulo de portais; sem reescrita funcional. |
| Assinatura e faturamento | Fortalecido | Webhook, reconciliação, histórico e gate backend convergem com o estado do Asaas. |
| Conta, usuários e convites | Fortalecido | Responsividade e tokens de tema ajustados; permissões e fluxo de convite preservados. |
| Financeiro | Acompanhar | Gates preservados; lançamentos, contratos e conciliação financeira pedem suíte própria. |
| Suporte e seleção de organização | Preservar | Troca de tenant e caches tocados usam organização ativa. |
| Superadmin | Acompanhar | Fluxos principais preservados; as telas administrativas ainda pedem matriz visual própria. |

## Decisão por página operacional

| Rota | Decisão | Observação |
| --- | --- | --- |
| `/dashboard` | Preservar | Referência visual; sem reescrita. |
| `/dashboard/campaigns` | Acompanhar | Falta matriz visual dedicada dos filtros. |
| `/dashboard/site` | Fortalecido | Gate também nos endpoints privados. |
| `/crm/contacts` | Fortalecido | Lista, detalhe, pipeline e auditoria convergem. |
| `/crm/conversas` | Fortalecido | Dados privados atrás da API e ingress endurecido. |
| `/crm/management` | Fortalecido | Filas/equipes segregadas e distribuição canônica. |
| `/crm/pipelines` | Fortalecido | Movimento otimista, cache, rollback e realtime ajustados. |
| `/agenda` | Acompanhar | Gate correto; cron fixo permanece residual. |
| `/automations` | Fortalecido | Lifecycle funcional e histórico consolidado. |
| `/properties` | Fortalecido | Módulo explícito, catálogo e seletor revisados. |
| `/properties/new` | Fortalecido | Gate fechado; formulário preservado. |
| `/properties/[id]/edit` | Fortalecido | Gate fechado; edição preservada. |
| `/properties/locations` | Fortalecido | Invisível e inacessível sem módulo. |
| `/properties/condominiums` | Fortalecido | Invisível e inacessível sem módulo. |
| `/properties/owners` | Fortalecido | Invisível e inacessível sem módulo. |
| `/properties/rentals` | Fortalecido | Invisível e inacessível sem módulo. |
| `/financeiro` | Acompanhar | Gate preservado; sem reescrita ampla. |
| `/financeiro/contas` | Acompanhar | Exige suíte de lançamentos e conciliação. |
| `/financeiro/contratos` | Acompanhar | Ações de contrato merecem E2E próprio. |
| `/financeiro/contratos/[id]` | Acompanhar | Parcelas, documentos, comissões e histórico não foram reescritos. |
| `/financeiro/comissoes` | Acompanhar | Falta matriz completa por papel e estado. |
| `/financeiro/corretor` | Acompanhar | Falta prova visual/funcional dedicada. |
| `/financeiro/dre` | Acompanhar | Relatório/configuração preservados. |
| `/financeiro/relatorios` | Acompanhar | Falta regressão dedicada de filtros/exportação. |
| `/gamificacao` | Fortalecido | Privacidade, RLS, worker e abas reforçados. |
| `/notifications` | Fortalecido | Organização ativa, temas e mobile validados. |
| `/settings` | Fortalecido | Conta, notificações, integrações, imóveis e assinatura receberam ajustes focais. |
| `/settings/site` | Fortalecido | Gate de módulo/permissão; editor preservado. |
| `/settings/users/[id]` | Preservar | Limites de admin, líder e usuário preservados. |
| `/suporte` | Preservar | Nenhum risco que justificasse reescrita. |
| `/select-organization` | Preservar | Troca de tenant e isolamento de cache preservados. |

O inventário complementar das páginas administrativas, autenticação, públicas e redirecionamentos permanece em `docs/levantamento-funcional-vimob-crm.md`.

## Papéis e módulos

| Papel | Contrato esperado |
| --- | --- |
| Administrador/owner | Áreas contratadas e operações concedidas à organização; módulo desligado permanece invisível e bloqueado na API. |
| Líder | Leads próprios e da equipe, gestão da própria equipe e páginas explicitamente permitidas; liderança não concede automaticamente exportação ou distribuição. |
| Usuário comum | Operação comercial concedida, sem páginas administrativas, exportação ou módulos não contratados. |
| Superadmin dentro de tenant | Continua sujeito aos módulos explícitos ao navegar como organização; não mascara plano incorreto. |

## Padrão visual e QA de navegador

A dashboard principal permaneceu como referência de densidade, tipografia, abas, botões e superfícies. Nas áreas tocadas:

- foram usados tokens de superfície, borda e texto para claro/escuro;
- ações deixam de depender de larguras rígidas no mobile;
- o host isolado não apresentou overflow do documento em desktop claro, desktop escuro ou mobile;
- notificações registraram `blackBorders=0` em claro e escuro;
- pipeline aquecido navegou em 1,4 s e o endpoint do board respondeu em 53 ms;
- a conexão Realtime retornou `101` e não surgiu nova telemetria durante a passagem.

Essa evidência cobre o navegador mais recente usado no QA isolado. Não representa a matriz completa de Safari/iOS, Chrome/Android, Firefox, PWA instalado, WebPush e redes degradadas.

## Evidências finais

### Banco e contratos

- pgTAP: **51 arquivos e 739 testes aprovados**.
- Migrations locais incluem realtime durável, distribuição canônica, upgrade forward fail-closed, billing, ingress público e manutenção associada.
- O estado validado é local/isolado; nenhuma migration foi aplicada em produção nesta auditoria.

### Código e suítes

- Validação TypeScript/domínio: **151/151**.
- Go: suíte completa aprovada.
- `go vet`: aprovado.
- Deno: **23/23 testes** aprovados e checks concluídos.
- `tsc --noEmit`: aprovado.
- ESLint: aprovado.
- Build de produção do Next.js: aprovado.
- E2E final: **21/21 em 3,9 minutos**.

### Carga

O smoke anterior validou o harness, autenticação e endpoints antes da rodada completa. Ele foi um ensaio preparatório e não é usado como certificação de capacidade.

Execução padrão final: `load-20260729T022059023Z-979adf4e`.

| Métrica | Resultado |
| --- | ---: |
| Requisições totais | 2.286 |
| Erros | 0 |
| Respostas 5xx | 0 |
| Deadlocks | 0 |
| Latência geral p95 | 300,23 ms |
| Latência geral p99 | 1.027,94 ms |
| Requisições do site | 525 |
| Site p95 | 370,77 ms |
| Site p99 | 1.049,61 ms |

Os gates funcionais de lifecycle, distribuição, automação e dashboard passaram nessa execução.

O resultado prova o cenário padrão executado, não 5–6 mil usuários simultâneos. Não houve nesta rodada soak prolongado, chaos test, saturação até o limite, ensaio multi-região nem medição completa de CPU, memória, pool, WAL e backlog sob essa concorrência-alvo.

### Nota sobre os servidores locais existentes

As instâncias já abertas nas portas `3000` e `8081` usam API antiga contra banco sem as migrations finais. Elas foram mantidas/restauradas e não foram usadas como evidência de saída. A validação final ocorreu em host isolado com o estado atual.

## Riscos residuais e plano de manutenção

### 1. Catálogo de produção e manutenção

- Gerar e revisar, por release, o catálogo de rotas, permissões, módulos, webhooks, RPCs e jobs.
- Registrar exatamente quais migrations foram aplicadas por ambiente e validar o forward upgrade antes de liberar tráfego.
- Definir rollback operacional, responsáveis, janela e sinais de abortar rollout.
- Monitorar retenção/limpeza de realtime, sequências de ticket órfãs, ledger de idempotência e tabelas de ingress.
- Remover Vista/Imoview fisicamente apenas após confirmar que nenhum tenant depende dos jobs históricos.

### 2. CAPTCHA e verificação de e-mail

Rate limit reduz abuso, mas não comprova humanidade nem propriedade do e-mail. Signup público e formulários de maior risco devem receber Turnstile/CAPTCHA, confirmação real de e-mail e processo de limpeza de cadastros abandonados.

### 3. Limites distribuídos

Os ingress críticos tocados compartilham estado pelo banco, mas ainda é necessário:

- inventariar todas as rotas públicas e webhooks;
- padronizar chave, janela, resposta `429` e `Retry-After`;
- confiar em `X-Forwarded-For` apenas atrás de proxies conhecidos;
- decidir a camada de WAF/Redis/gateway para produção multi-região;
- alertar sobre rejeições, cardinalidade e indisponibilidade do limitador.

### 4. Automações e outbox

- Medir backlog, idade da fila, retries, falhas permanentes e tempo até execução.
- Fechar com idempotência/outbox a janela entre efeito externo e marcação de sucesso.
- Tratar WhatsApp, push e outros efeitos externos como entrega ao menos uma vez.
- Exercitar recuperação após queda do worker e múltiplas réplicas em soak.

### 5. Gamificação

- Adicionar reconciliação periódica entre eventos, pontos, missões e ranking.
- Expor métricas de divergência, reprocessamento e atraso.
- Ampliar E2E para mudanças de papel, período, reset e eventos concorrentes.

### 6. Asaas

- Monitorar fila de webhook, eventos fora de ordem, reconciliação atrasada e falha do provedor.
- Ensaiar chargeback, estorno, cancelamento, troca de plano, cobrança duplicada e retorno após inadimplência.
- Definir rotação de segredo, runbook de incidente e reconciliação manual auditável.

### 7. Matriz de navegadores

Expandir o QA para Safari/iOS, Chrome/Android, Firefox, PWA instalado, permissões negadas, WebPush, teclado móvel, zoom, rede lenta/offline e viewports intermediários.

### 8. Capacidade 5–6 mil

Executar em staging representativo:

- ramp-up, carga sustentada e soak;
- pelo menos duas réplicas reais da API e workers;
- mistura de leitura, escrita, SSE/replay, distribuição, automação, WhatsApp e site;
- falha/reinício de réplica, atraso do banco e indisponibilidade parcial;
- métricas de p95/p99, erro, deadlock, pool, CPU, memória, WAL, locks e backlog.

Até essa rodada existir, **não há certificação de 5–6 mil usuários simultâneos**.

## Critério de saída recomendado

Uma área só muda de “Acompanhar” para “Preservar” quando:

1. passa para administrador, líder e usuário comum;
2. passa em claro/escuro, desktop/mobile e navegadores-alvo;
3. mantém isolamento entre pelo menos duas organizações;
4. trata carregamento, vazio, erro, retry e sucesso;
5. persiste e reconcilia corretamente após reload e reconexão;
6. possui métrica e alerta para sua falha operacional mais importante;
7. possui runbook e rollback proporcionais ao impacto.

## Conclusão

A revisão deixou de ter como bloqueadores o realtime somente em memória, a distribuição fragmentada e o bloqueio financeiro apenas na interface. Esses contratos agora estão implementados e validados localmente, junto do hardening de ingress.

O próximo passo responsável não é uma nova reescrita ampla. É promover o mesmo estado por release controlada, observar os riscos residuais e executar a certificação de capacidade específica para 5–6 mil usuários sem confundi-la com a carga padrão já aprovada.
