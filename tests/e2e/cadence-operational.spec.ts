import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { Pool } from 'pg';

import {
  E2E_CADENCE_LEADS,
  E2E_ORGANIZATION_ID,
  E2E_PIPELINE_ID,
  E2E_STAGE_ATTENTION_ID,
  E2E_STAGE_CADENCE_ID,
  getE2EConfig,
} from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type OperationalTask = {
  id?: string;
  position: number;
  type: 'call' | 'message' | 'email' | 'note';
  title: string;
  description?: string;
  observation?: string;
  recommended_message?: string;
  due_minutes: number;
  warning_minutes?: number;
  is_required: boolean;
  outcome_required: boolean;
};

type OperationalRules = {
  stage_id: string;
  pipeline_id: string;
  revision: number;
  cadence: {
    enabled: boolean;
    template_id?: string;
    tasks: OperationalTask[];
  };
  attention: {
    source_mode: 'inherit' | 'local';
    mode: 'disabled' | 'shadow' | 'enabled';
    first_outreach_minutes?: number;
    first_effective_contact_minutes?: number;
    stage_inactivity_minutes?: number;
    stage_max_age_minutes?: number;
    warning_minutes: number;
    escalation_minutes?: number;
    business_hours_only: boolean;
  };
  lifecycle: {
    on_stage_move: 'skip_pending';
    on_won: 'cancel_pending';
    on_lost: 'cancel_pending';
    on_reopen: 'new_cycle';
  };
};

type CadenceTaskState = {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'cancelled' | 'skipped';
  is_done: boolean;
  is_required: boolean;
  outcome_required: boolean;
};

type CadenceState = {
  lead_id: string;
  deal_status: 'open' | 'won' | 'lost';
  stage_id: string;
  stage_name: string;
  cadence_enabled: boolean;
  enrollment?: {
    id: string;
    status: string;
  };
  tasks: CadenceTaskState[];
  summary: {
    total: number;
    completed: number;
    pending: number;
  };
};

type HomeFocusItem = {
  id: string;
  kind: 'attention' | 'task';
  lead_id: string;
  title: string;
  target_url: string;
};

type Envelope<T> = { data: T };

type NotificationState = {
  id: string;
  title: string;
  content?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
};

async function parseResponse<T>(response: APIResponse, expectedStatus = 200) {
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
  return body ? JSON.parse(body) as T : null as T;
}

async function getRules(page: Page) {
  const response = await authenticatedAPIRequest(
    page,
    'GET',
    `/v1/stages/${E2E_STAGE_CADENCE_ID}/operational-rules`,
  );
  return (await parseResponse<Envelope<OperationalRules>>(response)).data;
}

function buildRules(revision: number): OperationalRules {
  return {
    stage_id: E2E_STAGE_CADENCE_ID,
    pipeline_id: E2E_PIPELINE_ID,
    revision,
    cadence: {
      enabled: true,
      tasks: [
        {
          position: 0,
          type: 'call',
          title: 'Ligar para o lead',
          description: 'Faça a primeira tentativa de contato e registre o andamento.',
          observation: 'Confirme o interesse antes de avançar.',
          due_minutes: 10,
          warning_minutes: 5,
          is_required: true,
          outcome_required: false,
        },
        {
          position: 1,
          type: 'message',
          title: 'Enviar retorno combinado',
          description: 'Envie uma mensagem curta com o próximo passo.',
          recommended_message: 'Olá, {nome}. Estou retornando para seguirmos com seu atendimento.',
          due_minutes: 20,
          warning_minutes: 10,
          is_required: false,
          outcome_required: true,
        },
      ],
    },
    attention: {
      source_mode: 'local',
      mode: 'shadow',
      first_outreach_minutes: 60,
      stage_inactivity_minutes: 120,
      warning_minutes: 15,
      business_hours_only: false,
    },
    lifecycle: {
      on_stage_move: 'skip_pending',
      on_won: 'cancel_pending',
      on_lost: 'cancel_pending',
      on_reopen: 'new_cycle',
    },
  };
}

async function saveRules(page: Page, rules: OperationalRules) {
  const response = await authenticatedAPIRequest(
    page,
    'PUT',
    `/v1/stages/${E2E_STAGE_CADENCE_ID}/operational-rules`,
    rules,
  );
  return (await parseResponse<Envelope<OperationalRules>>(response)).data;
}

async function getCadenceState(page: Page, leadID: string) {
  const response = await authenticatedAPIRequest(page, 'GET', `/v1/leads/${leadID}/cadence-state`);
  return (await parseResponse<Envelope<CadenceState>>(response)).data;
}

async function listNotifications(page: Page) {
  const response = await authenticatedAPIRequest(page, 'GET', '/v1/notifications?limit=100');
  return (await parseResponse<Envelope<NotificationState[]>>(response)).data;
}

function isCadenceNotification(notification: NotificationState) {
  const searchable = [
    notification.type,
    notification.title,
    notification.content || '',
    JSON.stringify(notification.metadata || {}),
  ].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /cadenc(?:e|ia)/i.test(searchable);
}

async function moveLead(page: Page, leadID: string, stageID: string) {
  return parseResponse(
    await authenticatedAPIRequest(page, 'POST', `/v1/leads/${leadID}/move-stage`, {
      stageId: stageID,
    }),
  );
}

async function completeTask(
  page: Page,
  leadID: string,
  taskID: string,
  outcome?: string,
) {
  return authenticatedAPIRequest(page, 'POST', '/v1/lead-tasks/complete-cadence', {
    leadId: leadID,
    taskId: taskID,
    ...(outcome ? { outcome } : {}),
  });
}

async function readEnrollmentTasks(enrollmentID: string) {
  const pool = new Pool({ connectionString: getE2EConfig().databaseURL });
  try {
    const result = await pool.query<{
      status: CadenceTaskState['status'];
      is_required: boolean;
    }>(`
      select
        status,
        coalesce((metadata->>'is_required')::boolean, true) as is_required
      from public.lead_tasks
      where organization_id = $1::uuid
        and cadence_enrollment_id = $2::uuid
      order by sequence, created_at
    `, [E2E_ORGANIZATION_ID, enrollmentID]);
    return result.rows;
  } finally {
    await pool.end();
  }
}

test.describe.serial('cadencias operacionais por etapa', () => {
  test('gestor configura regras, preserva lead legado e bloqueia sobrescrita concorrente', async ({ browser }) => {
    test.setTimeout(120_000);
    const adminContext = await browser.newContext();
    const userContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const userPage = await userContext.newPage();

    try {
      await signInAs(adminPage, 'admin');
      await signInAs(userPage, 'user');

      const initial = await getRules(adminPage);
      expect(initial.cadence.enabled).toBe(false);

      const saved = await saveRules(adminPage, buildRules(initial.revision));
      expect(saved.revision).toBe(initial.revision + 1);
      expect(saved.cadence.enabled).toBe(true);
      expect(saved.cadence.template_id).toBeTruthy();
      expect(saved.cadence.tasks.map((task) => task.title)).toEqual([
        'Ligar para o lead',
        'Enviar retorno combinado',
      ]);

      const legacyState = await getCadenceState(adminPage, E2E_CADENCE_LEADS.legacy);
      expect(legacyState.cadence_enabled).toBe(true);
      expect(legacyState.enrollment).toBeUndefined();
      expect(legacyState.tasks).toHaveLength(0);

      const readOnlyRules = await authenticatedAPIRequest(
        userPage,
        'PUT',
        `/v1/stages/${E2E_STAGE_CADENCE_ID}/operational-rules`,
        buildRules(saved.revision),
      );
      await parseResponse(readOnlyRules, 403);

      const firstWriter = await saveRules(adminPage, {
        ...buildRules(saved.revision),
        attention: {
          ...buildRules(saved.revision).attention,
          business_hours_only: true,
        },
      });
      expect(firstWriter.revision).toBe(saved.revision + 1);

      const staleWriter = await authenticatedAPIRequest(
        adminPage,
        'PUT',
        `/v1/stages/${E2E_STAGE_CADENCE_ID}/operational-rules`,
        buildRules(saved.revision),
      );
      await parseResponse(staleWriter, 409);

      await adminPage.goto('/crm/pipelines');
      await expect(adminPage.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();
      await adminPage.getByRole('button', { name: 'Configurar coluna Primeiro contato E2E' }).click();
      await expect(adminPage.getByText('Configurações da Coluna')).toBeVisible();
      await adminPage.getByRole('tab', { name: 'Regras da etapa' }).click();
      await expect(adminPage.getByRole('switch', { name: 'Ativar cadência desta etapa' })).toBeChecked();
      const taskTimeline = adminPage.getByRole('list', { name: 'Tarefas da cadência em ordem' });
      await expect(taskTimeline.getByText('Ligar para o lead', { exact: true })).toBeVisible();
      await expect(taskTimeline.getByText('Enviar retorno combinado', { exact: true })).toBeVisible();
    } finally {
      await userContext.close();
      await adminContext.close();
    }
  });

  test('corretor recebe o foco, visualiza o roteiro e conclui sem duplicidade', async ({ browser }) => {
    test.setTimeout(120_000);
    const adminContext = await browser.newContext();
    const userContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const userPage = await userContext.newPage();

    try {
      await signInAs(adminPage, 'admin');
      await signInAs(userPage, 'user');
      const notificationsBefore = await listNotifications(userPage);
      const notificationIdsBefore = new Set(notificationsBefore.map((notification) => notification.id));
      await moveLead(adminPage, E2E_CADENCE_LEADS.primary, E2E_STAGE_CADENCE_ID);

      const state = await getCadenceState(userPage, E2E_CADENCE_LEADS.primary);
      expect(state.enrollment?.status).toBe('active');
      expect(state.summary).toMatchObject({ total: 2, completed: 0, pending: 2 });
      expect(state.tasks.every((task) => task.status === 'pending')).toBe(true);

      const focus = await parseResponse<Envelope<HomeFocusItem[]>>(
        await authenticatedAPIRequest(userPage, 'GET', '/v1/home/focus?scope=mine&limit=20'),
      );
      const leadFocus = focus.data.filter((item) => item.lead_id === E2E_CADENCE_LEADS.primary);
      expect(leadFocus).toHaveLength(2);
      expect(leadFocus.every((item) => item.kind === 'task')).toBe(true);

      await userPage.goto('/inicio');
      const focusLink = userPage.locator(`a[href*="lead=${E2E_CADENCE_LEADS.primary}"]`).first();
      await expect(focusLink).toBeVisible();
      await focusLink.click();
      await expect(userPage.getByText('Cadência / Primeiro contato E2E')).toBeVisible();
      await expect(userPage.getByText('Ligar para o lead', { exact: true })).toBeVisible();

      const directTask = state.tasks.find((task) => !task.outcome_required)!;
      const outcomeTask = state.tasks.find((task) => task.outcome_required)!;

      await parseResponse(await completeTask(userPage, E2E_CADENCE_LEADS.primary, directTask.id));
      await parseResponse(await completeTask(userPage, E2E_CADENCE_LEADS.primary, directTask.id));
      await parseResponse(
        await completeTask(userPage, E2E_CADENCE_LEADS.primary, outcomeTask.id),
        400,
      );
      await parseResponse(
        await completeTask(userPage, E2E_CADENCE_LEADS.primary, outcomeTask.id, 'answered'),
      );

      const completed = await getCadenceState(userPage, E2E_CADENCE_LEADS.primary);
      expect(completed.enrollment?.status).toBe('completed');
      expect(completed.summary).toMatchObject({ total: 2, completed: 2, pending: 0 });
      expect(completed.tasks.every((task) => task.status === 'completed')).toBe(true);

      const notificationsAfter = await listNotifications(userPage);
      const notificationsCreatedByCadenceFlow = notificationsAfter.filter(
        (notification) => !notificationIdsBefore.has(notification.id),
      );
      expect(
        notificationsCreatedByCadenceFlow.filter(isCadenceNotification),
        'moving a lead and completing cadence tasks must not enqueue cadence notifications',
      ).toEqual([]);

      const refreshedFocus = await parseResponse<Envelope<HomeFocusItem[]>>(
        await authenticatedAPIRequest(userPage, 'GET', '/v1/home/focus?scope=mine&limit=20'),
      );
      expect(refreshedFocus.data.some((item) => item.lead_id === E2E_CADENCE_LEADS.primary)).toBe(false);
    } finally {
      await userContext.close();
      await adminContext.close();
    }
  });

  test('saída, ganho e reabertura preservam histórico e criam um novo ciclo', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'user');

    await moveLead(page, E2E_CADENCE_LEADS.lifecycle, E2E_STAGE_CADENCE_ID);
    const firstCycle = await getCadenceState(page, E2E_CADENCE_LEADS.lifecycle);
    expect(firstCycle.enrollment?.status).toBe('active');

    await moveLead(page, E2E_CADENCE_LEADS.lifecycle, E2E_STAGE_ATTENTION_ID);
    const firstCycleTasks = await readEnrollmentTasks(firstCycle.enrollment!.id);
    expect(firstCycleTasks.find((task) => task.is_required)?.status).toBe('skipped');
    expect(firstCycleTasks.find((task) => !task.is_required)?.status).toBe('cancelled');

    await moveLead(page, E2E_CADENCE_LEADS.lifecycle, E2E_STAGE_CADENCE_ID);
    const secondCycle = await getCadenceState(page, E2E_CADENCE_LEADS.lifecycle);
    expect(secondCycle.enrollment?.id).not.toBe(firstCycle.enrollment?.id);
    expect(secondCycle.summary.pending).toBe(2);

    await parseResponse(
      await authenticatedAPIRequest(page, 'PATCH', `/v1/leads/${E2E_CADENCE_LEADS.lifecycle}`, {
        dealStatus: 'won',
      }),
    );
    const won = await getCadenceState(page, E2E_CADENCE_LEADS.lifecycle);
    expect(won.deal_status).toBe('won');
    expect(won.tasks.every((task) => task.status === 'cancelled')).toBe(true);

    await parseResponse(
      await authenticatedAPIRequest(page, 'PATCH', `/v1/leads/${E2E_CADENCE_LEADS.lifecycle}`, {
        dealStatus: 'open',
      }),
    );
    const reopened = await getCadenceState(page, E2E_CADENCE_LEADS.lifecycle);
    expect(reopened.deal_status).toBe('open');
    expect(reopened.enrollment?.id).not.toBe(secondCycle.enrollment?.id);
    expect(reopened.summary.pending).toBe(2);
  });

  test('editor do gestor permanece operável no mobile', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    try {
      await signInAs(page, 'admin');
      await page.goto('/crm/pipelines');
      await expect(page.getByText('Novos E2E', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Ver pr.xima coluna/ }).click();
      await expect(page.getByText('Primeiro contato E2E', { exact: true })).toBeVisible();
      const settingsButton = page.getByRole('button', {
        name: 'Configurar coluna Primeiro contato E2E',
      });
      await settingsButton.click();
      await expect(page.getByText('Configurações da Coluna')).toBeVisible();
      await page.getByRole('tab', { name: 'Regras' }).click();
      await expect(page.getByRole('switch', { name: 'Ativar cadência desta etapa' })).toBeChecked();
      await expect(page.getByRole('button', { name: 'Nova tarefa' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Salvar regras' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
