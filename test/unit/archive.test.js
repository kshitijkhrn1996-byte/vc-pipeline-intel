import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldArchive } from '../../src/core/archive.js';

const today = '2026-12-20';
const vc = (o = {}) => ({ status: 'waiting_response', last_signal_date: null, ...o });

test('a VC silent for longer than the window is archived', () => {
  assert.match(shouldArchive({ vc: vc({ last_signal_date: '2026-10-01' }), firstChecked: '2026-10-11' }, today, 60), /since 2026-10-01/);
  assert.match(shouldArchive({ vc: vc(), firstChecked: '2026-10-11' }, today, 60), /70 days of tracking/);
});

test('a recent signal keeps the VC active', () => {
  assert.equal(shouldArchive({ vc: vc({ last_signal_date: '2026-11-30' }), firstChecked: '2026-10-11' }, today, 60), null);
});

test('a newly added VC gets the full window before it can be archived', () => {
  assert.equal(shouldArchive({ vc: vc(), firstChecked: '2026-11-15' }, today, 60), null);
});

test('never archives a VC he is in conversation with', () => {
  assert.equal(shouldArchive({ vc: vc({ status: 'in_conversation' }), firstChecked: '2026-01-01' }, today, 60), null);
});

test('a restored VC is not re-archived for another window', () => {
  assert.equal(shouldArchive({ vc: vc(), firstChecked: '2026-01-01', lastRestored: '2026-12-01' }, today, 60), null);
});
