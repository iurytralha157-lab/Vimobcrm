import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

export const teamCatalogOrganization = '50000000-0000-4000-8000-000000000001';
export const legacyTeamResponse = {
  id: '40000000-0000-4000-8000-000000000001', name: 'Equipe sintética', organization_id: teamCatalogOrganization,
  created_at: '2026-10-01T10:00:00Z', is_active: true, logo_url: null, created_by: null, created_by_user: null,
  members: [{ id: '60000000-0000-4000-8000-000000000001', team_id: '40000000-0000-4000-8000-000000000001',
    user_id: '20000000-0000-4000-8000-000000000001', created_at: '2026-10-01T10:00:00Z', is_leader: true,
    user: { id: '20000000-0000-4000-8000-000000000001', name: 'Pessoa sintética', email: 'synthetic@example.invalid' } }],
};

// API adapters and all schemas are real; only HTTP is replaced by an in-memory
// response. Legacy DTO fields follow the old Go Team projection, without revision.
export function teamCatalogApiFixture(initialResponse = { data: [legacyTeamResponse] }) {
  const requests = [], management = [], loaded = new Map();
  let response = initialResponse, failure;
  const files = { './common': 'lib/validation/common.ts', './filter-text': 'lib/validation/filter-text.ts',
    './queue-runtime': 'lib/validation/queue-runtime.ts', '@/lib/validation/common': 'lib/validation/common.ts',
    '@/lib/validation/manual-activities': 'lib/validation/manual-activities.ts',
    '@/lib/round-robin/queue-name': 'lib/round-robin/queue-name.ts',
    '@/lib/round-robin/input-text': 'lib/round-robin/input-text.ts',
    '@/lib/teams/member-availability-batches': 'lib/teams/member-availability-batches.ts',
    '@/lib/pipeline-reliability': 'lib/pipeline-reliability.ts' };
  function evaluate(filename) {
    if (loaded.has(filename)) return loaded.get(filename);
    const fixtureModule = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const request = list => async (path, options) => {
      list.push({ path, options }); if (failure) throw failure; return response;
    };
    const dependency = name => {
      if (name === 'zod') return { z };
      if (files[name]) return evaluate(files[name]);
      if (name === '@/lib/validation') return { ...evaluate('lib/validation/common.ts'), ...evaluate('lib/validation/crm-support.ts'), ...evaluate('lib/validation/team-filter-catalog.ts') };
      if (name === './vimob-client') return { vimobAPIRequest: request(requests) };
      if (name === '@/lib/api/management-request') return { managementAPIRequest: request(management) };
      throw new Error('Unexpected real dependency: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Error })(dependency, fixtureModule, fixtureModule.exports);
    loaded.set(filename, fixtureModule.exports); return fixtureModule.exports;
  }
  return { api: evaluate('lib/api/teams.ts').teamsAPI, requests, management,
    setResponse(value) { response = value; }, setFailure(error) { failure = error; } };
}
