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
