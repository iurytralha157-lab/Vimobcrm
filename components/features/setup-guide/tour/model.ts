import type { SetupStepId } from "@/hooks/use-setup-guide";

export type TourItem = {
  selector: string | string[];
  title: string;
  body: string;
  missingTitle?: string;
  missingBody?: string;
  closeOpenLayer?: boolean;
  action?: TourAction;
};

export type TourPlan = {
  route: string;
  path: string;
  items: TourItem[];
};

export type TourAction =
  | {
      type: "click";
      selector: string | string[];
      waitFor?: string | string[];
      closeOpenLayer?: boolean;
    }
  | {
      type: "hash";
      hash: string;
      waitFor?: string | string[];
      closeOpenLayer?: boolean;
    };

export const VALID_STEP_IDS: SetupStepId[] = [
  "dashboard",
  "first_lead",
  "first_property",
  "pipeline",
  "contacts",
  "conversations",
  "agenda",
  "profile",
  "whatsapp",
  "team",
  "teams",
  "distribution",
  "integrations_meta",
  "properties",
  "automations",
  "gamification",
  "financial",
  "ai",
  "site",
];

export const TOUR_PLANS: Partial<Record<SetupStepId, TourPlan>> = {
  dashboard: {
    route: "/dashboard",
    path: "/dashboard",
    items: [
      {
        selector: '[data-tour="dashboard-filters"]',
        title: "Periodo e filtros",
        body: "Escolha o período e use equipe, responsável, origem, campanha, anúncio, etiqueta e status para analisar um recorte específico. O indicador de imóveis segue apenas o acesso e o filtro de usuário/equipe.",
      },
      {
        selector: '[data-tour="dashboard-kpi-leads"]',
        title: "Leads",
        body: "Este quadrado mostra todos os leads captados no periodo selecionado, independentemente da etapa atual.",
        closeOpenLayer: true,
      },
      {
        selector: '[data-tour="dashboard-kpi-open"]',
        title: "Em aberto",
        body: "Mostra os leads que ainda estão em atendimento e precisam de acompanhamento.",
      },
      {
        selector: '[data-tour="dashboard-kpi-lost"]',
        title: "Perdidos",
        body: "Mostra leads marcados como perdidos. Quando houver dados, o card abre um resumo dos motivos.",
      },
      {
        selector: '[data-tour="dashboard-lost-dialog"]',
        title: "Relatorio de perdidos",
        body: "Ao abrir o card de perdidos, o CRM mostra motivos, distribuicao e os leads que foram perdidos no periodo filtrado.",
        action: {
          type: "click",
          selector: '[data-tour="dashboard-kpi-lost"]',
          waitFor: '[data-tour="dashboard-lost-dialog"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="dashboard-kpi-won"]',
        title: "Ganhos",
        body: "Mostra negocios ganhos e ajuda a acompanhar conversao e resultado comercial.",
        closeOpenLayer: true,
      },
      {
        selector: '[data-tour="dashboard-won-dialog"]',
        title: "Relatorio de ganhos",
        body: "Ao abrir ganhos, voce confere conversao, VGV dos ganhos, ticket medio, tempo de conversao e a lista de negocios fechados.",
        action: {
          type: "click",
          selector: '[data-tour="dashboard-kpi-won"]',
          waitFor: '[data-tour="dashboard-won-dialog"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="dashboard-kpi-visits"]',
        title: "Visitas",
        body: "Mostra visitas e reunioes criadas no periodo em relacao ao volume de leads.",
        closeOpenLayer: true,
      },
      {
        selector: '[data-tour="dashboard-kpi-vgv"]',
        title: "VGV",
        body: "Mostra o valor geral de vendas considerado no painel.",
      },
      {
        selector: '[data-tour="dashboard-kpi-first-contact"]',
        title: "Primeiro contato",
        body: "Ajuda a entender quanto tempo o time leva para fazer a primeira acao com o lead.",
      },
      {
        selector: '[data-tour="dashboard-kpi-properties"]',
        title: "Imoveis",
        body: "Administradores veem todos os imoveis da organizacao. Usuarios comuns veem os imoveis do proprio acesso. Quando um usuario e selecionado nos filtros, este numero considera os imoveis em que ele esta definido como responsavel e nao muda com o periodo do dashboard.",
      },
      {
        selector: '[data-tour="dashboard-evolution"]',
        title: "Evolucao do negocio",
        body: "Aqui voce acompanha a evolucao de abertos, ganhos e perdidos ao longo do periodo.",
      },
      {
        selector: '[data-tour="dashboard-funnel"]',
        title: "Funil de vendas",
        body: "Mostra como os leads estão distribuídos pelas etapas do funil.",
      },
      {
        selector: '[data-tour="dashboard-sources"]',
        title: "Origem dos leads",
        body: "Mostra de onde os leads vieram para ajudar a entender quais canais estão funcionando melhor.",
      },
    ],
  },
  first_lead: {
    route: "/crm/contacts?new=lead",
    path: "/crm/contacts",
    items: [
      {
        selector: '[data-tour="contacts-new"]',
        title: "Criar primeiro lead",
        body: "Clique aqui para abrir o cadastro manual. Ele é o caminho mais rápido para conhecer o fluxo antes da entrada automática por integrações.",
      },
      {
        selector: '[data-tour="pipeline-new-lead"]',
        title: "Cadastro em três etapas",
        body: "O formulário atual separa contato, perfil e gestão. Assim os dados essenciais ficam claros antes de escolher responsável e destino.",
        action: {
          type: "click",
          selector: '[data-tour="contacts-new"]',
          waitFor: '[data-tour="pipeline-new-lead"]',
        },
      },
      {
        selector: '[data-tour="lead-form-basic"]',
        title: "Dados básicos",
        body: "Comece por nome, telefone ou e-mail, origem e observações. Nome e pelo menos um meio de contato identificam o lead corretamente.",
      },
      {
        selector: '[data-tour="lead-form-profile"]',
        title: "Perfil e interesse",
        body: "Nesta aba você pode registrar profissão, renda, faixa de interesse e o imóvel relacionado ao atendimento.",
        action: {
          type: "click",
          selector: '[data-tour="lead-form-tab-profile"]',
          waitFor: '[data-tour="lead-form-profile"]',
        },
      },
      {
        selector: '[data-tour="lead-form-management"]',
        title: "Gestão do lead",
        body: "Finalize escolhendo responsável, status, pipeline, etapa e tags. É aqui que o lead ganha um destino comercial claro.",
        action: {
          type: "click",
          selector: '[data-tour="lead-form-tab-management"]',
          waitFor: '[data-tour="lead-form-management"]',
        },
      },
      {
        selector: '[data-tour="lead-form-submit"]',
        title: "Salvar o lead",
        body: "Depois de preencher os campos obrigatórios, crie o lead. Ele aparecerá em Contatos e na etapa selecionada da Pipeline.",
      },
    ],
  },
  first_property: {
    route: "/properties/new",
    path: "/properties/new",
    items: [
      {
        selector: '[data-tour="property-form"]',
        title: "Cadastro do primeiro imovel",
        body: "Este e o formulario completo de imovel. Ele organiza proprietario, dados comerciais, localizacao, valores, fotos e publicacao.",
      },
      {
        selector: '[data-tour="property-form-tabs"]',
        title: "Abas do cadastro",
        body: "Use as abas para navegar por proprietario, estrutura, localizacao, valores, midias, publicacao, comissoes e informacoes internas.",
      },
      {
        selector: '[data-tour="property-owner-section"]',
        title: "Responsavel e proprietario",
        body: "Defina quem captou o imovel e registre os dados do proprietario. Isso tambem controla quem pode editar depois.",
      },
      {
        selector: '[data-tour="property-structure-section"]',
        title: "Dados do imovel",
        body: "Informe titulo, tipo de imovel, modalidade e status. Esses dados ajudam a organizar busca e atendimento.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-structure"]',
          waitFor: '[data-tour="property-structure-section"]',
        },
      },
      {
        selector: '[data-tour="property-location-section"]',
        title: "Localizacao",
        body: "Preencha cidade, bairro, endereco e dados de localizacao para facilitar filtros, visitas e apresentacao ao lead.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-location"]',
          waitFor: '[data-tour="property-location-section"]',
        },
      },
      {
        selector: '[data-tour="property-values-section"]',
        title: "Valores",
        body: "Registre venda, locacao, condominio, IPTU e encargos importantes para a negociacao.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-values"]',
          waitFor: '[data-tour="property-values-section"]',
        },
      },
      {
        selector: '[data-tour="property-media-section"]',
        title: "Fotos e descricao",
        body: "Adicione fotos, video, tour virtual e descricoes internas ou publicas. Isso melhora a apresentacao do imovel.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-media"]',
          waitFor: '[data-tour="property-media-section"]',
        },
      },
      {
        selector: '[data-tour="property-publication-section"]',
        title: "Publicacao",
        body: "Quando o modulo de site estiver liberado, configure se o imovel sera anunciado, destacado e publicado.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-publication"]',
          waitFor: '[data-tour="property-publication-section"]',
        },
      },
      {
        selector: '[data-tour="property-commissions-section"]',
        title: "Comissoes e condicoes",
        body: "Defina a comissao do captador, percentuais e condicoes comerciais. Estes dados apoiam o fechamento e o financeiro quando o modulo estiver ativo.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-commissions"]',
          waitFor: '[data-tour="property-commissions-section"]',
        },
      },
      {
        selector: '[data-tour="property-confidential-section"]',
        title: "Dados confidenciais",
        body: "Guarde documentacao e observacoes internas que nao devem aparecer no site publico. Revise as permissoes antes de preencher dados sensiveis.",
        action: {
          type: "click",
          selector: '[data-tour="property-tab-confidential"]',
          waitFor: '[data-tour="property-confidential-section"]',
        },
      },
      {
        selector: '[data-tour="property-save-button"]',
        title: "Salvar imovel",
        body: "Depois de preencher os campos obrigatorios, salve para deixar o imovel disponivel na carteira.",
      },
    ],
  },
  pipeline: {
    route: "/crm/pipelines",
    path: "/crm/pipelines",
    items: [
      {
        selector: '[data-tour="pipeline-selector"]',
        title: "Selecionar pipeline",
        body: "Aqui voce troca entre pipelines quando a organizacao tiver mais de um funil.",
      },
      {
        selector: '[data-tour="pipeline-filters"]',
        title: "Filtros da pipeline",
        body: "Use periodo, busca, equipe, responsavel, origem, campanha, anuncio, tag e status para enxergar o recorte correto da pipeline.",
      },
      {
        selector: '[data-tour="pipeline-column"]',
        title: "Colunas da pipeline",
        body: "Cada coluna representa uma etapa do atendimento. Os leads avancam conforme o processo comercial.",
      },
      {
        selector: '[data-tour="pipeline-column-settings"]',
        title: "Configuração da coluna",
        body: "Aqui administradores ajustam nome, cor, cadencias e automacoes da etapa. Use com cuidado para nao alterar o fluxo da equipe por engano.",
      },
      {
        selector: '[data-tour="pipeline-new-lead"]',
        title: "Criar lead",
        body: "Use o botao Novo Lead no topo. O cadastro entra pelo fluxo padrao da pipeline, sem ocupar uma acao em cada coluna.",
      },
      {
        selector: '[data-tour="pipeline-lead-card"]',
        title: "Card do lead",
        body: "O card abre dados, historico, mensagens, feedback, agenda, cadencias, campanha, anexos e contexto comercial do lead.",
        missingTitle: "Card do lead",
        missingBody:
          "Este passo aparece quando existe pelo menos um lead na pipeline. O ideal e cadastrar o primeiro lead antes de revisar os detalhes do card.",
      },
      {
        selector: '[data-tour="lead-detail-dialog"]',
        title: "Detalhes do lead",
        body: "Ao abrir o card, tudo fica concentrado em uma tela: dados do contato, etapas, agenda, cadencias, historico e mensagens.",
        action: {
          type: "click",
          selector: '[data-tour="pipeline-lead-card"]',
          waitFor: '[data-tour="lead-detail-dialog"]',
          closeOpenLayer: true,
        },
        missingTitle: "Detalhes do lead",
        missingBody:
          "Este passo depende de um lead aberto na pipeline. Quando houver um lead, o guia abre o card automaticamente.",
      },
      {
        selector: '[data-tour="lead-detail-stages"]',
        title: "Etapas do atendimento",
        body: "No topo voce move o lead entre etapas. O historico deve registrar de onde ele saiu e para onde foi.",
      },
      {
        selector: '[data-tour="lead-detail-tags"]',
        title: "Tags do lead",
        body: "Use tags para marcar perfil, prioridade, origem complementar ou qualquer sinal importante para o atendimento.",
      },
      {
        selector: '[data-tour="lead-detail-contact"]',
        title: "Dados do contato",
        body: "Aqui ficam telefone, email, responsavel, origem, campanha e dados comerciais disponiveis para o atendimento.",
      },
      {
        selector: '[data-tour="lead-detail-documents"]',
        title: "Documentacao",
        body: "Use anexos para guardar documentos do lead. Quem nao tiver permissao deve apenas visualizar o que estiver liberado.",
      },
      {
        selector: '[data-tour="lead-detail-agenda"]',
        title: "Agenda do lead",
        body: "Agende visita, ligacao, reuniao, mensagem ou tarefa sem sair do card do lead.",
      },
      {
        selector: '[data-tour="lead-detail-cadence"]',
        title: "Cadencias",
        body: "Mostra as atividades previstas para a etapa atual, como follow-up, confirmacao ou acompanhamento.",
      },
      {
        selector: '[data-tour="lead-detail-feedback"]',
        title: "Feedback",
        body: "Registre observacoes comerciais, objeções, proximos passos e qualquer contexto que ajude a equipe.",
      },
      {
        selector: '[data-tour="lead-detail-history"]',
        title: "Historico e mensagens",
        body: "Aqui ficam mensagens, mudancas de etapa, respostas de formulario, criativos da Meta e eventos importantes do lead.",
      },
      {
        selector: '[data-tour="pipeline-refresh"]',
        title: "Atualizar",
        body: "Se precisar, este botao forca uma nova leitura da pipeline.",
        closeOpenLayer: true,
      },
    ],
  },
  contacts: {
    route: "/crm/contacts",
    path: "/crm/contacts",
    items: [
      {
        selector: '[data-tour="contacts-filters"]',
        title: "Filtros e busca",
        body: "Aqui voce busca por nome, telefone ou email e filtra por periodo, equipe, responsavel, origem, campanha, tag e status.",
      },
      {
        selector: '[data-tour="contacts-count"]',
        title: "Quantidade de leads",
        body: "Este contador mostra quantos leads aparecem com os filtros atuais.",
      },
      {
        selector: '[data-tour="contacts-new"]',
        title: "Novo lead",
        body: "Use este botao para cadastrar um lead manualmente.",
      },
      {
        selector: '[data-tour="contacts-import"]',
        title: "Importar e exportar",
        body: "Aqui ficam as acoes de importacao e exportacao da base quando o perfil tiver permissao.",
      },
      {
        selector: '[data-tour="contacts-import-action"]',
        title: "Importar leads",
        body: "Use a importacao quando precisar subir uma planilha para criar ou complementar leads dentro da base.",
        action: {
          type: "click",
          selector: '[data-tour="contacts-import"]',
          waitFor: '[data-tour="contacts-import-action"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="contacts-export-action"]',
        title: "Exportar leads",
        body: "A exportacao gera uma planilha com dados do lead, status, atendimento, pipeline, responsavel, origem, campanha e informacoes comerciais disponiveis.",
        action: {
          type: "click",
          selector: '[data-tour="contacts-import"]',
          waitFor: '[data-tour="contacts-export-action"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="contacts-filters-panel"]',
        title: "Status do negocio",
        body: "Abra os filtros e escolha Perdido para revisar os leads encerrados e os motivos registrados na lista.",
        action: {
          type: "click",
          selector: '[data-tour="contacts-advanced-filters"]',
          waitFor: '[data-tour="contacts-filters-panel"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="contacts-list"]',
        title: "Lista de contatos",
        body: "A tabela mostra dados do lead, status, responsavel, origem, pipeline, etapa e datas principais.",
      },
      {
        selector: '[data-tour="contacts-select-all"]',
        title: "Selecao em massa",
        body: "Quando permitido, voce seleciona varios contatos para aplicar acoes em lote.",
      },
    ],
  },
  conversations: {
    route: "/crm/conversas",
    path: "/crm/conversas",
    items: [
      {
        selector: '[data-tour="conversations-overview"]',
        title: "Conversas do WhatsApp",
        body: "A lateral mostra conversas, grupos e atendimentos disponiveis para o seu acesso.",
      },
      {
        selector: '[data-tour="conversations-channel"]',
        title: "Canais",
        body: "Use estes controles para alternar o tipo de conversa que quer visualizar.",
      },
      {
        selector: '[data-tour="conversations-search"]',
        title: "Buscar conversa",
        body: "Pesquise rapidamente por contato, numero ou texto relacionado.",
      },
      {
        selector: '[data-tour="conversations-hide-groups"]',
        title: "Ocultar grupos",
        body: "Este controle ajuda a manter o atendimento focado em conversas individuais.",
        action: {
          type: "click",
          selector: '[data-tour="conversations-filters"]',
          waitFor: '[data-tour="conversations-hide-groups"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="conversations-archived"]',
        title: "Arquivadas",
        body: "Use para incluir ou remover conversas arquivadas da lista.",
        action: {
          type: "click",
          selector: '[data-tour="conversations-filters"]',
          waitFor: '[data-tour="conversations-archived"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="conversations-list"]',
        title: "Lista de atendimentos",
        body: "Clique em uma conversa para abrir mensagens, vinculo com lead e continuidade do atendimento.",
      },
      {
        selector: '[data-tour="conversations-chat"]',
        title: "Abrir uma conversa",
        body: "Ao selecionar um atendimento, o CRM abre cabecalho, mensagens e campo de envio sem misturar organizacao, conexao ou contato.",
        action: {
          type: "click",
          selector: '[data-tour="conversations-item"] button',
          waitFor: '[data-tour="conversations-messages"]',
        },
        missingTitle: "Abrir uma conversa",
        missingBody:
          "Quando houver uma conversa visivel, o guia abre o primeiro atendimento automaticamente.",
      },
      {
        selector: '[data-tour="conversations-messages"]',
        title: "Historico de mensagens",
        body: "Aqui aparecem textos, imagens, audios, videos, documentos, figurinhas e status de envio. O historico deve permanecer ligado ao contato correto.",
        missingTitle: "Historico de mensagens",
        missingBody: "Selecione uma conversa para visualizar este ponto.",
      },
      {
        selector: '[data-tour="conversations-composer"]',
        title: "Enviar mensagens",
        body: "Use o campo inferior para texto e midias somente pela conexao liberada para o seu usuario.",
        missingTitle: "Enviar mensagens",
        missingBody:
          "O campo aparece quando uma conversa e uma conexão válida estão selecionadas.",
      },
    ],
  },
  agenda: {
    route: "/agenda",
    path: "/agenda",
    items: [
      {
        selector: '[data-tour="agenda-period"]',
        title: "Periodo da agenda",
        body: "Aqui voce volta para hoje, navega entre datas e entende qual periodo esta aberto.",
      },
      {
        selector: '[data-tour="agenda-filters"]',
        title: "Filtros da agenda",
        body: "Use filtros para mudar visualizacao, exibir linhas de horario e filtrar por usuario quando permitido.",
      },
      {
        selector: '[data-tour="agenda-new"]',
        title: "Novo compromisso",
        body: "Crie visitas, reunioes, ligacoes, tarefas ou outros compromissos.",
      },
      {
        selector: '[data-tour="agenda-event-sheet"]',
        title: "Formulario da agenda",
        body: "Este formulario cria ou edita compromissos. Ele tambem pode ser aberto pelo card do lead quando a agenda estiver vinculada ao atendimento.",
        action: {
          type: "click",
          selector: '[data-tour="agenda-new"]',
          waitFor: '[data-tour="agenda-event-sheet"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="agenda-event-title"]',
        title: "Titulo do compromisso",
        body: "Use um titulo claro para a equipe entender rapidamente o que precisa ser feito.",
      },
      {
        selector: '[data-tour="agenda-event-type"]',
        title: "Tipo de atividade",
        body: "Escolha se e ligacao, e-mail, reuniao, tarefa, mensagem ou visita ao imovel. O tipo ajuda filtros e historico.",
      },
      {
        selector: '[data-tour="agenda-event-date"]',
        title: "Data e horario",
        body: "Defina data, horario de inicio e fim. Tambem e aqui que ficam dia inteiro e repeticao do compromisso.",
      },
      {
        selector: '[data-tour="agenda-event-all-day"]',
        title: "Dia inteiro",
        body: "Ative quando o compromisso não tiver horário específico.",
      },
      {
        selector: '[data-tour="agenda-event-recurrence"]',
        title: "Repeticao",
        body: "Use para compromissos recorrentes, como semanal, mensal ou anual.",
      },
      {
        selector: '[data-tour="agenda-event-assignees"]',
        title: "Responsaveis",
        body: "Defina quem participa ou responde por esse compromisso. Isso evita que tarefas fiquem sem dono.",
      },
      {
        selector: '[data-tour="agenda-event-visibility"]',
        title: "Visibilidade",
        body: "Escolha se o compromisso segue o padrao da organizacao, fica publico para a equipe ou privado quando permitido.",
      },
      {
        selector: '[data-tour="agenda-event-property"]',
        title: "Imovel vinculado",
        body: "Quando for visita ou atendimento ligado a um imovel, vincule a unidade para manter contexto no CRM.",
      },
      {
        selector: '[data-tour="agenda-event-notes"]',
        title: "Observacoes",
        body: "Registre detalhes da visita, combinados, orientacoes e qualquer informacao util para o atendimento.",
      },
      {
        selector: '[data-tour="agenda-calendar"]',
        title: "Calendario",
        body: "Aqui aparecem os compromissos. Clique em um evento para editar ou em um horario vazio para criar rapidamente.",
        closeOpenLayer: true,
      },
    ],
  },
  profile: {
    route: "/settings?tab=account",
    path: "/settings",
    items: [
      {
        selector: '[data-tour="account-profile"]',
        title: "Dados da conta",
        body: "Atualize dados pessoais, telefone, identificacao e preferencias do usuario.",
      },
      {
        selector: '[data-tour="account-avatar"]',
        title: "Foto do perfil",
        body: "A foto ajuda a equipe a identificar o responsavel por leads, mensagens e atividades.",
      },
      {
        selector: '[data-tour="account-edit-profile"]',
        title: "Editar dados pessoais",
        body: "Abra a edicao para atualizar nome, CPF e WhatsApp. O telefone correto e importante para notificacoes e identificacao.",
      },
      {
        selector: '[data-tour="account-preferences"]',
        title: "Idioma e tema",
        body: "Escolha o idioma e use tema claro, escuro ou o padrao do dispositivo. A preferencia acompanha o seu usuario.",
      },
      {
        selector: '[data-tour="account-password"]',
        title: "Senha",
        body: "Aqui fica a troca de senha para manter a conta segura.",
      },
      {
        selector: '[data-tour="account-company"]',
        title: "Dados da empresa",
        body: "Esta área guarda logo, dados fiscais, endereço e contatos públicos da organização. Usuários comuns apenas consultam; administradores podem editar.",
      },
      {
        selector: '[data-tour="account-company-edit"]',
        title: "Editar empresa",
        body: "Administradores usam este botao para liberar os campos da organizacao e salvar as alteracoes.",
        missingTitle: "Editar empresa",
        missingBody:
          "Este botao aparece somente para administradores da organizacao.",
      },
      {
        selector: '[data-tour="account-financial-settings"]',
        title: "Configuração financeira",
        body: "A comissao padrao e usada como referencia nos calculos de comissao. O icone de informacao explica o efeito desse percentual.",
        missingTitle: "Configuração financeira",
        missingBody: "Este bloco aparece somente para administradores.",
      },
    ],
  },
  whatsapp: {
    route: "/settings?tab=integrations",
    path: "/settings",
    items: [
      {
        selector: '[data-tour="whatsapp-integration-card"]',
        title: "Integracao WhatsApp",
        body: "Este card abre o gerenciamento das conexoes de WhatsApp liberadas para o seu acesso.",
      },
      {
        selector: '[data-tour="whatsapp-integration-dialog"]',
        title: "Gerenciar conexoes",
        body: "Aqui voce cria conexoes, acompanha status, verifica QR Code, gerencia usuarios e define se uma conexao dispara notificacoes.",
        action: {
          type: "click",
          selector: '[data-tour="whatsapp-integration-button"]',
          waitFor: '[data-tour="whatsapp-integration-dialog"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="whatsapp-new-session"]',
        title: "Nova conexao",
        body: "Use este botao para iniciar a conexao de um novo numero. Se o limite do plano foi atingido, ele fica bloqueado.",
      },
      {
        selector: '[data-tour="whatsapp-create-dialog"]',
        title: "Nome da conexao",
        body: "Dê um nome claro para identificar o numero, como Vendas, Atendimento ou Nome do corretor. Depois o QR Code sera gerado.",
        action: {
          type: "click",
          selector: '[data-tour="whatsapp-new-session"]',
          waitFor: '[data-tour="whatsapp-create-dialog"]',
        },
      },
      {
        selector: '[data-tour="whatsapp-session-card"]',
        title: "Conexao existente",
        body: "Cada bloco mostra uma conexao do WhatsApp, dono, status e acoes disponiveis. Usuarios devem ver apenas conexoes do proprio acesso.",
        closeOpenLayer: true,
        missingTitle: "Conexao existente",
        missingBody:
          "Quando houver uma conexao criada, ela aparecera aqui com status conectado, desconectado ou aguardando leitura do QR Code.",
      },
      {
        selector: '[data-tour="whatsapp-verify-button"]',
        title: "Verificar conexao",
        body: "Use para confirmar se o backend ainda reconhece o WhatsApp como conectado e pronto para enviar ou receber mensagens.",
        missingTitle: "Verificar conexao",
        missingBody: "Este botao aparece em conexoes criadas.",
      },
      {
        selector: '[data-tour="whatsapp-notification-toggle"]',
        title: "Disparo de notificacoes",
        body: "Quando ativado, essa conexao pode ser usada pelo backend para enviar notificacoes importantes pelo WhatsApp.",
        missingTitle: "Disparo de notificacoes",
        missingBody:
          "Esse controle aparece para administradores quando existe uma conexao cadastrada.",
      },
      {
        selector: '[data-tour="whatsapp-qr-dialog"]',
        title: "QR Code",
        body: "Quando a conexao estiver aguardando leitura, abra o QR Code e escaneie pelo WhatsApp do celular autorizado.",
        action: {
          type: "click",
          selector: '[data-tour="whatsapp-qr-button"]',
          waitFor: '[data-tour="whatsapp-qr-dialog"]',
        },
        missingTitle: "QR Code",
        missingBody:
          "O QR Code aparece quando a conexao ainda nao esta conectada ou precisa ser reconectada.",
      },
      {
        selector: [
          '[data-tour="whatsapp-disconnect-button"]',
          '[data-tour="whatsapp-delete-button"]',
        ],
        title: "Desconectar ou apagar",
        body: "Desconectar tira o numero do ar. Apagar remove a conexao. Use com cuidado, principalmente quando existem conversas vinculadas ao atendimento.",
        missingTitle: "Desconectar ou apagar",
        missingBody: "Essas acoes aparecem quando uma conexao existe.",
      },
    ],
  },
  team: {
    route: "/settings?tab=team",
    path: "/settings",
    items: [
      {
        selector: '[data-tour="team-add-user"]',
        title: "Convidar usuario",
        body: "Novos acessos entram por convite. Informe os dados e o perfil inicial; a pessoa conclui o cadastro pelo link recebido.",
      },
      {
        selector: '[data-tour="team-invite-dialog"]',
        title: "Dados do convite",
        body: "Preencha nome, e-mail, telefone e perfil inicial. O sistema envia um convite; ele nao cria nem compartilha uma senha pronta.",
        action: {
          type: "click",
          selector: '[data-tour="team-add-user"]',
          waitFor: '[data-tour="team-invite-dialog"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="team-users-list"]',
        title: "Usuarios da organizacao",
        body: "A lista mostra quem está ativo e quais perfis e funções estão aplicados. Use essa leitura antes de alterar um acesso.",
        closeOpenLayer: true,
      },
      {
        selector: '[data-tour="team-user-role"]',
        title: "Usuário, gestor ou administrador",
        body: "Usuários atuam no próprio escopo. Gestores acompanham todos os leads e consultam equipes. Administradores gerenciam toda a organização.",
      },
      {
        selector: '[data-tour="team-user-active"]',
        title: "Ativar ou desativar",
        body: "Desativar bloqueia o acesso sem apagar o historico. E a opcao mais segura quando a pessoa sai temporariamente da operacao.",
      },
      {
        selector: '[data-tour="team-user-delete"]',
        title: "Excluir usuario",
        body: "A exclusao e definitiva e exige revisar a transferencia de leads e imoveis. Prefira desativar quando houver duvida.",
      },
    ],
  },
  teams: {
    route: "/crm/management?tab=teams",
    path: "/crm/management",
    items: [
      {
        selector: '[data-tour="management-teams"]',
        title: "Gestão de equipes",
        body: "Aqui você acompanha status, membros, líderes e quem criou cada equipe.",
      },
      {
        selector: '[data-tour="management-team-new"]',
        title: "Nova equipe",
        body: "Este botão abre a página completa de criação, onde nome, imagem, membros e escalas são definidos antes do primeiro salvamento.",
        missingTitle: "Criação de equipe",
        missingBody:
          "A criação aparece somente para administradores ou perfis com permissão de gestão de equipes.",
      },
      {
        selector: '[data-tour="management-team-list"]',
        title: "Lista de equipes",
        body: "Cada linha resume status, foto da equipe, pessoas, liderança, criador e data.",
        missingTitle: "Lista de equipes",
        missingBody: "As equipes cadastradas aparecerão aqui.",
      },
      {
        selector: '[data-tour="management-team-edit"]',
        title: "Página da equipe",
        body: "Editar abre a página dedicada com indicadores, membros, escalas e histórico de alterações.",
        missingTitle: "Página da equipe",
        missingBody:
          "Quando uma equipe existir, use Editar para abrir sua página completa.",
      },
      {
        selector: '[data-tour="management-team-member"]',
        title: "Escala por membro",
        body: "A foto de cada membro permite consultar rapidamente sua disponibilidade; a edição completa fica na página da equipe.",
        missingTitle: "Escala por membro",
        missingBody: "Este atalho aparece quando a equipe possui membros.",
      },
    ],
  },
  distribution: {
    route: "/crm/management?tab=distribution",
    path: "/crm/management",
    items: [
      {
        selector: '[data-tour="distribution-new-queue"]',
        title: "Nova fila",
        body: "Crie filas para distribuir leads automaticamente entre usuarios ou equipes. Filas sem regra de entrada nao capturam leads.",
      },
      {
        selector: '[data-tour="distribution-queue-editor"]',
        title: "Formulario da fila",
        body: "O cadastro reune destino, regras, participantes e redistribuicao. Revise cada bloco antes de ativar a fila.",
        action: {
          type: "click",
          selector: '[data-tour="distribution-new-queue"]',
          waitFor: '[data-tour="distribution-queue-editor"]',
          closeOpenLayer: true,
        },
      },
      {
        selector: '[data-tour="distribution-queue-basic"]',
        title: "Destino e estrategia",
        body: "Informe nome, estrategia, pipeline e etapa inicial. Todo lead aceito por esta fila seguira para esse destino.",
      },
      {
        selector: '[data-tour="distribution-queue-rules"]',
        title: "Regras de entrada",
        body: "Defina canal, formulario, webhook, origem, tag ou outra condicao. Uma regra ja usada em outra fila nao deve ser duplicada.",
      },
      {
        selector: '[data-tour="distribution-queue-members"]',
        title: "Participantes",
        body: "Adicione usuarios individualmente ou equipes. Equipes permanecem dinamicas: novos membros ativos passam a participar conforme a disponibilidade configurada na propria equipe.",
      },
      {
        selector: '[data-tour="distribution-queue-redistribution"]',
        title: "Redistribuicao",
        body: "Opcionalmente, mova leads sem acao humana depois do prazo. Essa regra vale apenas para leads que entrarem pela fila apos a ativacao.",
      },
      {
        selector: '[data-tour="distribution-queue-save"]',
        title: "Validar e salvar",
        body: "O botao so libera quando destino, regra e participantes obrigatorios estiverem validos. Salvar nao deve alterar leads antigos.",
      },
    ],
  },
  integrations_meta: {
    route: "/settings?tab=integrations",
    path: "/settings",
    items: [
      {
        selector: '[data-tour="meta-integration"]',
        title: "Facebook / Meta",
        body: "Abra esta integracao para conectar contas, paginas, formularios e destinos dos leads.",
      },
    ],
  },
  properties: {
    route: "/properties",
    path: "/properties",
    items: [
      {
        selector: '[data-tour="properties-new-button"]',
        title: "Novo imovel",
        body: "Use este botao para cadastrar um novo imovel na carteira quando seu perfil tiver permissao.",
      },
      {
        selector: [
          '[data-tour="properties-filter-button"]',
          '[data-tour="properties-filters-panel"]',
        ],
        title: "Filtros da carteira",
        body: "Abra filtros para buscar por tipo, modalidade, responsavel, cidade, bairro, quartos, valor e outras caracteristicas.",
      },
      {
        selector: '[data-tour="properties-filters-panel"]',
        title: "Painel de filtros",
        body: "Aqui voce refina a busca sem sair da carteira. E util quando a base tiver muitos imoveis.",
        action: {
          type: "click",
          selector: [
            '[data-tour="properties-filter-button"]',
            '[data-tour="properties-filters-panel"]',
          ],
          waitFor: '[data-tour="properties-filters-panel"]',
        },
      },
      {
        selector: '[data-tour="properties-filter-search"]',
        title: "Busca rapida",
        body: "Pesquise por endereco, nome, bairro ou codigo do imovel. A busca textual pode ser combinada com os demais filtros.",
      },
      {
        selector: '[data-tour="properties-filter-modality"]',
        title: "Modalidade",
        body: "Separe venda, locacao, venda e locacao, temporada ou lancamento.",
      },
      {
        selector: '[data-tour="properties-filter-availability"]',
        title: "Disponibilidade",
        body: "Encontre imoveis disponiveis, reservados, vendidos, alugados, inativos ou privados.",
      },
      {
        selector: '[data-tour="properties-filter-type"]',
        title: "Tipo de imovel",
        body: "Filtre apartamento, casa, terreno e os demais tipos cadastrados na organizacao.",
      },
      {
        selector: '[data-tour="properties-filter-location"]',
        title: "Cidade e bairro",
        body: "As opcoes sao geradas a partir das localidades cadastradas e ajudam a reduzir a carteira por regiao.",
      },
      {
        selector: '[data-tour="properties-filter-responsible"]',
        title: "Responsavel",
        body: "Mostra os imoveis em que a pessoa selecionada esta definida como responsavel pela captacao.",
      },
      {
        selector: '[data-tour="properties-filter-value"]',
        title: "Faixa de valor",
        body: "Defina valores minimo e maximo para aproximar a carteira do orcamento do cliente.",
      },
      {
        selector: '[data-tour="properties-filter-more-panel"]',
        title: "Filtros avancados",
        body: "Aqui ficam proprietario, condominio, mobília, quartos, suites, banheiros, vagas, areas, financiamento, permuta e demais criterios internos.",
        action: {
          type: "click",
          selector: '[data-tour="properties-filter-more"]',
          waitFor: '[data-tour="properties-filter-more-panel"]',
        },
      },
      {
        selector: '[data-tour="properties-list"]',
        title: "Lista de imoveis",
        body: "A lista mostra os imoveis disponiveis. Administradores enxergam mais itens; usuarios comuns seguem o acesso permitido.",
      },
    ],
  },
  automations: {
    route: "/automations",
    path: "/automations",
    items: [
      {
        selector: '[data-tour="automations-tabs"]',
        title: "Abas de automacoes",
        body: "Aqui voce alterna entre automacoes publicadas, modelos e historico de execucao.",
      },
      {
        selector: '[data-tour="automations-new"]',
        title: "Nova automacao",
        body: "Use para criar um fluxo novo quando o perfil e o plano permitirem editar automacoes.",
      },
      {
        selector: '[data-tour="automations-list"]',
        title: "Lista de automacoes",
        body: "Mostra fluxos ativos, status e acoes para editar, duplicar, pausar ou acompanhar historico.",
      },
    ],
  },
  gamification: {
    route: "/gamificacao",
    path: "/gamificacao",
    items: [
      {
        selector: '[data-tour="gamification-arena"]',
        title: "Arena imobiliaria",
        body: "A arena mostra pódio, classificação e ranking em tempo real quando os eventos de pontos estão conectados.",
      },
      {
        selector: '[data-tour="gamification-dashboard"]',
        title: "Dashboard da Arena",
        body: "Mostra desempenho, atividades recentes e uma leitura rapida dos pontos do usuario ou equipe.",
        action: {
          type: "hash",
          hash: "dashboard",
          waitFor: '[data-tour="gamification-dashboard"]',
        },
      },
      {
        selector: '[data-tour="gamification-history"]',
        title: "Historico de pontos",
        body: "Registra as acoes que geraram pontuacao para manter transparencia com a equipe.",
        action: {
          type: "hash",
          hash: "history",
          waitFor: '[data-tour="gamification-history"]',
        },
      },
      {
        selector: '[data-tour="gamification-config"]',
        title: "Configuração da gamificação",
        body: "Para administradores, aqui ficam regras, missoes, participantes, temporadas e aprovacoes manuais.",
        action: {
          type: "hash",
          hash: "config",
          waitFor: '[data-tour="gamification-config"]',
        },
      },
    ],
  },
  financial: {
    route: "/financeiro",
    path: "/financeiro",
    items: [
      {
        selector: '[data-tour="financial-overview"]',
        title: "Visao financeira",
        body: "Este painel consolida a operacao financeira da organizacao sem misturar os dados com a rotina comercial da Pipeline.",
      },
      {
        selector: '[data-tour="financial-kpis"]',
        title: "Indicadores principais",
        body: "Confira VGV, ticket medio, receitas, despesas, vencimentos e comissoes antes de abrir os detalhes de cada area.",
      },
      {
        selector: '[data-tour="financial-actions"]',
        title: "Relatorios e DRE",
        body: "Administradores autorizados podem exportar o resumo e seguir para a leitura executiva da DRE.",
      },
    ],
  },
  ai: {
    route: "/settings?tab=ai",
    path: "/settings",
    items: [
      {
        selector: '[data-tour="ai-overview"]',
        title: "Central de IA",
        body: "Esta central reune a operacao da IA da organizacao. Ela so aparece para administradores com o modulo liberado.",
      },
      {
        selector: '[data-tour="ai-metrics"]',
        title: "Metricas da IA",
        body: "Acompanhe leads recebidos, atendimentos, follow-ups e o limite de agentes contratado.",
      },
      {
        selector: '[data-tour="ai-connections"]',
        title: "Conexoes autorizadas",
        body: "Selecione exatamente quais conexoes do WhatsApp a IA pode visualizar e atender.",
        action: {
          type: "click",
          selector: '[data-tour="ai-tab-connections"]',
          waitFor: '[data-tour="ai-connections"]',
        },
      },
      {
        selector: '[data-tour="ai-agents"]',
        title: "Agentes",
        body: "Crie ou revise o agente de triagem e os especialistas, respeitando o limite definido para a organizacao.",
        action: {
          type: "click",
          selector: '[data-tour="ai-tab-agents"]',
          waitFor: '[data-tour="ai-agents"]',
        },
      },
      {
        selector: '[data-tour="ai-routing"]',
        title: "Regras de roteamento",
        body: "Defina quando uma conversa vai para cada agente, por conexao, origem, pipeline ou conteudo da mensagem.",
        action: {
          type: "click",
          selector: '[data-tour="ai-tab-routing"]',
          waitFor: '[data-tour="ai-routing"]',
        },
      },
      {
        selector: '[data-tour="ai-test"]',
        title: "Teste antes de ativar",
        body: "Valide contexto e roteamento aqui antes de permitir respostas reais em uma conexao do WhatsApp.",
        action: {
          type: "click",
          selector: '[data-tour="ai-tab-test"]',
          waitFor: '[data-tour="ai-test"]',
        },
      },
    ],
  },
  site: {
    route: "/settings/site",
    path: "/settings/site",
    items: [
      {
        selector: [
          '[data-tour="site-create-card"]',
          '[data-tour="site-settings"]',
        ],
        title: "Site imobiliario",
        body: "Aqui administradores configuram a vitrine publica, identidade, dominio, filtros e imoveis publicados.",
      },
      {
        selector: '[data-tour="site-settings-menu"]',
        title: "Menu do site",
        body: "Use este menu para alternar entre identidade, conteudo, dominio, busca, publicacao e outras configuracoes do site.",
        missingTitle: "Menu do site",
        missingBody:
          "Depois de criar a configuração inicial do site, o menu aparece aqui.",
      },
      {
        selector: '[data-tour="site-general-settings"]',
        title: "Configuracoes gerais",
        body: "Aqui ficam publicacao, logo, favicon, titulo, descricao, endereco temporario e dominio proprio. Verifique o dominio antes de divulgar.",
        missingTitle: "Configuracoes gerais",
        missingBody:
          "Esta área aparece depois de iniciar a configuração do site.",
      },
      {
        selector: '[data-tour="site-appearance-settings"]',
        title: "Aparencia e identidade",
        body: "Configure logo, tema, cores, hero, banners e marca d'agua. Confira o contraste em desktop e mobile.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-appearance"]',
          waitFor: '[data-tour="site-appearance-settings"]',
        },
      },
      {
        selector: '[data-tour="site-menu-settings"]',
        title: "Menu e filtros publicos",
        body: "Organize os links do cabecalho e escolha quais filtros aparecem na busca publica de imoveis.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-menu"]',
          waitFor: '[data-tour="site-menu-settings"]',
        },
      },
      {
        selector: '[data-tour="site-about-settings"]',
        title: "Pagina sobre",
        body: "Conte a historia da imobiliaria, apresente diferenciais e escolha a imagem institucional.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-about"]',
          waitFor: '[data-tour="site-about-settings"]',
        },
      },
      {
        selector: '[data-tour="site-contact-settings"]',
        title: "Contato e atendimento",
        body: "Revise telefone, WhatsApp, e-mail e endereco usados nos formularios e botoes publicos.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-contact"]',
          waitFor: '[data-tour="site-contact-settings"]',
        },
      },
      {
        selector: '[data-tour="site-social-settings"]',
        title: "Redes sociais",
        body: "Cadastre os links oficiais que aparecem no rodape e em outros pontos publicos do site.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-social"]',
          waitFor: '[data-tour="site-social-settings"]',
        },
      },
      {
        selector: '[data-tour="site-seo-settings"]',
        title: "SEO e rastreamento",
        body: "Configure metatags, pixels e scripts somente com dados validados. Esses campos afetam compartilhamento, indexacao e analise do site.",
        action: {
          type: "click",
          selector: '[data-tour="site-tab-seo"]',
          waitFor: '[data-tour="site-seo-settings"]',
        },
      },
      {
        selector: '[data-tour="site-preview"]',
        title: "Revisar o site",
        body: "Abra a previa e teste home, busca, filtros, detalhes do imovel, favoritos, formularios, politica de privacidade e responsividade antes de publicar.",
        closeOpenLayer: true,
      },
      {
        selector: '[data-tour="site-save-button"]',
        title: "Salvar alteracoes",
        body: "Depois de ajustar configuracoes, salve para refletir no site publico.",
        missingTitle: "Salvar alteracoes",
        missingBody:
          "O botao de salvar aparece para administradores com site configurado.",
      },
    ],
  },
};

export function normalizeStepId(value: unknown): SetupStepId | null {
  if (typeof value !== "string") return null;
  return VALID_STEP_IDS.includes(value as SetupStepId)
    ? (value as SetupStepId)
    : null;
}

const GUIDE_ACCENT_REPLACEMENTS: Record<string, string> = {
  acoes: "ações",
  acao: "ação",
  anuncio: "anúncio",
  anuncios: "anúncios",
  area: "área",
  areas: "áreas",
  ate: "até",
  alteracoes: "alterações",
  aparencia: "aparência",
  avancados: "avançados",
  automatica: "automática",
  automatico: "automático",
  automacoes: "automações",
  basico: "básico",
  basicos: "básicos",
  botao: "botão",
  botoes: "botões",
  cadencia: "cadência",
  cadencias: "cadências",
  calendario: "calendário",
  classificacao: "classificação",
  codigo: "código",
  comissao: "comissão",
  comissoes: "comissões",
  condicoes: "condições",
  configuracao: "configuração",
  configuracoes: "configurações",
  conexao: "conexão",
  conexoes: "conexões",
  conversao: "conversão",
  descricao: "descrição",
  descricoes: "descrições",
  documentacao: "documentação",
  distribuicao: "distribuição",
  evolucao: "evolução",
  formulario: "formulário",
  formularios: "formulários",
  funcao: "função",
  funcoes: "funções",
  gestao: "gestão",
  historico: "histórico",
  historicos: "históricos",
  horario: "horário",
  imovel: "imóvel",
  imoveis: "imóveis",
  imobiliaria: "imobiliária",
  informacao: "informação",
  informacoes: "informações",
  integracao: "integração",
  integracoes: "integrações",
  ja: "já",
  ligacao: "ligação",
  ligacoes: "ligações",
  lideranca: "liderança",
  lideres: "líderes",
  localizacao: "localização",
  midia: "mídia",
  midias: "mídias",
  metricas: "métricas",
  modulo: "módulo",
  modulos: "módulos",
  nao: "não",
  negocio: "negócio",
  negocios: "negócios",
  numero: "número",
  numeros: "números",
  notificacoes: "notificações",
  obrigatorio: "obrigatório",
  obrigatorios: "obrigatórios",
  observacao: "observação",
  observacoes: "observações",
  operacao: "operação",
  organizacao: "organização",
  organizacoes: "organizações",
  pagina: "página",
  paginas: "páginas",
  periodo: "período",
  periodos: "períodos",
  permissao: "permissão",
  permissoes: "permissões",
  possivel: "possível",
  proximo: "próximo",
  proximos: "próximos",
  proprietario: "proprietário",
  proprietarios: "proprietários",
  publicacao: "publicação",
  publico: "público",
  publicos: "públicos",
  rapida: "rápida",
  rapido: "rápido",
  relacao: "relação",
  relatorio: "relatório",
  relatorios: "relatórios",
  repeticao: "repetição",
  redistribuicao: "redistribuição",
  responsavel: "responsável",
  responsaveis: "responsáveis",
  selecao: "seleção",
  sera: "será",
  serao: "serão",
  estrategia: "estratégia",
  tambem: "também",
  tres: "três",
  titulo: "título",
  usuario: "usuário",
  usuarios: "usuários",
  vinculo: "vínculo",
  visao: "visão",
  visualizacao: "visualização",
  voce: "você",
  voces: "vocês",
};

export function formatGuideText(value: string) {
  return Object.entries(GUIDE_ACCENT_REPLACEMENTS).reduce(
    (text, [plain, accented]) => {
      return text.replace(new RegExp(`\\b${plain}\\b`, "gi"), (match) => {
        return match[0] === match[0].toUpperCase()
          ? accented[0].toUpperCase() + accented.slice(1)
          : accented;
      });
    },
    value,
  );
}
