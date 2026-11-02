# Solicitação de recuperação de senha

`use-password-recovery-request.ts` coordena o formulário público de recuperação.
O transporte continua em `authAPI.resetPassword`, por meio do Supabase Auth.
Este hook não cria tokens, não envia e-mails por outro canal e não consulta
a existência de uma conta.

Cada retorno concluído usa a mesma mensagem neutra, inclusive erros devolvidos
pelo provedor. A interface não confirma entrega nem deduz indisponibilidade
global de um erro associado a um endereço. Após 15 segundos sem conclusão,
mostra resultado não confirmado, sem reenviar automaticamente.

O coordenador em `lib/auth/password-recovery-request.ts` mantém apenas a trava
da promessa real e um deadline de 60 segundos na memória da aba. A trava
sobrevive à desmontagem do formulário e só termina quando a promessa original
encerra; o timeout visual não cancela o SDK. O cooldown vale para qualquer
resultado e endereço e não substitui a limitação real no servidor.

O custom fetch em `lib/supabase/client.ts` limita somente o POST
`/auth/v1/recover` na origem Supabase configurada: após 30 segundos cancela o
transporte real com `AbortController`, incluindo um corpo de resposta pendente.
O corpo é limitado a 64 KiB. O sinal original continua válido, não há retry
automático e a trava só libera quando o SDK encerra após o cancelamento.
Os demais endpoints preservam o transporte existente.

Mudanças de modo/e-mail, desmontagem e uma nova tentativa invalidam callbacks
anteriores. Nenhum e-mail, token, senha ou erro bruto é guardado pelo coordenador.

Os testes `password-recovery-request.test.mjs` e
`use-password-recovery-request.runtime.test.mjs` cobrem a trava real, cooldown,
timeout e callbacks atrasados, incluindo A-B-A e remount. O teste runtime extrai
o hook e o submit reais por AST; usa respostas sintéticas, sem rede ou serviços.
