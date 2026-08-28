import assert from "node:assert/strict";
import test from "node:test";

import {
  getAllowedManagementTabs,
  getSafeManagementTab,
  isManagementTab,
} from "./management";

function permissions(...allowed: string[]) {
  return (permission: string) => allowed.includes(permission);
}

test("bloqueia gestao para usuario comum sem permissoes", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions(),
  });

  assert.deepEqual(allowedTabs, []);
  assert.equal(getSafeManagementTab("pipelines", allowedTabs), null);
});

test("admin acessa todas as abas de gestao", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: true,
    isTeamLeader: false,
    hasPermission: permissions(),
  });

  assert.deepEqual(allowedTabs, ["teams", "distribution", "pipelines", "tags"]);
});

test("lider acessa somente equipes por padrao", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: true,
    hasPermission: permissions(),
  });

  assert.deepEqual(allowedTabs, ["teams"]);
  assert.equal(getSafeManagementTab("pipelines", allowedTabs), "teams");
});

test("permissoes administrativas liberam somente abas com contrato completo", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("pipeline_manage", "tag_manage"),
  });

  assert.deepEqual(allowedTabs, ["tags"]);
  assert.equal(getSafeManagementTab("tags", allowedTabs), "tags");
  assert.equal(getSafeManagementTab("teams", allowedTabs), "tags");
});

test("vinculo de pipelines exige permissao para gerenciar equipes", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("pipeline_manage", "team_manage"),
  });

  assert.deepEqual(allowedTabs, ["teams", "pipelines"]);
  assert.equal(getSafeManagementTab("pipelines", allowedTabs), "pipelines");
});

test("valida nomes de abas conhecidas", () => {
  assert.equal(isManagementTab("distribution"), true);
  assert.equal(isManagementTab("finance"), false);
  assert.equal(isManagementTab(null), false);
});
