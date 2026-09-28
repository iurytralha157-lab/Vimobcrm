import assert from 'node:assert/strict';
import test from 'node:test';

import { getLeadDisplayValue } from './lead-display-value';

test('the Pipeline card uses the same explicit lead value as the column total', () => {
  assert.equal(getLeadDisplayValue({
    valor_interesse: 350_000,
    interest_property: { preco: 900_000 },
  }), 350_000);
});

test('the visible linked property supplies the value only when the lead has none', () => {
  assert.equal(getLeadDisplayValue({
    valor_interesse: 0,
    interest_property: { preco: 900_000 },
  }), 900_000);
  assert.equal(getLeadDisplayValue({
    interest_property: { preco: 0 },
    property: { preco: 700_000 },
  }), 0);
});
