import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const contract = require('js-yaml').load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));

test('WhatsApp list count and filter catalogs accept the canonical legacy source bound', () => {
  for (const route of ['/v1/whatsapp/conversations', '/v1/whatsapp/conversations/unread-count', '/v1/whatsapp/conversations/filter-options']) {
    const parameter = contract.paths[route].get.parameters.find((item) => item.name === 'leadSource');
    assert.equal(parameter.schema.maxLength, 4096, route);
  }
  assert.equal(contract.components.parameters.AnalyticsSource.schema.maxLength, 4096);
});
