import '@wxt-dev/browser';
import type { ContextualIdentities, Sessions, Tabs } from 'webextension-polyfill';

declare module '@wxt-dev/browser' {
  namespace Browser {
    const contextualIdentities: ContextualIdentities.Static;
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
