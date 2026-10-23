# Mensagens pessoais salvas no WhatsApp — candidato local

Trabalho no checkout principal `D:/Vimob/workspaces/vimob-crm`, branch `main`, HEAD de referência `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Não houve publicação, envio a leads, migração remota ou alteração de produção. O banco usado nos testes é o cluster descartável com DDL e dados sintéticos em `127.0.0.1:57922/vimob_whatsapp_clone`; não é o túnel nem a API publicados.

## Uso

1. Escreva uma mensagem na barra da conversa e abra **Mensagens salvas** pelo ícone de marcador.
2. Escolha **Salvar mensagem atual**, informe o atalho e salve. O rascunho continua no campo; salvar não envia.
3. Em qualquer outra conversa, digite `/` para abrir a lista. `/a`, `/ab`, `/aba` e `/abe` filtram imediatamente por início do atalho ou da frase, sem HTTP por letra.
4. Escolha pela lista ou pelas setas e Enter. A escolha apenas insere no rascunho; o envio continua sendo um gesto separado. É possível inserir vários atalhos na mesma mensagem, editar, revisar e depois enviar.
5. O mesmo painel permite editar ou excluir as próprias mensagens. Escape fecha a lista/painel; Shift+Enter continua criando linha e Enter durante composição IME não envia.

O compositor é compartilhado por Conversas e pelo balão. O painel usa texto principal de 12 px/peso 300, auxiliares de 11 px, controles de 32 px, cantos de 6 px nos controles e 8 px no painel. Mantém superfícies neutras, laranja do produto no hover e ação de salvar em laranja a 50%. Não altera as fontes dos balões, timestamps, mídia ou a geometria aprovada do chat.

## Persistência e limites

- Os itens pertencem ao usuário autenticado **dentro da organização ativa**, e não à conversa ou ao responsável do lead. Colegas não recebem esses textos.
- Até 200 mensagens por usuário/organização; cada texto tem até 4.000 pontos de código Unicode. Atalho normalizado de 1 a 40 caracteres ASCII: letras, números, hífen ou sublinhado, começando por letra/número. Uma barra inicial é opcional; espaços externos do atalho são removidos e letras ASCII passam para minúsculas.
- O conteúdo é literal: preserva espaços, quebras, emojis e sequências como `{nome}` ou `$&`. Não há expansão de variáveis. Branco, NUL e Unicode inválido são rejeitados no cliente; a API também valida o conteúdo.
- Persistência em `private.whatsapp_quick_replies`; não usa localStorage nem os templates compartilhados `whatsapp_message_templates`.
- O browser recebe somente `id`, `shortcut`, `content`, `created_at` e `updated_at`. O corpo de criação não aceita `user_id`, `organization_id`, IDs ou slots internos.

## Contrato e segurança

| Método/rota | Permissão | Resultado |
| --- | --- | --- |
| `GET /v1/whatsapp/quick-replies` | `whatsapp_view` e módulo ativo | Lista pessoal ordenada por atalho, máximo 200 |
| `POST /v1/whatsapp/quick-replies` | `whatsapp_operate` e módulo ativo | Cria `{shortcut, content}`, retorna 201 |
| `PATCH /v1/whatsapp/quick-replies/{id}` | `whatsapp_operate` e módulo ativo | Altera pelo menos um campo não nulo, retorna 200 |
| `DELETE /v1/whatsapp/quick-replies/{id}` | `whatsapp_operate` e módulo ativo | Exclui o próprio item, retorna 204 vazio |

Todas as rotas passam pelos gates ativos existentes de JWT, tenant, módulo e permissão. Organização e usuário vêm do contexto autorizado. Todo SELECT/UPDATE/DELETE filtra organização e usuário; edição/exclusão de ID alheio retornam o mesmo 404 de item inexistente. Respostas têm `Cache-Control: no-store`; detalhes SQL e textos pessoais não são encaminhados ao logger genérico.

A tabela privada tem RLS e FORCE RLS, nenhuma política para browser e nenhum grant para `anon`/`authenticated`. Somente o papel de backend recebe CRUD. O limite usa advisory lock por proprietário em transação e slot único de 1 a 200, incluindo limite duro no banco. Identidade, proprietário e slot são imutáveis. Índices cobrem as FKs de organização, usuário e associação à organização.

O React Query usa organização, usuário, escopo e sessão na chave; consultas são compartilhadas entre as superfícies. Troca de organização/usuário/sessão aposenta respostas, mutações e painéis antigos, inclusive A→B→A. Resposta atrasada não substitui texto da nova conversa. Falha de leitura ou gravação é visível, com tentativa explícita; não há sucesso simulado quando a API não possui a rota. A lista se filtra em memória, sem consulta por tecla.

## Arquivos

- UI: `components/features/whatsapp/quick-replies/`, `ScopedMessageBox.tsx` e `hooks/whatsapp/use-quick-reply-composer.tsx`.
- Modelo puro: `lib/whatsapp-quick-reply-input.ts`; transporte/validação/cache em `lib/api/whatsapp-quick-replies.ts`, `lib/validation/whatsapp-quick-replies.ts` e `hooks/whatsapp/use-whatsapp-quick-replies.ts`.
- Servidor: `apps/api/internal/whatsapp/quick_replies*.go`, quatro registros em `apps/api/internal/app/routes.go`.
- Schema: `supabase/migrations/20261014211659_whatsapp_personal_quick_replies.sql`, registro próprio no source lock e `supabase/tests/whatsapp_personal_quick_replies.test.sql`.
- Contrato público interno: quatro operações e schemas em `packages/contracts/openapi/v1.yaml`. Esse registro legado já supera 800 linhas; cresceu somente para documentar a interface nova no catálogo existente. Uma futura divisão por domínio deve preservar os consumidores do documento; não foi feita refatoração incidental.

## Verificação

**69 testes focados aprovados, zero falhas e zero skips.** Contagem por teste de topo, sem somar subcasos novamente:

| Grupo | PASS | Prova |
| --- | ---: | --- |
| Modelo de filtro, cursor e inserção literal | 5 | `whatsapp-quick-replies-20261014/root/input-model-final.log` |
| API/Zod/React Query, proprietário, sessão e respostas atrasadas | 16 | `whatsapp-personal-quick-replies-20261014/data/runtime.log` |
| UI, regressões do compositor e página/balão reais | 37 | `whatsapp-quick-replies-20261014/ui/final-37.log` |
| Go, persistência/concorrência com banco e gates de rota | 11 | `whatsapp-personal-quick-replies-20261014/backend/proof.json` |

Os 37 incluem 18 casos de UI nova, sete regressões do compositor e 12 combinações das superfícies reais: página/balão × 320/390/1440 px × claro/escuro. Confirmam salvar, editar, excluir, prefixos progressivos, inserção sem envio, seleção/cursor, IME, tentativa após falha, rascunho preservado, formulário mantido ao clicar fora, scroll da opção selecionada, troca de contexto e gravador sem remontagem. As capturas de página em 320 px/claro e balão em 390 px/escuro foram inspecionadas visualmente.

Dos 11 Go, dois exercitam o banco real descartável: dois usuários, duas organizações, HTTP/repositório/persistência e oito gravações concorrentes disputando a vaga 200. O teste SQL separado também passou com CRUD sob `service_role`, recusa real de `anon`/`authenticated`, constraints e rollback. Duas primeiras execuções tiveram falha de tempo somente na limpeza das fixtures, preservadas como RED; a limpeza foi dividida por dependência com contexto fresco e tempos registrados, mantendo todas as asserções. Os resíduos desses REDs foram conferidos e removidos por IDs sintéticos exatos: zero organizações, perfis, auth, memberships ou mensagens dessas fixtures restantes. O cluster iniciado nesta rodada foi encerrado e a porta 57922 deixou de escutar.

`npm run typecheck` passou na versão final. `npm run lint` passou com zero erros e três warnings preexistentes em testes de propriedades; lint focal passou sem avisos. O verificador de migrations passou com 222 migrations; somente o registro novo foi acrescentado e os 221 anteriores foram preservados. Os 24 arquivos comuns aos manifestos das provas mantiveram os hashes finais.

O catálogo OpenAPI foi ampliado e validado como YAML. As quatro rotas novas foram acrescentadas ao router e o contrato anterior permaneceu semanticamente igual. A suíte ampliada teve **50 passados e duas falhas preexistentes**, reproduzidas identicamente com os snapshots anteriores do YAML/router por adaptador somente leitura, sem substituir arquivos do checkout: projeção de campos de imóveis e conflito de revisão de equipes. Não foram alteradas nesta tarefa. A outra suíte com falhas anteriores, de mídia, está detalhada abaixo; portanto o repositório inteiro não é declarado verde.

Resultados finais, logs e hashes da rodada ficam em `D:/Vimob/tmp/whatsapp-quick-replies-20261014/` e `D:/Vimob/tmp/whatsapp-personal-quick-replies-20261014/`. A prova SQL usa transação com rollback; Go usa somente fixtures sintéticas e limpa suas linhas. Não contar testes DB pulados na rodada sem opt-in como aprovados: apenas a execução local explicitamente habilitada comprova persistência e concorrência.

As fixtures de browser exercitam React/React Query, textarea, UI e CSS reais com fronteiras de autenticação/HTTP/microfone sintéticas e rede externa bloqueada. Não equivalem a uma sessão autenticada completa com provedor real, Safari, PWA ou aparelho físico. A família Geist servida por `next/font` não é baixada pelo harness; tamanhos, pesos e geometria vêm do CSS do produto.

Repetição dos testes de browser/modelo e gates locais:

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/whatsapp-quick-reply-input.test.mts
node --test hooks/whatsapp/use-whatsapp-quick-replies.runtime.test.mjs
node --test --test-concurrency=1 components/features/whatsapp/quick-replies/quick-replies-ui.runtime.test.mjs components/features/whatsapp/quick-replies/quick-replies-surfaces.runtime.test.mjs components/features/whatsapp/scoped-message-box.runtime.test.mjs
npm run typecheck
npm run lint
node scripts/supabase/verify-migrations.mjs
```

Para repetir Go/SQL com banco, primeiro revalidar o cluster descartável e reabrir somente ele. Os runners e o opt-in explícito estão em `whatsapp-personal-quick-replies-20261014/backend/run-go-proof.mjs` e `run-sql-proof.mjs`; sem opt-in os testes DB são pulados. Não apontar esses runners para banco remoto nem reutilizar credenciais de produção. A prova consolidada é `whatsapp-quick-replies-20261014/root/closure-proof.json`.

## Publicação futura e reversão

A migração é aditiva e compatível com a API anterior. Quando houver autorização de release, aplicar a migração pela trilha de cutover apropriada, depois API e frontend da mesma versão. O bloqueio de `supabase db push` descrito em `supabase/README.md` permanece. Uma prévia que consulta a API publicada antiga pode retornar 404 para o recurso novo; editar o frontend local não publica as rotas nem a tabela.

Para reverter, retirar seletivamente a integração do compositor e as quatro rotas novas, preservando as demais mudanças locais. Conservar a tabela aditiva para não apagar mensagens pessoais; eventual remoção exige decisão explícita de retenção. Snapshots desta rodada ficam em `root/before/`. Não restaurar arquivos inteiros nem executar reset no checkout com trabalho preexistente.

## Ajuste do aviso de envio da rodada anterior

`MessageBubble.tsx` remove os três botões inline de mensagens definitivamente não enviadas e mostra o aviso em 10 px, peso 300 e linha de 14 px. A alteração vale para página e balão, preserva o motivo da falha e o menu existente de copiar/dados. O fluxo distinto de envio ainda não confirmado continua permitindo verificação.

Provas em `D:/Vimob/tmp/whatsapp-failure-notice-20261014/`: quatro testes integrados, oito combinações página/balão e 320/1440 px aprovadas. A suíte de mídia teve 31 passados e duas falhas reproduzidas no snapshot anterior e no candidato: contador de scroll do histórico e fallback de áudio obsoleto. Elas estão registradas em `independent/proof.json`; nenhum teste foi removido ou enfraquecido para ocultá-las.
