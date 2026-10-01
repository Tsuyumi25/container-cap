import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { Tab } from '../core/contracts.ts';

const source = readFileSync(new URL('../public/experiments/zen-tabs/api.js', import.meta.url), 'utf8');

function nativeTab(id: number, cookieStoreId: string, empty = false, closing = false) {
  return { id, cookieStoreId, incognito: false, closing, hasAttribute: () => empty };
}

type NativeTab = ReturnType<typeof nativeTab>;
interface WindowState {
  private: boolean;
  closed: boolean;
  gBrowser: { tabs: NativeTab[] };
  gZenWorkspaces: { promiseInitialized: Promise<void>; allStoredTabs: NativeTab[] };
}

function queryFor(windows: WindowState[]): () => Promise<Tab[]> {
  const sandbox = {
    ExtensionAPI: class {},
    Services: { wm: { getEnumerator: () => windows } },
    zenTabs: undefined as unknown as new () => {
      getAPI(context: unknown): { zenTabs: { query(): Promise<Tab[]> } };
    },
  };
  runInNewContext(source, sandbox);
  return new sandbox.zenTabs().getAPI({
    extension: {
      canAccessWindow: (window: WindowState) => !window.private,
      tabManager: { getWrapper: (tab: NativeTab) => tab },
    },
  }).zenTabs.query;
}

function windowWith(tabs: NativeTab[]): WindowState {
  return {
    private: false,
    closed: false,
    gBrowser: { tabs: tabs.slice(0, 1) },
    gZenWorkspaces: { promiseInitialized: Promise.resolve(), allStoredTabs: tabs },
  };
}

test('all workspace tabs count across windows before and after switching the visible workspace', async () => {
  const personal = nativeTab(1, 'firefox-container-1');
  const work = nativeTab(2, 'firefox-container-2');
  const first = windowWith([personal, work]);
  const second = windowWith([nativeTab(3, 'firefox-container-1')]);
  const query = queryFor([first, second]);
  for (const visible of [personal, work]) {
    first.gBrowser.tabs = [visible];
    const tabs = await query();
    assert.deepEqual(Array.from(tabs, tab => tab.id), [1, 2, 3]);
    assert.equal(tabs.filter(tab => tab.cookieStoreId === 'firefox-container-1').length, 2);
    assert.equal(tabs.filter(tab => tab.cookieStoreId === 'firefox-container-2').length, 1);
  }
});

test('initialization waits for restored tabs and excludes private, empty, closing and duplicate entries', async () => {
  const tab = nativeTab(1, 'firefox-container-1');
  const window = windowWith([]);
  const { promise, resolve: finishRestore } = Promise.withResolvers<void>();
  window.gZenWorkspaces.promiseInitialized = promise;
  const privateWindow = { ...windowWith([nativeTab(9, 'firefox-container-2')]), private: true };
  const result = queryFor([window, privateWindow])();
  window.gZenWorkspaces.allStoredTabs = [
    tab, tab, nativeTab(-1, 'firefox-default', true), nativeTab(2, 'firefox-container-1', false, true),
  ];
  finishRestore();
  assert.deepEqual(Array.from(await result, tab => tab.id), [1]);
});
