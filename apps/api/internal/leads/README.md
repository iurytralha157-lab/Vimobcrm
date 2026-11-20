# Domínio Leads

Este pacote é dono do cadastro e ciclo de vida dos leads, das projeções de
contatos, histórico e funil, e dos efeitos de negócio já associados a esses
fluxos. A composição da aplicação em `internal/app` instancia `NewRepository`
e `NewHandler`; os handlers recebem o contexto de tenant resolvido pelo servidor.

## Interfaces e responsabilidades

| Arquivo ou grupo | Responsabilidade |
| --- | --- |
| `handler.go`, `*_handler.go` | Contratos HTTP, validação de entrada, autorização do fluxo e tradução de erros. |
| `repository.go` | Construção de `Repository`, contratos internos compartilhados e os fluxos de mutação ainda não separados. |
| `repository_read.go` | `List`, `Get`, `GetSensitiveProfile` e projeção SQL canônica dos campos do lead. |
| `repository_scan.go` | Leitura das colunas para `Lead`, metadados de perfil e conversores de valores nulos, escalares e JSON. |
| `lead_creation.go` | `Repository.Create` e `createNewLead`: entrada do fluxo de criação e persistência de um lead novo. |
| `lead_reentry.go` | `registerReentry`: persistência da reentrada de um lead existente. |
| `lead_update.go` | `Repository.Update`: edição de leads, com os guards e os efeitos da transação de atualização. |
| `lead_assignment.go` | `Repository.Assign` e `transferLeadAssignee`: troca manual de responsável e persistência compartilhada da atribuição. |
| `types.go`, `*_types.go` | Contratos do domínio já consumidos pelos handlers e pela composição. |
| `lead_history_*`, `pipeline_board*`, `queue_pool_*` | Projeções e operações especializadas já separadas por fluxo. |
| `move_stage_*`, `redistribution_*`, `notification_*` | Transições, distribuição e entrega durável dos efeitos existentes. |

Outros domínios devem consumir as interfaces públicas necessárias do pacote.
Helpers não exportados continuam internos a `leads`; a organização em arquivos
não cria outro pacote nem uma nova API. Regras novas de outro domínio pertencem
ao respectivo dono, com uma interface explícita para a integração.

## Leitura de leads

O caminho de uma consulta é handler → método de `Repository` → SQL/projeção →
scanner → contrato `Lead`. A consulta conserva os filtros de organização e
visibilidade, a paginação, o escopo dos imóveis e o enriquecimento existente.
`GetSensitiveProfile` continua delegando ao carregador autorizado já existente.

`leadSelectFields` e `scanLeadFields` formam um contrato de ordem de colunas.
Ao adicionar ou remover um campo, valide a projeção e o scanner juntos. Os
conversores em `repository_scan.go` também são usados por mutações e outros
arquivos deste pacote; eles não fazem consultas nem escolhem autorização.

## Criação e reentrada — etapa 3B.2

`Repository.Create` e `createNewLead` ficam em `lead_creation.go`;
`registerReentry` fica em `lead_reentry.go`. Os métodos continuam no mesmo
pacote e usam o mesmo `Repository`, contratos e helpers existentes. A divisão
preserva SQL, limites de transação, locks, autorização, idempotência e ordem
dos efeitos; não transfere regras para outro domínio nem altera o envio de
notificações.

## Edição, movimentação e atribuição — etapa 3B.3

`Repository.Update` e o controle da ordem do card ficam em `lead_update.go`.
`Repository.MoveStage` fica em `move_stage_transaction.go`, junto da
transação de movimentação usada pela Pipeline e pelas automações.
`Repository.Assign` e `transferLeadAssignee` ficam em `lead_assignment.go`.
Os handlers, assinaturas, transações, locks, regras de autorização e efeitos
continuam os mesmos.

## Reservas e vínculos de conversas do WhatsApp

Os snapshots e locks de reserva ficam em `property_reservation_lock.go`, e a
reserva e liberação do imóvel ficam em `property_reservation_transition.go`.
`property_reservation_notifications.go` reúne a notificação aos leads
interessados e usa o evento de reserva existente em
`property_reservation_outbox.go`.

`whatsapp_conversation_binding.go` reúne a autorização e o vínculo de uma
conversa na criação e na reentrada do lead. O lock de sessão para vínculo
somente de mensagens futuras continua em `whatsapp_future_binding.go`.

## Continuação da divisão

`repository.go` continua sendo um legado acima do limite de 800 linhas. A
extração de leitura e conversão reduziu o arquivo sem alterar declarações, SQL
ou assinaturas. As etapas 3B.2 e 3B.3 separam os métodos descritos acima.

Cada recorte deve preservar seus limites de transação, locks, autorização,
idempotência e efeitos. Testes que leem o fonte de `repository.go` precisam
continuar verificando o corpo e a ordem das operações do fluxo correto quando
esse fluxo mudar de arquivo. Não misture a extração estrutural com mudanças
de regras de negócio ou com a transferência de responsabilidades entre domínios.

## Verificação e reversão

Na raiz do repositório, execute:

```powershell
go test ./apps/api/internal/leads ./apps/api/internal/app ./apps/api/internal/distribution ./apps/api/internal/roundrobin
```

As integrações com PostgreSQL exigem os respectivos harnesses e opt-ins de
testes locais. Sem esses ambientes, informe os testes pulados; sucesso dos
testes unitários não representa validação do banco ou de produção.

A reversão da extração de leitura deve tratar `repository.go`,
`repository_read.go` e `repository_scan.go` como um único conjunto: devolver as
declarações ao arquivo anterior e remover suas cópias dos dois arquivos novos.
Uma reversão parcial produz funções ausentes ou duplicadas.

Na etapa 3B.2, o conjunto de reversão é `repository.go`, `lead_creation.go` e
`lead_reentry.go`: devolver os três métodos ao arquivo anterior e remover suas
cópias dos arquivos extraídos. Esta separação não requer mudança de
schema, contrato HTTP, configuração ou sequência de deploy.

Para reverter a etapa 3B.3, devolva os métodos extraídos ao `repository.go`,
remova as cópias em `lead_update.go`, `lead_assignment.go` e
`move_stage_transaction.go` e restaure as referências nos testes de contrato.

Para reverter a extração de reservas e vínculos, devolva as declarações dos
quatro arquivos novos ao `repository.go` e restaure os três testes que leem
`whatsapp_conversation_binding.go` para lerem o arquivo anterior.
