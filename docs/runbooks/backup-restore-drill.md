# Recuperação do Vimob CRM

O retorno de imagem resolve regressões na aplicação. Para recuperar um banco ou volume perdido, o ponto de recuperação precisa reunir PostgreSQL, objetos do Storage e a configuração capaz de abrir esses dados. O recibo de recuperação da aplicação e o recibo de restauração de dados são distintos.

## Ensaio local com dados sintéticos

Use o Docker Desktop local com as imagens indicadas no [executor](../../scripts/supabase/rehearse-local-recovery.mjs) já presentes. O executor rejeita daemons remotos, cria duas redes Docker internas e deixa as portas sem publicação. Cada execução cria senhas sintéticas, volumes próprios e um arquivo de dados para ensaio. Rode a partir da raiz do checkout.

```powershell
node scripts/supabase/rehearse-local-recovery.mjs
```

O ensaio cria duas contas no GoTrue, registra um lead, um trabalho pendente, um arquivo de teste com metadados protegidos por RLS e um evento SSE. Com a autenticação parada, o executor gera o dump e o arquivo de objetos. Depois grava um marcador no banco de origem para demonstrar o que ficou fora da cópia. A etapa de recuperação verifica os hashes dos arquivos e restaura o banco e os objetos em destinos novos. A confirmação usa o login das duas contas, o hash dos bytes restaurados e a visibilidade por conta dos metadados do arquivo no banco. O recibo inclui o registro e o gatilho do SSE, a fila ainda pendente e a ausência do marcador posterior. Os recursos criados são removidos no final.

A duração medida vai da criação do ambiente de destino até a conclusão das verificações. Registre-a como tempo do ensaio sintético. O marcador representa o limite do ponto recuperado nessa execução. O PostgreSQL usa um diretório efêmero em memória e o arquivo de teste fica em volumes Docker. A validação do Storage ocorre por bytes e metadados SQL. O download via API e o tempo de recuperação de produção dependem do ensaio com o backup real.

## Validação do backup real

1. Identifique o cluster, volume do banco e backend do Storage ativos pelos inventários do ambiente. Confirme um destino externo acessível em caso de perda do host de produção. Registre os identificadores e horários das cópias sem registrar valores de segredos. A confirmação inclui cobertura e retenção do banco, versão e integridade dos objetos e disponibilidade da configuração protegida necessária à recuperação.
2. Escolha um ponto consistente entre o banco e o Storage. Para recuperação até um instante específico, prove também a cobertura do backup base e do arquivo WAL até o ponto selecionado. Registre o horário de referência e o instante recuperado. Uma exportação do schema ou um snapshot de um volume isolado cobre apenas parte do sistema.
3. Restaure somente em destino aprovado que bloqueie saídas para provedores e aceite os dados segundo o controle de acesso do ambiente. Prepare as credenciais no destino por meio do armazenamento seguro. Trave recebimento, e-mail, WhatsApp, cobrança, cron e workers com efeito externo antes de iniciar os serviços recuperados. Mantenha os originais ativos e referenciados separadamente.
4. Confira login com conta de teste aprovada, isolamento entre duas organizações, lead e histórico, leitura de um anexo autorizado e negação da conta sem acesso. Compare as filas com a cópia e verifique que trabalhos pendentes ficaram preservados sem envio. Valide publicação e integrações por configuração permitida ou por substitutos locais. Registre as verificações e o plano de descarte do destino.
5. Meça o tempo da restauração + verificação e a diferença entre o incidente simulado e o último estado recuperado. Compare ambos com as metas aprovadas. Guarde um comprovante sanitizado com origem, ponto de cópia, integridade, versões, duração, resultado e responsável. Uma prova aceitável inclui banco, Auth e bytes do Storage. Repita depois de mudanças no mecanismo de backup ou na topologia.

## Conferência do schema antes da release

Em produção self-hosted, compare objetos reais do lote e a identidade do banco. O histórico do Git e a verificação do arquivo de migração comprovam o conteúdo a publicar. O catálogo executado comprova as definições, donos, grants, políticas, constraints e índices no destino. Registre, por alteração, SHA do arquivo revisado, versão, destino, estado esperado e evidências de leitura antes e depois, inclusive para cutovers separados. Verifique a equivalência com uma reconstrução em ambiente isolado. Mantenha o bloqueio de `db push`. Qualquer reconciliação histórica exige análise própria. [Fluxo de migrações do repositório](../../supabase/README.md#bloqueio-de-segurança-atual)
