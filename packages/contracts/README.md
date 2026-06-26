# packages/contracts

Espaco para contratos compartilhados da API.

Proximos passos:

- OpenAPI em `openapi/v1.yaml`.
- Tipos gerados para o frontend.
- Schemas de request/response por dominio.

Este pacote evita que frontend, API e workers discordem sobre payloads.

## Contratos atuais

- `GET /v1/leads`
- `GET /v1/leads/{id}`
- `POST /v1/leads`
