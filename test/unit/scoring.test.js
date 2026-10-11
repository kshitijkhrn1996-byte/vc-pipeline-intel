import test from 'node:test';
import assert from 'node:assert/strict';
import { recencyFactor, itemPoints, scoreVc } from '../../src/core/scoring.js';
import { decideAction } from '../../src/core/actions.js';
import { validateItems } from '../../src/core/validate.js';

const today = '2026-10-11';

test('recency: full within a week, zero past 30 days', () => {
  assert.equal(recencyFactor(0), 1);
  assert.equal(recencyFactor(7), 1);
  assert.equal(recencyFactor(30), 0);
  assert.equal(recencyFactor(31), 0);
  assert.ok(recencyFactor(18) > 0 && recencyFactor(18) < 1);
});

test('a fresh, on-thesis logistics investment is a strong signal on its own', () => {
  const s = scoreVc([{ type: 'investment', relevance: 3, published: '2026-10-08' }], today);
  assert.equal(s, 40);
});

test('off-topic activity barely moves the score', () => {
  const s = scoreVc([{ type: 'interview', relevance: 0, published: '2026-10-09' }], today);
  assert.ok(s < 5);
});

test('score is capped at 100', () => {
  const items = Array.from({ length: 5 }, () => ({ type: 'investment', relevance: 3, published: '2026-10-10' }));
  assert.equal(scoreVc(items, today), 100);
});

test('item points are zero outside the window', () => {
  assert.equal(itemPoints({ type: 'blog', relevance: 3, published: '2026-09-01' }, today), 0);
});

test('actions combine score with Vikram status and last contact', () => {
  assert.equal(decideAction({ score: 60, status: 'yet_to_reach_out' }, today).code, 'REACH_OUT_NOW');
  assert.equal(decideAction({ score: 10, status: 'yet_to_reach_out' }, today).code, 'DEPRIORITISE');
  assert.equal(decideAction({ score: 90, status: 'waiting_response', lastContact: '2026-10-05' }, today).code, 'HOLD_AWAITING_REPLY');
  assert.equal(decideAction({ score: 50, status: 'waiting_response', lastContact: '2026-09-01' }, today).code, 'NUDGE_NOW');
  assert.equal(decideAction({ score: 5, status: 'waiting_response', lastContact: '2026-09-01' }, today).code, 'DEPRIORITISE');
  assert.equal(decideAction({ score: 80, status: 'passed' }, today).code, 'SKIP_PASSED');
  assert.equal(decideAction({ score: 80, status: 'in_conversation' }, today).code, 'CONTINUE');
});

test('validator drops stale, undated, link-less and duplicate items', () => {
  const items = [
    { title: 'Fund backs freight startup - Mint', url: 'https://a.com/1', published: 'Wed, 07 Oct 2026 09:47:45 GMT' },
    { title: 'Fund backs freight startup - ET', url: 'https://b.com/1', published: '2026-10-06' },
    { title: 'Old news', url: 'https://c.com', published: '2026-08-01' },
    { title: 'No link', url: '', published: '2026-10-01' },
    { title: 'Bad date', url: 'https://d.com', published: 'soon' },
    { title: 'Future', url: 'https://e.com', published: '2026-12-01' },
  ];
  const out = validateItems(items, today);
  assert.equal(out.length, 1);
  assert.equal(out[0].published, '2026-10-07');
});

test('several outlets covering one event count once', () => {
  const dup = (url) => ({ type: 'investment', relevance: 3, published: '2026-10-08', event: 'acme-seed', url });
  assert.equal(scoreVc([dup('a'), dup('b'), dup('c')], today), 40);
});

test('off-topic activity alone never reaches the outreach threshold', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((e) => ({ type: 'investment', relevance: 1, published: '2026-10-09', event: e }));
  const score = scoreVc(items, today);
  assert.equal(score, 15);
  assert.equal(decideAction({ score, status: 'yet_to_reach_out' }, today).code, 'DEPRIORITISE');
});

test('investor-database pages are not signals', () => {
  const out = validateItems([
    { title: 'Whatfix - 2026 Funding Rounds & List of Investors - Tracxn', url: 'https://x.com/1', published: '2026-10-01' },
    { title: 'Zetwerk company profile', publisher: 'Crunchbase', url: 'https://x.com/2', published: '2026-10-01' },
    { title: 'Freight startup raises seed led by Fund', url: 'https://x.com/3', published: '2026-10-01' },
  ], today);
  assert.deepEqual(out.map((o) => o.url), ['https://x.com/3']);
});
