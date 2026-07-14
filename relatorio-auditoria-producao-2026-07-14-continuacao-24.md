# Relatorio de auditoria em producao - Continuacao 24

Data: 2026-07-14
Modulo auditado: Financeiro
Ambiente: https://app.vimobcrm.com.br
Perfis: administrador e usuario padrao
Modo: navegador em producao, sem testes locais

## Resumo executivo

O modulo Financeiro foi auditado com o perfil administrador e comparado com acesso direto pelo usuario padrao. Nenhum formulario foi salvo, nenhum export foi acionado, nenhuma regra foi criada, nenhum grupo de DRE foi inicializado e nenhuma configuracao foi alterada.

Achado principal: o usuario padrao, mesmo sem o item Financeiro no menu lateral, conseguiu acessar por URL direta todas as rotas financeiras administrativas testadas. Isso inclui dashboard financeiro, contas, contratos, comissoes, relatorios, DRE, botoes de exportacao e formularios de criacao de lancamento, contrato e regra de comissao.

## Achados

### CRITICO - Usuario padrao acessa rotas financeiras administrativas por URL direta

Evidencias:
- `EVID-PROD-STD-FINANCIAL-DIRECT-DASHBOARD-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-CONTAS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-CONTRATOS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-COMISSOES-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-RELATORIOS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-DRE-024.png`
- `EVID-PROD-STD-FINANCIAL-CONTAS-NOVO-LANCAMENTO-024.png`
- `EVID-PROD-STD-FINANCIAL-CONTRATOS-NOVO-CONTRATO-024.png`
- `EVID-PROD-STD-FINANCIAL-COMISSOES-NOVA-REGRA-024.png`

Comportamento observado:
- O menu do usuario padrao nao exibe Financeiro como area principal.
- Mesmo assim, as URLs `/financeiro`, `/financeiro/contas`, `/financeiro/contratos`, `/financeiro/comissoes`, `/financeiro/relatorios` e `/financeiro/dre` carregam conteudo financeiro administrativo.
- O usuario padrao visualiza dados financeiros, tabelas, filtros, botoes de exportacao e botoes de criacao.
- O usuario padrao conseguiu abrir, sem salvar, os modais `Novo Lancamento`, `Novo Contrato` e `Nova Regra`.
- A rota `/financeiro/dre` expoe os botoes Excel, PDF e Inicializar Grupos do DRE ao usuario padrao.

Impacto:
- Exposicao de dados financeiros sensiveis por bypass de UI.
- Possibilidade aparente de criar ou preparar registros financeiros por perfil sem permissao esperada.
- Possibilidade aparente de exportar relatorios financeiros por perfil padrao.
- Risco de alteracao indevida de configuracao do DRE se a acao de inicializacao nao for protegida no backend.

Recomendacao:
- Aplicar checagem server-side e client-side por permissao em todas as rotas `/financeiro/*`.
- O usuario padrao deveria acessar somente a visao permitida, por exemplo `/financeiro/corretor`, se aplicavel.
- Esconder botoes nao e suficiente; bloquear carregamento de dados e mutacoes no backend/API/Supabase RLS.
- Validar tambem os endpoints/mutations de criacao, exportacao e inicializacao de DRE.

### ALTO - Botoes de exportacao e inicializacao aparecem em contexto sensivel

Evidencias:
- `EVID-PROD-ADM-FINANCIAL-DRE-RELATORIO-CARREGADO-024.png`
- `EVID-PROD-ADM-FINANCIAL-DRE-CONFIGURACAO-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-DRE-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-RELATORIOS-024.png`

Comportamento observado:
- DRE exibe Excel, PDF e Inicializar Grupos do DRE.
- Relatorios exibem CSV e Excel.
- Os botoes nao foram clicados por seguranca da auditoria.

Risco:
- Caso os handlers nao tenham autorizacao forte, dados financeiros podem ser exportados ou configuracoes podem ser alteradas por perfil indevido.

### MEDIO - Rotas de Relatorios e DRE apresentaram estado inicial em branco durante hidratacao

Evidencias:
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-RETORNO-024.png`
- `EVID-PROD-ADM-FINANCIAL-DRE-RETORNO-024.png`
- `EVID-PROD-ADM-FINANCIAL-DRE-RELATORIO-CARREGADO-024.png`

Comportamento observado:
- Ao abrir `/financeiro/relatorios` e `/financeiro/dre`, a primeira leitura do DOM veio vazia.
- A interface carregou apos espera adicional.

Impacto:
- Percepcao de tela em branco, risco de automacao/teste instavel e UX degradada em conexoes lentas.

### BAIXO - Avisos de grafico com dimensao invalida no console

Console:
- `The width(-1) and height(-1) of chart should be greater than 0...`

Contexto:
- Avisos apareceram durante uso do dashboard financeiro/graficos.
- Nao houve erro fatal observado.

Recomendacao:
- Garantir `minWidth`/`minHeight` ou container estavel para os graficos antes da renderizacao.

## Cobertura com administrador

Rotas auditadas:
- `/financeiro`
- `/financeiro/contas`
- `/financeiro/contratos`
- `/financeiro/comissoes`
- `/financeiro/relatorios`
- `/financeiro/dre`
- `/financeiro/corretor`

Fluxos validados sem gravar dados:
- Dashboard financeiro e KPIs.
- Contas: filtros, busca e modal `Novo Lancamento`.
- Contratos: filtros, busca e modal `Novo Contrato`.
- Contratos: abas Geral, Imovel, Valores, Corretores e Datas.
- Contratos: botao local `Adicionar` em Corretores, sem salvar.
- Comissoes: abas Previstas, Liberadas, Aprovadas, Pagas e Regras.
- Comissoes: modal `Nova Regra`, sem salvar.
- Relatorios: Fechamento Mensal, Fluxo de Caixa, Comissoes por Corretor, Receita por Imovel, Pagamentos Realizados e Pendencias Financeiras.
- DRE: filtros, aba Relatorio, aba Configuracao e botoes de inicializacao/exportacao visiveis, sem clique.
- Meu Financeiro: visao de corretor.

## Evidencias principais do administrador

- `EVID-PROD-ADM-FINANCIAL-CONTAS-NOVO-LANCAMENTO-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTAS-SEARCH-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-IMOVEL-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-VALORES-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-CORRETORES-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-CORRETORES-ADICIONAR-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-NOVO-CONTRATO-DATAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-CONTRATOS-SEARCH-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-PREVISTAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-LIBERADAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-APROVADAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-PAGAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-REGRAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-COMISSOES-NOVA-REGRA-024.png`
- `EVID-PROD-ADM-FINANCIAL-MINHAS-COMISSOES-024.png`
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-FLUXO-CAIXA-024.png`
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-COMISSOES-CORRETOR-024.png`
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-RECEITA-IMOVEL-024.png`
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-PAGAMENTOS-REALIZADOS-024.png`
- `EVID-PROD-ADM-FINANCIAL-RELATORIOS-PENDENCIAS-FINANCEIRAS-024.png`
- `EVID-PROD-ADM-FINANCIAL-DRE-RELATORIO-CARREGADO-024.png`
- `EVID-PROD-ADM-FINANCIAL-DRE-CONFIGURACAO-024.png`

## Evidencias principais do usuario padrao

- `EVID-PROD-STD-FINANCIAL-DASHBOARD-AUTH-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-DASHBOARD-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-CONTAS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-CONTRATOS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-COMISSOES-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-RELATORIOS-024.png`
- `EVID-PROD-STD-FINANCIAL-DIRECT-DRE-024.png`
- `EVID-PROD-STD-FINANCIAL-CONTAS-NOVO-LANCAMENTO-024.png`
- `EVID-PROD-STD-FINANCIAL-CONTRATOS-NOVO-CONTRATO-024.png`
- `EVID-PROD-STD-FINANCIAL-COMISSOES-NOVA-REGRA-024.png`
- `EVID-PROD-STD-FINANCIAL-CORRETOR-024.png`

## Acoes explicitamente nao executadas

- Nao cliquei em Exportar, CSV, Excel ou PDF.
- Nao cliquei em Inicializar Grupos do DRE nem Inicializar Grupos Padrao.
- Nao salvei `Novo Lancamento`, `Novo Contrato` ou `Nova Regra`.
- Nao marquei notificacoes push.
- Nao alterei filtros persistentes, preferencias, dados financeiros ou permissoes.
- Nao registrei credenciais, emails completos, chaves ou cookies neste relatorio.

## Conclusao

O Financeiro esta funcional para administrador, mas a protecao por perfil esta insuficiente. O problema mais urgente e impedir que o usuario padrao acesse rotas administrativas por URL direta e garantir que dados, exportacoes e mutacoes financeiras sejam validados no servidor e no banco, nao apenas pelo menu da interface.
