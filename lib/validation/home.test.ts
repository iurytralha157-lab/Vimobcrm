import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HOME_PUBLICATION_CTA_HREFS,
  apiDeleteHomePublicationImageResponseSchema,
  apiHomeAssistantResponseSchema,
  apiHomeFocusResponseSchema,
  apiHomeNoticeListResponseSchema,
  apiHomePublicationCardListResponseSchema,
  apiHomePublicationListResponseSchema,
  createHomePublicationInputSchema,
  homeAssistantInputSchema,
  homePublicationCtaHrefSchema,
  reorderHomePublicationsInputSchema,
  updateHomePublicationInputSchema,
} from "./home";

const ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";

const leadDetailSource = readFileSync(
  "components/features/leads/LeadDetailDialog.tsx",
  "utf8",
);
const contactsSource = readFileSync(
  "components/features/contacts/ContactsScreen.tsx",
  "utf8",
);
const pipelinesSource = readFileSync(
  "components/features/pipelines/Pipelines-screen.tsx",
  "utf8",
);
const eventSheetSource = readFileSync(
  "components/features/schedule/EventSheet.tsx",
  "utf8",
);
const agendaSource = readFileSync(
  "components/features/schedule/AgendaScreen.tsx",
  "utf8",
);
const conversationLeadPanelSource = readFileSync(
  "components/features/whatsapp/ConversationLeadPanel.tsx",
  "utf8",
);
const appHeaderSource = readFileSync(
  "components/shared/layout/AppHeader.tsx",
  "utf8",
);
const appLayoutSource = readFileSync(
  "components/shared/layout/AppLayout.tsx",
  "utf8",
);
const homeScreenSource = readFileSync(
  "components/features/home/HomeScreen.tsx",
  "utf8",
);
const homeNoticeRailSource = readFileSync(
  "components/features/home/HomeNoticeRail.tsx",
  "utf8",
);

const publication = {
  id: ID,
  title: "Cuide das oportunidades de hoje",
  body: "Veja os leads que precisam de atenção e mantenha as cadências em movimento.",
  ctaLabel: "Abrir Pipeline",
  ctaHref: "/crm/pipelines",
  imageUrl: null,
  cardSize: "wide",
  accent: "orange",
  displayOrder: 10,
  isActive: true,
  startsAt: null,
  endsAt: null,
  targetType: "all",
  targetOrganizationIds: [],
  targetUserIds: [],
  targetRoles: [],
  createdAt: "2026-07-29T12:00:00Z",
  updatedAt: "2026-07-29T12:00:00Z",
};

const publicationCard = {
  id: publication.id,
  title: publication.title,
  body: publication.body,
  ctaLabel: publication.ctaLabel,
  ctaHref: publication.ctaHref,
  imageUrl: publication.imageUrl,
  cardSize: publication.cardSize,
  accent: publication.accent,
  displayOrder: publication.displayOrder,
};

test("catálogo de CTA aceita somente destinos internos suportados", () => {
  assert.deepEqual(HOME_PUBLICATION_CTA_HREFS, [
    "/dashboard",
    "/crm/pipelines",
    "/crm/contacts",
    "/crm/conversas",
    "/agenda",
    "/automations",
    "/automations?tab=automations",
    "/automations?tab=templates",
    "/automations?tab=history",
    "/properties",
    "/gamificacao",
    "/notifications",
    "/settings",
    "/suporte",
  ]);

  for (const href of HOME_PUBLICATION_CTA_HREFS) {
    assert.equal(homePublicationCtaHrefSchema.safeParse(href).success, true);
  }
  assert.equal(homePublicationCtaHrefSchema.safeParse("/admin").success, false);
  assert.equal(
    homePublicationCtaHrefSchema.safeParse("https://example.com").success,
    false,
  );
});

test("criação normaliza texto, aplica defaults e mantém imageUrl somente leitura", () => {
  const result = createHomePublicationInputSchema.safeParse({
    title: "  Acompanhe seus leads  ",
    body: "  Priorize os próximos contatos.  ",
    ctaLabel: "  Ver Pipeline  ",
    ctaHref: "/crm/pipelines",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.title, "Acompanhe seus leads");
    assert.equal(result.data.cardSize, "half");
    assert.equal(result.data.accent, "orange");
    assert.equal(result.data.targetType, "all");
    assert.deepEqual(result.data.targetOrganizationIds, []);
  }

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      title: "Acompanhe seus leads",
      body: "Priorize os próximos contatos.",
      ctaLabel: "Ver Pipeline",
      ctaHref: "/crm/pipelines",
      imageUrl: null,
    }).success,
    false,
  );
});

test("agenda e público-alvo precisam formar combinações consistentes", () => {
  const base = {
    title: "Comunicado segmentado",
    body: "Conteúdo exclusivo para uma organização.",
    ctaLabel: "Abrir Agenda",
    ctaHref: "/agenda" as const,
  };

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      targetType: "organizations",
    }).success,
    false,
  );

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      targetType: "organizations",
      targetOrganizationIds: [ORGANIZATION_ID],
    }).success,
    true,
  );

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      targetType: "all",
      targetOrganizationIds: [ORGANIZATION_ID],
    }).success,
    false,
  );

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      targetType: "roles",
      targetRoles: ["admin"],
    }).success,
    true,
  );

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      targetType: "roles",
      targetRoles: ["owner"],
    }).success,
    false,
  );

  assert.equal(
    createHomePublicationInputSchema.safeParse({
      ...base,
      startsAt: "2026-07-30T12:00:00Z",
      endsAt: "2026-07-30T11:59:59Z",
    }).success,
    false,
  );
});

test("edição exige alteração e também bloqueia imageUrl", () => {
  assert.equal(updateHomePublicationInputSchema.safeParse({}).success, false);
  assert.equal(
    updateHomePublicationInputSchema.safeParse({
      title: "Nova chamada",
    }).success,
    true,
  );
  assert.equal(
    updateHomePublicationInputSchema.safeParse({
      imageUrl: "https://cdn.example.com/image.png",
    }).success,
    false,
  );
});

test("assistente limita e normaliza a pergunta e aceita ausência de resposta", () => {
  const input = homeAssistantInputSchema.safeParse({
    question: "  Como criar uma cadência?  ",
  });
  assert.equal(input.success, true);
  if (input.success)
    assert.equal(input.data.question, "Como criar uma cadência?");

  assert.equal(
    homeAssistantInputSchema.safeParse({ question: "a" }).success,
    false,
  );
  assert.equal(
    homeAssistantInputSchema.safeParse({ question: "a".repeat(501) }).success,
    false,
  );
  assert.equal(
    apiHomeAssistantResponseSchema.safeParse({ data: null }).success,
    true,
  );
  assert.equal(
    apiHomeAssistantResponseSchema.safeParse({
      data: {
        answer: "Abra a área de automações e selecione Cadências.",
        title: "Cadências",
        articleId: ID,
      },
    }).success,
    true,
  );
});

test("feed operacional valida a obrigação e o ciclo atual com contrato estável", () => {
  assert.equal(
    apiHomeFocusResponseSchema.safeParse({
      data: [
        {
          id: `attention:${ID}`,
          kind: "attention",
          obligation_key: `first_effective_contact:${SECOND_ID}`,
          lead_id: ORGANIZATION_ID,
          lead_name: "Maria",
          title: "Contato efetivo com Maria",
          description: "Pipeline · Atendimento",
          due_at: "2026-07-31T12:00:00Z",
          status: "warning",
          tone: "warning",
          policy_type: "first_effective_contact",
          task_type: null,
          target_url: `/crm/pipelines?lead=${ORGANIZATION_ID}`,
          stage_id: SECOND_ID,
          stage_name: "Atendimento",
        },
      ],
    }).success,
    true,
  );

  assert.equal(
    apiHomeFocusResponseSchema.safeParse({
      data: [
        {
          id: "task:fora-do-ciclo",
          kind: "task",
          obligation_key: "cadence_task:fora-do-ciclo",
          lead_id: ORGANIZATION_ID,
          lead_name: "Maria",
          title: "Ligar",
          description: "",
          due_at: "2026-07-31T12:00:00Z",
          status: "pending",
          tone: "neutral",
          target_url: "https://externo.example",
        },
      ],
    }).success,
    false,
  );

  for (const unsafeTarget of [
    "//externo.example/roubo",
    "/\\externo.example/roubo",
    "/crm/pipelines\u0000?lead=roubo",
  ]) {
    assert.equal(
      apiHomeFocusResponseSchema.safeParse({
        data: [
          {
            id: `attention:${ID}`,
            kind: "attention",
            obligation_key: `first_effective_contact:${SECOND_ID}`,
            lead_id: ORGANIZATION_ID,
            lead_name: "Maria",
            title: "Contato efetivo com Maria",
            description: "Pipeline · Atendimento",
            due_at: "2026-07-31T12:00:00Z",
            status: "warning",
            tone: "warning",
            policy_type: "first_effective_contact",
            task_type: null,
            target_url: unsafeTarget,
            stage_id: SECOND_ID,
            stage_name: "Atendimento",
          },
        ],
      }).success,
      false,
      unsafeTarget,
    );
  }
});

test("avisos da página inicial preservam severidade, ação e descarte seguros", () => {
  assert.equal(
    apiHomeNoticeListResponseSchema.safeParse({
      data: [
        {
          id: "billing:" + ORGANIZATION_ID + ":overdue:2026-08-08",
          source: "billing",
          severity: "critical",
          title: "Sua assinatura venceu há 2 dias",
          description: "O acesso será bloqueado amanhã.",
          action_label: "Regularizar assinatura",
          action_url: "/settings?tab=subscription",
          dismissible: false,
        },
        {
          id: "announcement:" + ID,
          source: "announcement",
          severity: "announcement",
          title: "Comunicado",
          description: "Atualização programada para esta noite.",
          action_label: null,
          action_url: null,
          dismissible: true,
          display_duration_seconds: 15,
        },
      ],
    }).success,
    true,
  );

  for (const actionURL of ["", "//evil.example", "javascript:alert(1)"]) {
    assert.equal(
      apiHomeNoticeListResponseSchema.safeParse({
        data: [
          {
            id: "announcement:unsafe",
            source: "announcement",
            severity: "announcement",
            title: "Comunicado",
            description: "Link inválido",
            action_label: "Abrir",
            action_url: actionURL,
            dismissible: true,
          },
        ],
      }).success,
      false,
    );
  }
});

test("respostas preservam extensões e exclusão de imagem aceita aviso de limpeza", () => {
  const list = apiHomePublicationListResponseSchema.safeParse({
    data: [{ ...publication, futureField: "preservado" }],
    futureMeta: true,
  });
  assert.equal(list.success, true);
  if (list.success) assert.equal(list.data.data[0].futureField, "preservado");

  assert.equal(
    apiDeleteHomePublicationImageResponseSchema.safeParse({
      data: publication,
      cleanupWarning: "O vínculo foi removido, mas o Storage não respondeu.",
    }).success,
    true,
  );
});

test("resposta pública expõe somente o conteúdo necessário do card", () => {
  assert.equal(
    apiHomePublicationCardListResponseSchema.safeParse({
      data: [publicationCard],
    }).success,
    true,
  );

  assert.equal(
    apiHomePublicationCardListResponseSchema.safeParse({
      data: [
        {
          ...publicationCard,
          targetOrganizationIds: [ORGANIZATION_ID],
        },
      ],
    }).success,
    false,
  );

  assert.equal(
    apiHomePublicationCardListResponseSchema.safeParse({
      data: [
        {
          ...publicationCard,
          imageUrl: "https://cdn.example.com/publicacao.webp",
        },
      ],
    }).success,
    true,
  );

  for (const imageUrl of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "ftp://cdn.example.com/publicacao.webp",
  ]) {
    assert.equal(
      apiHomePublicationCardListResponseSchema.safeParse({
        data: [{ ...publicationCard, imageUrl }],
      }).success,
      false,
    );
  }
});

test("reordenação exige itens únicos e ordens válidas", () => {
  assert.equal(
    reorderHomePublicationsInputSchema.safeParse({
      items: [
        { id: ID, displayOrder: 10 },
        { id: SECOND_ID, displayOrder: 20 },
      ],
    }).success,
    true,
  );

  assert.equal(
    reorderHomePublicationsInputSchema.safeParse({
      items: [
        { id: ID, displayOrder: 10 },
        { id: ID, displayOrder: 20 },
      ],
    }).success,
    false,
  );

  assert.equal(
    reorderHomePublicationsInputSchema.safeParse({
      items: [{ id: ID, displayOrder: -1 }],
    }).success,
    false,
  );
});

test("detalhe do lead monta somente os layouts V2 ativos em mobile e desktop", () => {
  for (const callerSource of [contactsSource, pipelinesSource]) {
    assert.match(
      callerSource,
      /import\(["']@\/components\/features\/leads\/LeadDetailDialog["']\)/,
    );
    assert.match(callerSource, /<LeadDetailDialog\b/);
  }

  assert.match(
    leadDetailSource,
    /if \(isMobile\) \{\s*return \([\s\S]*?<Drawer\b[\s\S]*?\{MobileContentV2\(\)\}/,
  );
  assert.match(
    leadDetailSource,
    /data-tour="lead-detail-dialog"[\s\S]*?\{DesktopContentV2\(\)\}/,
  );
  assert.match(leadDetailSource, /disabled=\{!canOperateLead\}/);
  assert.equal(
    [...leadDetailSource.matchAll(/\{hasAgendaModule && <EventSheet\b/g)].length,
    2,
  );
  assert.match(
    leadDetailSource,
    /if \(isMobile\) \{[\s\S]*?\{MobileContentV2\(\)\}[\s\S]*?\{hasAgendaModule && <EventSheet\b/,
  );
  assert.match(
    leadDetailSource,
    /data-tour="lead-detail-dialog"[\s\S]*?\{DesktopContentV2\(\)\}[\s\S]*?\{hasAgendaModule && <EventSheet\b/,
  );
  assert.match(leadDetailSource, /data-tour="lead-detail-stages"/);
  assert.match(leadDetailSource, /data-tour="lead-detail-history"/);

  assert.doesNotMatch(leadDetailSource, /const MobileContent =/);
  assert.doesNotMatch(leadDetailSource, /const DesktopContent =/);
  assert.doesNotMatch(leadDetailSource, /useLeadDetailV2/);
});

test("EventSheet mantém a superfície responsiva ativa e seus três chamadores", () => {
  for (const callerSource of [agendaSource, conversationLeadPanelSource, leadDetailSource]) {
    assert.match(callerSource, /<EventSheet\b/);
  }

  assert.match(eventSheetSource, /data-tour="agenda-event-sheet"/);
  assert.match(
    eventSheetSource,
    /className="!h-\[100dvh\][\s\S]*?!w-full[\s\S]*?sm:!w-\[min\(560px,calc\(100vw-40px\)\)\]/,
  );
  assert.match(eventSheetSource, /if \(!hasAgendaModule\) return null/);
  assert.match(eventSheetSource, /hasPermission\("schedule_manage"\)/);
  assert.match(eventSheetSource, /if \(!nextOpen && isLoading\) return/);

  assert.doesNotMatch(eventSheetSource, /className="hidden"/);
  assert.doesNotMatch(eventSheetSource, /Mais opções/);
  assert.doesNotMatch(eventSheetSource, /typeConf\.color/);
});

test("cabeçalho e aviso da Home mantêm a superfície lisa e resiliente", () => {
  assert.match(
    appHeaderSource,
    /<header className="[^"]*\bborder-0\b[^"]*\bshadow-none\b[^"]*">/,
  );
  assert.match(appHeaderSource, /<header className="[^"]*\bbg-transparent\b/);
  assert.doesNotMatch(
    appHeaderSource,
    /<header className="[^"]*bg-\[var\(--app-surface-solid\)\]/,
  );
  assert.match(appHeaderSource, /<header className="[^"]*\bpx-5\b[^"]*\bmd:px-8\b/);
  assert.doesNotMatch(appHeaderSource, /<header className="[^"]*\bmd:ml-/);
  assert.doesNotMatch(appHeaderSource, /from ['"]next\/image['"]/);
  assert.match(
    appHeaderSource,
    /<AvatarImage\s+src=\{organization\.logo_url \|\| undefined\}[\s\S]*?<AvatarFallback[^>]*bg-primary\b/,
  );
  assert.match(
    appHeaderSource,
    /unreadCount > 0[\s\S]*?rounded-full border-0 bg-primary\b/,
  );
  assert.match(
    appHeaderSource,
    /<Avatar className="h-8 w-8 border-0">[\s\S]*?<AvatarFallback className="bg-primary\b/,
  );
  assert.match(
    appHeaderSource,
    /aria-label=\{`Notificações[\s\S]*?className="[^"]*rounded-\[6px\][^"]*\bborder-0\b[^"]*\bbg-card\b/,
  );
  assert.equal(
    [...appHeaderSource.matchAll(/className="[^"]*rounded-\[6px\][^"]*\bborder-0\b[^"]*\bbg-card\b[^"]*\bshadow-none\b/g)].length,
    3,
  );
  assert.match(
    appHeaderSource,
    /rounded-\[4px\] bg-primary text-primary-foreground transition-colors/,
  );
  assert.match(
    appHeaderSource,
    /app-header-logout[^"]*\bbg-primary\b[^"]*\btext-primary-foreground\b[^"]*\btransition-colors\b/,
  );

  assert.match(
    appLayoutSource,
    /<AppHeader title=\{title\} \/>\s*\{belowHeader\}\s*[\s\S]*?<main\b/,
  );
  assert.doesNotMatch(appLayoutSource, /flex flex-1 overflow-hidden md:gap-/);
  assert.match(
    homeScreenSource,
    /belowHeader=\{<HomeNoticeRail notices=\{noticesQuery\.data \|\| \[\]\} \/>\}/,
  );
  assert.match(homeNoticeRailSource, /\bw-full\b[^"\n]*\brounded-none\b[^"\n]*\bpx-5\b[^"\n]*\bshadow-none\b[^"\n]*\bmd:px-8\b/);
});
