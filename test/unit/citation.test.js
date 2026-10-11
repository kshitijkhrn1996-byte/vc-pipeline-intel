import test from 'node:test';
import assert from 'node:assert/strict';
import { citesSignal, signalTerms } from '../../src/core/citation.js';

const signals = [{ title: 'BackOps raises $42M to expand AI supply chain automation', summary: 'BackOps secures $42M funding.' }];

test('a draft that names the signal company cites it', () => {
  assert.ok(citesSignal('Hi Rachel,\n\nSaw that you backed BackOps in its $42M round.', signals, 'Construct Capital'));
});

test('a draft built on an old portfolio company from the notes does not', () => {
  assert.equal(citesSignal("Hi Rachel,\n\nI saw Construct Capital's investment in Nauta.", signals, 'Construct Capital'), false);
});

test('generic words and the firm name are not counted as a citation', () => {
  const terms = signalTerms([{ title: 'Construct Capital leads Seed funding round', summary: '' }], 'Construct Capital');
  assert.deepEqual(terms, []);
});

test('a firm blog post is cited by its topic even without a company name', () => {
  const blog = [{ title: 'Elevation Capital on how vertical AI creates new software market winners', summary: 'Elevation blog on vertical AI software winners.' }];
  assert.ok(citesSignal("Hi Mukul,\n\nEnjoyed Elevation's recent piece on how vertical AI creates new software market winners.", blog, 'Elevation Capital'));
});

test('describing the founder\'s own product never counts as citing the signal', () => {
  const s = [{ title: 'Polygrade raises $6.3M for AI warranty claims', summary: 'AI platform for home warranty claims processing.' }];
  assert.equal(citesSignal('Hi Rachel,\n\nFreightLoop helps Indian shippers book carriers, track shipments and reconcile freight invoices.', s, 'Construct Capital'), false);
});

test('the real Nauta draft (generic supply-chain wording, hook from the notes) is rejected', () => {
  const s = [{ title: 'BackOps raises $42M to expand its AI supply chain automation technology', summary: 'BackOps raises $42M for AI supply chain automation.' },
    { title: 'Polygrade raised $6.3M to build an AI platform for home warranty claims processing', summary: '' }];
  const body = "Hi Rachel,\n\nI saw Construct Capital's investment in Nauta and your focus on transforming legacy supply chain operations.\n\nI am the founder of FreightLoop.\n\nBest,\nVikram";
  assert.equal(citesSignal(body, s, 'Construct Capital'), false);
});

test('a signal named only later in the email (not the opening) does not count', () => {
  const s = [{ title: 'BackOps raises $42M for AI supply chain automation', summary: '' }];
  assert.equal(citesSignal('Hi Rachel,\n\nHope you are well.\n\nAlso saw BackOps raised money.', s, 'Construct Capital'), false);
});
