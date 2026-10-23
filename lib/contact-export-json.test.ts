import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { parseContactExportJSON, stringifyContactExportJSON } from './contact-export-json.ts';

const parse = (text: string) => parseContactExportJSON(text, { nodes: 10_000, characters: 1_000_000 });

test('JSON numeric tokens survive exactly, including precision, trailing decimals and exponents', () => {
  const source = '{"integer":9007199254740993,"decimal":1234567890.1234567890123456789,"exponent":1e1000,"zero":-0,"values":[1.20,0,false,null]}';
  assert.equal(stringifyContactExportJSON(parse(source)), source);
});

test('quoted numbers, escapes and prototype-like keys remain data', () => {
  const source = '{"__proto__":{"safe":true},"quoted":"9007199254740993","escaped":"a\\\"b\\\\c","unicode":"🏠"}';
  assert.equal(stringifyContactExportJSON(parse(source)), source);
  assert.equal(Object.prototype.hasOwnProperty.call({}, 'safe'), false);
});

test('invalid or oversized/deep JSON fails explicitly rather than returning partial values', () => {
  for (const source of ['{"n":01}', '[1,]', '{"a":true} garbage', '"bad\nstring"', '{"a":NaN}', '1e']) {
    assert.throws(() => parse(source), /JSON.*inválido/);
  }
  assert.throws(() => parseContactExportJSON('{"a":1}', { nodes: 1, characters: 100 }), /Nenhum campo foi cortado/);
  assert.throws(() => parseContactExportJSON('{"a":1}', { nodes: 100, characters: 2 }), /Nenhum campo foi cortado/);
  assert.throws(() => parse('['.repeat(66) + '1' + ']'.repeat(66)), /limite de processamento/);
});
