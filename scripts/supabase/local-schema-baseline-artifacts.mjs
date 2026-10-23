import assert from 'node:assert/strict';

const identifierStart = /[A-Za-z_\u0080-\uFFFF]/;
const identifierPart = /[A-Za-z0-9_$\u0080-\uFFFF]/;
const protectedSchemas = new Set(['supabase_migrations', 'vimob_local_bootstrap']);
const boundedTimeouts = new Set(['statement_timeout', 'lock_timeout', 'transaction_timeout']);
const keyword = (token, value) => token?.kind === 'word' && token.value === value;

function quoted(source, offset, delimiter, escapes = false) {
  let value = '';
  for (let index = offset + 1; index < source.length; index++) {
    const character = source[index];
    if (character === delimiter) {
      if (source[index + 1] === delimiter) { value += delimiter; index++; continue; }
      return { value, end: index + 1 };
    }
    if (escapes && character === '\\') {
      assert.ok(index + 1 < source.length, 'Incomplete SQL escape string in baseline artifact.');
      const escaped = source[++index], remaining = source.slice(index);
      const octal = remaining.match(/^[0-7]{1,3}/)?.[0];
      const hex = remaining.match(/^x([0-9A-Fa-f]{1,2})/)?.[1];
      const unicodeWidth = escaped === 'u' ? 4 : escaped === 'U' ? 8 : 0;
      if (octal) { value += String.fromCharCode(Number.parseInt(octal, 8)); index += octal.length - 1; }
      else if (hex) { value += String.fromCharCode(Number.parseInt(hex, 16)); index += hex.length; }
      else if (unicodeWidth) {
        const digits = source.slice(index + 1, index + 1 + unicodeWidth);
        assert.ok(new RegExp(`^[0-9A-Fa-f]{${unicodeWidth}}$`).test(digits), 'Invalid SQL Unicode escape string.');
        const codepoint = Number.parseInt(digits, 16);
        assert.ok(codepoint > 0 && codepoint <= 0x10ffff, 'Invalid SQL escape string codepoint.');
        value += String.fromCodePoint(codepoint); index += unicodeWidth;
      } else value += ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[escaped] ?? escaped;
    } else value += character;
  }
  assert.fail('Unterminated SQL quote in baseline artifact.');
}

function unicodeIdentifier(value, escape) {
  assert.ok(escape.length === 1 && !/[0-9A-Fa-f+\s'"]/.test(escape), 'Invalid SQL Unicode identifier escape.');
  let result = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== escape) { result += value[index]; continue; }
    if (value[index + 1] === escape) { result += escape; index++; continue; }
    const long = value[index + 1] === '+', width = long ? 6 : 4;
    const digits = value.slice(index + (long ? 2 : 1), index + (long ? 2 : 1) + width);
    assert.ok(new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(digits), 'Invalid SQL Unicode identifier.');
    const codepoint = Number.parseInt(digits, 16);
    assert.ok(codepoint > 0 && codepoint <= 0x10ffff, 'Invalid SQL Unicode codepoint.');
    result += String.fromCodePoint(codepoint); index += width + (long ? 1 : 0);
  }
  return result;
}

function sqlTokens(input) {
  const source = input.replace(/^\uFEFF/, ''), tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index], next = source[index + 1];
    if (/\s/.test(character)) { index++; continue; }
    if (character === '-' && next === '-') {
      index += 2; while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      continue;
    }
    if (character === '/' && next === '*') {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source[index] === '/' && source[index + 1] === '*') { depth++; index += 2; }
        else if (source[index] === '*' && source[index + 1] === '/') { depth--; index += 2; }
        else index++;
      }
      assert.equal(depth, 0, 'Unterminated SQL block comment in baseline artifact.');
      continue;
    }
    if (character === '\\') {
      const start = Math.max(source.lastIndexOf('\n', index - 1), source.lastIndexOf('\r', index - 1)) + 1;
      let end = source.indexOf('\n', index); if (end === -1) end = source.length;
      const line = source.slice(index, end).replace(/\r$/, '');
      assert.ok(start === index && /^\\(?:restrict|unrestrict) [A-Za-z0-9]+[\t ]*$/.test(line),
        'Only whole-line original pg_dump restrict/unrestrict metacommands are permitted.');
      index = end; continue;
    }
    if (character === "'" || ((character === 'e' || character === 'E') && next === "'")) {
      const escaped = character !== "'", literal = quoted(source, index + (escaped ? 1 : 0), "'", escaped);
      tokens.push({ kind: 'string', value: literal.value }); index = literal.end; continue;
    }
    if ((character === 'u' || character === 'U') && next === '&' && source[index + 2] === '"') {
      const identifier = quoted(source, index + 2, '"');
      tokens.push({ kind: 'unicodeIdentifier', value: identifier.value }); index = identifier.end; continue;
    }
    if (character === '"') {
      const identifier = quoted(source, index, '"');
      tokens.push({ kind: 'identifier', value: identifier.value }); index = identifier.end; continue;
    }
    if (character === '$' && !(index > 0 && identifierPart.test(source[index - 1]))) {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/)?.[0];
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length);
        assert.ok(end !== -1, 'Unterminated SQL dollar quote in baseline artifact.');
        tokens.push({ kind: 'body', value: '' }); index = end + delimiter.length; continue;
      }
    }
    if (identifierStart.test(character)) {
      const start = index++; while (index < source.length && identifierPart.test(source[index])) index++;
      tokens.push({ kind: 'word', value: source.slice(start, index).toLowerCase() }); continue;
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(next || ''))) {
      const number = source.slice(index).match(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/)[0];
      tokens.push({ kind: 'number', value: number }); index += number.length; continue;
    }
    tokens.push({ kind: 'symbol', value: character }); index++;
  }
  for (let index = 0; index < tokens.length; index++) if (tokens[index].kind === 'unicodeIdentifier') {
    const custom = keyword(tokens[index + 1], 'uescape');
    assert.ok(!custom || tokens[index + 2]?.kind === 'string', 'Invalid SQL UESCAPE clause.');
    tokens[index] = { kind: 'identifier', value: unicodeIdentifier(tokens[index].value, custom ? tokens[index + 2].value : '\\') };
    if (custom) tokens.splice(index + 1, 2);
  }
  return tokens;
}

function protectedCreation(tokens, index) {
  let cursor = index + 1;
  if (keyword(tokens[cursor], 'global') || keyword(tokens[cursor], 'local')) cursor++;
  if (['unlogged', 'temporary', 'temp'].some(word => keyword(tokens[cursor], word))) cursor++;
  const schema = keyword(tokens[cursor], 'schema'), table = keyword(tokens[cursor], 'table');
  const sequence = keyword(tokens[cursor], 'sequence');
  if (!schema && !table && !sequence) return false;
  cursor++;
  if (keyword(tokens[cursor], 'if') && keyword(tokens[cursor + 1], 'not') && keyword(tokens[cursor + 2], 'exists')) cursor += 3;
  if (schema && keyword(tokens[cursor], 'authorization')) cursor++;
  const name = tokens[cursor];
  if (sequence && ['word', 'identifier'].includes(name?.kind) && name.value === 'private' && tokens[cursor + 1]?.value === '.') {
    const relation = tokens[cursor + 2];
    if (['word', 'identifier'].includes(relation?.kind) && /^lead_distribution_ticket_[0-9a-f]{32}$/.test(relation.value)) return true;
  }
  return ['word', 'identifier'].includes(name?.kind) && protectedSchemas.has(name.value);
}

function setting(tokens, index) {
  let cursor = index + 1;
  if (keyword(tokens[cursor], 'local') || keyword(tokens[cursor], 'session')) cursor++;
  const name = tokens[cursor++];
  if (!['word', 'identifier'].includes(name?.kind)) return;
  const normalizedName = name.value.toLowerCase(); // GUC names are case-insensitive, including quoted names.
  if (tokens[cursor]?.value !== '=' && !keyword(tokens[cursor], 'to')) return;
  cursor++;
  if (tokens[cursor]?.value === '+' || tokens[cursor]?.value === '-') cursor++;
  const value = tokens[cursor];
  if (boundedTimeouts.has(normalizedName) && ['string', 'number'].includes(value?.kind)) {
    const numeric = value.value.trim().match(/^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)\s*(?:us|ms|s|min|h|d)?$/i);
    assert.ok(!numeric || Number(numeric[1]) !== 0,
      'Dump prologue must retain reviewed bounded SQL timeouts.');
  }
  // The dump uses standard-conforming strings. Do not allow changing the
  // interpretation of later quotes and hiding a psql command in a false string.
  if (normalizedName === 'standard_conforming_strings') assert.ok(['on', 'true', '1', 'yes', 't', 'y'].includes(value?.value?.trim().toLowerCase()),
    'Baseline SQL must preserve standard-conforming string parsing.');
}

// This validates reviewed dump syntax, not arbitrary SQL as a sandbox. Artifact
// hashes and the isolated target remain mandatory at the caller boundary.
export function assertSQLArtifact(source) {
  assert.equal(typeof source, 'string', 'Baseline SQL artifact must be text.');
  assert.ok(!source.includes('\0'), 'NUL bytes are not permitted in a baseline SQL artifact.');
  const tokens = sqlTokens(source);
  for (let index = 0; index < tokens.length; index++) {
    if (keyword(tokens[index], 'create')) assert.ok(!protectedCreation(tokens, index),
      'Snapshot must not restore either migration ledger or its own sentinel.');
    if (keyword(tokens[index], 'set')) setting(tokens, index);
  }
}
