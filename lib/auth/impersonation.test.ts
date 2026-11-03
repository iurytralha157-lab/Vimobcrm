import assert from 'node:assert/strict';
import test from 'node:test';

import { parseImpersonationSession as parse } from './impersonation';

test('accepts only a complete impersonation record', () => {
  assert.deepEqual(parse('{"orgId":"a","orgName":"Org"}'), { orgId: 'a', orgName: 'Org' });
  for (const value of [null, '', '{broken', 'null', '[]', '"a"', '{"orgId":"","orgName":"Org"}', '{"orgId":"a"}', '{"orgId":1,"orgName":"Org"}']) {
    assert.equal(parse(value), null, String(value));
  }
});
