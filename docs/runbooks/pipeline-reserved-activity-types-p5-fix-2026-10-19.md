# Pipeline: tipos reservados de atividades

19/10/2026. Item 09/P5 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Evidências locais:
`D:/Vimob/outputs/pipeline-activity-types-p5-fix-20261019-b099`.

## Defeito e fronteira de escrita

O POST genérico `/v1/activities` aceitava um tipo arbitrário e metadata livre.
Um cliente autorizado a operar o lead podia gravar `status_change`,
`lead_created` ou `property_selected` sem executar essa operação de domínio.
Metadata também podia imitar origem de automação, feedback, anexos, imóveis
ou identidade de eventos. Isso alterava apresentação/correlação do histórico;
não foi comprovada mudança real de status nem acesso a outro tenant por essa via.

A rota genérica agora tem um contrato fechado para atividades manuais:

| Tipo | Metadata opcional permitida |
|---|---|
| `note` | Nenhuma chave. |
| `call_initiated` | `phone`, `channel=phone`. |
| `call` | `phone`, `channel=call/phone`, resultado de ligação e `notes`. |
| `email` | `channel=email`, resultado de e-mail e `notes`. |
| `message` | `channel=message/whatsapp`, resultado de mensagem e `notes`. |

Resultados de ligação: answered, not_answered, invalid_number, busy, scheduled.
E-mail: replied, not_replied, bounced. Mensagem: replied, seen_no_reply,
not_seen, no_whatsapp, scheduled. Telefone tem limite de 80 pontos Unicode;
texto e observações, 2.000. NUL e Unicode inválido são recusados. Os valores
enumerados são sensíveis a maiúsculas/minúsculas. Tipo desconhecido também é
recusado; novo evento interno não fica liberado por omissão de uma denylist.

Metadata ausente/null vira objeto vazio. Chaves extras, valores não textuais,
arrays e objetos aninhados são rejeitados. O cliente não informa `origin`,
`source`, `kind`, `is_automation`, IDs de correlação ou estado anterior/novo.
O servidor atribui `origin=manual_activity` após validar a entrada. O mapa
normalizado é uma cópia, e a validação também ocorre no kernel transacional
antes de abrir a transação, cobrindo chamadas que contornem o DTO HTTP.

Autorização, organização/ator obtidos da sessão, trava do lead, bolsão,
hidratação e redação da resposta permanecem. Entradas inválidas não abrem a
transação nem produzem atividade. A UI valida antes do evento otimista e
congela o payload por operação antes do primeiro await; alteração posterior
do objeto do chamador não substitui o comando que já foi capturado.

O caller produtivo genérico inventariado é a ligação rápida
`call_initiated`, com `phone` e `channel=phone`, no LeadDetailDialog. Pipeline,
mobile e Contatos compartilham esse caminho. Resultados de contato, feedback,
cadências, status/etapa, tags, imóveis, documentos, Agenda, Meta e WhatsApp
continuam usando seus produtores próprios, sem passar pelo novo validador.
Os schemas de leitura continuam aceitando os tipos/metadados históricos.

## Escrita direta no banco

O ledger local também concedia mutações em `public.activities` aos papéis de
navegador. A validação Go, sozinha, não cobriria essa entrada pela Data API.
A migration append-only criada pelo CLI revoga INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES e TRIGGER de PUBLIC/anon/authenticated, incluindo
INSERT/UPDATE/REFERENCES por coluna. Não muda linhas, SELECT, RLS ou funções.

Preflight e postflight conferem o catálogo; privilégios herdados que ainda
deixem escrita causam rollback. A comparação de privilégios preserva a leitura
dos papéis de navegador e os privilégios efetivos de service_role. Se estes
dependem exclusivamente de PUBLIC, a migration aborta para revisão específica
do alvo, sem conceder acesso novo automaticamente. Produtores Go privilegiados,
Edge Functions service_role e funções internas SECURITY DEFINER permanecem
separados da rota genérica. Não foi introduzido trigger baseado no JWT, que
poderia bloquear um produtor legítimo SECURITY DEFINER. A inspeção local do
call graph/ACL das funções encontrou seis escritores SQL diretos e oito nomes
alcançáveis conservadores, sem gateway genérico executável pelo navegador
confirmado nas fontes. Isso não substitui inspeção do catálogo instalado.

Referências de contrato: [grants e RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
e [REVOKE no PostgreSQL](https://www.postgresql.org/docs/current/sql-revoke.html).
Nenhuma conclusão sobre grants instalados em produção foi obtida neste lote.

## Leitura defensiva e preservação

Objetos JSON válidos como `{"toString":null}` em campos esperados como texto
derrubavam o builder ou renderer de histórico. Os leitores escalares agora
ignoram objetos/arrays em vez de executar coerção de objeto. Números finitos,
strings e os booleanos já suportados conservam seus contratos. Mapas de
rótulos usam somente propriedades próprias, inclusive para chaves de payload
como `constructor` e `__proto__`. O status da compatibilidade de reentrada
legada é conferido como string antes da correlação. Essa defesa não apaga
linhas antigas nem autentica retroativamente sua origem. A apresentação de
respostas booleanas de formulário permanece pendência própria (item 13).

As mudanças do componente legado se limitam às conversões de metadata e
fallbacks de apresentação. Nenhuma alteração de fonte, layout, compositor,
envio, permissões, paginação ou ações de cadência foi incluída. Motivo de perda,
feedback legítimo, imóvel, documento e transições armazenadas continuam sendo
apresentados pelos mesmos caminhos, com testes de regressão.

## Entrega futura e limites

A migration ficou somente no código local. Para fechar a entrada direta no
alvo, ela precisa passar pelo processo de aplicação aprovado do projeto;
`supabase db push` continua bloqueado pelo README do ledger. Também é preciso
atualizar todas as réplicas da API. Frontend sozinho ou API isolada não fecham
as duas vias. A ordem segura é revisar o catálogo do alvo, aplicar a ACL,
atualizar a API e disponibilizar o frontend; os produtores antigos Go usam
conexão privilegiada e não dependem da escrita direta do navegador.

Clientes externos que gravavam tipos desconhecidos ou metadata livre passam
a receber erro de entrada inválida; operações de domínio devem usar seus
endpoints dedicados. Não há fallback silencioso para inserção direta.

Sem deploy, commit, push, migration aplicada, acesso a banco real, alteração
de configuração remota ou serviço iniciado. Testes de Go com pgx fake e SQL
em PGlite efêmero não são integração com Supabase/PostgREST reais, Safari
físico nem carga de 300 usuários. O fechamento é deste item; os próximos
continuam sendo validação financeira, Agenda no histórico, scroll, respostas
booleanas de formulário e código morto, em lotes próprios.

Para reverter código, selecionar os hunks contra o backup `before/`, sem
restaurar arquivos inteiros nem resetar alterações de outras abas. Reversão
de ACL no alvo exige migration futura revisada com catálogo capturado;
restaurar grants amplos de navegador reabriria a falha.

## Verificação final

- Contrato frontend/API/hook: **118/118 PASS**, sem skips. Inclui 33 regressões
  anteriores. O corpus compartilhado possui 276 vetores (36 aceitos, 240
  recusados) dentro desses testes e dos testes Go; não somar como testes E2E.
  O snapshot anterior falha nos controles de reserva e de criação otimista.
- Leitura defensiva: **243/243 PASS**, sem skips, mais **308/308 regressões**
  existentes de histórico/feedback/projeção. A matriz independente examinou
  37 tipos, 106 posições e 15 formas de valor com builder/renderer reais,
  sem exceções; são chamadas de funções, não centenas de milhares de testes
  de navegador. Formulários aninhados: **40/40 PASS**, sem skips. A rodada
  conjunta final dos quatro grupos frontend/histórico aprovou **709/709**;
  não somar novamente as rodadas parciais nem as 286.190 chamadas do probe.
- Go: **821 testes principais + 3.033 subtestes PASS**, zero falhas, em leads,
  app, schedule, cadences e authorization. **175 entradas SKIP** (89 principais
  e 86 subtestes); opt-ins de banco foram desabilitados apenas no subprocesso.
  Não somar pais e filhos como testes independentes. O RED por overlay usa o
  kernel real anterior, sem restaurar o checkout.
- SQL: **30/30 PASS** no PGlite efêmero, executando a migration literal,
  incluindo tabela/coluna/PUBLIC/herança, ownership, rollback, SELECT/RLS,
  service_role e produtor SECURITY DEFINER sintético.
- Typecheck, lint e audit:check aprovados. Lint global tem zero erros e sete
  avisos anteriores; as fontes novas/alteradas têm conferência focada limpa.
  Inventários regenerados em ordem e comparados sem mudança semântica.
- Source-lock de migrations: **256 fontes verificadas**. Foram acrescentadas
  somente esta migration e a de recibos do item 07, que já estava no checkout
  e ainda não constava no lock. Seus bytes foram comparados com o recibo SQL
  anterior; as 254 fontes previamente registradas permanecem idênticas. Não
  houve alteração/aplicação de qualquer migration anterior. Manifesto Edge:
  41 live, 26 tombstones e 15 retired, sem alteração de fontes.

Os recibos frontend, backend, SQL, probe independente e preservação em b099
registram hashes das fontes executadas. O fechamento é **9/14 itens corrigidos
no código local**, com cinco pendentes. A proteção no ambiente depende da
aplicação futura da migration ACL e da API compatível.

Comparação final: **4.148 das 4.167 fontes monitoradas anteriores idênticas**,
19 existentes alteradas dentro da allowlist e 13 novas. As 2.606 entradas locais
anteriores do Git permanecem; o total final é 2.621 (13 arquivos novos e dois
arquivos antes limpos agora modificados). No LeadUnifiedThread, 15 das 23
funções de primeiro nível estão literalmente iguais, incluindo o componente
principal; mudaram apenas oito helpers de apresentação. Formulários mudaram
somente formatWebhookQuestion e a dedup de reentrada somente o guard de status.
As ações/popup/drafts/cadência/feedback anteriores têm hashes iguais ao baseline.
