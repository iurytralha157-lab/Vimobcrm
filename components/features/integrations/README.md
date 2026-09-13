# Integrações

Este domínio organiza a conexão e a configuração de provedores externos sem
misturar as telas operacionais do CRM.

## Fronteiras

- `config/integrations/`: catálogo tipado, assets, aliases, permissões,
  capabilities e superfície de gerenciamento.
- `providers/<id>/`: manifesto leve de cada integração exibida no catálogo.
- `<provider>/index.ts`: fachada dos componentes de configuração já ativos.
- `hooks/integrations/<provider>/`: fachada compatível dos hooks do provedor.
- `lib/api/integrations/<provider>.ts`: chamadas HTTP isoladas por provedor.
- `lib/api/integrations.ts`: fachada temporária que preserva o contrato público
  de `integrationsAPI` durante a migração.

Os manifests dos provedores futuros são esqueletos intencionais: mantêm o card,
o identificador e os contratos de disponibilidade prontos, sem simular uma
conexão que ainda não existe.

Telas operacionais continuam em seus domínios. Marketing permanece em
`features/marketing`, conversas em `features/whatsapp` e agenda em
`features/schedule`; somente conexão e configuração pertencem a este domínio.
