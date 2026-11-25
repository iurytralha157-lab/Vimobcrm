# Recuperação de senha

`ResetPasswordScreen` mantém os campos e mensagens da tela. A validação do link
e o ciclo da visita ficam em `hooks/auth/use-password-recovery-session.ts`.
PKCE, token hash e links administrativos com sessão implícita passam por um
cliente Supabase isolado em memória. Na recuperação PKCE, ele lê apenas o
verificador da solicitação feita no navegador. O cliente compartilhado recebe
a sessão depois que o Auth confirma o link, o token indica AMR `recovery` e
o usuário corresponde à conta já aberta, quando houver uma. Um verificador
de solicitação mais recente impede a instalação da recuperação anterior.

O proxy encaminha sessões assinadas de recuperação das rotas de login, cadastro,
onboarding e CRM para `/reset-password`, preservando a sessão. Uma navegação ou
evento recebido por outra aba não representa cancelamento. A query `cancel=1`
também não encerra a sessão: a saída usa a ação explícita da tela e os guards
da identidade que está sendo recuperada.

Na tela inválida é possível solicitar outro e-mail de recuperação. A saída
explícita pode encerrar a recuperação atual mesmo sem
prova local do link. O clique captura visita e identidade antes de consultar a
sessão fresca; só encerra a mesma sessão com AMR `recovery`, sem autorizar troca
de senha. Sessões normais/OTP estáveis são preservadas, e uma substituição durante
a consulta invalida a saída. O listener continua observando identidades após
invalidar a visita, sem reabrir o formulário nem conceder prova.

Uma visita validada captura usuário e `session_id`. `settingsAPI.changePassword`
encaminha essa identidade ao transporte; chamadas de Configurações sem intenção
explícita capturam os mesmos dados do token corrente no início da chamada.
O refresh pode renovar um token da mesma sessão, mas não mudar o alvo da senha.

`lib/auth/password-recovery-exit.ts` reutiliza os guards do logout para revogar
o JWT original, conferir a sessão fresca antes do logout local e conferir a
visita novamente antes de limpar evidências ou navegar. Falha na limpeza local
mantém a tela disponível para tentar sair novamente, evitando retornar ao proxy
com uma cookie de recuperação ainda presente.

Troca de usuário, nova sessão ou desmontagem impedem uma resposta tardia da
validação privada de alterar a sessão compartilhada ou o formulário. O
controlador compara a visita e a sessão antes de chamar o SDK. Na etapa final,
uma troca de sessão visível antes da resposta de verificação do Auth impede a
instalação. A gravação subsequente de cookie pelo SDK e o logout local podem
intercalar com outra aba. A validação confere a identidade antes de liberar
a troca de senha.

Sem acesso a `sessionStorage`, uma sessão pré-existente sozinha não autoriza o
reset. Um link verificado na visita corrente pode continuar em memória; recuperar
essa prova após recarregar a página exige armazenamento disponível e a mesma
sessão de recuperação.

Verificações focadas, sem rede ou banco:

```sh
node --test hooks/auth/password-recovery-session.race.test.mjs lib/auth/password-recovery-exit.test.mjs lib/api/password-change-identity.test.mjs
node --test lib/auth/password-recovery-proxy.test.mjs
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/auth/password-recovery.test.ts
```

Os testes executam o hook, o handler de submit extraído da tela, o método real de
API e os helpers de saída com transporte em memória. Cobrem substituição de
usuário/sessão, respostas tardias, desmontagem, refresh e falhas de logout. Não
substituem testes autenticados no navegador ou a entrega de e-mail pelo SMTP.

# Destino após o login e falhas de acesso

`lib/auth/post-login-destination.ts` é a única regra de destino. Superadmin fora de
impersonação vai para `/admin`, salvo se pediu uma rota do painel ou uma rota do CRM
com organização ativa. O `proxy` não conhece o papel, então o `AppLayout` envia ao
painel o superadmin que abre o `/inicio` sem organização ativa. Com organização ativa,
ele continua podendo abrir o `/inicio` dela. A regra do usuário comum não mudou.

`lib/auth/access-validation.ts` separa falha temporária de perda de acesso. Rede,
408, 425, 429 e 5xx mantêm o último contexto validado, mostram um aviso e tentam de
novo. 403, 404 e a primeira carga continuam falhando fechado. Um 401 da API só
encerra a sessão depois que o Auth confirma, e apenas neste dispositivo. A revogação
global fica para logout explícito, recuperação concluída e conta suspensa.

`npm run test:auth-scenarios` roda esses fluxos em navegador real, com backend falso.
