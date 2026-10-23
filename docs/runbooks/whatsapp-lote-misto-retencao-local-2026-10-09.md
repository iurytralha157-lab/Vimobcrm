# WhatsApp: retenção local de callback bruto misto

Estado em 2026-10-09: implementação **somente no checkout local**. A migração
foi exercitada no clone descartável `127.0.0.1:57323`; não houve aplicação
na base principal nem publicação da API ou da Edge Function.

## Problema observado

O ingress divide lotes pequenos em linhas individuais. Um callback com mais
de 128 mensagens pode permanecer como uma linha bruta. A retenção de sete dias
só conseguia substituir a linha inteira quando **todos** os membros pertenciam
à mesma conversa sem lead expirada. Um lote com mensagem de lead preservava
corretamente essa mensagem, mas também preservava o conteúdo já expirado.

## Regra implementada

A função `private.whatsapp_unlinked_mixed_inbox_plan` constrói a alteração a
partir da linha antiga, da conversa física e dos snapshots imutáveis. Ela só
retira membros de `data.messages` e os snapshots embutidos correspondentes se:

1. O array bruto e o array de snapshots têm mesma ordem, contagem e IDs únicos.
2. Cada snapshot embutido é idêntico ao snapshot SQL da mesma organização,
   sessão, evento e provider ID.
3. A mensagem pertence à conversa sem lead v1 expirada por `conversation_id`,
   por mensagem canônica do mesmo provider ID, ou por rota phone/JID e janela
   temporal sem época concorrente.
4. Nenhum membro preservado ou snapshot posterior depende, como predecessor,
   de um membro que seria removido.
5. O envelope é `data.messages`, com apenas os campos auxiliares esperados.

Se qualquer prova falhar, a linha permanece intacta e processável. Um lote
`data.Messages`, IDs ambíguos, épocas concorrentes ou uma cadeia de predecessor
sem solução automática exigem investigação separada; eles não são contados como
retidos com sucesso.

Com membros restantes, a linha mantém seu status anterior (`pending`, `retry`,
`dead` ou `processed`) e recebe um marcador de contagem sem conteúdo pessoal:
`{"__vimob_retention":{"kind":"partial_expired_unlinked_v1","redacted_count":N}}`.
Uma segunda época pode expirar depois; quando todos os membros restantes forem
provados, a linha vira o tombstone terminal existente. A inserção de inbox
remove um marcador `__vimob_retention` que venha do provedor. O Go ingress
preserva a prova SHA-256 dos bytes originais antes da sanitização para
reconhecer um replay legítimo sem restaurar o payload bruto.

O trabalhador marca outcomes das mensagens expiradas antes de remover seus
corpos. Isso fecha a cadeia de roteamento para futuros ingressos. A função
exclusiva antiga fica interna; `service_role` só pode chamar o trabalhador
combinado. A busca seleciona somente planos válidos e limita linhas alteradas
por ciclo.

## Evidência local

- Migração: `supabase/migrations/20261009033238_whatsapp_partial_mixed_batch_retention.sql`.
- pgTAP novo: `supabase/tests/whatsapp_unlinked_mixed_batch_partial_retention.test.sql`
  **31/31** no clone `57323`.
- Regressões existentes: `whatsapp_unlinked_raw_batch_retention.test.sql`
  **11/11**; `whatsapp_unlinked_epoch_retention.test.sql` **27/27**.
- Cenários: 129 membros com 128 expirados e um lead, quatro estados de inbox,
  duas épocas expirando em dias diferentes, `conversation_id` nulo com prova
  por rota ou mensagem canônica, replay sem reinserção, marcador forjado,
  predecessor dependente, envelope alternativo, tentativa de alteração direta
  do snapshot e rota phone ambígua.

Esses testes provam as transações SQL no clone. O ensaio HTTP/worker Go no
clone descartável `57325` também passou com lote misto de 129 membros:
removeu o único membro sem lead vencido, preservou os 128 de lead e reconheceu
o replay exato do callback original com `instanceToken` como duplicado, sem
reinserção. O source lock passou com 168 migrações não vazias. Ainda faltam
instalação integral da migração em um banco recém-criado e ensaio do Edge com
o mesmo lote misto. O Edge em execução passou para entrada sem lead, saída
externa e primeiro lead sem atendimento no projeto descartável, mas esse
ensaio não cobriu o lote de 129. Nenhum desses resultados representa o provedor
real.

## Limite para publicação

Não afirmar cobertura universal de limpeza em até sete dias enquanto houver
lotes fail-closed. É preciso medir quantos existem por organização/sessão,
identificar seu formato e decidir correção específica sem alterar lead nem
forçar descarte. Um `whatsapp_conversation_routing_head` existente também
bloqueia a retenção por proteger uma cadeia ativa; o cutover ou a investigação
precisa resolver esse vínculo antes da limpeza.
