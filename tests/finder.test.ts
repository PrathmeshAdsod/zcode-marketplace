import assert from 'node:assert/strict';
import { test } from 'node:test';
import { samples } from '../server/catalog';
import { evidenceFor, finderMatches, validateBrief } from '../server/finder';
import { blankFinderBrief } from '../src/finder-contract';

test('Finder requires literal provenance and rejects a finding from a different archive', () => {
  const query = 'The classroom Wi-Fi may be switched off after setup. Arrow keys would be nice.';
  const brief = validateBrief({ ...blankFinderBrief, requirements: [
    { kind: 'capability', value: 'offline', expected: true, priority: 'must', quote: 'Wi-Fi may be switched off after setup' },
    { kind: 'capability', value: 'keyboard', expected: true, priority: 'prefer', quote: 'Arrow keys would be nice' },
  ] }, query, true);
  assert.ok(brief);
  assert.equal(validateBrief({ ...blankFinderBrief, requirements: [
    { ...brief.requirements[0], value: 'offline', quote: 'Supports offline mode' },
  ] }, query, true), null);
  const real = samples.find(item => item.id === 'acorn-trail')!;
  const stale = { ...real, id: 'stale', digest: 'f'.repeat(64) };
  const { results } = finderMatches([stale, real], query, brief);
  assert.deepEqual(results.map(row => [row.item.id, row.status]), [['acorn-trail', 'match'], ['stale', 'near']]);
  assert.equal(results[0].evidence[0].evidenceId, 'ev-87e194d0bdab-offline');
  assert.equal(results[1].evidence[0].evidenceId, null);
  const orbit = samples.find(item => item.id === 'example-orbit')!;
  assert.equal(evidenceFor(orbit, { kind: 'capability', key: 'multiplayer', expected: true, priority: 'must', quote: '' }).state, 'seller-claimed');
});

test('Finder requires currency clarification before it can recommend a release', () => {
  const query = 'I need a browser game with a budget of 50.';
  const parsed = validateBrief({
    ...blankFinderBrief, budget: { cents: 5000, inclusive: true, quote: 'budget of 50' },
  }, query, true);
  assert.ok(parsed);
  assert.equal(parsed.budget, null);
  assert.equal(parsed.ambiguities[0].quote, 'I need a browser game with a budget of 50');
  assert.ok(finderMatches(samples, query, parsed).results.every(row => row.status === 'near'));
});

test('the tested Inspect edition cannot qualify for a reusable validation contract', () => {
  const inspect = samples.find(item => item.id === 'column-desk-inspect');
  assert.ok(inspect);
  const query = 'I need a reusable CSV contract.';
  const brief = { ...blankFinderBrief, requirements: [
    { kind: 'capability' as const, key: 'schema-export' as const, priority: 'must' as const, expected: true, quote: query },
  ] };
  const candidates = finderMatches(samples, query, brief).results;
  assert.deepEqual(candidates.map(candidate => candidate.item.id), ['column-desk-inspect']);
  const [result] = candidates;
  assert.equal(result.status, 'near');
  assert.equal(result.evidence[0].state, 'contradicted');
  assert.equal(result.evidence[0].evidenceId, 'ev-' + inspect.digest?.slice(0, 12) + '-schema-export');
});
