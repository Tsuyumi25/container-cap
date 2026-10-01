import { browser } from 'wxt/browser';
import { ContainerLimiter } from '../core/limiter';
import { quotaDisplay, remainingBadgeText, windowQuotaContexts } from '../core/quota-display';
import type { Request, Response, Session, Settings, Tab } from '../core/contracts';

export default defineBackground(() => {
  const limiter = new ContainerLimiter({
    tabs() {
      return browser.zenTabs.query();
    },
    async containers() {
      return browser.contextualIdentities.query({});
    },
    async close(id) {
      await browser.tabs.remove(id);
    },
    async restoreToken(id) {
      const token = await browser.sessions.getTabValue(id, 'container-cap-token');
      return typeof token === 'string' ? token : undefined;
    },
    async remember(id, token) {
      await browser.sessions.setTabValue(id, 'container-cap-token', token);
    },
    async settings() {
      const { settings } = await browser.storage.local.get('settings');
      return (settings as Settings | undefined) ?? { defaultLimit: 100, limits: {} };
    },
    async saveSettings(settings) {
      await browser.storage.local.set({ settings });
    },
    async session() {
      const { session } = await browser.storage.local.get('session');
      return (session as Session | undefined) ?? { enabled: true, blocked: 0, error: null };
    },
    async saveSession(session) {
      await browser.storage.local.set({ session });
    },
  });

  const shownBadges = new Map<number, string>();
  let refreshRequested = false;
  let refreshing = false;

  async function updateBadges() {
    while (refreshRequested) {
      refreshRequested = false;
      const [state, activeTabs, openWindows, stored] = await Promise.all([
        limiter.status(), browser.tabs.query({ active: true }),
        browser.windows.getAll(), browser.storage.session.get('badgeContexts'),
      ]);
      if (refreshRequested) continue;
      const windowIds = openWindows.flatMap(window =>
        window.id === undefined || window.incognito ? [] : [window.id]);
      const previous = (stored.badgeContexts as Record<number, Tab> | undefined) ?? {};
      const contexts = windowQuotaContexts(windowIds, activeTabs.flatMap(tab =>
        tab.id === undefined ? [] : [{
          id: tab.id, windowId: tab.windowId,
          cookieStoreId: tab.cookieStoreId, incognito: tab.incognito,
        }]), previous);
      if (JSON.stringify(contexts) !== JSON.stringify(previous)) {
        await browser.storage.session.set({ badgeContexts: contexts });
      }
      const windows = new Set(windowIds);
      for (const windowId of shownBadges.keys()) {
        if (!windows.has(windowId)) shownBadges.delete(windowId);
      }
      for (const windowId of windowIds) {
        const display = quotaDisplay(state, contexts[windowId]);
        const signature = JSON.stringify(display);
        if (shownBadges.get(windowId) === signature) continue;
        const status = display.enabled ? '已啟用' : '已暫停';
        const capacity = display.remaining !== null && display.remaining < 0
          ? `超出上限 ${-display.remaining} 個`
          : `剩餘 ${display.remaining}`;
        let title = display.count === null
          ? `Container Cap：此分頁未使用 container · ${status}`
          : `${display.name}：${display.count}/${display.limit} · ${capacity} · ${status}`;
        if (display.error) title += `\n${display.error}`;
        const color = !display.enabled ? '#626a77'
          : display.remaining !== null && display.remaining <= 0 ? '#a32020' : '#27323b';
        try {
          await Promise.all([
            browser.action.setBadgeText({ windowId, text: remainingBadgeText(display.remaining) }),
            browser.action.setBadgeBackgroundColor({ windowId, color }),
            browser.action.setTitle({ windowId, title }),
          ]);
          shownBadges.set(windowId, signature);
        } catch (cause) {
          console.error('Container Cap badge 更新失敗：', cause);
        }
      }
    }
  }

  function scheduleBadgeUpdate() {
    refreshRequested = true;
    if (refreshing) return;
    refreshing = true;
    void updateBadges().catch(console.error).finally(() => {
      refreshing = false;
      if (refreshRequested) scheduleBadgeUpdate();
    });
  }

  browser.tabs.onCreated.addListener(tab => {
    if (tab.id === undefined) return;
    void limiter.created({ id: tab.id, cookieStoreId: tab.cookieStoreId, incognito: tab.incognito })
      .catch(cause => console.error('Container Cap 已暫停：', cause))
      .finally(scheduleBadgeUpdate);
  });
  browser.tabs.onRemoved.addListener(scheduleBadgeUpdate);
  browser.tabs.onActivated.addListener(scheduleBadgeUpdate);
  browser.tabs.onAttached.addListener(scheduleBadgeUpdate);
  browser.tabs.onDetached.addListener(scheduleBadgeUpdate);
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === 'complete') scheduleBadgeUpdate();
  });
  browser.windows.onFocusChanged.addListener(scheduleBadgeUpdate);
  browser.windows.onRemoved.addListener(scheduleBadgeUpdate);
  browser.contextualIdentities.onCreated.addListener(scheduleBadgeUpdate);
  browser.contextualIdentities.onRemoved.addListener(scheduleBadgeUpdate);
  browser.contextualIdentities.onUpdated.addListener(scheduleBadgeUpdate);

  browser.runtime.onMessage.addListener((message: Request, sender) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return;
    if (!['status', 'set-enabled', 'set-default-limit', 'set-container-limit'].includes(message.type)) return;
    return (async (): Promise<Response> => {
      try {
        switch (message.type) {
          case 'status':
            return { ok: true, state: await limiter.status() };
          case 'set-enabled':
            if (typeof message.enabled !== 'boolean') throw new Error('啟用狀態格式錯誤。');
            return { ok: true, state: await limiter.setEnabled(message.enabled) };
          case 'set-default-limit':
            return { ok: true, state: await limiter.setDefaultLimit(message.limit) };
          case 'set-container-limit':
            return { ok: true, state: await limiter.setContainerLimit(message.cookieStoreId, message.limit) };
        }
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
      }
    })();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.session || changes.settings)) scheduleBadgeUpdate();
  });
  void limiter.initialize().catch(async cause => {
    console.error('Container Cap 初始化失敗：', cause);
    await limiter.setEnabled(false);
  }).then(scheduleBadgeUpdate).catch(console.error);
  void browser.action.setBadgeTextColor({ color: '#ffffff' }).catch(console.error);
});
