# Criação inline de tags respeita tag_manage

Achado `R2-TAG-INLINE-CREATE-AFFORDANCE`, alias operacional
`R2-TAG-CREATE-AFFORDANCE`, base `6d76556c`, rodada de 15/11/2026.
Delta local, sem commit, deploy ou reteste visual em produção neste ensaio.

## Causa e alcance

O comum B, sem tag_manage, via Criar nova tag habilitado no próprio lead em
Contatos, enquanto Gestão/Tags redirecionava para Home. Clique vazio no footer
legado apenas foca a busca; nome novo/Enter pode tentar criar a tag global.
Nenhuma criação global ou resposta 403 de produção foi testada para este achado.

O contrato do servidor exige tag_manage na rota POST /v1/tags e novamente no
Repository.CreateTag, antes do INSERT. lead_create não é uma alternativa nesse
caminho. Associar uma tag existente ao lead é outra operação, com lead_operate
e autorização do lead. A divergência comprovada é de interface; não comprova
elevação de acesso.

Os três exports legados de components/ui/tag-selector.tsx consultavam useTags e
useCreateTag, mas não a permissão de criação. Seus consumidores foram mapeados:

| Export | Consumidor |
|---|---|
| TagSelector | CreateLeadDialog |
| InlineTagSelector | WebhooksTab |
| TagSelectorPopoverContent | Dois pontos de LeadDetailDialog em contacts/default |

O variant pipeline usa LeadTagPickerContent, que já possui guard. O componente
SearchableTagPicker também já respeita tag_manage. Ambos foram preservados.
A alteração na camada compartilhada é necessária para alcançar os três exports
e seus consumidores, sem replicar a correção em cada formulário.

## Alteração mínima

Cada export usa o hook de permissões existente. Render da criação, handler e
teclado Enter exigem tag_manage; busca não anuncia criação para quem não pode
criar. O inline vazio deixa de recomendar uma ação indisponível. Buscar,
selecionar e remover tags existentes seguem os callbacks e permissões dos donos.

Não foram alterados hooks de transporte, API, servidor, RLS, grants ou catálogo
de permissões. Não há nova prop, camada, dependência ou migração. A permissão no
browser segue sendo conveniência de UI; o servidor continua autorizando a escrita.

## Verificação

O harness existente passou a montar os três exports reais, com hooks
useTags/useCreateTag, React Query e Radix reais. Auth/permissões e transporte são
sintéticos, sem rede. O picker moderno e seus 16 casos permanecem no mesmo
harness. Os 23 casos novos cobrem render e Enter sem permissão, criação por botão
e Enter com permissão, revogação aberta/restauração sem autoenvio, duas
organizações e seleção/remoção de associações existentes. O viewport é 360×640.

O RED final tem 39 casos: 12 falhas pertinentes e 27 controles aprovados,
zero pulos. Os dois ensaios preliminares de montagem do harness foram corrigidos
e preservados separadamente; não são apresentados como reprodução do produto.

| Verificação local | Resultado |
|---|---|
| Harness focado após correção | 39/39, zero pulos |
| test:form-wizards | 121/121, zero pulos; inclui os 39 |
| Typecheck | exit 0 |
| Lint | exit 0; zero erros e oito avisos legados |
| Inventários/audit após escritores canônicos | 4/4, zero pulos |
| git diff --check | exit 0 |
| Peer de fonte/testes/runner | Aprovado; somente leitura, sem repetir gates |

O arquivo do harness não integrava os runners da CI nessa base. Foi acrescentado
ao script test:form-wizards existente, já executado após instalar Chromium no
job whatsapp-contracts. Não há novo job, dependência ou alteração de workflow.
Os 39 casos são subset do total 121 e não devem ser somados de novo.

## Limites, impacto e reversão

Não foi montado o fluxo completo de Contatos, criação de lead ou Webhooks, nem
executado PostgreSQL, POST real ou reteste visual de produção por este ensaio.
Callbacks de criação já em voo nos exports legados seguem o comportamento
anterior; o fencing do picker moderno não foi retrabalhado.

Quem não tem tag_manage deixa de receber controles de criar tags globais e
mantém a escolha de tags existentes. Quem tem a permissão preserva a criação.
Após release, retestar os três consumidores por perfil, inclusive Enter com o
picker aberto depois de revogar a permissão, sem conceder novos grants.

Reverter o delta e regenerar os inventários restaura o comportamento anterior.
Nenhum dado ou configuração remota exige restauração. Os logs do ensaio ficam
nos artefatos operacionais vetter-tag-create-affordance-20261115.
