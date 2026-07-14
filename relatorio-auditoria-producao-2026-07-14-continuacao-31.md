# Relatório de Auditoria Funcional - Produção - Continuação 31

Data: 14/07/2026
Ambiente: produção, navegador, VIMob CRM
Módulo auditado: Configurações
Perfis: administrador e usuário padrão
Escopo: conta, usuários, pagamentos, integrações, IA, imóveis e site
Dados alterados: nenhum

## Resumo executivo

A auditoria desta continuação cobriu Configurações com administrador e usuário padrão, incluindo navegação direta por URL, abas, subtabs, modais e controles de formulário. Foram geradas 42 novas evidências, elevando o total acumulado para 236 imagens.

O administrador acessa as áreas administrativas esperadas: usuários, pagamentos, integrações, IA, regras de imóveis e site. O usuário padrão tem bloqueio claro em `settings/site`, mas apresentou inconsistências nas demais rotas administrativas: algumas ficam em carregamento indefinido, outras retornam conteúdo de outra aba sem mensagem, e integrações permite abrir o modal de WhatsApp com ações operacionais visíveis.

Não foram executadas ações destrutivas, envio de convite, troca de senha, conexão de integração, upload, remoção de mídia, alteração de site, alteração de regras ou salvamento de formulário.

## Cobertura executada

- Administrador: 24 evidências em Configurações.
- Usuário padrão: 18 evidências em Configurações.
- Rotas diretas testadas: `/settings?tab=account`, `/settings?tab=team`, `/settings?tab=subscription`, `/settings?tab=integrations`, `/settings?tab=ai`, `/settings?tab=properties`, `/settings/site`.
- Formulários/modais abertos: edição de perfil, atualização de senha, edição de empresa, novo corretor, nova função e WhatsApp em integrações.
- Abas administrativas abertas: IA Atendimento, Triagem, Roteamento, Teste e Logs; Site Geral, Aparência, Menu, Sobre, Contato, Social e SEO.

## Achados principais

### Alto - Usuário padrão acessa modal operacional de WhatsApp

ID: CONFIG-STD-INT-001
Perfil: usuário padrão
URL: `/settings?tab=integrations`
Evidência: `EVID-PROD-STD-CONFIG-INTEGRACOES-WHATSAPP-CONECTAR-031.png`

O usuário padrão consegue abrir a integração de WhatsApp pelo botão `Conectar`. O modal exibiu uma conexão existente, status, opções de verificação, QR Code e botão de apagar conexão. As outras integrações aparecem com `Sem acesso`, o que torna o WhatsApp uma divergência de permissão.

Risco: usuário sem perfil administrativo pode interagir com uma integração crítica e visualizar ações que deveriam ser restritas. Nenhuma ação interna do modal foi executada.

### Alto - Rotas administrativas ficam presas carregando permissões

ID: CONFIG-STD-PERM-001
Perfil: usuário padrão
URLs: `/settings?tab=team` e `/settings?tab=properties`
Evidências: `EVID-PROD-STD-CONFIG-USUARIOS-BRANCO-REPRO-031.png`, `EVID-PROD-STD-CONFIG-IMOVEIS-BRANCO-REPRO-031.png`

Ao acessar diretamente as abas administrativas de Usuários e Imóveis, a interface permanece em `Carregando permissões da organização...` mesmo após espera prolongada. Não há mensagem clara de acesso negado, redirecionamento ou conteúdo funcional.

Risco: falha de tratamento de autorização/estado deixa a tela sem saída clara e pode mascarar erro de permissão.

### Médio - Rotas administrativas exibem conteúdo incorreto ou fallback silencioso

ID: CONFIG-STD-ROUTE-001
Perfil: usuário padrão
URLs: `/settings?tab=subscription` e `/settings?tab=ai`
Evidências: `EVID-PROD-STD-CONFIG-PAGAMENTOS-031.png`, `EVID-PROD-STD-CONFIG-IA-031.png`

A rota de pagamentos exibiu o conteúdo de Conta sem informar que o acesso foi bloqueado. A rota de IA exibiu conteúdo de Integrações, também sem mensagem explícita. O comportamento contrasta com `settings/site`, que mostra `Acesso restrito`.

Risco: inconsistência de roteamento e autorização; o usuário não sabe se a área foi bloqueada, carregada parcialmente ou redirecionada.

### Médio - Fluxo de atualização de senha não solicita senha atual

ID: CONFIG-STD-CONTA-001
Perfil: usuário padrão
URL: `/settings?tab=account`
Evidência: `EVID-PROD-STD-CONFIG-CONTA-ATUALIZAR-SENHA-031.png`

O painel de atualização exibiu campos de nova senha e confirmação, com botão desabilitado enquanto vazio. Não foi identificado campo de senha atual no fluxo observado.

Risco: se a aplicação permitir alteração apenas com sessão ativa, a equipe deve confirmar se essa é uma decisão deliberada e compatível com o modelo de segurança. O envio não foi testado para não alterar credenciais reais.

### Baixo - Avisos técnicos no console

ID: CONFIG-TECH-001
Perfis: administrador e usuário padrão
Evidência técnica: logs coletados na aba do navegador

Foram observados avisos recorrentes:

- gráfico com largura/altura inválida no dashboard após login;
- `DialogContent` sem descrição ou `aria-describedby`.

Risco: impacto principal em acessibilidade, estabilidade visual e qualidade técnica. Não houve erro crítico de console durante esta continuação.

## Comparação por perfil

| Área | Administrador | Usuário padrão | Resultado |
|---|---|---|---|
| Conta | Visualiza e edita perfil, senha e dados da empresa | Edita perfil próprio; empresa aparece somente leitura | Parcialmente aprovado |
| Usuários | Lista usuários, convites, funções, ações de papel/status | URL direta fica carregando permissões | Falha no tratamento do bloqueio |
| Pagamentos | Aba acessível ao admin | URL direta mostra Conta sem aviso | Falha de roteamento/mensagem |
| Integrações | Aba acessível com ações administrativas | Integrações parcialmente visíveis; WhatsApp abre modal | Falha de permissão no WhatsApp |
| IA | Abas e prompts acessíveis ao admin | URL direta mostra Integrações | Falha de roteamento/mensagem |
| Imóveis | Regras administrativas acessíveis | URL direta fica carregando permissões | Falha no tratamento do bloqueio |
| Site | Abas e controles públicos acessíveis ao admin | Bloqueio claro com `Acesso restrito` | Aprovado |

## Testes executados

| ID | Perfil | Funcionalidade | Status | Evidência |
|---|---|---|---|---|
| CONFIG-ADM-001 | Admin | Conta | Aprovado | `EVID-PROD-ADM-CONFIG-CONTA-031.png` |
| CONFIG-ADM-002 | Admin | Editar perfil | Bloqueado sem salvar | `EVID-PROD-ADM-CONFIG-CONTA-EDIT-PERFIL-031.png` |
| CONFIG-ADM-003 | Admin | Atualizar senha | Bloqueado sem salvar | `EVID-PROD-ADM-CONFIG-CONTA-ATUALIZAR-SENHA-031.png` |
| CONFIG-ADM-004 | Admin | Editar empresa | Bloqueado sem salvar | `EVID-PROD-ADM-CONFIG-CONTA-EDIT-EMPRESA-031.png` |
| CONFIG-ADM-005 | Admin | Usuários | Aprovado visual | `EVID-PROD-ADM-CONFIG-USUARIOS-031.png` |
| CONFIG-ADM-006 | Admin | Novo corretor | Bloqueado sem envio | `EVID-PROD-ADM-CONFIG-USUARIOS-NOVO-CORRETOR-031.png` |
| CONFIG-ADM-007 | Admin | Nova função | Bloqueado sem salvar | `EVID-PROD-ADM-CONFIG-USUARIOS-NOVA-FUNCAO-031.png` |
| CONFIG-ADM-008 | Admin | Pagamentos | Aprovado visual | `EVID-PROD-ADM-CONFIG-PAGAMENTOS-031.png` |
| CONFIG-ADM-009 | Admin | Integrações | Aprovado visual | `EVID-PROD-ADM-CONFIG-INTEGRACOES-031.png` |
| CONFIG-ADM-010 | Admin | IA Atendimento | Aprovado visual | `EVID-PROD-ADM-CONFIG-IA-ATENDIMENTO-031.png` |
| CONFIG-ADM-011 | Admin | IA Triagem | Aprovado visual | `EVID-PROD-ADM-CONFIG-IA-TRIAGEM-031.png` |
| CONFIG-ADM-012 | Admin | IA Roteamento | Aprovado visual | `EVID-PROD-ADM-CONFIG-IA-ROTEAMENTO-031.png` |
| CONFIG-ADM-013 | Admin | IA Teste | Aprovado visual | `EVID-PROD-ADM-CONFIG-IA-TESTE-031.png` |
| CONFIG-ADM-014 | Admin | IA Logs | Aprovado visual | `EVID-PROD-ADM-CONFIG-IA-LOGS-031.png` |
| CONFIG-ADM-015 | Admin | Configurações de imóveis | Aprovado visual | `EVID-PROD-ADM-CONFIG-IMOVEIS-031.png` |
| CONFIG-ADM-016 | Admin | Site Geral | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-GERAL-031.png` |
| CONFIG-ADM-017 | Admin | Site Aparência | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-APARENCIA-031.png` |
| CONFIG-ADM-018 | Admin | Site Menu | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-MENU-031.png` |
| CONFIG-ADM-019 | Admin | Site Sobre | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-SOBRE-031.png` |
| CONFIG-ADM-020 | Admin | Site Contato | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-CONTATO-031.png` |
| CONFIG-ADM-021 | Admin | Site Social | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-SOCIAL-031.png` |
| CONFIG-ADM-022 | Admin | Site SEO | Aprovado visual | `EVID-PROD-ADM-CONFIG-SITE-SEO-031.png` |
| CONFIG-STD-001 | Padrão | Conta | Aprovado visual | `EVID-PROD-STD-CONFIG-CONTA-031.png` |
| CONFIG-STD-002 | Padrão | Editar perfil | Bloqueado sem salvar | `EVID-PROD-STD-CONFIG-CONTA-EDIT-PERFIL-031.png` |
| CONFIG-STD-003 | Padrão | Atualizar senha | Bloqueado sem salvar | `EVID-PROD-STD-CONFIG-CONTA-ATUALIZAR-SENHA-031.png` |
| CONFIG-STD-004 | Padrão | Idioma | Parcial | `EVID-PROD-STD-CONFIG-CONTA-IDIOMA-OPCOES-FORCE-031.png` |
| CONFIG-STD-005 | Padrão | Tema | Parcial | `EVID-PROD-STD-CONFIG-CONTA-TEMA-OPCOES-FORCE-031.png` |
| CONFIG-STD-006 | Padrão | Usuários por URL direta | Falhou | `EVID-PROD-STD-CONFIG-USUARIOS-BRANCO-REPRO-031.png` |
| CONFIG-STD-007 | Padrão | Pagamentos por URL direta | Falhou | `EVID-PROD-STD-CONFIG-PAGAMENTOS-031.png` |
| CONFIG-STD-008 | Padrão | Integrações | Parcial | `EVID-PROD-STD-CONFIG-INTEGRACOES-031.png` |
| CONFIG-STD-009 | Padrão | WhatsApp em integrações | Falhou | `EVID-PROD-STD-CONFIG-INTEGRACOES-WHATSAPP-CONECTAR-031.png` |
| CONFIG-STD-010 | Padrão | IA por URL direta | Falhou | `EVID-PROD-STD-CONFIG-IA-031.png` |
| CONFIG-STD-011 | Padrão | Imóveis por URL direta | Falhou | `EVID-PROD-STD-CONFIG-IMOVEIS-BRANCO-REPRO-031.png` |
| CONFIG-STD-012 | Padrão | Site por URL direta | Aprovado | `EVID-PROD-STD-CONFIG-SITE-031.png` |

## Evidências geradas

Administrador:

- `EVID-PROD-ADM-CONFIG-CONTA-031.png`
- `EVID-PROD-ADM-CONFIG-CONTA-EDIT-PERFIL-031.png`
- `EVID-PROD-ADM-CONFIG-CONTA-ATUALIZAR-SENHA-031.png`
- `EVID-PROD-ADM-CONFIG-CONTA-EDIT-EMPRESA-031.png`
- `EVID-PROD-ADM-CONFIG-USUARIOS-031.png`
- `EVID-PROD-ADM-CONFIG-USUARIOS-NOVO-CORRETOR-031.png`
- `EVID-PROD-ADM-CONFIG-USUARIOS-NOVA-FUNCAO-031.png`
- `EVID-PROD-ADM-CONFIG-PAGAMENTOS-031.png`
- `EVID-PROD-ADM-CONFIG-INTEGRACOES-031.png`
- `EVID-PROD-ADM-CONFIG-IA-031.png`
- `EVID-PROD-ADM-CONFIG-IA-ATENDIMENTO-031.png`
- `EVID-PROD-ADM-CONFIG-IA-TRIAGEM-031.png`
- `EVID-PROD-ADM-CONFIG-IA-ROTEAMENTO-031.png`
- `EVID-PROD-ADM-CONFIG-IA-TESTE-031.png`
- `EVID-PROD-ADM-CONFIG-IA-LOGS-031.png`
- `EVID-PROD-ADM-CONFIG-IMOVEIS-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-GERAL-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-APARENCIA-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-MENU-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-SOBRE-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-CONTATO-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-SOCIAL-031.png`
- `EVID-PROD-ADM-CONFIG-SITE-SEO-031.png`

Usuário padrão:

- `EVID-PROD-STD-CONFIG-CONTA-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-EDIT-PERFIL-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-ATUALIZAR-SENHA-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-IDIOMA-OPCOES-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-IDIOMA-OPCOES-FORCE-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-IDIOMA-OPCOES-VISUAL-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-TEMA-OPCOES-031.png`
- `EVID-PROD-STD-CONFIG-CONTA-TEMA-OPCOES-FORCE-031.png`
- `EVID-PROD-STD-CONFIG-MENU-031.png`
- `EVID-PROD-STD-CONFIG-USUARIOS-031.png`
- `EVID-PROD-STD-CONFIG-USUARIOS-BRANCO-REPRO-031.png`
- `EVID-PROD-STD-CONFIG-PAGAMENTOS-031.png`
- `EVID-PROD-STD-CONFIG-INTEGRACOES-031.png`
- `EVID-PROD-STD-CONFIG-INTEGRACOES-WHATSAPP-CONECTAR-031.png`
- `EVID-PROD-STD-CONFIG-IA-031.png`
- `EVID-PROD-STD-CONFIG-IMOVEIS-031.png`
- `EVID-PROD-STD-CONFIG-IMOVEIS-BRANCO-REPRO-031.png`
- `EVID-PROD-STD-CONFIG-SITE-031.png`

## Limitações e bloqueios

- Troca real de senha não foi executada para não alterar credenciais reais.
- Salvamentos administrativos não foram executados por risco de impacto em produção.
- Convites, conexão de WhatsApp, exclusão de conexão, upload de logo/favicon e edição de site não foram executados.
- Os seletores de idioma e tema foram acionados sem alteração de opção; a lista não abriu de forma confiável pela automação e ficou classificada como parcial.

## Recomendações

1. Revisar imediatamente a permissão do modal de WhatsApp para usuário padrão.
2. Padronizar bloqueio de rotas administrativas com mensagem clara, como ocorre em `settings/site`.
3. Corrigir fallback silencioso de `subscription` e `ai`.
4. Adicionar tratamento de timeout/erro ao carregamento de permissões da organização.
5. Revisar o fluxo de atualização de senha para confirmar exigência ou dispensa da senha atual.
6. Corrigir avisos de acessibilidade em dialogs e dimensões de gráficos.

## Estado final

A sessão foi retornada ao perfil administrador usando a credencial atualizada informada pelo solicitante. Nenhum dado de produção foi salvo, removido, enviado ou conectado durante esta continuação.
