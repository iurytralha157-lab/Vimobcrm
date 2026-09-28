# Pipeline

A rota `/crm/pipelines` usa `PipelinesScreen` para o quadro, `LeadDetailDialog` para o lead e `StageOperationalRules` para a cadência da etapa. As leituras e mutações passam pelos hooks e por `lib/api/`; as permissões, o escopo da organização e as transações são conferidos novamente na API Go.

## Contratos que precisam permanecer alinhados

- O quadro consulta `/v1/pipeline-board` e as rotas de contagem, paginação e filtros da etapa. O filtro de equipe considera a equipe atual do responsável, com tratamento próprio para leads sem responsável. A chave de cache inclui organização, usuário, visibilidade e filtros efetivos.
- Abrir um lead exige uma leitura recente autorizada. Perda de acesso fecha o detalhe e remove sua cópia do cache. Erro temporário também fecha o detalhe até nova confirmação.
- Mover um lead envia a etapa esperada. A API retorna conflito se outra sessão já o moveu; o quadro desfaz a alteração otimista e atualiza os dados.
- Reordenar ou editar etapas envia a versão original de cada etapa. A API salva a lista em uma transação e recusa versões antigas, exclusões com histórico ou configurações vinculadas. O editor mantém o rascunho quando há conflito.
- Regras operacionais de cadência aceitam `pipeline_manage` ou `automations_manage`. A revisão impede sobrescrever a configuração de outra sessão; o editor preserva o rascunho e solicita atualização explícita.
- `stage_entered_at` mede o tempo na etapa atual. `first_response_at` e `first_response_seconds` são métricas distintas; a atividade de contato pode ser salva mesmo se o registro da métrica falhar, com aviso e repetição apenas da métrica.

## Impacto e validação

As proteções de cache e autorização evitam mostrar um detalhe antigo após mudança de equipe ou organização. Os conflitos impedem perda silenciosa de mudanças de etapa e cadência. O histórico ordena os eventos pela ocorrência e restringe os campos de auditoria retornados ao cliente.

Ao validar uma publicação, testar com administrador, líder e corretor em duas sessões; criar e editar cadência; mover o mesmo lead simultaneamente; conferir tempos, histórico e filtros com os dados reais; e observar carregamento inicial, reconexão e paginação em desktop e celular. Testes locais sem acesso ao banco operacional não comprovam esses fluxos integrados.
