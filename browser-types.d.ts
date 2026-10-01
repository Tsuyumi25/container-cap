import '@wxt-dev/browser';
import type { ContextualIdentities, Sessions, Tabs } from 'webextension-polyfill';
import type { Tab } from './core/contracts';

declare module '@wxt-dev/browser' {
  namespace Browser {
    const contextualIdentities: ContextualIdentities.Static;
    namespace zenTabs {
      function query(): Promise<Tab[]>;
    }
    namespace action {
      interface TitleDetails {
        windowId?: number;
      }
      interface BadgeTextDetails {
        windowId?: number;
      }
      interface BadgeColorDetails {
        windowId?: number;
      }
    }
    namespace sessions {
      const getTabValue: Sessions.Static['getTabValue'];
      const setTabValue: Sessions.Static['setTabValue'];
    }
    namespace tabs {
      interface Tab {
        cookieStoreId?: Tabs.Tab['cookieStoreId'];
      }
    }
  }
}
