this.zenTabs = class extends ExtensionAPI {
  getAPI(context) {
    const { extension } = context;
    return {
      zenTabs: {
        async query() {
          const tabs = [];
          const seen = new Set();
          for (const window of Services.wm.getEnumerator('navigator:browser')) {
            if (!extension.canAccessWindow(window)) continue;
            const workspaces = window.gZenWorkspaces;
            if (!workspaces) throw new Error('Container Cap 需要 Zen workspace API。');
            await workspaces.promiseInitialized;
            if (window.closed) continue;
            for (const nativeTab of workspaces.allStoredTabs) {
              if (nativeTab.closing || nativeTab.hasAttribute('zen-empty-tab')) continue;
              const tab = extension.tabManager.getWrapper(nativeTab);
              if (!tab || seen.has(tab.id)) continue;
              seen.add(tab.id);
              tabs.push({ id: tab.id, cookieStoreId: tab.cookieStoreId, incognito: tab.incognito });
            }
          }
          return tabs;
        },
      },
    };
  }
};
