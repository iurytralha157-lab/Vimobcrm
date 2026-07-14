# Relatório de Auditoria em Produção - Continuação 34

Data: 2026-07-14
Ambiente: Produção, navegador
Escopo: topo global, notificações, aviso de atualização, prompt de push, menu de perfil, guia de configuração, novidades e seletor de organização.
Perfis: administrador e usuário padrão.

## Resumo

Foram auditados os controles transversais do cabeçalho em produção. A sessão terminou novamente autenticada como administrador.

Não foram acionadas ações que alteram estado, como ativar push no navegador, marcar notificações como lidas, arquivar novidades, concluir etapas do guia, reiniciar guia, ocultar guia automaticamente ou abrir documentos externos.

Total geral de evidências após esta rodada: 306 arquivos PNG.

## Evidências válidas

- `EVID-PROD-ADM-TOPO-DASHBOARD-PROMPT-NOTIFICACOES-034.png`
- `EVID-PROD-ADM-NOTIFICACOES-PAINEL-034.png`
- `EVID-PROD-ADM-PERFIL-MENU-REDO-034.png`
- `EVID-PROD-ADM-PERFIL-GUIA-CONFIGURACAO-REDO-034.png`
- `EVID-PROD-ADM-PERFIL-NOVIDADES-REDO-034.png`
- `EVID-PROD-ADM-ORGANIZACAO-MENU-REDO-034.png`
- `EVID-PROD-STD-TOPO-DASHBOARD-PROMPT-NOTIFICACOES-034.png`
- `EVID-PROD-STD-NOTIFICACOES-PAINEL-034.png`
- `EVID-PROD-STD-PERFIL-MENU-REDO-034.png`
- `EVID-PROD-STD-PERFIL-GUIA-CONFIGURACAO-034.png`
- `EVID-PROD-STD-PERFIL-GUIA-CONFIGURACAO-AUTO-034.png`
- `EVID-PROD-STD-PERFIL-NOVIDADES-034.png`
- `EVID-PROD-STD-ORGANIZACAO-AUSENTE-034.png`
- `EVID-PROD-ADM-RETORNO-SESSAO-FINAL-034.png`

## Resultado por área

### Aviso global e push

O aviso superior de atualização aparece para os dois perfis com chamada para novidades e guia de configuração. O prompt de push também aparece para ambos com CTA de ativação.

O CTA de push não foi acionado, pois isso altera permissão do navegador e estado da sessão. Nos logs, aparece a mensagem de que a inicialização push foi ignorada no ambiente web, então vale validar em ambiente controlado se o botão entrega feedback adequado quando a permissão não pode ser inicializada.

### Notificações

Administrador: o painel abre pelo contador no topo e lista notificações de novo lead atribuído. O painel mostra ações de marcar todas como lidas e ver todas. A ação de marcar como lida não foi clicada por alterar estado.

Usuário padrão: o painel abre pelo contador no topo e lista lembretes de agenda e lead atribuído. Também mostra as ações de marcar todas como lidas e ver todas, sem acionamento por segurança.

Achado: no painel do administrador aparecem textos de placeholder ou massa de teste em notificações de produção. Isso precisa ser limpo ou tratado na origem, pois passa percepção de ambiente não finalizado.

### Menu de perfil

Os dois perfis exibem o menu com Configurações, Guia de configuração, Novidades, versão v2.2.1 e Sair.

O acesso ao Guia de configuração e Novidades pelo menu foi validado nos dois perfis. Em Novidades há abas de novidades e arquivados, lista de oito itens ativos, conteúdo legal e ação de arquivar. A ação de arquivar não foi acionada.

### Guia de configuração

Administrador: o guia abre pelo menu e mostra 17 de 18 etapas concluídas, progresso de 94 por cento.

Usuário padrão: o guia abriu automaticamente após login e também abre pelo menu. Mostra 1 de 11 etapas concluídas, progresso de 9 por cento. A abertura automática pode ser intencional para onboarding, mas é intrusiva em auditoria de retorno ao dashboard e deve respeitar a opção de não mostrar automaticamente quando o usuário a escolher.

Não foram acionados concluir etapa, reiniciar guia ou não mostrar automaticamente.

### Organização e permissões

Administrador: o seletor de organização fica visível no topo e abre lista de organizações disponíveis, com a organização atual marcada.

Usuário padrão: o seletor de organização não fica visível no topo. Isso é coerente com menor permissão e evita troca de organização por perfil comum.

Comparação de navegação: o administrador vê mais módulos no menu lateral, incluindo Gestão, Automações e Financeiro. O usuário padrão vê um conjunto reduzido no topo e menu lateral, sem seletor de organização. A segregação visual de permissões se manteve nessa rodada.

## Achados

1. Médio - Notificações do administrador exibem placeholder ou dados de teste em produção.
2. Médio - Botões críticos do topo, como contador de notificações, perfil e organização, aparecem sem rótulo acessível descritivo em parte dos casos. Para leitor de tela, o botão de notificações pode virar apenas um número.
3. Baixo - Logs repetem avisos de gráficos com largura e altura zeradas ou negativas no dashboard.
4. Baixo - Prompt de push aparece, mas logs indicam inicialização push ignorada no ambiente web. Recomenda-se feedback explícito para o usuário antes de solicitar permissão.

## Limitações controladas

Não foram testados os botões que mudam estado de produção: ativar push, marcar notificações como lidas, arquivar novidade, concluir etapa, reiniciar guia, ocultar guia automaticamente e abrir documento externo.

Arena permaneceu fora do escopo, exceto por aparecer em menus e no texto do guia.
