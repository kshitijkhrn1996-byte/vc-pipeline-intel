import test from 'node:test';
import assert from 'node:assert/strict';
import { changesSince } from '../../src/core/changes.js';

const prev = { score: 20, action_code: 'DEPRIORITISE', checked_at: '2026-10-08T01:00:00Z' };

test('a VC that crosses into outreach is flagged as newly actionable and heating up', () => {
  const r = changesSince({ score: 45, action_code: 'REACH_OUT_NOW' }, prev, [{ published: '2026-10-10' }, { published: '2026-09-30' }]);
  assert.equal(r.delta, 25);
  assert.deepEqual(r.flags, ['now_actionable', 'heating_up', 'new_signal']);
  assert.equal(r.newSignals, 1);
});

test('a VC that drops below the outreach line went quiet (not double-counted as cooling)', () => {
  const r = changesSince({ score: 5, action_code: 'DEPRIORITISE' }, { ...prev, score: 50, action_code: 'NUDGE_NOW' });
  assert.deepEqual(r.flags, ['went_quiet']);
});

test('first check has no trend', () => {
  assert.deepEqual(changesSince({ score: 30 }, null, []).flags, ['first_check']);
});
