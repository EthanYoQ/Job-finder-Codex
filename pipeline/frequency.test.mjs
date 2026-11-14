import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {slotAt,timerBelongsToSlot} from './frequency.mjs';

const midnight = Date.parse('2026-11-14T00:01:00+08:00');
const next = Date.parse('2026-11-15T00:01:00+08:00');

test('the timer and retry slots both use Beijing 00:01', () => {
  const timer = readFileSync(new URL('./jobfinder-refresh.timer', import.meta.url), 'utf8');
  assert.deepEqual(timer.match(/^OnCalendar=.*$/gm), ['OnCalendar=*-*-* 16:01:00 UTC']);
  assert.equal(slotAt(midnight-1), Date.parse('2026-11-13T00:01:00+08:00'));
  assert.equal(slotAt(midnight), midnight);
  assert.equal(slotAt(Date.parse('2026-11-14T12:01:00+08:00')), midnight);
  assert.equal(slotAt(next-1), midnight);
  assert.equal(slotAt(next), next);
});

test('a delayed retry retains the same timer provenance until the next daily slot', () => {
  const triggered = midnight + 1_000;
  assert.equal(timerBelongsToSlot(triggered, midnight, next-1), true);
  assert.equal(timerBelongsToSlot(triggered, next, next), false);
  assert.equal(timerBelongsToSlot(triggered, midnight, midnight), false);
  assert.equal(timerBelongsToSlot(NaN, midnight, midnight), false);
});
