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

## Continuação da divisão

`repository.go` continua sendo um legado acima do limite de 800 linhas. A
extração de leitura e conversão reduziu o arquivo sem alterar declarações, SQL
ou assinaturas. Os próximos recortes devem separar criação/reentrada,
atualização, atribuição, reservas e vínculos WhatsApp por responsabilidade,
reutilizando os módulos existentes, como `lead_update_destination.go`,
`move_stage_transaction.go`, `property_reservation_outbox.go` e
`whatsapp_future_binding.go`.

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

A reversão da extração deve tratar `repository.go`, `repository_read.go` e
`repository_scan.go` como um único conjunto: devolver as declarações ao arquivo
anterior e remover suas cópias dos dois arquivos novos. Uma reversão parcial
produz funções ausentes ou duplicadas. Esta separação não requer mudança de
schema, contrato HTTP, configuração ou sequência de deploy.
