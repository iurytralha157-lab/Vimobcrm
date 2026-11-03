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
