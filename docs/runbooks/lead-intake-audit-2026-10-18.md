# Auditoria da entrada de leads — 18/10/2026

## Escopo e conclusão

Auditoria das entradas Meta, WhatsApp, API pública, webhook genérico, site,
portais e cadastro/importação até a distribuição. Produção foi consultada por
GET autenticado no PostgREST e pela sessão existente do navegador. Não houve
edição de lead, replay, descarte, envio, alteração de configuração, migration
ou deploy em produção.

Foram feitas quatro correções locais pequenas, com reprodução e testes:

1. Aceitar rótulos de telefone conhecidos no campo escolhido pelo formulário Meta.
2. Buscar Graph quando `field_data` do webhook está vazio ou sem respostas.
3. Preservar o país de um PN internacional do WhatsApp nos RPCs de lead.
4. Não converter telefone JSON numérico para notação científica no webhook genérico.

**A auditoria não permite declarar a entrada universalmente resolvida.** Há
pendências reais de WhatsApp e uma divergência de configuração da fila da Clau.
Bloquear todo contato inválido exige retenção e revisão; um simples descarte
ou retry indefinido criaria outro problema.

## Alvos e limites da evidência

- Checkout principal: `D:\Vimob\workspaces\vimob-crm`, branch `main`.
- HEAD local inicial: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
- Existiam 2.450 entradas no `git status --porcelain` antes das edições.
- `/healthz` da API publicada informou `7e490c7559b37d058395804b857173fc326e76d6`.
- Portanto, **local e produção não eram a mesma revisão**. As quatro falhas
  corrigidas foram também conferidas no código do SHA publicado, via `git show`.
- Banco consultado: `supabase.vimobcrm.com.br`; o conector gerenciado não listou
  projetos e a rota PostgreSQL direta não estava acessível. Foram usadas as
  credenciais locais existentes exclusivamente para leituras, sem imprimi-las.
- Tabelas privadas, configuração montada dos workers, épocas ativas e índices
  do banco não foram inspecionados diretamente. Nenhuma migration local é
  tratada como prova de instalação em produção.
- Dados abaixo são fotografias de consultas sucessivas, não um snapshot
  transacional único. Filas podem progredir durante a auditoria.
- Telefones, e-mails, textos de mensagens e credenciais não são reproduzidos
  neste documento. Fixtures novas usam dados sintéticos.

## Incidente da Clau: causa comprovada

Identificadores para correlação interna:

| Campo | Valor |
|---|---|
| Organização | Clau Negócios e Gestão |
| Organization ID | `e286062d-91f7-4d8e-bc53-56d5423588af` |
| Lead ID | `76f8e296-3dbf-4138-8a7c-d5b57b7826bf` |
| Meta leadgen ID | `1111435118192601` |
| Form ID | `1790058505606722` |
| Page ID | `101312448668448` |
| Recebimento do webhook | 18/10/2026 16:01:00, America/Sao_Paulo |
| Criação do cadastro | 16:01:05 |
| Webhook finalizado | 16:01:08; `processed`, uma tentativa, sem erro |
| Atribuição registrada no lead | 16:01:38 |
| Situação de contato | Telefone nulo; e-mail presente |

O responsável e o feedback foram cruzados com `users`, `leads` e `activities`.
O feedback é compatível com o relato do usuário. O dado perdido foi o telefone;
não seria correto afirmar que o registro também estava sem e-mail.

O mapping real do formulário contém:

```text
phone_number    -> custom
whatsapp_number -> phone
email           -> email
nome_completo   -> name
```

O campo `whatsapp_number` veio com o rótulo `Cel.` antes do número, no formato
sintético `Cel. +55 (11) 99999-9999`. O validador estrutural rejeitava as letras.
O `phone_number` padrão estava explicitamente configurado como campo adicional,
portanto não deveria substituir silenciosamente o campo escolhido.

Os dois valores reais têm os **mesmos 13 dígitos**. Neste evento, a diferença
era de apresentação, não de número. As respostas permaneceram em
`lead_meta.raw_payload.lead_details.field_data`, no payload e nos metadados da
entrada. O cadastro terminou com `meta_details_status=complete`, sem telefone;
um webhook duplicado não corrigiria automaticamente esse cadastro.

Correção: [adaptador Meta](../../apps/api/internal/meta/phone_mapping.go) remove
somente um rótulo inicial conhecido (`Cel`, `Tel`, `Celular`, `Telefone`,
`WhatsApp`) seguido de ponto ou dois-pontos, e aplica o validador existente.
Ramal, texto livre, dois números, rótulos empilhados e parênteses inválidos
continuam rejeitados. O mapping e a resposta bruta são preservados.

O cadastro histórico não foi alterado. Sua recuperação exige ação separada e
conferida; a correção de código é prospectiva.

## Distribuição da Clau: problema separado do telefone

O evento do caso registrou `no_matching_queue`. O formulário e a integração
não tinham fila, pipeline, etapa ou responsável explícito. A fila ativa
`Distribuição` existe, mas as duas regras ativas consultadas cobrem apenas:

```text
1321435080101543
1367369625379679
```

O formulário do incidente, `1790058505606722`, não está nessa lista. Isso é uma
divergência de configuração observada; não se resolve com exceção por nome de
empresa no código. O evento histórico sem fila e a configuração atual são
evidências concordantes, mas não provam que toda configuração permaneceu igual
durante a semana.

Na janela auditada, a Clau teve **74 registros `no_matching_queue`**. São eventos,
não necessariamente 74 leads distintos. O responsável do caso foi atribuído
depois da criação, mas os registros consultados não demonstraram o mecanismo
exato dessa atribuição. Não atribuir essa ação à fila que não foi selecionada.

Ajuste operacional proposto, ainda não aplicado: confirmar que esse formulário
deve usar a fila `Distribuição` e incluí-lo na configuração auditável existente,
validando destino e elegibilidade. Não criar bypass no backend.

## Amostra recente de produção

Janela principal: **11/10/2026 00:00 BRT até 18/10/2026 19:28:51 BRT**.
Paginação completa dos cadastros e eventos Meta, sem truncamento.

| Fonte do cadastro | Cadastros | Sem telefone | Sem telefone e e-mail | Sem responsável |
|---|---:|---:|---:|---:|
| Meta | 1.550 | 16 | 14 | 1 |
| WhatsApp | 276 | 0 | 0 | 0 |
| Demais origens | 246 | 0 | 0 | 0 |
| Total | 2.072 | 16 | 14 | 1 |

A Clau teve 91 cadastros nessa janela, incluindo 68 Meta; apenas o incidente
acima estava sem telefone. Uma leitura adicional desde 04/10 encontrou 105
cadastros da Clau e o mesmo único caso sem telefone.

Os 16 casos Meta estavam com detalhes `complete`. As respostas observadas
incluem e-mail digitado no campo de WhatsApp, números concatenados, valores com
19 dígitos e formatos recusados. Não é seguro escolher outro número de campo
`custom` sem respeitar a configuração. Nem todos os 16 são o mesmo bug do rótulo.

Nenhum e-mail armazenado falhou na triagem simples de formato usada na consulta.
Isso não comprova existência da caixa, entregabilidade ou validação completa.

Eventos Meta recebidos: **2.138** — 1.512 `processed`, 52 `duplicate` e 574
`skipped`. Todos os 574 tinham o motivo de ausência de rota ativa para page/form;
não eram falhas genéricas de transporte nem foram classificados como dummy.
Formulários sem integração ativa podem ser intencionais: não ativá-los em massa.
Cadastros e eventos não são contagens equivalentes, por reentrada, duplicidade,
origens importadas e limites de tempo distintos.

Nenhum `portal_webhook_events` apareceu no período. Leads com fonte textual
`portais` não comprovam uso desse endpoint específico.

Distribuição, leitura até 19:35 BRT, excluindo `auto_redistribution` para evitar
truncamento: **1.591 logs** — 1.504 `canonical_round_robin`, 83
`no_matching_queue` (75 leads distintos) e quatro `no_available_members`.
Essa é a frequência dos resultados históricos, não o estado atual de cada lead.

## WhatsApp: fila real exige acompanhamento específico

A consulta inicial de todas as lanes atingiu 10.000 linhas e foi tratada como
**truncada**, não como total. A consulta posterior da lane `live`, entre
11/10 00:00 BRT e 18/10 19:31 BRT, trouxe todos os 6.781 registros com estado
`pending`, `retry` ou `dead` naquele instante:

| Categoria | Quantidade |
|---|---:|
| Recibos `dead`, alvo de notificação/mensagem não encontrado | 4.597 |
| Recibos em `retry`, mesmo motivo | 6 |
| Mensagens `dead`, conflito de conversa ativa por lead | 51 |
| Mensagens `dead`, responsável fora da associação ativa | 15 |
| Mensagens `dead`, `managed_whatsapp_ctwa_ad_required` | 2 |
| Mensagens/`sendmessage` pendentes | 2.046 |
| Recibos pendentes | 64 |

Os 4.597 recibos mortos **não são 4.597 leads perdidos**. O SHA publicado tenta
primeiro encontrar mensagem/outbox na organização e sessão e depois uma
notificação. Um alvo desconhecido aborta a transação do lote e pode impedir a
confirmação dos alvos conhecidos que vieram junto. Retries podem bloquear a
rota; rotas `__session__` podem interferir em outras conversas da sessão.

`dead` não bloqueia o FIFO genérico por si só. A exceção relevante é uma
dependência explícita de predecessor sem processamento/outcome.

Na leitura das 2.046 mensagens pendentes às 19:33 BRT:

- Todas tinham snapshot versão 1; 2.045 tinham predecessor explícito.
- 1.674 estavam em sessões ativas/conectadas, época 1, com predecessor.
- 307 estavam em sessões ativas/conectadas, época 0, com predecessor.
- 52 estavam em sessões ativas/desconectadas e 12 em sessões excluídas.
- Uma estava ativa/conectada, época 1, sem predecessor explícito.
- Nenhuma dessas linhas tinha tentativa futura na leitura.
- Nos 20 predecessores iniciais consultados, todos estavam pendentes e sem
  outcome. A amostra não prova o estado de todas as cadeias.

Três cadeias foram seguidas até um ancestral sem predecessor explícito: duas
chegaram a mensagens de backlog pendentes com zero tentativas; a terceira
chegou a um backlog `dead` de 10/10, com 12 tentativas e erro
`native WhatsApp processor does not support this event`. Isso demonstra uma
dependência real parada nessa cadeia. A elegibilidade completa das raízes ainda
depende de época ativa/configuração/locks privados não consultados.

A inspeção posterior somente das chaves do payload identificou
`data.Message.liveLocationMessage` nessa raiz. Esse subtipo não tem suporte no
SHA publicado. O checkout já possui suporte e fixture sintética em
`webhook_native_structured_content.go`/`webhook_native_structured_content_test.go`,
anteriores a esta tarefa. Publicar suporte não reabre automaticamente um `dead`.
Nenhuma coordenada ou imagem do payload foi reproduzida na auditoria.

O checkout já continha, antes desta tarefa, isolamento de recibos por alvo,
commit dos alvos conhecidos e RPC delimitado por organização/sessão. Esse
conjunto depende de migration local e **não está no SHA publicado**. Ele não
foi criado por esta auditoria e não deve ser publicado parcialmente. Os testes
com banco desse conjunto não foram executados nesta rodada.

Próxima ação segura: conferir época ativa e raiz bloqueadora por sessão,
validar as correções já preparadas em banco descartável, distinguir evento
descartável de mensagem recuperável e montar recuperação por IDs. Não executar
replay global, marcar desconhecido como sucesso nem retirar a proteção de
predecessor para fazer a fila andar artificialmente.

## Inventário dos caminhos e barreiras existentes

| Entrada | Caminho principal | Proteções e limites |
|---|---|---|
| Meta | `meta/repository.go`: webhook → page/form → Graph/mapping → lead/entrada → distribuição | Assinatura, rota única por tenant, evento durável, dedup por leadgen e identidade por fila; contato inválido ainda pode desaparecer do campo canônico |
| WhatsApp | `whatsapp/handler.go` → ingress/inbox/snapshot → worker/native ou Edge → RPC lead → distribuição | Autenticação, tenant/sessão, época, snapshot imutável, PN/LID, CTWA, retry limitado; `processed` não implica criação de lead |
| API pública | `publicapi/handler.go` → intake compartilhado em `webhooks/repository.go` | Chave, limite de uso, telefone obrigatório, `Idempotency-Key`, transação; validação de string de telefone ainda baseada em contagem |
| Webhook genérico | `webhooks/handler.go` → `ReceiveLead` | Token, limite, mapping, transação; idempotência opcional e contato pode faltar; rejeições não têm inbox própria |
| Site | `site/repository_public_contact.go` | Consentimento, honeypot, rate limit, telefone/mensagem, submissão idempotente; validação estrutural de telefone mais permissiva |
| Portal OLX | `portals/repository_leads.go` | Autenticação, evento/lead na mesma transação, dedup; contato inválido pode virar vazio e seguir para distribuição |
| Manual/importação | `leads/types.go`, `leads/repository.go`, recibos de importação | Validador de telefone comum, validação frontend por linha, recibos; nome sem canal é permitido e validação de e-mail diverge entre front/Go |

`private.lead_distribution_events` guarda resultado/idempotência;
`round_robin_logs` e timeline mostram histórico. O runtime privado de filas e
`lead_redistribution_jobs` representam recuperação durável. `no_matching_queue`
finaliza o evento sem criar job nesse ramo: um texto “aguardando distribuição”
na timeline não comprova que exista trabalho agendado.

## Demais achados e soluções práticas

| Prioridade | Achado confirmado no código | Encaminhamento |
|---|---|---|
| Alta | Campo Meta inválido pode gerar card sem contato e `complete` | Reter para revisão quando houve contato mapeado mas nenhum canal aproveitável; preservar nome-only legítimo |
| Alta | Genérico não mantém tentativas rejeitadas antes da transação | Introduzir recibo durável e motivo antes de ampliar bloqueios de formato; logs HTTP e produtor são necessários para auditar rejeições históricas |
| Média | Meta aceita e-mail sem validar e o último telefone válido pode vencer por ordem | Validar candidatos, respeitar mapping/ignore, colapsar equivalentes e sinalizar conflito; não eleger número alternativo arbitrariamente |
| Média | API/genérico/site têm validadores diferentes; letras/expoente textual podem passar por contagem | Unificar a regra estrutural por adaptador, preservando payload usado na idempotência; implantar junto da retenção de rejeições |
| Média | Portal pode esvaziar ambos os contatos e distribuir | Preservar recebimento e oferecer revisão antes de mudar contrato de aceitação |
| Média | Parser PN aceita domínio e conteúdo permissivos; aliases BR são amplos | Conferir domínio PN, tamanho e dígitos; reter identidade inválida sem converter LID em telefone; testar compatibilidade antes de apertar aliases |
| Média | Manual/Go pode aceitar display-name no e-mail e truncar antes da validação | Validar endereço exato e tamanho antes de truncar; alinhar contratos com fixtures |

Barreira Meta sugerida não foi implementada como um `if` isolado. Hoje
`DetailsPending` guarda o webhook original, mas não necessariamente a resposta
Graph que motivou o bloqueio. Eventos `deferred` esgotados não aparecem no banner
atual; a retenção versionada elimina eventos após 30 dias, sem distinguir revisão.

Desenho necessário: snapshot das respostas + mapping + códigos de problema,
separado por leadgen/organização; falha visível `meta_contact_unusable`; revisão
autorizada e reavaliação idempotente; política de retenção explícita. Nenhum dado
de outro tenant deve aparecer por compartilhar um webhook com vários changes.
Não prometer recuperação automática sem esse caminho operacional.

## Arquivos alterados nesta tarefa

- `apps/api/internal/meta/repository.go`: chamadas ao adaptador e `hasFieldData`.
- `apps/api/internal/meta/phone_mapping.go` e `phone_mapping_test.go`: rótulos e
  regressão do mapping real com valores sintéticos.
- `apps/api/internal/meta/repository_lead_details_test.go`: Graph quando respostas
  vazias; preservação de resposta presente/dummy.
- `apps/api/internal/webhooks/repository.go`, `phone_payload.go` e
  `phone_payload_test.go`: telefone JSON inteiro em decimal; negativos, frações
  representáveis, não finitos e valores acima de 15 dígitos recusados antes do banco.
- `apps/api/internal/whatsapp/webhook_native_processor.go`, `lead_contact_phone.go`
  e `lead_contact_phone_test.go`: preservar `+` internacional na fronteira RPC.
- `supabase/functions/evolution-go-webhook/index.ts` e
  `lead-contact-phone.node.test.mjs`: mesma correção no lookup/criação Edge.
- `supabase/functions/production-manifest.json`: somente `source_sha256` de
  `evolution-go-webhook`; versão e hash capturado de deploy preservados.

Nenhuma regra de fila, identidade por e-mail, componente de UI, dependência,
migration, segredo, configuração remota ou CI foi alterada. O novo teste Edge
foi executado explicitamente; ainda não consta na allowlist do contrato de CI.
Os arquivos legados grandes não foram refatorados incidentalmente: o nativo
recebeu a troca de um argumento e o Edge um helper de sete linhas e três usos.

## Verificação e limites

As regressões foram executadas antes dos fixes e falharam nos cenários descritos.

| Verificação | Resultado |
|---|---|
| `go test ./internal/meta ./internal/phonenumber -count=1` em `apps/api` | Passou |
| `go test ./internal/webhooks -count=1` em `apps/api` | Passou, sem skips |
| `go test ./internal/whatsapp -json -count=1 -timeout 180s` em `apps/api` | 1.298 testes/subtestes aprovados; 248 pulados; zero falhas |
| Edge: novo teste + stored-lid-identity + hardening-source + post-form-intake | 53/53 aprovados |
| Revisão independente Meta/WA/webhook e regressões focadas | Sem bloqueadores encontrados; testes passaram |
| Testes focados existentes de conteúdo estruturado/identidade WhatsApp | 26 subtestes aprovados, incluindo localização; sem skips |
| `node scripts/supabase/verify-edge-functions.mjs` | Passou após atualizar somente o hash da fonte alterada |
| `git diff --check` nos arquivos envolvidos | Passou |
| ESLint focal do Edge e do novo teste | Interrompido após vários minutos sem saída; não considerado aprovado |

Os skips Go exigem bancos/provedores/ambientes opt-in ausentes. As provas novas
exercitam parsing, HTTP simulado e argumentos reais de RPC com doubles; não são
canário externo nem gravação/distribuição real no PostgreSQL. Não houve teste
E2E de produção, carga de 5–6 mil usuários, migração ou release. Não houve
alteração de frontend Next; sua suíte não foi usada como prova desses fixes.

O decoder JSON genérico continua `float64`: inteiros de até 15 dígitos são
exatamente representáveis, mas fração inferior à precisão pode já ter sido
arredondada pelo decoder. O patch não muda o decoder compartilhado.

## Publicação e reversão

Este checkout não é uma release limpa: inclui extensas mudanças anteriores e
dependências de banco não publicadas. Não publicar o conjunto inteiro como se
fosse apenas esta correção. Preparar um SHA revisado, conferir pré-requisitos,
validar os formatos em banco descartável e então executar canários autorizados
de Meta, API e WhatsApp. Deploy e correção de registros históricos são separados.

Reverter somente os deltas desta tarefa e seus helpers/testes; nunca restaurar
integralmente os grandes arquivos dirty. Os agentes guardaram snapshots prévios
em diretórios TEMP específicos da auditoria. O manifesto deve acompanhar a
fonte revertida, preservando metadados do deploy capturado. Nenhuma reversão de
banco é necessária para os quatro fixes desta rodada.
