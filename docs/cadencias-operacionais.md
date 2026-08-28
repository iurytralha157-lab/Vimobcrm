# Cadências operacionais por etapa

## Objetivo

Transformar a cadência em um acordo operacional simples:

- o gestor configura o que deve ser feito em cada etapa;
- o corretor enxerga apenas as tarefas do ciclo e da etapa atuais;
- o lead continua livre para mudar de etapa;
- tarefas não executadas ficam auditadas, sem bloquear o funil;
- ganho, perda e reabertura possuem comportamento previsível;
- alertas de tempo e tarefas aparecem em um único foco operacional.

## Modelo

Cada etapa pode ter:

1. **Cadência**
   - ativada ou desativada;
   - zero ou mais tarefas explícitas;
   - prazo e aviso em minutos;
   - tarefa obrigatória ou opcional;
   - resultado operacional obrigatório ou opcional;
   - instrução, observação e mensagem recomendada.
2. **Atenção**
   - origem `inherit` para usar a política mais específica da etapa, pipeline ou organização;
   - origem `local` para a etapa assumir explicitamente cada tipo de alerta;
   - primeira tentativa de contato;
   - primeiro contato efetivo;
   - inatividade na etapa;
   - tempo máximo na etapa;
   - modo desativado, observação ou ativo;
   - horário comercial e escalonamento.

Etapa sem cadência ativa ou sem tarefas explícitas gera **zero obrigações**.
Um template global ou antigo nunca ativa uma etapa sozinho: o opt-in acontece
somente quando o gestor salva as novas regras daquela etapa.

Os quatro limites opcionais de atenção e os avisos de tarefas de cadência são
independentes. Uma cadência ativa e com tarefas sempre cria sua política técnica
de prazo; escolher `inherit` ou desativar os quatro limites locais não silencia
as tarefas pendentes. O kill switch global do motor de atenção continua sendo a
última camada de segurança.

## Ciclos e histórico

- Entrada em uma etapa aberta cria um `lead_stage_cycle`.
- A cadência é materializada uma vez por ciclo.
- Salvar novamente a mesma configuração não recria tarefas nem reinicia progresso.
- Uma cadência já concluída não é reaberta por uma alteração do gestor.
- Ao sair da etapa:
  - tarefa obrigatória pendente vira `skipped`;
  - tarefa opcional pendente vira `cancelled`;
  - tarefa concluída permanece `completed`.
- Ao ganhar ou perder:
  - obrigações pendentes viram `cancelled`;
  - nenhum ciclo artificial é criado na etapa de destino.
- Ao reabrir:
  - começa um novo ciclo;
  - o histórico anterior não é alterado.
- Ao desativar a cadência:
  - tarefas pendentes e a matrícula ativa são canceladas;
  - tarefas concluídas permanecem intactas.
- Ao reativar após desativação:
  - o ciclo que já estava aberto não recebe tarefas retroativas;
  - a nova configuração passa a valer apenas na próxima entrada ou reabertura,
    que cria um ciclo novo;
  - históricos concluídos e cancelados não são revividos.
- Ao criar ou editar uma regra:
  - leads que já estavam na etapa não recebem novas obrigações naquele ciclo;
  - o snapshot atualizado é materializado somente em um ciclo de etapa novo;
  - uma política reconfigurada não reaproveita o estado de entrega do ciclo
    anterior para disparar uma cobrança imediata.
- Uma cadência individual legada que já esteja ativa continua visível e
  executável até terminar, sem ativar automaticamente a etapa para novos leads.

## Contratos principais

- `GET /v1/cadence-templates`
  - lista os templates da organização e suas tarefas;
  - inclui templates legados para leitura e troca manual compatível.
- `POST /v1/cadence-tasks`
  - exige `pipeline_manage`;
  - adiciona uma tarefa pelo contrato legado de deslocamento em dias;
  - retorna conflito quando o template pertence ao editor operacional da etapa.
- `PATCH /v1/cadence-tasks/{id}`
  - exige `pipeline_manage`;
  - substitui os campos editáveis da tarefa do template;
  - não altera tarefas gerenciadas pelo editor operacional da etapa.
- `DELETE /v1/cadence-tasks/{id}`
  - exige `pipeline_manage`;
  - remove somente uma tarefa pertencente à organização atual;
  - não remove tarefas gerenciadas pelo editor operacional da etapa.
- `POST /v1/leads/{id}/cadence`
  - exige `lead_operate` e visibilidade operacional sobre o lead;
  - troca a cadência de um lead aberto apenas quando o template é ativo,
    compatível, não vazio e permitido pela regra da etapa.
- `GET /v1/stages/{id}/operational-rules`
  - leitura para membros da organização;
  - permite prévia somente leitura;
  - retorna `revision`, usada para impedir sobrescrita por uma tela antiga;
  - `cadence.template_id` aparece apenas quando existe um template local
    canônico da etapa; tarefas herdadas não expõem IDs editáveis.
- `PUT /v1/stages/{id}/operational-rules`
  - exige `pipeline_manage`;
  - salva regra, tarefas e políticas na mesma transação;
  - exige a `revision` retornada pelo último GET;
  - retorna `409 stage_operational_rules_changed` se outro gestor salvou antes,
    sem sobrescrever a configuração mais nova;
  - não usa `cadence.template_id` como seletor da mutação: a identidade do
    template local é controlada pelo servidor.
- `GET /v1/leads/{id}/cadence-state`
  - respeita o escopo de visibilidade do lead;
  - retorna somente o ciclo atual e suas tarefas materializadas.
- `POST /v1/lead-tasks/complete-cadence`
  - exige `lead_operate`;
  - conclui pela identificação exata da tarefa materializada;
  - exige resultado somente quando a regra da tarefa exigir.
- `GET /v1/home/focus`
  - reúne atenção, cadência e tarefas;
  - elimina duplicidade entre alerta e tarefa;
  - respeita organização, equipe e responsável.

## Regras de segurança

- Nenhuma chamada Supabase parte dos componentes.
- Tarefas de cadência, templates operacionais e regras de etapa são mutados
  somente pela API; a Data API permanece apenas para leitura desses estados.
- O `organization_id` vem do contexto autenticado, nunca do payload como fonte de verdade.
- O gestor não configura movimentação ou redistribuição automática nesta versão.
- Resolução administrativa de atenção exige permissão, motivo e justificativa, e gera auditoria.
- Templates globais são herdados apenas para leitura; ao salvar, a etapa recebe uma cópia própria.
- Em `attention.source_mode = inherit`, overrides operacionais da etapa são
  arquivados e a política ativa mais específica do pipeline ou da organização
  volta a valer.
- Em `attention.source_mode = local`, um limite preenchido cria uma política
  local; um limite vazio, ou o modo `disabled`, cria um tombstone local que
  bloqueia a política mais ampla somente para aquele tipo e etapa.
- A política técnica `cadence_task` acompanha a ativação da cadência e não é
  controlada pelo `source_mode` dos quatro limites opcionais.
- Políticas já mantidas na Central de Atenção nunca são sobrescritas: um conflito
  precisa ser resolvido ali antes de ativar a mesma regra pela etapa.
- Leads legados sem ciclos não recebem baseline nem obrigações quando a regra é
  salva. As cobranças começam somente em ciclos novos de etapa ou de responsável,
  sem avalanche retroativa.
- Depois que um lead legado entra em um ciclo novo coberto por regras
  operacionais, atividades humanas passam a registrar os mesmos fatos de
  contato e inatividade dos leads novos, sem alterar o marcador imutável
  `attention_eligible`.
- A configuração nova não cria eventos vazios na timeline operacional legada.
- O teste de integração aceita somente banco local/loopback.

## Matriz de homologação isolada

Executar apenas em uma organização e usuários de teste:

1. Criar gestor, corretor A e corretor B.
2. Criar pipeline com:
   - etapa sem cadência;
   - etapa com duas tarefas;
   - etapa com alerta de inatividade;
   - etapa final.
3. Validar etapa sem regra: nenhuma tarefa e nenhum alerta.
4. Entrar na etapa com cadência: uma matrícula e tarefas com prazo real.
5. Concluir tarefa sem resultado obrigatório: conclusão direta.
6. Concluir tarefa com resultado obrigatório: resultado exigido.
7. Salvar a mesma regra: nenhum reset ou duplicação.
8. Mover sem concluir:
   - obrigatória `skipped`;
   - opcional `cancelled`.
9. Marcar como ganho e perdido: pendências canceladas.
10. Reabrir: novo ciclo, histórico preservado.
11. Desativar e reativar:
    - pendências atuais canceladas;
    - nenhuma matrícula criada no ciclo já aberto;
    - nova matrícula somente depois de sair e entrar novamente na etapa.
12. Confirmar foco da página inicial:
   - sem duplicidade;
   - prioridade por atraso/aviso/prazo;
   - item removido após conclusão.
13. Confirmar escopo:
   - corretor vê apenas leads permitidos;
   - líder vê sua equipe;
   - gestor com `pipeline_manage` edita regras;
   - demais usuários recebem somente leitura.
14. Repetir os passos essenciais no mobile.
15. Criar um lead legado sem matrícula/ciclos, salvar a regra da etapa e
    confirmar:
    - nenhum ciclo histórico é reconstruído pelo salvamento;
    - nenhuma instância, tarefa ou aviso é criado retroativamente;
    - a transação não varre todos os leads que já estavam na etapa.
16. Mover o lead legado para uma nova entrada real na etapa, executar uma
    atividade humana e confirmar:
    - fato operacional registrado sem mudar `attention_eligible`;
    - primeiro contato resolvido quando aplicável;
    - relógio de inatividade reiniciado.
17. Validar herança de atenção:
    - `inherit` usa a política mais específica do pipeline ou organização;
    - `local` com limite vazio bloqueia apenas aquele tipo herdado;
    - voltar para `inherit` remove o bloqueio local.
18. Ativar uma cadência sem limites locais e confirmar que tarefas pendentes
    ainda possuem aviso e vencimento pela política `cadence_task`.
19. Manter um enrollment legado incompatível com a etapa e confirmar que suas
    tarefas continuam visíveis, sem tornar a etapa automaticamente ativa.
20. Criar uma política pela Central de Atenção e confirmar que Regras da etapa
    não a altera nem a arquiva.
21. Em duas conexões, concluir simultaneamente as duas últimas tarefas de uma
    matrícula e confirmar:
    - ambas concluídas uma única vez;
    - matrícula `completed`;
    - nenhuma falha por deadlock.
22. Concorrer conclusão com troca de cadência, mudança de etapa e reatribuição:
    - nenhuma operação termina com SQLSTATE `40P01`;
    - autorização é revalidada no snapshot bloqueado do lead;
    - o estado final possui uma única cadência coerente.
23. Concorrer criação/troca de matrícula com edição ou desativação da regra:
    - nenhuma matrícula nasce depois da desativação confirmada;
    - snapshot e tarefas pertencem integralmente à mesma revisão.
24. Abrir a mesma etapa em duas sessões e salvar as duas com a mesma revisão:
    - a primeira atualização avança a revisão;
    - a segunda recebe `409 stage_operational_rules_changed`;
    - recarregar antes de tentar novamente preserva a alteração do outro gestor.

## Rollout

1. Executar migration e testes em banco local descartável.
2. Homologar com organização isolada e dados fictícios.
3. Iniciar regras de atenção em modo `shadow`.
4. Comparar alertas esperados com o histórico real.
5. Ativar uma etapa por vez.
6. Monitorar volume de tarefas, atrasos, erros e tempo de resposta.
7. Antes de produção, ensaiar a migration em um clone sanitizado com
   cardinalidade equivalente:
   - definir `lock_timeout` e `statement_timeout` conservadores;
   - medir os `UPDATE` de compatibilidade e a validação das constraints;
   - separar qualquer backfill volumoso em lotes retomáveis;
   - concorrer o ensaio com movimentação de leads e conclusão de tarefas.
8. Somente depois desse ensaio planejar migration e deploy de produção.
