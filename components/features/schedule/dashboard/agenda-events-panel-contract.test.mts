import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("./AgendaEventsPanel.tsx", import.meta.url);
const hookPath = new URL(
  "../../../../hooks/schedule/use-schedule-dashboard-events.ts",
  import.meta.url,
);
const apiPath = new URL(
  "../../../../lib/api/schedule-dashboard.ts",
  import.meta.url,
);
const mutationsHookPath = new URL(
  "../../../../hooks/use-schedule-events.ts",
  import.meta.url,
);
const assigneesHookPath = new URL(
  "../../../../hooks/use-schedule-event-assignees.ts",
  import.meta.url,
);
const cacheInvalidationPath = new URL(
  "../../../../hooks/schedule/invalidate-schedule-dashboard.ts",
  import.meta.url,
);
const googleCalendarHookPath = new URL(
  "../../../../hooks/use-google-calendar.ts",
  import.meta.url,
);
const backendRealtimeBusPath = new URL(
  "../../../../contexts/BackendRealtimeBus.tsx",
  import.meta.url,
);

test("painel lista os agendamentos do recorte com paginação interna", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, />\s*Agendamentos\s*</);
  assert.doesNotMatch(source, /Próximos agendamentos/);
  assert.match(
    source,
    /useScheduleDashboardEvents\(eventsFilters,\s*\{[\s\S]*?enabled,[\s\S]*?lifecycleRevision,[\s\S]*?\}\)/,
  );
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /Carregar mais/);
  assert.match(source, /Atualizar lista de agendamentos/);
  assert.match(source, /eventsQuery\.isFetching \|\| enabled === false/);
  assert.match(source, /event\.lead_name/);
  assert.match(source, /propertyLabel/);
  assert.match(source, /event\.user_name/);
  assert.match(source, /event\.is_overdue/);
  assert.match(source, /endTime < now/);
  assert.match(source, /lifecycleRevision/);
  assert.match(source, /event\.is_all_day/);
  assert.match(source, /Dia inteiro/);
  assert.match(source, /Responsável principal:/);
  assert.match(source, /Não classificado/);
  assert.match(source, /EVENT_TYPE_PRESENTATION\.__unknown__/);
});

test("hook pagina em lotes de 20 sem recarregar todas as páginas por intervalo", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /SCHEDULE_DASHBOARD_EVENTS_PAGE_SIZE = 20/);
  assert.match(source, /lifecycleRevision = 0/);
  assert.match(source, /useInfiniteQuery/);
  assert.match(source, /offset: pageParam/);
  assert.match(source, /getNextPageParam/);
  assert.doesNotMatch(source, /refetchInterval/);
});

test("API usa o endpoint paginado dedicado e valida a resposta", async () => {
  const source = await readFile(apiPath, "utf8");

  assert.match(source, /\/v1\/schedule\/dashboard\/events/);
  assert.match(source, /scheduleDashboardEventsQuerySchema/);
  assert.match(source, /apiScheduleDashboardEventsResponseSchema/);
});

test("mutações reiniciam a lista paginada antes de atualizar os indicadores", async () => {
  const source = await readFile(mutationsHookPath, "utf8");
  const assigneesSource = await readFile(assigneesHookPath, "utf8");
  const cacheInvalidationSource = await readFile(cacheInvalidationPath, "utf8");
  const googleCalendarSource = await readFile(googleCalendarHookPath, "utf8");
  const backendRealtimeSource = await readFile(backendRealtimeBusPath, "utf8");

  assert.match(
    cacheInvalidationSource,
    /resetQueries\(\{\s*queryKey:\s*\[['"]schedule-dashboard['"],\s*['"]events['"]\]\s*,?\s*\}\)/,
  );
  assert.match(
    cacheInvalidationSource,
    /query\.queryKey\[1\] !== ["']events["']/,
  );
  assert.match(source, /invalidateScheduleDashboardCaches\(queryClient\)/);
  assert.equal(
    assigneesSource.match(/invalidateScheduleDashboardCaches\(queryClient\)/g)
      ?.length,
    2,
  );
  assert.match(
    googleCalendarSource,
    /useSyncGoogleCalendarNow[\s\S]*invalidateScheduleDashboardCaches\(queryClient\)/,
  );
  assert.match(
    backendRealtimeSource,
    /event\.type\.startsWith\(["']schedule\.["']\)[\s\S]*handleScheduleEvent/,
  );
  assert.match(
    backendRealtimeSource,
    /handleScheduleEvent[\s\S]*invalidateScheduleDashboardCaches\(queryClient\)/,
  );
});
