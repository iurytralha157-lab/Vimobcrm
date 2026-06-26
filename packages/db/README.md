# packages/db

Pacote compartilhado para conexao com Postgres.

O backend deve acessar o Supabase Postgres via `DATABASE_URL` usando pool de conexoes. Para deploy em VM/container persistente, preferir conexao direta quando a rede permitir; se o ambiente for IPv4-only ou serverless, usar pooler conforme a configuracao do Supabase.
