import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE,
  paginateAgendaResponsibleResults,
} from "./agenda-responsible-results-pagination";

test("pagina no máximo 25 responsáveis sem alterar a ordem recebida", () => {
  const orderedIds = Array.from({ length: 67 }, (_, index) => index + 1);
  const page = paginateAgendaResponsibleResults(orderedIds, 2);

  assert.equal(AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE, 25);
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 3);
  assert.equal(page.from, 26);
  assert.equal(page.to, 50);
  assert.deepEqual(page.items, orderedIds.slice(25, 50));
  assert.deepEqual(
    orderedIds,
    Array.from({ length: 67 }, (_, index) => index + 1),
  );
});

test("mantém acesso à última página e limita páginas que ficaram fora do intervalo", () => {
  const orderedIds = Array.from({ length: 67 }, (_, index) => index + 1);
  const lastPage = paginateAgendaResponsibleResults(orderedIds, 999);

  assert.equal(lastPage.page, 3);
  assert.equal(lastPage.from, 51);
  assert.equal(lastPage.to, 67);
  assert.deepEqual(lastPage.items, orderedIds.slice(50));
});

test("representa uma lista vazia sem criar intervalo inexistente", () => {
  const page = paginateAgendaResponsibleResults([], 4);

  assert.deepEqual(page.items, []);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 1);
  assert.equal(page.from, 0);
  assert.equal(page.to, 0);
});
