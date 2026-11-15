# Superfície de prioridades da cadência — 15/11/2026

Registro parcial do achado `R2-CADENCE-PRIORITIES-SURFACE`. A configuração de
cadência promete aviso em Prioridades, mas a Home observada em produção não
exibia essa superfície. Isso não comprova, isoladamente, falha do motor ou da
materialização no banco.

## Causa e mudança localizada

O commit `88e8417c` removeu a Central de Atenção da navegação. A rota antiga
passou depois a redirecionar para a Home. No freeze `20dfdf60`, a integração de
`HomeFocusList` e `useHomeOverview` foi retirada de `HomeScreen`, enquanto o
componente, hook, endpoint e `HOME_PAGE_SECTIONS.focus=true` permaneceram.

A correção reintegra o bloco existente **Seu foco agora**, abaixo do assistente
atual, preservando carrossel, avisos, busca e navegação. Não restaura a Central.
`/attention` aponta para `/inicio#home-focus`. O escopo inicial é `mine`; equipe
e organização seguem os guards existentes de `useUserAccessScope`, com retorno
a `mine` se o escopo solicitado perder autorização. A API continua exigindo
`attention_view`, organização autenticada e seus próprios limites de escopo.
Nenhum dado, status de tarefa, horário ou regra de autorização é alterado.

A revisão cruzada reproduziu uma segunda condição: uma consulta desativada
mantém seus dados no React Query. Retirar `attention_view` e manter
`dashboard_view` ainda deixava a atenção antiga visível junto do fallback.
O hook agora mapeia somente fontes atualmente autorizadas; também não expõe
cache com faturamento bloqueado ou acesso ainda não resolvido. O fallback de
tarefas só aparece enquanto a atenção não é a fonte ativa. O cache não é apagado
para esconder o problema. Os dois testes de regressão falharam antes e passaram
após esse ajuste.

Somente a consulta `serverFocusQuery` passa a consultar a cada 15 segundos;
stale time, agenda e demais consultas permanecem como antes. O polling continua
condicionado a acesso/módulo e `refetchIntervalInBackground=false`. O worker de
atenção tem ciclo de 30 segundos: a combinação nominal tem até aproximadamente
45 segundos de espera, além de rede, consultas e disponibilidade do serviço.
Isso reduz a chance de pular a janela mínima de aviso de um minuto; não é um
SLA nem prova de capacidade para seis mil usuários. Enquanto a Home permanece
visível, essa consulta pode ocorrer quatro vezes por minuto por sessão, em vez
de uma. Nenhum envio externo, sino ou push é acrescentado.

## Evidência e verificações

O mesmo conjunto corrige `R2-COLUMN-SETTINGS-CTA`: o usuário comum via um
botão de configuração de coluna sem opções aplicáveis. `PipelinesScreen`
reutiliza os helpers de acesso às regras e às automações; `PipelineBoard`
renderiza o menu somente quando alguma dessas capacidades existe. Perfis com
acesso apenas às automações continuam contemplados, respeitando o módulo.
Nenhuma permissão de servidor foi ampliada. O runtime do board verifica
desktop, mobile e fechamento do menu após revogação; o gate completo de
colunas abaixo inclui essa regressão.

- **RED:** render da Home real mostrava carrossel e assistente, sem a região
  `Seu foco agora`.
- **GREEN:** `home-focus-surface.runtime.test.mjs` usa HomeScreen, HomeFocusList,
  useHomeOverview, API de Home e validação Zod reais. Auth, capacidades de
  acesso, transporte e slots não relacionados são sintéticos. Os oito casos
  cobrem montagem e ordem, tarefa/aviso/atraso, link do lead, scopes e revogação,
  chaves de duas organizações/atores, negação/retry e polling real de 15s sem
  invalidação manual, revogação parcial com fallback positivo e cache bloqueado
  por faturamento/acesso pendente. Chromium é isolado e nenhuma rede de produção
  é usada.
- O teste também confere `refetchInterval=15000`, polling em background
  desativado, query enabled e chave com organização/ator/escopo.
- `go test ./internal/homefocus ./internal/attention` passou. Os testes de
  servidor verificam own/team/organization, rejeição de escopos indevidos,
  ordenação e deduplicação da obrigação. A inspeção do SQL confirma o filtro
  parametrizado de tenant. Esta etapa não executou PostgreSQL de duas
  organizações; não apresentar os testes de cache/roles como prova de banco.

O novo runtime entra em `npm run test:form-wizards`, já executado no job de CI
que instala Chromium. Não há nova dependência, instalação ou job. Os gates
locais foram executados sobre a base integrada `3efa6b95` com estas alterações:

| Verificação local | Resultado |
| --- | --- |
| `npm run test:form-wizards` | 54/54, sem pulos; inclui os oito casos Home. |
| `npm run test:pipeline-columns` | 959/959 em 64 arquivos, sem pulos, na execução compartilhada do ajuste de CTA. |
| `npm run typecheck` | Aprovado. |
| `npm run lint` | Zero erros; oito warnings legados fora destes ajustes. |
| `npm run audit:check` | Dois inventários regenerados e quatro contratos aprovados. |
| `npm run validation:test` | Fases 814/814, localização 3/3 e postvalidation 84/84, sem pulos. |

Os subconjuntos não devem ser somados como um total de testes independentes.
O resultado da CI remota deste novo snapshot e o reteste visual de produção
continuam pendentes.

## Reteste real e reversão

Após publicação, abrir uma sessão QA autorizada e a Home; conferir **Meu foco**
como padrão, tarefa do funil exclusivo e link para o mesmo lead. Em uma tarefa
nova com prazo de três minutos e antecedência de um minuto, observar tempo real
sem retroceder relógio ou dados. Conferir aviso antes do vencimento, atraso e
remoção da pendência após registrar o resultado no lead. Separar essa evidência
visual do status do motor/banco e dos testes de sino de atribuição.

Não há migration ou mudança de schema. A reversão é o `git revert` do commit de
integração desta correção e republicação normal, com inventários e testes
coerentes. Tarefas e leads sintéticos persistidos não são removidos por revert.
A auditoria geral por perfil continua incompleta.
