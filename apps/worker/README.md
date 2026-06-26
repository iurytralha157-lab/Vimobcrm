# Vimob Worker

Espaco reservado para os workers do Vimob CRM.

Este app vai processar tarefas que nao devem bloquear requests HTTP:

- webhooks externos
- WhatsApp
- Google Calendar
- Meta/Facebook
- notificacoes
- retries e dead-letter queues

Na Fase 1, a API nasce primeiro. O worker entra quando a fila for escolhida e o primeiro fluxo assincrono for migrado.
