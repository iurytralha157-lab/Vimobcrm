'use client';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Building2,
  Kanban,
  ListTodo,
  Shuffle,
  Tags,
  Search,
  HelpCircle,
  MessageSquare,
  Calendar,
  DollarSign,
  FileText,
  BarChart3,
  Bell,
  Zap,
  UserPlus,
  Phone,
  Globe,
  Lightbulb,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { QuickActions } from '@/components/features/help/QuickActions';
import { MyRequestsList } from '@/components/features/help/MyRequestsList';
import { FeatureRequestDialog } from '@/components/features/help/FeatureRequestDialog';

const helpSections = [
  {
    icon: Building2,
    title: 'Começando',
    items: [
      {
        question: 'Como funciona o CRM?',
        answer: 'O CRM (Customer Relationship Management) é uma ferramenta para gerenciar seus leads e clientes. Você pode acompanhar todo o histórico de interações, organizar leads por estágios do funil de vendas e automatizar tarefas de acompanhamento.'
      },
      {
        question: 'O que é o pipeline?',
        answer: 'O pipeline é um quadro visual em formato Kanban que mostra seus leads organizados por estágio. Cada coluna representa uma etapa do seu processo de vendas (ex: Novo Lead, Em Contato, Proposta Enviada, Fechado). Você arrasta os cards para acompanhar o progresso.'
      },
      {
        question: 'Onde vejo minhas tarefas pendentes?',
        answer: 'Suas tarefas aparecem no Dashboard na seção "Tarefas do Dia", na Agenda com visualização de calendário, e também no painel de detalhes de cada lead. Tarefas vencidas ficam destacadas em vermelho.'
      },
    ]
  },
  {
    icon: Kanban,
    title: 'Gerenciando Leads',
    items: [
      {
        question: 'Como criar um novo lead?',
        answer: 'No pipeline, clique no botão "Novo Lead" no canto superior direito. Preencha os dados do contato como nome, telefone, email e selecione o imóvel de interesse se houver. O lead aparecerá na primeira coluna do pipeline.'
      },
      {
        question: 'Como mover um lead entre estágios?',
        answer: 'Basta arrastar o card do lead de uma coluna para outra. Ao soltar, o sistema atualiza automaticamente o estágio e registra a movimentação no histórico. Você também pode alterar clicando no card e selecionando o novo estágio.'
      },
      {
        question: 'Como ver o histórico de um lead?',
        answer: 'Clique no card do lead para abrir o painel de detalhes. Na aba "Histórico" você vê todas as atividades: mensagens enviadas, ligações realizadas, mudanças de estágio, tarefas concluídas e anotações.'
      },
      {
        question: 'Como alterar nome, cor e ordem das colunas?',
        answer: 'Clique no ícone de engrenagem ao lado do nome da pipeline. No editor de estágios você pode renomear colunas, alterar cores, reordenar arrastando e adicionar/remover etapas do funil.'
      },
      {
        question: 'Como filtrar leads?',
        answer: 'Use os filtros disponíveis no topo do pipeline: por responsável, por tags, por fonte de origem ou por data. Você também pode buscar por nome, telefone ou email na barra de pesquisa.'
      },
    ]
  },
  {
    icon: MessageSquare,
    title: 'WhatsApp e Conversas',
    items: [
      {
        question: 'Como conectar o WhatsApp?',
        answer: 'Acesse Configurações > WhatsApp e clique em "Nova Sessão". Escaneie o QR Code com seu celular. Após conectar, você poderá enviar e receber mensagens diretamente pelo CRM.'
      },
      {
        question: 'Como enviar mensagens pelo CRM?',
        answer: 'Acesse o menu "Conversas" para ver todas as conversas ativas. Clique em uma conversa para abrir o chat e enviar mensagens. Você também pode iniciar uma conversa clicando no botão de WhatsApp no card do lead.'
      },
      {
        question: 'Quer que eu explique como está funcionando o chat?',
        answer: 'O botão verde no canto inferior direito abre o chat flutuante. Ele permite responder mensagens rapidamente sem sair da tela atual. Você vê a lista de conversas recentes e pode trocar entre elas.'
      },
      {
        question: 'Me manda como está funcionando hoje o sistema para receber imagens e audios no wpp?',
        answer: 'O sistema recebe automaticamente imagens e áudios enviados pelos seus clientes no WhatsApp. Você pode visualizá-los e ouvi-los diretamente no chat do CRM. Para enviar arquivos, use o ícone de anexo no chat.',
      },
    ]
  },
  {
    icon: ListTodo,
    title: 'Tarefas e Cadências',
    items: [
      {
        question: 'O que são cadências?',
        answer: 'Cadências são sequências de tarefas automáticas que são criadas quando um lead entra em um estágio. Por exemplo: dia 0 = ligação de boas-vindas, dia 1 = mensagem de follow-up, dia 3 = envio de material. Isso garante um acompanhamento consistente.'
      },
      {
        question: 'Como configurar cadências por estágio?',
        answer: 'Acesse CRM > Cadências. Selecione o estágio desejado e adicione as tarefas com seus respectivos dias. Você pode definir tipo (ligação, mensagem, visita), título, descrição e mensagem recomendada.'
      },
      {
        question: 'Como marcar uma tarefa como concluída?',
        answer: 'Nas tarefas do lead, clique no checkbox ao lado da tarefa. Ela será marcada como concluída e removida da sua lista de pendências. O sistema registra quem concluiu e quando.'
      },
      {
        question: 'Como criar tarefas manuais?',
        answer: 'Abra os detalhes do lead e clique em "Nova Tarefa". Defina o título, tipo (ligação, mensagem, visita), data de vencimento e descrição. A tarefa aparecerá na sua agenda e no painel do lead.'
      },
    ]
  },
  {
    icon: Calendar,
    title: 'Agenda',
    items: [
      {
        question: 'Como agendar uma visita?',
        answer: 'Na Agenda, clique em "Novo Evento" e selecione o tipo "Visita". Preencha o lead relacionado, imóvel, data/hora e observações. O evento aparece no calendário e nas tarefas do lead.'
      },
      {
        question: 'Como sincronizar com Google Agenda?',
        answer: 'Na tela da Agenda, clique em "Conectar Google Agenda". Autorize o acesso e seus eventos serão sincronizados automaticamente entre o CRM e sua agenda Google.'
      },
      {
        question: 'Como visualizar a agenda de toda equipe?',
        answer: 'Na Agenda, use o filtro de usuários para ver os compromissos de todos os corretores. Isso ajuda a organizar visitas e evitar conflitos de horário.'
      },
    ]
  },
  {
    icon: Building2,
    title: 'Imóveis',
    items: [
      {
        question: 'Como cadastrar um imóvel?',
        answer: 'Acesse o menu "Imóveis" e clique em "Novo Imóvel". Preencha as informações: tipo, preço, endereço, características (quartos, vagas, área) e faça upload das fotos. O sistema gera um código único automaticamente.'
      },
      {
        question: 'Como funciona o código do imóvel?',
        answer: 'Cada imóvel recebe um código automático baseado no tipo: AP (Apartamento), CA (Casa), TE (Terreno), CO (Comercial), SA (Sala), LA (Laje). O número incrementa automaticamente: AP0001, AP0002, etc.'
      },
      {
        question: 'Como publicar imóveis no site?',
        answer: 'Ao cadastrar ou editar um imóvel, marque a opção "Publicar no site". Configure o site em Configurações > Site para personalizar cores, logo e informações de contato.'
      },
    ]
  },
  {
    icon: Tags,
    title: 'Tags e Organização',
    items: [
      {
        question: 'Para que servem as tags?',
        answer: 'Tags são etiquetas coloridas para categorizar leads. Exemplos: "Quente" (alta probabilidade), "Investidor", "Alto Padrão", "Urgente". Elas facilitam filtrar e organizar seus leads.'
      },
      {
        question: 'Como criar e gerenciar tags?',
        answer: 'Acesse CRM > Tags. Crie novas tags com nome e cor. Você pode aplicar tags nos leads através do card ou edição de detalhes. Tags podem ser usadas em regras de distribuição.'
      },
    ]
  },
  {
    icon: Shuffle,
    title: 'Distribuição de Leads',
    items: [
      {
        question: 'O que é a roleta de distribuição?',
        answer: 'A roleta distribui automaticamente novos leads entre os corretores da equipe. Quando um lead chega (via Meta, site ou manualmente), ele é atribuído ao próximo corretor da fila de forma justa e equilibrada.'
      },
      {
        question: 'Como configurar regras de distribuição?',
        answer: 'Acesse CRM > Distribuição. Crie filas com os usuários participantes e defina pesos. Adicione regras para direcionar leads específicos (por fonte, campanha, tag) para filas diferentes.'
      },
      {
        question: 'Como funciona a distribuição por peso?',
        answer: 'Você pode definir pesos diferentes para cada corretor. Por exemplo, um corretor sênior pode ter peso 2 e receber o dobro de leads que um júnior com peso 1.'
      },
    ]
  },
  {
    icon: Globe,
    title: 'Integração Meta (Facebook/Instagram)',
    items: [
      {
        question: 'Como conectar minha conta?',
        answer: 'Acesse Configurações > Integração Meta e clique em "Conectar com Facebook". Autorize o acesso e selecione a página e formulários de Lead Ads que deseja sincronizar.'
      },
      {
        question: 'Os leads chegam em tempo real?',
        answer: 'Sim! Após configurar, os leads do Meta são recebidos instantaneamente. Eles aparecem na coluna "Novo Lead" do pipeline e são distribuídos pela roleta automaticamente.'
      },
    ]
  },
  {
    icon: Globe,
    title: 'Site Público',
    items: [
      {
        question: 'Como configurar meu site?',
        answer: 'Acesse Configurações > Site. Configure título, cores, logo, informações de contato e redes sociais. Ative o site e ele ficará disponível no subdomínio configurado ou domínio personalizado.'
      },
      {
        question: 'Como conectar domínio próprio?',
        answer: 'Em Configurações > Site, adicione seu domínio personalizado. Siga as instruções para configurar o DNS apontando para nossos servidores. A verificação é automática.'
      },
    ]
  },
  {
    icon: DollarSign,
    title: 'Financeiro',
    items: [
      {
        question: 'Como registrar receitas e despesas?',
        answer: 'No menu Financeiro > Lançamentos, clique em "Novo Lançamento". Defina tipo (receita ou despesa), valor, categoria, data de vencimento e descrição. Você pode parcelar e configurar recorrência.'
      },
      {
        question: 'Como acompanhar comissões?',
        answer: 'O menu Comissões mostra todas as comissões pendentes, aprovadas e pagas. Você vê o valor, corretor responsável, contrato relacionado e pode gerenciar o fluxo de aprovação.'
      },
    ]
  },
  {
    icon: FileText,
    title: 'Contratos',
    items: [
      {
        question: 'Como criar um contrato?',
        answer: 'Acesse Contratos > Novo Contrato. Selecione o lead/cliente, imóvel, tipo (venda ou locação), valor e condições. Você pode vincular os corretores participantes e suas porcentagens de comissão.'
      },
      {
        question: 'Como acompanhar o status?',
        answer: 'Contratos passam por etapas: Rascunho, Assinado, Em Andamento, Concluído. O painel mostra indicadores de cada status e você pode filtrar por tipo e data.'
      },
    ]
  },
  {
    icon: BarChart3,
    title: 'Dashboard e Relatórios',
    items: [
      {
        question: 'O que vejo no Dashboard?',
        answer: 'O Dashboard mostra: leads do período, conversões, tarefas pendentes, desempenho por corretor e gráficos de evolução. Use os filtros de data para analisar diferentes períodos.'
      },
      {
        question: 'Como ver o desempenho da equipe?',
        answer: 'O menu Desempenho mostra ranking de corretores, taxa de conversão, tempo médio de atendimento e leads por fonte. Ideal para gestores acompanharem a equipe.'
      },
      {
        question: 'Como exportar dados?',
        answer: 'Na lista de contatos e relatórios, use o botão "Exportar". Os dados são baixados em formato Excel (XLSX) para análises externas.'
      },
    ]
  },
  {
    icon: Zap,
    title: 'Automações',
    items: [
      {
        question: 'O que posso automatizar?',
        answer: 'Você pode criar automações para: enviar mensagens automáticas quando um lead entra, mover leads entre estágios baseado em condições, criar tarefas automaticamente e notificar a equipe.'
      },
      {
        question: 'Como criar uma automação?',
        answer: 'No menu Automações, clique em "Nova Automação". Use o editor visual para definir o gatilho (ex: lead criado), condições e ações. Conecte os blocos arrastando as conexões.'
      },
      {
        question: 'Como configurar automação por estágio?',
        answer: 'No editor de estágios da pipeline, você pode definir ações automáticas quando um lead entra: mudar status, atribuir responsável ou executar automação completa.'
      },
    ]
  },
  {
    icon: Bell,
    title: 'Notificações',
    items: [
      {
        question: 'Que notificações recebo?',
        answer: 'Você recebe notificações de: novos leads atribuídos, mensagens de clientes, tarefas vencendo, leads parados há muito tempo, ganho de leads e respostas a solicitações.'
      },
      {
        question: 'Como visualizar notificações?',
        answer: 'Clique no ícone de sino no cabeçalho. Notificações não lidas aparecem com contador. Clique em uma notificação para ir diretamente ao item relacionado.'
      },
    ]
  },
  {
    icon: Phone,
    title: 'Contatos',
    items: [
      {
        question: 'Qual a diferença entre Leads e Contatos?',
        answer: 'Leads são oportunidades ativas no funil de vendas. Contatos é a base completa de pessoas cadastradas, incluindo leads convertidos, clientes antigos e contatos gerais.'
      },
      {
        question: 'Como importar contatos?',
        answer: 'No menu Contatos, clique em "Importar". Faça upload de uma planilha Excel com as colunas: nome, telefone, email. O sistema valida e importa os dados automaticamente.'
      },
      {
        question: 'Como exportar minha base?',
        answer: 'Na lista de contatos, use o botão "Exportar". Você pode exportar todos os contatos ou apenas os filtrados em formato Excel.'
      },
    ]
  },
  {
    icon: UserPlus,
    title: 'Equipes e Funções',
    items: [
      {
        question: 'Como criar uma equipe?',
        answer: 'Acesse CRM > Equipes e clique em "Nova Equipe". Defina nome, adicione membros e selecione o líder. Vincule pipelines específicas à equipe para controle de acesso.'
      },
      {
        question: 'O que um líder de equipe pode fazer?',
        answer: 'Líderes visualizam todos os leads da equipe e pipelines vinculadas, podem editar cadências e configurar distribuição. Não têm acesso às áreas financeiras ou configurações globais.'
      },
      {
        question: 'Como configurar funções (RBAC)?',
        answer: 'Em Configurações > Funções, crie papéis personalizados (ex: Backoffice, Gerente, Vendedor) e defina permissões específicas para cada área do sistema.'
      },
    ]
  },
];

export default function Help() {
  const [searchTerm, setSearchTerm] = useState('');
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  const filteredSections = helpSections.map(section => ({
    ...section,
    items: section.items.filter(
      item =>
        item.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.answer.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter(section => section.items.length > 0);

  return (
    <AppLayout title="Central de Ajuda">
      <div className="animate-in space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <HelpCircle className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Guia de Uso</h1>
              <p className="text-muted-foreground">Tudo que você precisa saber para usar o CRM</p>
            </div>
          </div>

          <Button onClick={() => setRequestDialogOpen(true)} className="gap-2">
            <Lightbulb className="h-4 w-4" />
            Sugerir Melhoria
          </Button>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              Ações Rápidas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-4">
            <QuickActions />
          </CardContent>
        </Card>

        {/* My Requests */}
        <MyRequestsList />

        {/* Search */}
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar no guia de ajuda..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-12 pl-12 pr-4 rounded-xl border border-white/[0.055] bg-[var(--app-surface)] focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Sections - Grid layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredSections.map((section) => (
            <Card key={section.title}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <section.icon className="h-5 w-5 text-primary" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 md:px-6 pb-4 pt-0">
                <Accordion type="single" collapsible className="w-full">
                  {section.items.map((item, index) => (
                    <AccordionItem key={index} value={`item-${index}`}>
                      <AccordionTrigger className="text-left hover:no-underline">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredSections.length === 0 && (
          <Card className="p-12 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">Nenhum resultado encontrado</h3>
            <p className="text-muted-foreground text-sm">
              Tente buscar com outras palavras ou navegue pelas categorias acima.
            </p>
          </Card>
        )}

        {/* Feature Request Dialog */}
        <FeatureRequestDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
        />
      </div>
    </AppLayout>
  );
}
