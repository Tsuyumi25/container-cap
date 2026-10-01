import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaDisplay, remainingBadgeText, windowQuotaContexts } from '../core/quota-display.ts';
import type { Snapshot } from '../core/contracts.ts';

const state: Snapshot = {
  enabled: true,
  blocked: 0,
  error: null,
  defaultLimit: 100,
  containers: [
    { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', count: 82, limit: 100, overridden: false },
    { cookieStoreId: 'firefox-container-2', name: 'Reading', color: 'red', count: 3, limit: 5, overridden: true },
  ],
};

test('switching the active container selects its own usage and override, never the sum', () => {
  const work = quotaDisplay(state, { id: 1, cookieStoreId: 'firefox-container-1' });
  const reading = quotaDisplay(state, { id: 2, cookieStoreId: 'firefox-container-2' });
  assert.deepEqual([work.count, work.limit, work.remaining], [82, 100, 18]);
  assert.deepEqual([reading.count, reading.limit, reading.remaining], [3, 5, 2]);
});

test('unmanaged, private and missing active tabs do not retain another container quota', () => {
  for (const tab of [
    undefined,
    { id: 1, cookieStoreId: 'firefox-default' },
    { id: 2, cookieStoreId: 'firefox-container-1', incognito: true },
    { id: 3, cookieStoreId: 'deleted-container' },
  ]) {
    const display = quotaDisplay(state, tab);
    assert.deepEqual([display.count, display.limit, display.remaining], [null, null, null]);
  }
});

test('pausing retains quota visibility', () => {
  const display = quotaDisplay({ ...state, enabled: false }, { id: 1, cookieStoreId: 'firefox-container-1' });
  assert.deepEqual([display.count, display.limit, display.remaining, display.enabled], [82, 100, 18, false]);
});

test('excess usage remains visible while paused and enabled as tabs close below the limit', () => {
  for (const enabled of [false, true]) {
    for (const [count, remaining] of [[120, -20], [101, -1], [100, 0], [99, 1]] as const) {
      const display = quotaDisplay({
        ...state,
        enabled,
        containers: [{ ...state.containers[0]!, count }],
      }, { id: 1, cookieStoreId: 'firefox-container-1' });
      assert.deepEqual([display.count, display.limit, display.remaining], [count, 100, remaining]);
    }
  }
});

test('native badges distinguish no quota from zero remaining and abbreviate without rounding up', () => {
  for (const [remaining, expected] of [
    [null, ''], [0, '0'], [18, '18'], [999, '999'],
    [1000, '1k'], [1999, '1k'], [999999, '999k'],
    [1000000, '1M'], [1000000000, '1B'],
    [1000000000000, '1T'], [Number.MAX_SAFE_INTEGER, '9P'],
    [-1, '-1'], [-999, '-999'], [-1000, '-1k'], [-1999, '-1k'],
    [-999999, '-999k'], [-1000000, '-1M'], [-Number.MAX_SAFE_INTEGER, '-9P'],
  ] as const) {
    assert.equal(remainingBadgeText(remaining), expected);
  }
});

test('closing the final tab updates the remembered container to its full remaining quota', () => {
  const active = [{ id: 3, windowId: 1, cookieStoreId: 'firefox-container-1' }];
  const previous = windowQuotaContexts([1], active);
  const emptied: Snapshot = {
    ...state,
    containers: [{ ...state.containers[0]!, count: 0, limit: 3 }],
  };
  const afterClose = windowQuotaContexts([1], [], previous);
  assert.equal(remainingBadgeText(quotaDisplay(emptied, afterClose[1]).remaining), '3');
  const afterWake = windowQuotaContexts([1], [], JSON.parse(JSON.stringify(afterClose)));
  assert.equal(remainingBadgeText(quotaDisplay(emptied, afterWake[1]).remaining), '3');
});

test('switching to an unmanaged tab clears the remembered container badge', () => {
  const previous = windowQuotaContexts([1], [{ id: 3, windowId: 1, cookieStoreId: 'firefox-container-1' }]);
  const switched = windowQuotaContexts([1], [{ id: 4, windowId: 1, cookieStoreId: 'firefox-default' }], previous);
  assert.equal(remainingBadgeText(quotaDisplay(state, switched[1]).remaining), '');
  const closed = windowQuotaContexts([1], [], switched);
  assert.equal(remainingBadgeText(quotaDisplay(state, closed[1]).remaining), '');
});

test('window contexts stay independent and a closed window cannot leak its quota into a new window', () => {
  const previous = windowQuotaContexts([1, 2], [
    { id: 3, windowId: 1, cookieStoreId: 'firefox-container-1' },
    { id: 4, windowId: 2, cookieStoreId: 'firefox-container-2' },
  ]);
  const afterClose = windowQuotaContexts([2, 5], [], previous);
  assert.equal(afterClose[1], undefined);
  assert.equal(remainingBadgeText(quotaDisplay(state, afterClose[2]).remaining), '2');
  assert.equal(remainingBadgeText(quotaDisplay(state, afterClose[5]).remaining), '');
});
