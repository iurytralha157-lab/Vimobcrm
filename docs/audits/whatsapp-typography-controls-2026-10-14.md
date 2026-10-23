# Referências de tipografia e controles do WhatsApp

Leitura e ajuste no checkout principal `D:/Vimob/workspaces/vimob-crm`. Esta nota identifica as referências que já existem no projeto; não substitui o CSS por um manual novo. Não foi encontrado um `DESIGN_SYSTEM.md`, `UI_STANDARDS.md` ou manual dedicado de tipografia na pesquisa local.

## Fontes de autoridade

- `app/layout.tsx:2–13` declara Geist e Geist Mono via `next/font`, com as variáveis `--font-geist-sans` e `--font-geist-mono`. `app/globals.css:340–347` mapeia as famílias e usa a fonte sans no corpo. Isso prova a configuração da fonte; o harness isolado não comprova o carregamento do arquivo Geist numa sessão autenticada do aplicativo.
- `app/globals.css:72–83` define tamanhos, pesos e alturas de linha do produto. As regras de `.app-shell` em `418–466` mostram o peso aplicado de fato aos elementos e classes semânticas.
- `config/filter-ui.ts:4–10` fornece controles compactos: gatilho com 32px de altura, raio 6px e texto 11px/300; controle e opções com texto 12px/300 e raio 6px.
- `config/form-wizard.ts:6` contém uma ação primária existente com `bg-primary/50`, texto 12px/300 e raio 6px. O `/50` altera a transparência do fundo laranja, mantendo texto e ícones legíveis; não equivale a reduzir a opacidade do botão inteiro.
- `app/globals.css:489–501` aplica superfície, borda zero, raio 8px e peso 300 aos popups/diálogos; os controles internos usam raio 6px.
- `docs/audits/home-design-debt.md:24–30` é um relatório heurístico com a direção visual de blocos 8px, controles 6px e microelementos 4px. Ele avisa que não substitui inspeção renderizada. Sua frase geral sobre títulos 400 não descreve todos os títulos semânticos atuais: as classes de seção e card no CSS usam 300.

## Padrão aplicado pelo CSS

Os tamanhos abaixo consideram a base usual de 16px. O harness verifica os pixels computados dos controles alterados.

| Uso | Tamanho | Peso | Referência |
| --- | ---: | ---: | --- |
| Título de página (`app-page-title`) | 18px | 400 | `app/globals.css:440–443` |
| Título de seção (`app-section-title`) | 16px | 300 | `app/globals.css:447–450` |
| Título de card (`app-card-title`) | 14px | 300 | `app/globals.css:454–457` |
| Corpo do produto | 14px | 300 | `--app-font-size-body`, `--app-font-weight-body` |
| Texto auxiliar (`app-caption`) | 12px | 300 | `app/globals.css:461–464` |
| Controles compactos | 11–12px | 300 | `config/filter-ui.ts` |
| Ênfase explícita | conforme contexto | 400 | `--app-font-weight-emphasis` |
| Destaques reservados | conforme contexto | 500/600 | `--app-font-weight-strong/display` |

As classes `font-thin`, `font-extralight`, `font-light` e `font-normal` dentro de `.app-shell` são normalizadas para o token 300 com `!important`. Portanto, acrescentar uma classe de peso menor por si só pode não mudar a aparência. O corpo das mensagens WhatsApp em peso 200 é uma exceção solicitada explicitamente nesta rodada, implementada pelo responsável do balão; este ajuste dos controles preserva essa decisão.

## Busca e mensagens anteriores

`ConversationHistorySearch` é compartilhado pelo widget flutuante, pela página de Conversas e pelo histórico do lead. O campo agora usa o token de caption (12px), peso 300, altura 32px e raio 6px. O bloco e o campo não têm borda colorida; o foco não acrescenta ring preto/laranja, inclusive dentro do diálogo. O hint “Digite o texto que deseja encontrar.” foi removido. Continuam disponíveis o placeholder, rótulos acessíveis, resultado, erro, busca adicional e navegação com ID canônico, sessão e conversa. A região `aria-live` permanece montada e vazia antes da busca, sem margem vazia, para receber as atualizações de status.

`LoadOlderMessagesButton` centraliza o mesmo controle nas três superfícies: texto 11px/300, altura 32px, raio 6px, fundo primário laranja com 50% de transparência e hover 70% conforme o padrão existente. A espera desabilita o botão, mostra o spinner e informa `aria-busy`. Os callbacks de paginação, preservação de scroll, mensagens de erro e guardas de escopo dos consumidores continuam iguais.

## Prova local e limites

`components/features/whatsapp/conversations/history-controls-ui.runtime.test.mjs` renderiza os controles e primitives reais com o CSS do produto compilado, usando Chromium isolado e callbacks sintéticos. Sete casos passaram, sem skips ou tentativas de rede: largura 390/1440, temas claro/escuro, shell/diálogo, geometria, ausência de borda/ring visível, remoção do hint, buscas vazias/em andamento, navegação canônica, erros, alpha 50% e paginação em espera/retry. A geometria/foco percorre oito combinações de host, tema e contexto.

O teste contra os bytes anteriores reproduziu duas falhas esperadas: campo com 16px/40px e ring visível, e hint presente. O primeiro teste novo comparava uma sombra literalmente `none`; o Tailwind mantém uma lista de sombras com extensão zero e um outline transparente. Essa assertiva foi corrigida para verificar ausência visível, sem aceitar sombra com extensão positiva. Os logs anteriores foram preservados.

Evidências, bytes anteriores e hashes ficam em `D:/Vimob/tmp/whatsapp-typography-controls-20261014/mac/manifest.json`. Esta prova é dos controles compartilhados e seus callbacks; não representa uma navegação autenticada completa nas três superfícies, uma sessão WhatsApp nativa, fila, banco ou produção. Os ajustes de mídia/menu e os gates globais têm validação coordenada separadamente.
