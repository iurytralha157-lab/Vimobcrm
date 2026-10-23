# Pipeline: P3 de cache recriado por resposta tardia

19/10/2026. Correção local do item 03 da auditoria
`D:/Vimob/outputs/pipeline-card-reaudit-20261019-t927/AUDITORIA.md`.
Checkout principal `D:/Vimob/workspaces/vimob-crm`, branch main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee` mais alterações locais preexistentes.
Evidências desta etapa: `D:/Vimob/outputs/pipeline-cache-p3-fix-20261019-v031`.

## Defeito e correção

Uma resposta de atribuição ou mudança de etapa no popup podia executar
`setQueryData`, atualizar o quadro e emitir atualização antes de conferir a
validade do acesso que iniciou a operação. Isso recriava o cache do client
antigo após logout/troca de sessão. A auditoria não comprovou vazamento entre
organizações; o defeito confirmado era a escrita tardia no cache aposentado.

`lib/access/query-client-access.ts` mantém uma visita passiva por QueryClient
em WeakMap. O QueryProvider ativa a visita no layout effect e a aposenta no
cleanup quando o client ou SID muda. Uma visita aposentada não pode reviver,
inclusive ao sair e voltar ao acesso anterior. Não há clear, remoção de
queries, cancelamento global, listener novo ou alteração nos defaults do cache.
As fronteiras de usuário, organização, papel, permissões e escopos continuam
usando a assinatura de acesso existente do provider.

`useLeadRequestScope` captura também essa visita. A reconciliação exige a
visita ativa, a identidade observada pelo hook e os identificadores globais
atuais do usuário/SID. A intenção é capturada antes do primeiro await e retida
durante confirmação fora da escala e motivo de perda; CAS/revisão original
continuam obrigatórios. As operações de UI/rollback combinam a validade do
detalhe com a validade da requisição.

Os dois handlers verificam o acesso antes de concluir o recibo otimista,
gravar o ACK no cache ou emitir atualização. ACK de lead errado ou de outra
organização é rejeitado. Fechar apenas o popup permite reconciliar uma escrita
já iniciada no mesmo acesso, mas impede atualização da UI antiga e toast de
sucesso. Refresh do token com o mesmo SID preserva a operação.

Os POSTs desses dois handlers não usam o AbortSignal de fechamento do popup:
o resultado de uma gravação já enviada precisa continuar observável. O
`onRequestStart` composto impede um novo envio após fechamento/troca de acesso,
inclusive se a resolução do token ficou aguardando. Pins de usuário/SID,
timeout interno do transporte e verificações do ACK são preservados. Em erro
após fechamento normal, somente as queries ativas do lead e quadro originais
são relidas, enquanto aquele acesso ainda é válido. Após aposentar o acesso,
não há refetch ativo, restauração de snapshot ou dados da resposta antiga.

## Escopo e arquitetura

Produto existente alterado somente em LeadDetailDialog, QueryProvider e
useLeadRequestScope, mais o helper isolado em lib/access. Fixtures que executam
declarações reais via AST receberam a nova dependência; asserções existentes
foram mantidas. Dois testes novos cobrem os handlers/provider e um cobre a
lease. A interface visual, endpoints, backend, schemas, permissões e contratos
das outras abas não foram redesenhados.

LeadDetailDialog já excede o tamanho recomendado. Foram alterados apenas os
dois caminhos defeituosos, sem extração estrutural simultânea. Uma futura
extração dos controladores deve preservar a matriz de sessões/fechamento e os
contratos de CAS; não misturar com a remoção de código morto do item 14.

Os quatro relatórios de superfícies/dívida visual foram regenerados porque a
posição das declarações e seus digests mudaram. Três arquivos mudaram;
home-design-debt.md permaneceu idêntico. As contagens,
superfícies, rotas e regras permanecem iguais; o diff não introduz nova UI.
Scripts/contratos do inventário não foram modificados.

## Validação e limites

- RED final: o produto anterior falha em 50 dos 98 casos da regressão original,
  sem skips. Os 48 controles restantes passam. O teste executa os handlers
  reais extraídos por AST, scopes/otimismo reais e QueryClient real.
- GREEN final: 116 casos passam (112 de regressão de ACK/envio e 4 da lease),
  sem falhas/skips. Inclui logout, SID, ator, organização, client, permissões,
  A→B→A observado, fechamento normal, troca só do lead, token refresh, cache
  limpo e ACK inválido. QueryObservers reais verificam releitura autorizada
  após erro/fechamento e ausência de releitura após aposentadoria do acesso.
- Provider: 12 casos passam, incluindo assinatura de acesso, SID/retorno,
  refresh mesmo SID, unmount, ordenação das listas e defaults preservados.
- Consumidores existentes: 331 casos distintos passam, sem skips, nos grupos
  shared-scope (172) e adjacent-scope (159). Os 30 casos de atribuição/etapa
  desse conjunto foram repetidos após o refinamento final e continuam verdes.
  Não somar repetições: total desta etapa é 459 casos distintos.
- Typecheck global e audit:check aprovados (4 contratos do inventário).
  Lint global: zero erros e os 7 avisos preexistentes fora deste ajuste.
  Diff-check aprovado; dos 4.073 arquivos monitorados no início, 4.063 ficaram
  idênticos, 10 mudaram conforme a allowlist e 5 foram adicionados. Relatórios
  gerados têm comparação suplementar separada. Resultados detalhados nos
  recibos desta etapa e em CORRECOES.md.

Testes de lifecycle usam scheduler sintético de hooks e transporte controlado,
sem navegador montado, API, banco ou provedor real. A revisão independente
conferiu o callback no transporte real e não encontrou novo bloqueador P3.
Não certificam o comportamento instalado em produção nem carga de 300 usuários.
Uma falha real de rede/timeout ainda pode ter resultado de gravação incerto;
reconciliação não significa que o servidor cancelou uma transação.

Não houve deploy, migration, commit, push, mudança de dados reais ou início de
serviços nesta etapa. O checkpoint anterior permite verificar os arquivos
preservados; reversão deve remover somente os hunks desta etapa, nunca resetar
o checkout ou restaurar arquivos inteiros que contêm ajustes anteriores.

## Continuidade

Com os dois P2 da Agenda e este P3, são 3/14 itens corrigidos localmente.
Os 11 restantes da auditoria continuam pendentes. Próximo: item 04/P4,
digitação no formulário real durante salvamento lento. Esta correção não é
um aceite da Pipeline completa para publicação.
