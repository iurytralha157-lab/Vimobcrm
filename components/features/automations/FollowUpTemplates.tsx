import { Badge } from '@/components/ui/badge';
import { Clock, Calendar, Plus, Building2, Zap } from 'lucide-react';

export interface FollowUpTemplate {
  id: string;
  name: string;
  description: string;
  days: number;
  industry: 'real_estate' | 'general';
  messages: {
    day: number;
    title: string;
    content: string;
  }[];
  onReplyMessage?: string;
}

export const DEFAULT_ON_REPLY_MESSAGE = "";

export const FOLLOW_UP_TEMPLATES: FollowUpTemplate[] = [
  {
    id: 'real_estate_3',
    name: 'Follow-up 3 Dias',
    description: 'Sequência rápida de 3 mensagens para leads quentes',
    days: 3,
    industry: 'real_estate',
    onReplyMessage: undefined,
    messages: [
      { day: 1, title: 'Primeiro contato', content: `Olá {{lead.name}}! 👋\n\nAqui é da {{organization.name}}. Vi que você demonstrou interesse em nossos imóveis.\n\nPosso ajudar a encontrar o imóvel perfeito para você? Qual região você está procurando?` },
      { day: 2, title: 'Lembrete', content: `Oi {{lead.name}}, tudo bem? \n\nSó passando para lembrar que estamos à disposição para ajudar na sua busca!\n\nTemos ótimas opções disponíveis. Quer que eu envie algumas sugestões?` },
      { day: 3, title: 'Última tentativa', content: `{{lead.name}}, última mensagem! 😊\n\nCaso ainda esteja procurando imóvel, ficarei feliz em ajudar.\n\nSe mudar de ideia, é só me chamar aqui!` },
    ],
  },
  {
    id: 'real_estate_6',
    name: 'Follow-up 6 Dias',
    description: 'Sequência completa para nutrir leads interessados',
    days: 6,
    industry: 'real_estate',
    onReplyMessage: undefined,
    messages: [
      { day: 1, title: 'Boas-vindas', content: `Olá {{lead.name}}! 👋\n\nSeja bem-vindo(a) à {{organization.name}}! \n\nEstou aqui para ajudar você a encontrar o imóvel ideal. Pode me contar um pouco sobre o que você busca? 🏠` },
      { day: 2, title: 'Apresentação', content: `Oi {{lead.name}}! Tudo bem?\n\nAproveitando para me apresentar melhor: sou consultor(a) imobiliário(a) e tenho acesso a diversas opções que podem te interessar.\n\nQual tipo de imóvel você está procurando? Casa, apartamento, terreno?` },
      { day: 3, title: 'Dica de mercado', content: `{{lead.name}}, você sabia? 📊\n\nO momento atual está muito favorável para quem quer comprar ou alugar imóvel.\n\nPosso te mostrar algumas oportunidades imperdíveis na sua região de interesse!` },
      { day: 4, title: 'Oferta especial', content: `Oi {{lead.name}}! \n\nSeparei algumas opções especiais que podem combinar com o que você procura.\n\nQuer que eu te envie os detalhes? É só me responder! 📱` },
      { day: 5, title: 'Convite para visita', content: `{{lead.name}}, que tal agendar uma visita? 🗓️\n\nPosso organizar para você conhecer pessoalmente os imóveis que mais se encaixam no seu perfil.\n\nQual o melhor dia e horário para você?` },
      { day: 6, title: 'Encerramento', content: `{{lead.name}}, última mensagem da nossa sequência! \n\nCaso precise de ajuda com imóveis no futuro, pode contar comigo.\n\nSalva meu contato e chama quando precisar! 🤝` },
    ],
  },
  {
    id: 'real_estate_10',
    name: 'Follow-up 10 Dias',
    description: 'Sequência estendida para leads que precisam mais tempo',
    days: 10,
    industry: 'real_estate',
    onReplyMessage: undefined,
    messages: [
      { day: 1, title: 'Primeiro contato', content: `Olá {{lead.name}}! 👋\n\nBem-vindo(a) à {{organization.name}}! \n\nEstou aqui para ajudar você na busca pelo imóvel ideal. O que você está procurando?` },
      { day: 2, title: 'Apresentação', content: `Oi {{lead.name}}! \n\nSou especialista em imóveis na região e posso te ajudar a encontrar opções que combinam com você.\n\nQual seu orçamento e localização de preferência?` },
      { day: 3, title: 'Opções disponíveis', content: `{{lead.name}}, temos várias opções interessantes! 🏠\n\nPosso te enviar uma seleção personalizada com base no que você procura.\n\nMe conta mais sobre suas preferências!` },
      { day: 4, title: 'Conteúdo educativo', content: `Oi {{lead.name}}! Dica do dia 📚\n\nSabia que é importante verificar a documentação do imóvel antes de fechar negócio?\n\nPosso te ajudar com isso também! Quer saber mais?` },
      { day: 5, title: 'Destaques da semana', content: `{{lead.name}}, olha só os destaques desta semana! ⭐\n\nSeparei algumas opções especiais com ótimas condições.\n\nQuer que eu te mostre?` },
      { day: 6, title: 'Convite para conhecer', content: `Oi {{lead.name}}! \n\nQue tal marcar uma visita para conhecer pessoalmente os imóveis?\n\nPosso organizar tudo para você! Qual sua disponibilidade? 🗓️` },
      { day: 7, title: 'Lembrete de benefícios', content: `{{lead.name}}, lembre-se dos benefícios de trabalhar comigo:\n\n✅ Atendimento personalizado\n✅ Opções selecionadas para você\n✅ Suporte em toda a negociação\n\nVamos conversar?` },
      { day: 8, title: 'Última promoção', content: `Oi {{lead.name}}! \n\nRecebi uma oportunidade imperdível que pode te interessar.\n\nPosso te contar mais? É por tempo limitado! ⏰` },
      { day: 9, title: 'Disponibilidade', content: `{{lead.name}}, só confirmando:\n\nContinuo à disposição para te ajudar quando precisar! \n\nÉ só me chamar aqui que respondo rapidinho 📱` },
      { day: 10, title: 'Despedida', content: `{{lead.name}}, última mensagem! \n\nFoi um prazer te conhecer. Quando decidir buscar um imóvel, pode contar comigo.\n\nSalva meu contato e até breve! 🤝` },
    ],
  },
];

interface FollowUpTemplatesProps {
  onSelectTemplate: (template: FollowUpTemplate | null) => void;
  canCreate?: boolean;
}

export function FollowUpTemplates({ onSelectTemplate, canCreate = true }: FollowUpTemplatesProps) {
  if (!canCreate) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {/* Create from scratch */}
        <div
          data-tour="automations-new"
          className="cursor-pointer rounded-2xl aspect-[4/3] flex items-center justify-center transition-all duration-200 group relative overflow-hidden border-0 bg-orange-500 hover:bg-orange-600"
          onClick={() => onSelectTemplate(null)}
        >
          <div className="flex flex-col items-center justify-center p-4 text-center relative z-10">
            <div className="p-2.5 rounded-xl bg-white/20 mb-2 transition-all duration-200 group-hover:scale-110">
              <Plus className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-semibold text-white text-xs">
              Criar uma automação
            </h3>
          </div>
        </div>

        {/* Template cards */}
        {FOLLOW_UP_TEMPLATES.map((template) => (
          <div
            key={template.id}
            className="cursor-pointer rounded-2xl aspect-[4/3] flex items-center justify-center relative transition-all duration-200 group overflow-hidden border border-white/[0.055] bg-white/[0.045] hover:bg-orange-500 hover:border-orange-500"
            onClick={() => onSelectTemplate(template)}
          >
            <div className="flex flex-col items-center justify-center p-4 text-center relative z-10">
              <div className="p-2.5 rounded-xl bg-primary/10 group-hover:bg-white/20 transition-all duration-200 mb-2 group-hover:scale-110">
                <Zap className="h-6 w-6 text-primary group-hover:text-white" />
              </div>
              <h3 className="font-semibold text-xs mb-0.5 text-foreground group-hover:text-white">{template.name}</h3>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground group-hover:text-white/70">
                <span className="flex items-center gap-0.5">
                  <Calendar className="h-2.5 w-2.5" />
                  {template.days}d
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {template.messages.length} msgs
                </span>
              </div>
            </div>
            <Badge className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0 bg-white/[0.06] text-muted-foreground border-0 group-hover:bg-white/20 group-hover:text-white">
              <Building2 className="h-2.5 w-2.5 mr-0.5" />
              Imob.
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
