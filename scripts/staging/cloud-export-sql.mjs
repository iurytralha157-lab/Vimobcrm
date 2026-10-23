import assert from 'node:assert/strict';

// Lexical splitting only: never rewrite quoted function bodies or string values.
export function statements(source) {
  const result = [];
  let index = 0, start = 0, tokens = [];
  const push = (kind, value) => tokens.push({ kind, value });
  while (index < source.length) {
    const char = source[index], next = source[index + 1];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '-' && next === '-') {
      const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue;
    }
    if (char === '/' && next === '*') {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; } else index++;
      }
      assert.equal(depth, 0, 'Unterminated SQL comment.'); continue;
    }
    if (char === '\\') {
      const end = source.indexOf('\n', index), stop = end < 0 ? source.length : end;
      assert.equal(tokens.length, 0, 'A dump control cannot interrupt SQL.');
      assert.ok(index === 0 || source[index - 1] === '\n', 'Dump control must occupy a whole line.');
      assert.match(source.slice(index, stop), /^\\(?:restrict|unrestrict) [A-Za-z0-9]+\r?$/,
        'Unexpected psql control.');
      index = stop; start = stop; continue;
    }
    const escapedString = /[Ee]/.test(char) && next === "'";
    if (char === "'" || char === '"' || escapedString) {
      const delimiter = escapedString ? "'" : char;
      let value = '', closed = false; index += escapedString ? 2 : 1;
      while (index < source.length) {
        if (escapedString && source[index] === '\\') {
          assert.ok(index + 1 < source.length, 'Incomplete SQL escape.');
          value += source.slice(index, index + 2); index += 2; continue;
        }
        if (source[index] === delimiter) {
          if (source[index + 1] === delimiter) { value += delimiter; index += 2; continue; }
          index++; closed = true; break;
        }
        value += source[index++];
      }
      assert.ok(closed, 'Unterminated SQL quote.');
      push(delimiter === '"' ? 'identifier' : 'string', value); continue;
    }
    if (char === '$') {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length);
        assert.ok(end >= 0, 'Unterminated SQL function body.');
        index = end + delimiter.length; push('body', ''); continue;
      }
    }
    const word = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
    if (word) { push('word', word.toLowerCase()); index += word.length; continue; }
    if (char === ';') {
      if (tokens.length) result.push({ source: source.slice(start, index + 1), tokens });
      tokens = []; index++; start = index; continue;
    }
    push('symbol', char); index++;
  }
  assert.equal(tokens.length, 0, 'SQL must end with a semicolon.');
  return result;
}

export const values = statement => statement.tokens.map(token => token.value);
const qualified = (tokens, index, allowed) => {
  assert.ok(['word', 'identifier'].includes(tokens[index]?.kind), 'Expected qualified SQL target.');
  assert.ok(allowed.includes(tokens[index].value), 'Unexpected SQL target schema.');
  assert.equal(tokens[index + 1]?.value, '.', 'SQL target must be explicitly schema qualified.');
  assert.ok(['word', 'identifier'].includes(tokens[index + 2]?.kind), 'Expected SQL target name.');
};

export function assertDDL(statement, allowedSchemas, { overlay = false } = {}) {
  const t = statement.tokens, v = values(statement), verb = v[0];
  assert.ok(['create', 'alter', 'grant', 'revoke', 'comment'].includes(verb), 'Unexpected top-level DDL statement.');
  if (verb === 'grant' || verb === 'revoke') {
    const on = v.indexOf('on');
    assert.ok(on > 0, 'Role grants are not allowed.');
    const objectType = v[on + 1];
    assert.ok(['schema', 'table', 'sequence', 'function', 'type'].includes(objectType), 'Unexpected ACL target type.');
    let cursor = on + 2;
    while (true) {
      if (objectType === 'schema') { assert.ok(allowedSchemas.includes(v[cursor]), 'Unexpected schema ACL.'); cursor++; }
      else {
        qualified(t, cursor, allowedSchemas); cursor += 3;
        if (objectType === 'function' && v[cursor] === '(') {
          let depth = 0;
          do { if (v[cursor] === '(') depth++; if (v[cursor] === ')') depth--; cursor++; }
          while (depth && cursor < v.length);
          assert.equal(depth, 0, 'Unclosed function ACL signature.');
        }
      }
      if (v[cursor] === ',') { cursor++; continue; }
      assert.ok(v[cursor] === (verb === 'grant' ? 'to' : 'from'), 'Unexpected ACL target list.');
      break;
    }
    assert.equal(v.includes('granted'), false, 'Explicit grantor requires separate review.');
    return;
  }
  if (verb === 'alter') {
    assert.ok(!t.some((token, index) => token.kind === 'word' && token.value === 'set'
      && t[index + 1]?.kind === 'word' && t[index + 1].value === 'schema'), 'Moving objects between schemas is not allowed.');
  }
  if (verb === 'comment') {
    assert.equal(v[1], 'on');
    if (v[2] === 'schema') assert.ok(allowedSchemas.includes(v[3]));
    else {
      assert.ok(['column', 'table', 'function', 'type', 'sequence', 'view', 'index', 'constraint', 'policy', 'trigger'].includes(v[2]), 'Unexpected comment target.');
      const index = ['constraint', 'policy', 'trigger'].includes(v[2]) ? v.indexOf('on', 3) + 1 : 3;
      qualified(t, index, allowedSchemas);
    }
    return;
  }
  if (verb === 'alter' && v[1] === 'default') {
    assert.deepEqual(v.slice(0, 7), ['alter', 'default', 'privileges', 'for', 'role', 'postgres', 'in']);
    assert.equal(v[7], 'schema'); assert.ok(allowedSchemas.includes(v[8])); return;
  }
  let kindIndex = v[1] === 'or' && v[2] === 'replace' ? 3 : 1;
  if (v[kindIndex] === 'unlogged') { assert.equal(v[kindIndex + 1], 'table'); kindIndex++; }
  if (v[kindIndex] === 'constraint') { assert.equal(v[kindIndex + 1], 'trigger'); kindIndex++; }
  if (v[kindIndex] === 'unique') kindIndex++;
  const kind = v[kindIndex];
  if (kind === 'schema') { assert.ok(allowedSchemas.includes(v[kindIndex + 1])); return; }
  if (kind === 'index' && verb === 'create') {
    let on = v.indexOf('on', kindIndex + 1) + 1;
    if (v[on] === 'only') on++;
    qualified(t, on, allowedSchemas); return;
  }
  if (kind === 'policy' || kind === 'trigger') {
    const on = v.indexOf('on', kindIndex + 1);
    assert.ok(on > 0); qualified(t, on + 1, allowedSchemas); return;
  }
  if (kind === 'publication') {
    assert.ok(overlay && verb === 'alter' && v[2] === 'supabase_realtime', 'Only reviewed publication membership is allowed.');
    assert.deepEqual(v.slice(3, 6), ['add', 'table', 'only']); qualified(t, 6, ['public', 'private']); return;
  }
  assert.ok(['table', 'function', 'sequence', 'type', 'view', 'index'].includes(kind), 'Unexpected DDL object type.');
  let target = kindIndex + 1;
  if (v[target] === 'only') target++;
  qualified(t, target, allowedSchemas);
  if (verb === 'alter' && v.at(-3) === 'owner' && v.at(-2) === 'to') {
    assert.equal(v.at(-1), 'postgres', 'Application ownership must remain postgres.');
  }
}

const prologueSQL = [
  "SET LOCAL statement_timeout = '5min';", "SET LOCAL lock_timeout = '5s';",
  'SET idle_in_transaction_session_timeout = 0;', "SET LOCAL transaction_timeout = '180s';",
  "SET client_encoding = 'UTF8';", 'SET standard_conforming_strings = on;',
  "SELECT pg_catalog.set_config('search_path', '', false);", 'SET check_function_bodies = false;',
  'SET xmloption = content;', 'SET client_min_messages = warning;', 'SET row_security = off;',
];
const signature = statement => JSON.stringify(statement.tokens);
const prologueSignatures = new Set(prologueSQL.map(sql => signature(statements(sql)[0])));
export const isReviewedPrologue = statement => prologueSignatures.has(signature(statement));
const storageSettings = new Set(["SET default_tablespace = '';", 'SET default_table_access_method = heap;']
  .map(sql => signature(statements(sql)[0])));
export const isReviewedStorageSetting = statement => storageSettings.has(signature(statement));

export function assertReferenceInsert(statement, allowedTables) {
  const t = statement.tokens, v = values(statement);
  assert.deepEqual(v.slice(0, 2), ['insert', 'into'], 'Only INSERT is allowed in static reference data.');
  qualified(t, 2, ['public', 'private']);
  const table = `${v[2]}.${v[4]}`;
  assert.ok(allowedTables.includes(table), 'Reference table is not allowlisted.');
  assert.equal(v[5], '('); let depth = 0, end = -1;
  for (let index = 5; index < v.length; index++) {
    if (v[index] === '(') depth++;
    if (v[index] === ')' && --depth === 0) { end = index; break; }
  }
  assert.ok(end > 0 && v[end + 1] === 'values', 'Static reference rows must use literal VALUES.');
  let cursor = end + 2;
  while (cursor < t.length) {
    assert.equal(v[cursor++], '(', 'Expected a literal reference row.');
    let columns = 0;
    while (true) {
      const begin = cursor;
      while (cursor < t.length && v[cursor] !== ',' && v[cursor] !== ')') cursor++;
      const scalar = t.slice(begin, cursor);
      assert.ok(scalar.length > 0, 'Empty reference scalar.');
      const isString = scalar.length === 1 && scalar[0].kind === 'string';
      const isKeyword = scalar.length === 1 && scalar[0].kind === 'word' && ['null', 'true', 'false'].includes(scalar[0].value);
      const isNumber = scalar.every(token => token.kind === 'symbol') && /^[+-]?[0-9]+(?:\.[0-9]+)?$/.test(scalar.map(token => token.value).join(''));
      assert.ok(isString || isKeyword || isNumber, 'Only reviewed literal VALUES are allowed; expressions/calls/casts/upserts require review.');
      columns++;
      if (v[cursor] === ',') { cursor++; continue; }
      assert.equal(v[cursor++], ')'); break;
    }
    assert.ok(columns > 0);
    if (cursor === t.length) break;
    assert.equal(v[cursor++], ',', 'No clause may follow static reference VALUES.');
    assert.ok(cursor < t.length, 'Incomplete reference row list.');
  }
  return table;
}
