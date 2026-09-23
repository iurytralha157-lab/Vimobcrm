# Dashboard de leads

O filtro de data seleciona leads pela entrada (`leads.created_at`). Os cards de total, em aberto, perdidos e ganhos mostram o estado atual dessa mesma coorte. O tempo até o ganho continua sendo a diferença entre `won_at` e `created_at`. O gráfico de evolução mantém sua série temporal própria de eventos.

O card de 1º contato usa a primeira resposta humana registrada em `leads.first_response_*`; a média não inclui leads sem medida humana válida. O detalhe sob demanda (`GET /v1/dashboard/first-contact`) agrupa pelo usuário que fez essa resposta e pela origem. Um lead transferido pode ter responsável atual diferente do autor do primeiro contato. O registro é gravado uma vez por lead: se uma automação o preenche antes da ação humana, essa ação posterior não aparece na média. `lead_action_facts` e ciclos de atribuição não cobrem todos os fluxos atuais, então não substituem esse campo como fonte completa. A base não recalcula uma média por ciclo após cada redistribuição.

Redistribuições concluídas vêm dos logs de redistribuição automática da fila e do histórico de saídas do pool. O total e os números de saída e recebimento por corretor contam leads distintos; o total de movimentações conta eventos e pode ser maior. Registros históricos sem origem e destino confiáveis ficam fora dessas contagens.

Leads por corretor usa o responsável atual e todos os filtros. Leads por equipe atribui cada lead às equipes ativas desse responsável, inclusive quando o lead entrou por atribuição direta ou outra fila; esse bloco ignora apenas o filtro global de equipe. Um corretor em várias equipes pode fazer o mesmo lead aparecer em cada uma delas. A escolha de equipes exibidas é uma preferência local por usuário e organização, fora do filtro global.

As consultas respeitam o escopo de visibilidade do usuário. O detalhamento do 1º contato e a distribuição por corretor/equipe estão disponíveis a proprietários, administradores e líderes de equipe. A interface usa barras com rolagem horizontal no mobile e não busca detalhes individuais de leads no popup de 1º contato.
