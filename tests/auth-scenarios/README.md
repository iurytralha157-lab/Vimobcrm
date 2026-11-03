# Cenários de login em navegador real

Roda o Next em modo dev contra um backend falso local (`fake-backend.mjs`), que
simula Auth e API sem dado real, sem Docker e sem rede externa. Cobre destino após
o login, superadmin, retorno à página pedida e falhas temporárias de acesso.

```sh
npm run test:auth-scenarios          # todos
npm run test:auth-scenarios -- '^16' # filtra por regex no nome
```

Os cenários complementam os testes de `tests/e2e`, que usam Supabase e API reais.
O backend falso não prova contrato com os serviços reais: a validação final
continua sendo na homologação.

O bootstrap usa o executável Node atual e o CLI Next instalado no projeto,
com caminhos nativos e diretório de trabalho fixo, inclusive no Windows. Não
depende de `npx`, shell ou diretório de onde o comando foi chamado. A API pública
e o BFF do Next recebem o backend falso local; nenhum `.env` real é consultado
pelo runner para obter credenciais.

A prontidão exige o aviso do processo filho que acabou de iniciar antes do
HTTP: `fake up` no backend e `Ready in` no Next. Falha de spawn ou saída precoce
gera erro imediato, inclusive se outro serviço já ocupar a porta. O prazo de
startup continua sendo 120 segundos, com até 120 tentativas e intervalo de
1 segundo entre falhas. Cada GET recebe todo o prazo global restante, permitindo
a compilação fria do Next sem abortá-la após 1 segundo. Uma conexão sem resposta
é abortada no deadline total. O prazo pode ser reduzido somente pelo helper nos
testes unitários; o runner não passa override. Os cenários e assertions permanecem
iguais.

Um bloco `finally` fecha o navegador e encerra apenas as árvores de processos
criadas pelo runner, mesmo quando o início ou a execução falha. SIGINT e SIGTERM
acionam a mesma limpeza e preservam um exit code diferente de zero. No Windows, o
encerramento usa o PID filho conhecido com `taskkill /T`; não busca nem encerra
processos por nome ou porta. `AUTH_SCENARIOS_URL`, quando informado, continua
permitindo um frontend já iniciado: esse processo externo nunca é encerrado.

Para verificar somente o bootstrap e o ciclo de vida, sem rodar a matriz:

```sh
node --test tests/auth-scenarios/runner-lifecycle.test.mjs
```
