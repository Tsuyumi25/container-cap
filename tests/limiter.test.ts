import test from 'node:test';
import assert from 'node:assert/strict';
import { ContainerLimiter } from '../core/limiter.ts';
import type { LimiterPort, Session, Settings, Tab } from '../core/contracts.ts';

const A = 'firefox-container-1';
const B = 'firefox-container-2';

function fixture(initial: Tab[] = []) {
  const data = {
    tabs: structuredClone(initial),
    settings: { defaultLimit: 100, limits: {} } as Settings,
    session: { enabled: true, blocked: 0, error: null } as Session,
    failQuery: false,
    failClose: false,
    closed: [] as number[],
    tokens: new Map<number, string>(),
  };
  const port: LimiterPort = {
    async tabs() {
      if (data.failQuery) throw new Error('query failed');
      return structuredClone(data.tabs);
    },
    async containers() {
      return [
        { cookieStoreId: A, name: 'A', color: 'blue' },
        { cookieStoreId: B, name: 'B', color: 'red' },
      ];
    },
    async close(id) {
      if (data.failClose) throw new Error('close failed');
      data.closed.push(id);
      data.tabs = data.tabs.filter(tab => tab.id !== id);
    },
    async restoreToken(id) { return data.tokens.get(id); },
    async remember(id, token) { data.tokens.set(id, token); },
    async settings() { return structuredClone(data.settings); },
    async saveSettings(settings) { data.settings = structuredClone(settings); },
    async session() { return structuredClone(data.session); },
    async saveSession(session) { data.session = structuredClone(session); },
  };
  const limiter = new ContainerLimiter(port);
  async function open(id: number, cookieStoreId = A) {
    const tab = { id, cookieStoreId };
    data.tabs.push(tab);
    await limiter.created(tab);
  }
  return { data, port, limiter, open };
}

test('each container has its own quota irrespective of the combined total', async () => {
  const { limiter, data, open } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(true);
  await open(2, B);
  await open(3, A);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2]);
  assert.deepEqual(data.closed, [3]);
  const status = await limiter.status();
  assert.deepEqual(status.containers.map(c => [c.name, c.count, c.limit]), [['A', 1, 1], ['B', 1, 1]]);
  assert.equal(status.blocked, 1);
});

test('a burst of ten at 99 keeps the old 99 and the first new tab', async () => {
  const initial = Array.from({ length: 99 }, (_, i) => ({ id: i + 1, cookieStoreId: A }));
  const { limiter, data } = fixture(initial);
  await limiter.setEnabled(true);
  const arrivals = Array.from({ length: 10 }, (_, i) => ({ id: i + 100, cookieStoreId: A }));
  data.tabs.push(...arrivals);
  await Promise.all(arrivals.map(tab => limiter.created(tab)));
  assert.deepEqual(data.tabs.map(tab => tab.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(data.closed, [101, 102, 103, 104, 105, 106, 107, 108, 109]);
});

test('pinned, hidden and discarded tabs across windows still occupy container slots', async () => {
  const initial = [
    { id: 1, cookieStoreId: A, pinned: true, windowId: 1 },
    { id: 2, cookieStoreId: A, hidden: true, windowId: 2 },
    { id: 3, cookieStoreId: A, discarded: true, windowId: 3 },
  ];
  const { limiter, data, open } = fixture(initial);
  await limiter.setDefaultLimit(3);
  await limiter.setEnabled(true);
  await open(4);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2, 3]);
  assert.deepEqual(data.closed, [4]);
});

test('restoration while paused and enabling above quota preserve existing tabs', async () => {
  const { limiter, data, open } = fixture();
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(false);
  await open(1);
  await open(2);
  await open(3);
  assert.equal((await limiter.status()).enabled, false);
  await limiter.setEnabled(true);
  assert.deepEqual(data.closed, []);
  await open(4);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2, 3]);
  assert.deepEqual(data.closed, [4]);
});

test('a tab already present when enabling is protected from a queued creation event', async () => {
  const { limiter, data } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  const enabling = limiter.setEnabled(true);
  const restored = { id: 2, cookieStoreId: A };
  data.tabs.push(restored);
  const creation = limiter.created(restored);
  await Promise.all([enabling, creation]);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2]);
  assert.deepEqual(data.closed, []);
});

test('lowering a limit does not cull tabs and admissions resume after space is freed', async () => {
  const { limiter, data, open } = fixture([{ id: 1, cookieStoreId: A }, { id: 2, cookieStoreId: A }]);
  await limiter.setEnabled(true);
  await limiter.setDefaultLimit(1);
  assert.deepEqual(data.closed, []);
  await open(3);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2]);
  data.tabs = [];
  await open(4);
  assert.deepEqual(data.tabs.map(tab => tab.id), [4]);
});

test('container overrides persist independently and reset follows the default', async () => {
  const { limiter, data, open } = fixture();
  await limiter.setDefaultLimit(1);
  await limiter.setContainerLimit(A, 2);
  await limiter.setEnabled(true);
  await open(1);
  await open(2);
  await open(3, B);
  await open(4, B);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2, 3]);
  await limiter.setContainerLimit(A, null);
  const a = (await limiter.status()).containers[0];
  assert.equal(a?.limit, 1);
  assert.equal(a?.overridden, false);
  await open(5);
  assert.deepEqual(data.closed, [4, 5]);
});

test('default, private and missing-container tabs stay untouched', async () => {
  const { limiter, data } = fixture();
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(true);
  const arrivals = [
    { id: 1, cookieStoreId: 'firefox-default' },
    { id: 2, cookieStoreId: 'firefox-default' },
    { id: 3, cookieStoreId: 'firefox-private', incognito: true },
    { id: 4, cookieStoreId: A, incognito: true },
    { id: 5 },
  ];
  data.tabs.push(...arrivals);
  await Promise.all(arrivals.map(tab => limiter.created(tab)));
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2, 3, 4, 5]);
  assert.deepEqual((await limiter.status()).containers.map(c => c.count), [0, 0]);
  assert.deepEqual(data.closed, []);
});

test('invalid limits and nonexistent container overrides do not alter settings', async () => {
  const { limiter, data } = fixture();
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(limiter.setDefaultLimit(limit));
    await assert.rejects(limiter.setContainerLimit(A, limit));
  }
  await assert.rejects(limiter.setContainerLimit('missing', 5));
  assert.deepEqual(data.settings, { defaultLimit: 100, limits: {} });
});

test('a failed close pauses enforcement and never substitutes an older tab', async () => {
  const { limiter, data, open } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(true);
  data.failClose = true;
  await assert.rejects(open(2), /close failed/);
  data.failClose = false;
  await open(3);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2, 3]);
  assert.equal((await limiter.status()).enabled, false);
  assert.match((await limiter.status()).error!, /close failed/);
  assert.deepEqual(data.closed, []);
});

test('a query failure pauses enforcement and keeps existing and incoming tabs', async () => {
  const { limiter, data, open } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setEnabled(true);
  data.failQuery = true;
  await assert.rejects(open(2), /query failed/);
  data.failQuery = false;
  assert.equal((await limiter.status()).enabled, false);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 2]);
  assert.deepEqual(data.closed, []);
});

test('enabled and paused choices survive controller recreation', async () => {
  const { limiter, port, data } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(true);
  const resumed = new ContainerLimiter(port);
  const newTab = { id: 2, cookieStoreId: A };
  data.tabs.push(newTab);
  await resumed.created(newTab);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1]);
  assert.equal((await resumed.status()).enabled, true);
  await resumed.setEnabled(false);
  const restarted = new ContainerLimiter(port);
  const next = { id: 3, cookieStoreId: A };
  data.tabs.push(next);
  await restarted.created(next);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 3]);
  assert.equal((await restarted.status()).enabled, false);
});

test('a tab closed before its creation handler runs does not consume capacity', async () => {
  const { limiter, data } = fixture();
  await limiter.setDefaultLimit(1);
  await limiter.setEnabled(true);
  const gone = { id: 1, cookieStoreId: A };
  const present = { id: 2, cookieStoreId: A };
  data.tabs.push(present);
  await Promise.all([limiter.created(gone), limiter.created(present)]);
  assert.deepEqual(data.tabs.map(tab => tab.id), [2]);
  assert.deepEqual(data.closed, []);
});

test('restoring an accepted tab above the limit preserves it while new tabs are refused', async () => {
  const { limiter, data, open } = fixture();
  await limiter.setDefaultLimit(1);
  await open(1);
  const token = data.tokens.get(1)!;
  data.tabs = [];
  await open(2);
  const restored = { id: 3, cookieStoreId: A };
  data.tokens.set(3, token);
  data.tabs.push(restored);
  await limiter.created(restored);
  await open(4);
  assert.deepEqual(data.tabs.map(tab => tab.id), [2, 3]);
  assert.deepEqual(data.closed, [4]);
  assert.equal((await limiter.status()).enabled, true);
});

test('duplicating an open tab cannot reuse its restoration token to bypass the cap', async () => {
  const { limiter, data, open } = fixture();
  await limiter.setDefaultLimit(1);
  await open(1);
  const duplicate = { id: 2, cookieStoreId: A };
  data.tokens.set(2, data.tokens.get(1)!);
  data.tabs.push(duplicate);
  await limiter.created(duplicate);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1]);
  assert.deepEqual(data.closed, [2]);
});

test('an accepted duplicate receives an independent restoration identity', async () => {
  const { limiter, data, open } = fixture();
  await limiter.setDefaultLimit(2);
  await open(1);
  const duplicate = { id: 2, cookieStoreId: A };
  data.tokens.set(2, data.tokens.get(1)!);
  data.tabs.push(duplicate);
  await limiter.created(duplicate);
  assert.notEqual(data.tokens.get(1), data.tokens.get(2));
  const token = data.tokens.get(2)!;
  data.tabs = data.tabs.filter(tab => tab.id !== 2);
  await open(3);
  data.tokens.set(4, token);
  const restored = { id: 4, cookieStoreId: A };
  data.tabs.push(restored);
  await limiter.created(restored);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1, 3, 4]);
  assert.deepEqual(data.closed, []);
});

test('initialization adopts existing tabs and preserves their identities across a restart', async () => {
  const { limiter, port, data } = fixture([{ id: 1, cookieStoreId: A }, { id: 2, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  await limiter.initialize();
  const tokens = [data.tokens.get(1)!, data.tokens.get(2)!];
  data.tabs = [];
  const restarted = new ContainerLimiter(port);
  await restarted.initialize();
  const restored = [{ id: 3, cookieStoreId: A }, { id: 4, cookieStoreId: A }];
  data.tokens.set(3, tokens[0]!);
  data.tokens.set(4, tokens[1]!);
  data.tabs.push(...restored);
  await Promise.all(restored.map(tab => restarted.created(tab)));
  assert.deepEqual(data.tabs.map(tab => tab.id), [3, 4]);
  assert.deepEqual(data.closed, []);
  assert.equal((await restarted.status()).enabled, true);
});

test('initialization never adopts queued new tabs as restored tabs', async () => {
  const { limiter, data } = fixture([{ id: 1, cookieStoreId: A }]);
  await limiter.setDefaultLimit(1);
  const initialization = limiter.initialize();
  const arrival = { id: 2, cookieStoreId: A };
  data.tabs.push(arrival);
  const creation = limiter.created(arrival);
  await Promise.all([initialization, creation]);
  assert.deepEqual(data.tabs.map(tab => tab.id), [1]);
  assert.deepEqual(data.closed, [2]);
});
