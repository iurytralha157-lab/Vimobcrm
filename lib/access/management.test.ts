import assert from "node:assert/strict";
import test from "node:test";

import {
  canEditTeam,
  canManageAllTeams,
  canViewAllTeams,
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
    hasPermission: permissions("team_view", "team_manage"),
  });

  assert.deepEqual(allowedTabs, ["teams"]);
  assert.equal(getSafeManagementTab("pipelines", allowedTabs), "teams");
});

test("gestor com team_view recebe a aba de equipes em modo leitura", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("team_view"),
  });

  assert.deepEqual(allowedTabs, ["teams"]);
  assert.equal(getSafeManagementTab("teams", allowedTabs), "teams");
});

test("grant explicito de team_manage libera somente a gestao de equipes", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("team_view", "team_manage"),
  });

  assert.deepEqual(allowedTabs, ["teams"]);
  assert.equal(getSafeManagementTab("distribution", allowedTabs), "teams");
});

test("permissoes administrativas liberam suas abas declaradas", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("pipeline_manage", "tag_manage"),
  });

  assert.deepEqual(allowedTabs, ["pipelines", "tags"]);
  assert.equal(getSafeManagementTab("tags", allowedTabs), "tags");
  assert.equal(getSafeManagementTab("teams", allowedTabs), "pipelines");
});

test("team_manage e pipeline_manage liberam suas duas abas", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: false,
    hasPermission: permissions("pipeline_manage", "team_manage"),
  });

  assert.deepEqual(allowedTabs, ["teams", "pipelines"]);
  assert.equal(getSafeManagementTab("pipelines", allowedTabs), "pipelines");
});

test("lider com negacao efetiva de equipes nao recebe atalho por causa do vinculo", () => {
  const allowedTabs = getAllowedManagementTabs({
    isAdmin: false,
    isTeamLeader: true,
    hasPermission: permissions(),
  });

  assert.deepEqual(allowedTabs, []);
});

test("valida nomes de abas conhecidas", () => {
  assert.equal(isManagementTab("distribution"), true);
  assert.equal(isManagementTab("finance"), false);
  assert.equal(isManagementTab(null), false);
});

test("gestor que também lidera mantém leitura global e edita apenas o próprio time", () => {
  const access = {
    isAdmin: false,
    isTeamLeader: true,
    memberRole: "manager",
    ledTeamIds: ["team-led"],
    hasPermission: permissions("team_view", "team_manage"),
  };

  assert.equal(canViewAllTeams(access), true);
  assert.equal(canManageAllTeams(access), false);
  assert.equal(canEditTeam(access, "team-led"), true);
  assert.equal(canEditTeam(access, "team-other"), false);
});

test("líder comum permanece restrito às equipes que lidera", () => {
  const access = {
    isAdmin: false,
    isTeamLeader: true,
    memberRole: "user",
    ledTeamIds: ["team-led"],
    hasPermission: permissions("team_view", "team_manage"),
  };

  assert.equal(canViewAllTeams(access), false);
  assert.equal(canManageAllTeams(access), false);
  assert.equal(canEditTeam(access, "team-led"), true);
  assert.equal(canEditTeam(access, "team-other"), false);
});
