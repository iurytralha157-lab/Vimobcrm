# Realtime: endurecimento do WhatsApp

## Estado implementado

- O canal privado `whatsapp:{organizationId}:inbox` tem um único dono no shell:
  `WhatsAppRealtimeBus`.
- Canais `whatsapp:{organizationId}:lead:{leadId}` têm ciclo de vida separado do
  inbox. Trocar a conversa selecionada não reconecta o inbox.
- Um registry central mantém um canal físico por tópico, faz fan-out para
  assinantes lógicos e só remove o canal após o último `release`.
- O fechamento usa uma janela de 200 ms. Uma nova aquisição nessa janela
  reutiliza o canal; se o fechamento já começou, a nova abertura aguarda sua
  conclusão.
- `CHANNEL_ERROR` e `TIMED_OUT` são registrados e permanecem sob o rejoin
  exponencial do `realtime-js`. Um `CLOSED` inesperado cria um canal físico novo.
- Falhas de um listener são isoladas e não interrompem os demais listeners.
- A assinatura é fail-closed enquanto módulo e permissões carregam, e exige o
  módulo `whatsapp` e a permissão efetiva `whatsapp_view`.
- A autorização RLS dos tópicos privados segue o mesmo contrato efetivo:
  módulo explicitamente desabilitado bloqueia; `owner`/`admin` são wildcard;
  para membros comuns, `whatsapp_operate` e `whatsapp_manage` implicam
  `whatsapp_view`; o tópico de lead ainda exige acesso ao lead.
- Erros de autenticação, abertura, canal, timeout, fechamento inesperado,
  remoção e listener são enviados à telemetria com throttle, sem conteúdo de
  mensagem nem identificadores de lead.

## Validação local

- Testes unitários do registry cobrem fan-out/refcount, fechamento final,
  reacquire durante grace, espera de closing, independência inbox/lead,
  isolamento de listener e reconexão após `CLOSED`.
- O pgTAP de autorização cobre anonimato, tenant, módulo, permissão efetiva,
  implicações, administrador e tópico de lead.
- O teste legado de entrega durável do WhatsApp continua passando.

## Próximo passo documentado: Gamificação

A Gamificação ainda usa seis assinaturas `postgres_changes` em
`hooks/gamification/use-gamification-overview.ts`. Não foi migrada neste lote.

Antes de aumentar carga, migrar esses sinais para Broadcast privado por
organização, mantendo a API como fonte canônica. O desenho deve:

1. publicar apenas hints sem dados sensíveis;
2. usar um tópico privado por organização;
3. aplicar RLS com módulo `gamification` e `gamification_view`;
4. reconciliar as queries ao entrar em `SUBSCRIBED`;
5. manter polling de segurança durante a transição;
6. medir `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED` e latência de reconciliação;
7. remover as seis assinaturas `postgres_changes` somente após teste de carga e
   período de observação.

Motivo: `postgres_changes` valida RLS por assinante e processa as mudanças em
uma única thread. Broadcast privado reduz o custo de fan-out e evita depender
de `REPLICA IDENTITY FULL` para eventos de exclusão filtrados.
