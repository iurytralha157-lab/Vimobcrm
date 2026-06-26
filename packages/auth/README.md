# packages/auth

Pacote compartilhado para autenticacao server-side.

Implementa validacao de tokens do Supabase Auth por JWKS quando o projeto usa chaves assimetricas. Tambem aceita `SUPABASE_JWT_SECRET` como compatibilidade com projetos legados, mas essa secret deve existir apenas em ambiente server-side.

Autorizacao de produto nao deve usar `user_metadata`. Permissoes, organizacao e papeis devem vir de tabelas de dominio ou de `app_metadata` controlado pelo servidor.
