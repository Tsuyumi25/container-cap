import type { Snapshot, Tab } from './contracts.ts';

export interface QuotaDisplay {
  name: string | null;
  count: number | null;
  limit: number | null;
  remaining: number | null;
  enabled: boolean;
  error: string | null;
}

export function quotaDisplay(state: Snapshot, activeTab?: Tab): QuotaDisplay {
  const container = activeTab && !activeTab.incognito
    ? state.containers.find(item => item.cookieStoreId === activeTab.cookieStoreId)
    : undefined;
  return {
    name: container?.name ?? null,
    count: container?.count ?? null,
    limit: container?.limit ?? null,
    remaining: container ? container.limit - container.count : null,
    enabled: state.enabled,
    error: state.error,
  };
}

export function remainingBadgeText(remaining: number | null): string {
  if (remaining === null) return '';
  const magnitude = Math.abs(remaining);
  for (const [scale, suffix] of [
    [1e15, 'P'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k'],
  ] as const) {
    if (magnitude >= scale) return `${Math.trunc(remaining / scale)}${suffix}`;
  }
  return String(remaining);
}

export function windowQuotaContexts(
  windowIds: readonly number[],
  activeTabs: readonly (Tab & { windowId: number })[],
  previous: Readonly<Record<number, Tab>> = {},
): Record<number, Tab> {
  const contexts: Record<number, Tab> = {};
  const openWindows = new Set(windowIds);
  for (const windowId of windowIds) {
    if (previous[windowId]) contexts[windowId] = previous[windowId];
  }
  for (const tab of activeTabs) {
    if (!openWindows.has(tab.windowId)) continue;
    contexts[tab.windowId] = {
      id: tab.id, cookieStoreId: tab.cookieStoreId, incognito: tab.incognito,
    };
  }
  return contexts;
}
