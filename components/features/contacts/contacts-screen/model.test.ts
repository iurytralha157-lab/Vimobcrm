import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { FILTER_UI } from "@/config/filter-ui";

import {
  buildContactExportFilters,
  buildContactListFilters,
  getContactDealStatus,
  parseContactPageInput,
  toggleContactSelection,
  toggleCurrentPageSelection,
  getCurrentPageSelection,
  contactSelectionScope,
// The Node type-stripping runner requires the explicit TypeScript extension.
// @ts-expect-error -- production imports remain extensionless for Next.js.
} from "./model.ts";

test("derives query and export filters without leaking pagination controls", () => {
  const filters = buildContactListFilters({
    search: "Ana",
    teamId: "team-1",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    assigneeId: "unassigned",
    tagIds: ["tag-2", "tag-1", "tag-2"],
    source: "meta",
    pageId: "page-1",
    campaignId: "campaign-1",
    adSetId: "adset-1",
    adId: "ad-1",
    dealStatus: "lost",
    dateRange: {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-02T23:59:59.000Z"),
    },
    sortBy: "created_at",
    sortDir: "desc",
    page: 3,
    pageSize: 50,
  });

  assert.deepEqual(filters, {
    search: "Ana",
    teamId: "team-1",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    assigneeId: undefined,
    unassigned: true,
    tagIds: ["tag-1", "tag-2"],
    source: "meta",
    pageId: "page-1",
    campaignId: "campaign-1",
    adSetId: "adset-1",
    adId: "ad-1",
    dealStatus: "lost",
    createdFrom: "2026-09-01T00:00:00.000Z",
    createdTo: "2026-09-02T23:59:59.000Z",
    sortBy: "created_at",
    sortDir: "desc",
    page: 3,
    limit: 50,
    mode: "compact",
  });
  assert.deepEqual(buildContactExportFilters(filters), {
    search: "Ana",
    teamId: "team-1",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    assigneeId: undefined,
    unassigned: true,
    tagIds: ["tag-1", "tag-2"],
    source: "meta",
    pageId: "page-1",
    campaignId: "campaign-1",
    adSetId: "adset-1",
    adId: "ad-1",
    dealStatus: "lost",
    createdFrom: "2026-09-01T00:00:00.000Z",
    createdTo: "2026-09-02T23:59:59.000Z",
  });
});

test("omits the date constraint until a period is explicitly applied", () => {
  const filters = buildContactListFilters({
    search: "",
    teamId: null,
    pipelineId: "all",
    stageId: "all",
    assigneeId: null,
    tagIds: [],
    source: null,
    pageId: null,
    campaignId: null,
    adSetId: null,
    adId: null,
    dealStatus: null,
    dateRange: null,
    sortBy: "created_at",
    sortDir: "desc",
    page: 1,
    pageSize: 50,
  });

  assert.equal(filters.createdFrom, undefined);
  assert.equal(filters.createdTo, undefined);
  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 50);
});

test("preserves current-page and shift-range selection semantics", () => {
  const pageIds = ["lead-1", "lead-2", "lead-3", "lead-4"];

  assert.deepEqual(
    [...toggleCurrentPageSelection(new Set(), pageIds)],
    pageIds,
  );
  assert.equal(toggleCurrentPageSelection(new Set(pageIds), pageIds).size, 0);
  assert.deepEqual(
    [
      ...toggleContactSelection({
        selectedIds: new Set(["lead-1"]),
        currentPageIds: pageIds,
        contactId: "lead-3",
        shiftPressed: true,
        lastSelectedId: "lead-1",
      }),
    ],
    ["lead-1", "lead-2", "lead-3"],
  );
  assert.deepEqual(
    [
      ...toggleContactSelection({
        selectedIds: new Set(["lead-2", "lead-3"]),
        currentPageIds: pageIds,
        contactId: "lead-3",
        shiftPressed: true,
        lastSelectedId: "lead-1",
      }),
    ],
    [],
  );
});

test("keeps deal-status fallback and permissive page parsing", () => {
  assert.equal(getContactDealStatus("lost"), "lost");
  assert.equal(getContactDealStatus(null), "open");
  assert.equal(parseContactPageInput("2abc", 4), 2);
  assert.equal(parseContactPageInput("5", 4), null);
});

test('selection reflects page membership rather than the number of selected IDs', () => {
  const ids = ['new-1', 'new-2'];
  const old = new Set(['old-1', 'old-2']);
  assert.equal(getCurrentPageSelection(old, ids), false);
  assert.deepEqual([...toggleCurrentPageSelection(old, ids)], ids);
  assert.equal(getCurrentPageSelection(new Set(['new-1']), ids), 'indeterminate');
  assert.equal(getCurrentPageSelection(new Set(ids), ids), true);
  assert.equal(getCurrentPageSelection(new Set(), []), false);
});

test('selection scope changes immediately with search, page, filters and ordering', () => {
  const filters = { page: 1, limit: 50, source: 'meta', sortDir: 'desc' as const };
  const initial = contactSelectionScope(filters, '');
  assert.notEqual(initial, contactSelectionScope({ ...filters, page: 2 }, ''));
  assert.notEqual(initial, contactSelectionScope({ ...filters, source: 'site' }, ''));
  assert.notEqual(initial, contactSelectionScope(filters, 'Nova busca'));
  assert.notEqual(initial, contactSelectionScope({ ...filters, sortDir: 'asc' }, ''));
  const identity = { organizationId: 'org-a', userId: 'user-a' };
  const scoped = contactSelectionScope(filters, '', identity);
  assert.notEqual(scoped, contactSelectionScope(filters, '', { ...identity, organizationId: 'org-b' }));
  assert.notEqual(scoped, contactSelectionScope(filters, '', { ...identity, userId: 'user-b' }));
});

test("keeps the contacts page fixed while the list owns scrolling and pagination", () => {
  const screenSource = readFileSync(
    resolve(process.cwd(), "components/features/contacts/ContactsScreen.tsx"),
    "utf8",
  );
  const listSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/contacts/contacts-screen/ContactsList.tsx",
    ),
    "utf8",
  );
  const toolbarSource = readFileSync(
    resolve(
      process.cwd(),
      "components/features/contacts/contacts-screen/ContactsToolbar.tsx",
    ),
    "utf8",
  );
  const sharedFiltersSource = readFileSync(
    resolve(process.cwd(), "components/shared/SharedFilters.tsx"),
    "utf8",
  );
  const globalStyles = readFileSync(
    resolve(process.cwd(), "app/globals.css"),
    "utf8",
  );

  assert.match(screenSource, /<AppLayout title="Contatos" disableMainScroll>/);
  assert.match(screenSource, /footer=\{[\s\S]*?<ContactsPagination/);
  assert.match(listSource, /data-contacts-scroll-region/);
  assert.match(listSource, /contacts-table-card[^\n]*rounded-\[8px\][^\n]*p-0/);
  assert.match(
    listSource,
    /contacts-table crm-management-table[^\n]*\[&_th\]:h-8/,
  );
  assert.match(
    listSource,
    /<TableHeader className="crm-management-sticky-header sticky top-0 z-20">/,
  );
  assert.match(listSource, /data-contacts-pagination className="shrink-0"/);
  assert.match(listSource, /aria-label="Responsável">Resp\.<\/TableHead>/);
  assert.match(toolbarSource, /className="app-toolbar overflow-visible p-2 md:px-2 md:py-1"/);
  const toolbarFiltersConfig = screenSource.match(
    /^  const toolbarFilters: ContactsToolbarFilters = \{[\s\S]*?^  \};/m,
  )?.[0];
  assert.ok(toolbarFiltersConfig);
  assert.doesNotMatch(toolbarFiltersConfig, /\btriggerClassName\s*:/);
  assert.match(
    toolbarSource,
    /<SharedFilters \{\.\.\.filters\} sourceFilterMaxLength=\{MAX_LEAD_SOURCE_FILTER_LENGTH\} \/>/,
  );
  assert.match(
    sharedFiltersSource,
    /const dashboardTriggerClass = FILTER_UI\.trigger;/,
  );
  const filterTriggerSource = sharedFiltersSource.match(
    /const filterTrigger = \(\s*(<Button\b[\s\S]*?<\/Button>)\s*\);/,
  )?.[1];
  assert.ok(filterTriggerSource);
  assert.match(
    filterTriggerSource,
    /className=\{cn\(\s*dashboardTriggerClass,\s*triggerClassName,/,
  );
  assert.match(
    sharedFiltersSource,
    /<SharedFilterPanel\b[^>]*\btrigger=\{filterTrigger\}/,
  );
  assert.match(
    FILTER_UI.trigger,
    /(?:^|\s)bg-\[var\(--app-surface-soft\)\](?:\s|$)/,
  );
  assert.match(
    toolbarSource,
    /data-tour="contacts-import"[\s\S]{0,260}bg-\[var\(--app-surface-soft\)\]/,
  );
  assert.match(
    globalStyles,
    /\.crm-management-sticky-header,[\s\S]*?\.crm-management-sticky-header > tr > th \{[\s\S]*?linear-gradient\(var\(--app-surface-soft\), var\(--app-surface-soft\)\)/,
  );
  assert.match(
    globalStyles,
    /\.contacts-table-scroll > div \{[\s\S]*?height: 100%;[\s\S]*?overscroll-behavior: contain;/,
  );
  assert.match(
    globalStyles,
    /\.contacts-table tbody \.contacts-actions-cell \{[\s\S]*?linear-gradient\([\s\S]*?var\(--contacts-row-bg, var\(--app-surface-solid\)\)[\s\S]*?var\(--app-surface-solid\);/,
  );
  assert.doesNotMatch(
    globalStyles,
    /\.contacts-table \.contacts-actions-cell::before/,
  );
});
