# Relatorio de auditoria funcional - Continuacao 25

Data: 2026-07-14
Ambiente: producao - app.vimobcrm.com.br
Modulo auditado nesta continuacao: Imoveis
Perfis usados: usuario padrao e administrador
Navegador: navegador in-app controlado pelo Codex
Escopo excluido: Arena, conforme regra inicial

## Resumo executivo

Esta continuacao cobriu a area de Imoveis em producao, comparando usuario padrao e administrador sem alterar dados reais. Foram registradas 63 evidencias de listagens, filtros, formularios, abas, rotas auxiliares, menus de card e modais.

O achado mais importante e de permissao: o usuario padrao conseguiu abrir o historico e o formulario de edicao de um imovel de auditoria cujo responsavel pela captacao exibido era outro usuario. A tela de novo imovel tambem informa que apenas administradores e o responsavel pela captacao poderiam editar depois, mas o usuario padrao viu o botao Salvar habilitado no formulario de edicao, alem das abas Publicacao, Comissoes e Confidencial. Nao foi acionado Salvar para evitar alteracao em producao.

Nenhum registro foi criado, editado, excluido, publicado, despublicado, importado, exportado ou enviado. Todos os testes que envolveriam persistencia real ficaram bloqueados por seguranca.

## Cobertura desta rodada

- Evidencias criadas: 63 arquivos PNG.
- Perfil padrao: listagem, busca, filtros avancados, filtro por valor, limpar filtros, visualizar card, historico, menu de card, formulario de edicao, todas as 10 abas de edicao, formulario de novo imovel, todas as 10 abas de novo imovel, rotas auxiliares, modais de proprietario, cidade, bairro e condominio.
- Administrador: listagem, busca do imovel de auditoria, menu de card, formulario de edicao, formulario de novo imovel, todas as 10 abas de novo imovel, rotas auxiliares, modais de proprietario, cidade, bairro e condominio.
- Nao testado por seguranca: salvar, cadastrar, excluir, voltar disponibilidade, publicar, despublicar, upload de midia, envio de aviso, alteracao de status e qualquer acao de persistencia.

## Achados principais

### IMOV-STD-SEC-001

Modulo: Imoveis
Funcionalidade: Edicao de imovel de outro responsavel
Perfil: Usuario padrao
URL: /properties/9b162c8e-7ee3-48b2-8962-51bb8564d197/edit
Status: FALHOU
Severidade: CRITICO
Evidencias: EVID-PROD-STD-PROPERTIES-CARD-MENU-025.png, EVID-PROD-STD-PROPERTIES-EDIT-FORM-025.png, EVID-PROD-STD-PROPERTIES-EDIT-PROPRIETARIO-025.png, EVID-PROD-STD-PROPERTIES-EDIT-CONFIDENCIAL-025.png

Resultado encontrado: o usuario padrao visualizou a acao Editar no menu do card e abriu o formulario completo de edicao de um imovel cujo responsavel pela captacao exibido era outro usuario. O botao Salvar estava visivel e habilitado, e as abas Publicacao, Comissoes e Confidencial estavam acessiveis.

Resultado esperado: se a regra exibida na propria tela for valida, apenas administradores e o responsavel pela captacao deveriam editar o imovel. O usuario padrao nao deveria ver ou abrir edicao de registro de outro responsavel.

Persistencia apos atualizar: nao testada, pois salvar alteraria dados de producao.
Impacto: risco de acesso indevido, edicao indevida e exposicao de informacoes sensiveis do imovel.

### IMOV-STD-SEC-002

Modulo: Imoveis
Funcionalidade: Historico do imovel
Perfil: Usuario padrao
URL: /properties
Status: FALHOU
Severidade: ALTO
Evidencia: EVID-PROD-STD-PROPERTIES-HISTORY-025.png

Resultado encontrado: o usuario padrao abriu Historico de um imovel associado a outro responsavel e visualizou eventos/atores de auditoria do registro.

Resultado esperado: se o usuario padrao deve operar apenas seus proprios registros ou dados permitidos, o historico de outro responsavel deveria ser bloqueado ou filtrado.

Persistencia apos atualizar: nao aplicavel.
Impacto: exposicao de trilha operacional e eventos internos.

### IMOV-STD-SEC-003

Modulo: Imoveis
Funcionalidade: Cadastros auxiliares por URL direta
Perfil: Usuario padrao
URLs: /properties/owners, /properties/locations, /properties/condominiums, /properties/rentals
Status: PARCIAL
Severidade: ALTO
Evidencias: EVID-PROD-STD-PROPERTIES-OWNERS-025.png, EVID-PROD-STD-PROPERTIES-LOCATIONS-025.png, EVID-PROD-STD-PROPERTIES-CONDOMINIUMS-025.png, EVID-PROD-STD-PROPERTIES-OWNERS-NEW-MODAL-025.png, EVID-PROD-STD-PROPERTIES-LOCATIONS-NEW-CITY-MODAL-025.png, EVID-PROD-STD-PROPERTIES-LOCATIONS-NEW-BAIRRO-MODAL-025.png, EVID-PROD-STD-PROPERTIES-CONDOMINIUMS-NEW-MODAL-025.png

Resultado encontrado: o usuario padrao acessou rotas auxiliares e viu botoes de criacao: Novo proprietario, Nova cidade, Novo bairro e Novo condominio. Os modais abriram com campos e botoes Salvar/Cadastrar.

Resultado esperado: precisa ser confirmado pela regra de negocio. Se cadastros auxiliares forem administrativos, a tela e os botoes nao deveriam estar disponiveis para usuario padrao.

Persistencia apos atualizar: nao testada, pois cadastrar alteraria producao.
Impacto: risco de criacao indevida de cadastros estruturais da carteira.

### IMOV-STD-DATA-004

Modulo: Imoveis
Funcionalidade: Visibilidade da carteira completa
Perfil: Usuario padrao
URL: /properties
Status: PARCIAL
Severidade: ALTO
Evidencias: EVID-PROD-STD-PROPERTIES-LIST-025.png, EVID-PROD-STD-PROPERTIES-ADVANCED-FILTERS-025.png

Resultado encontrado: o usuario padrao visualizou 533 imoveis, filtros amplos e filtro por responsavel. Tambem conseguiu localizar e abrir um imovel de auditoria associado a outro responsavel.

Resultado esperado: se usuario padrao deve ver apenas registros atribuidos a ele, a listagem e os filtros estao amplos demais.

Persistencia apos atualizar: nao aplicavel.
Impacto: risco de exposicao de dados operacionais da carteira completa.

### IMOV-ADM-CMP-005

Modulo: Imoveis
Funcionalidade: Comparacao de menu de card
Perfis: Usuario padrao e administrador
Status: APROVADO COM OBSERVACAO
Severidade: MEDIA
Evidencias: EVID-PROD-STD-PROPERTIES-CARD-MENU-025.png, EVID-PROD-ADM-PROPERTIES-CARD-MENU-025.png

Resultado encontrado: o administrador viu Visualizar, Historico, Editar, Voltar disponivel e Excluir. O usuario padrao viu Visualizar, Historico, Editar e Voltar disponivel, sem Excluir.

Resultado esperado: diferenca de Excluir esta correta para um perfil padrao, mas Editar, Historico e Voltar disponivel precisam de revisao conforme permissoes esperadas.

### IMOV-FORM-006

Modulo: Imoveis
Funcionalidade: Novo imovel e abas do formulario
Perfis: usuario padrao e administrador
Status: APROVADO PARA NAVEGACAO, BLOQUEADO PARA PERSISTENCIA
Severidade: MEDIA
Evidencias: EVID-PROD-STD-PROPERTIES-NEW-FORM-025.png ate EVID-PROD-STD-PROPERTIES-NEW-CONFIDENCIAL-025.png; EVID-PROD-ADM-PROPERTIES-NEW-FORM-025.png ate EVID-PROD-ADM-PROPERTIES-NEW-CONFIDENCIAL-025.png

Resultado encontrado: ambos os perfis abriram o formulario de novo imovel e todas as abas: Proprietario, Dados do imovel, Localizacao, Valores, Caracteristicas, Extras, Midia e descricoes, Publicacao, Comissoes e Confidencial.

Resultado esperado: administrador deve ter acesso completo. Para usuario padrao, confirmar se Publicacao, Comissoes e Confidencial devem estar visiveis/editaveis.

Persistencia apos atualizar: nao testada por seguranca.

### IMOV-ROUTE-007

Modulo: Imoveis
Funcionalidade: Bairros
Perfil: Usuario padrao
URL: /properties/neighborhoods
Status: PARCIAL
Severidade: BAIXO
Evidencias: EVID-PROD-STD-PROPERTIES-NEIGHBORHOODS-025.png, EVID-PROD-STD-PROPERTIES-LOCATIONS-BAIRROS-025.png

Resultado encontrado: a URL direta /properties/neighborhoods retornou 404. A subarea Bairros existe dentro de /properties/locations e abriu pela interface.

Resultado esperado: se Bairros deve ser acessivel apenas como subaba, o 404 e aceitavel. Se houver expectativa de URL direta, falta rota.

### IMOV-RENT-008

Modulo: Imoveis
Funcionalidade: Imoveis para aluguel
Perfis: usuario padrao e administrador
URL: /properties/rentals
Status: PARCIAL
Severidade: MEDIA
Evidencias: EVID-PROD-STD-PROPERTIES-RENTALS-025.png, EVID-PROD-ADM-PROPERTIES-RENTALS-025.png

Resultado encontrado: a rota carregou apenas o titulo Imoveis para Aluguel para ambos os perfis, sem filtros, lista ou estado vazio explicativo.

Resultado esperado: exibir lista, filtros ou mensagem clara de estado vazio/em construcao.

### IMOV-UI-009

Modulo: Imoveis
Funcionalidade: Dialogos e modais
Perfis: usuario padrao e administrador
Status: FALHOU
Severidade: BAIXO
Evidencias: console do navegador e modais capturados

Resultado encontrado: o console registrou avisos repetidos de acessibilidade: dialogos sem Description ou aria-describedby.

Resultado esperado: cada DialogContent deve ter descricao acessivel ou referencia aria adequada.

## Testes aprovados ou sem falha funcional visivel

- Busca por texto no usuario padrao retornou estado vazio coerente e botao Limpar filtros.
- Filtro por faixa de valor no usuario padrao retornou resultado vazio sem travar a tela.
- Limpar filtros no usuario padrao restaurou a listagem com 533 imoveis.
- Preview de imovel abriu com dados resumidos e sem quebrar a interface.
- Rotas /properties/owners, /properties/locations e /properties/condominiums carregaram nos dois perfis.
- Modais de novo proprietario, nova cidade, novo bairro e novo condominio abriram e foram cancelados nos dois perfis.
- Administrador autenticou com sucesso e viu menu lateral ampliado, incluindo modulos administrativos adicionais.

## Evidencias geradas

Pasta: C:\Users\andre\vimob-crm

- EVID-PROD-STD-PROPERTIES-LIST-025.png
- EVID-PROD-STD-PROPERTIES-SEARCH-EMPTY-025.png
- EVID-PROD-STD-PROPERTIES-ADVANCED-FILTERS-025.png
- EVID-PROD-STD-PROPERTIES-VALUE-FILTER-025.png
- EVID-PROD-STD-PROPERTIES-FILTERS-CLEAR-025.png
- EVID-PROD-STD-PROPERTIES-PREVIEW-025.png
- EVID-PROD-STD-PROPERTIES-CARD-MENU-025.png
- EVID-PROD-STD-PROPERTIES-HISTORY-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-FORM-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-PROPRIETARIO-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-DADOS-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-LOCALIZACAO-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-VALORES-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-CARACTERISTICAS-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-EXTRAS-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-MIDIA-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-PUBLICACAO-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-COMISSOES-025.png
- EVID-PROD-STD-PROPERTIES-EDIT-CONFIDENCIAL-025.png
- EVID-PROD-STD-PROPERTIES-NEW-FORM-025.png
- EVID-PROD-STD-PROPERTIES-NEW-PROPRIETARIO-025.png
- EVID-PROD-STD-PROPERTIES-NEW-DADOS-025.png
- EVID-PROD-STD-PROPERTIES-NEW-LOCALIZACAO-025.png
- EVID-PROD-STD-PROPERTIES-NEW-VALORES-025.png
- EVID-PROD-STD-PROPERTIES-NEW-CARACTERISTICAS-025.png
- EVID-PROD-STD-PROPERTIES-NEW-EXTRAS-025.png
- EVID-PROD-STD-PROPERTIES-NEW-MIDIA-025.png
- EVID-PROD-STD-PROPERTIES-NEW-PUBLICACAO-025.png
- EVID-PROD-STD-PROPERTIES-NEW-COMISSOES-025.png
- EVID-PROD-STD-PROPERTIES-NEW-CONFIDENCIAL-025.png
- EVID-PROD-STD-PROPERTIES-OWNERS-025.png
- EVID-PROD-STD-PROPERTIES-OWNERS-NEW-MODAL-025.png
- EVID-PROD-STD-PROPERTIES-LOCATIONS-025.png
- EVID-PROD-STD-PROPERTIES-LOCATIONS-BAIRROS-025.png
- EVID-PROD-STD-PROPERTIES-LOCATIONS-NEW-CITY-MODAL-025.png
- EVID-PROD-STD-PROPERTIES-LOCATIONS-NEW-BAIRRO-MODAL-025.png
- EVID-PROD-STD-PROPERTIES-CONDOMINIUMS-025.png
- EVID-PROD-STD-PROPERTIES-CONDOMINIUMS-NEW-MODAL-025.png
- EVID-PROD-STD-PROPERTIES-RENTALS-025.png
- EVID-PROD-STD-PROPERTIES-NEIGHBORHOODS-025.png
- EVID-PROD-ADM-PROPERTIES-LIST-025.png
- EVID-PROD-ADM-PROPERTIES-SEARCH-AUDIT-025.png
- EVID-PROD-ADM-PROPERTIES-CARD-MENU-025.png
- EVID-PROD-ADM-PROPERTIES-EDIT-FORM-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-FORM-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-PROPRIETARIO-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-DADOS-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-LOCALIZACAO-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-VALORES-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-CARACTERISTICAS-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-EXTRAS-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-MIDIA-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-PUBLICACAO-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-COMISSOES-025.png
- EVID-PROD-ADM-PROPERTIES-NEW-CONFIDENCIAL-025.png
- EVID-PROD-ADM-PROPERTIES-OWNERS-025.png
- EVID-PROD-ADM-PROPERTIES-OWNERS-NEW-MODAL-025.png
- EVID-PROD-ADM-PROPERTIES-LOCATIONS-025.png
- EVID-PROD-ADM-PROPERTIES-LOCATIONS-NEW-CITY-MODAL-025.png
- EVID-PROD-ADM-PROPERTIES-LOCATIONS-NEW-BAIRRO-MODAL-025.png
- EVID-PROD-ADM-PROPERTIES-CONDOMINIUMS-025.png
- EVID-PROD-ADM-PROPERTIES-CONDOMINIUMS-NEW-MODAL-025.png
- EVID-PROD-ADM-PROPERTIES-RENTALS-025.png

## Dados criados, alterados ou limpos

- Dados criados: nenhum.
- Dados alterados: nenhum.
- Dados excluidos: nenhum.
- Limpeza realizada: nao aplicavel.

## Recomendacao de prioridade

1. Corrigir ou confirmar a regra de permissao de edicao/historico/status para usuario padrao em imoveis de outro responsavel.
2. Revisar visibilidade da carteira completa e filtro por responsavel para usuario padrao.
3. Definir se cadastros auxiliares de proprietario, cidade, bairro e condominio podem ser criados por usuario padrao.
4. Implementar estado util na rota de imoveis para aluguel ou remover a rota enquanto estiver incompleta.
5. Corrigir avisos de acessibilidade nos dialogos.

## Observacao final

A auditoria desta rodada nao prova persistencia de criacao/edicao porque as acoes de salvar/cadastrar/excluir foram deliberadamente bloqueadas em producao. O risco principal, porem, ja aparece antes da persistencia: a interface do usuario padrao expoe telas e acoes de edicao/historico/status para registro que aparenta pertencer a outro responsavel.
