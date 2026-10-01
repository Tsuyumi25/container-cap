import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const profile = fileURLToPath(new URL('./.dev/zen-profile', import.meta.url));
mkdirSync(profile, { recursive: true });

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifestVersion: 3,
  manifest: {
    name: 'Container Cap',
    description: '每個 Firefox container 各自限制分頁數，保留既有分頁。',
    icons: { 16: 'icon.svg', 32: 'icon.svg', 48: 'icon.svg', 96: 'icon.svg' },
    action: { default_icon: 'icon.svg' },
    permissions: ['tabs', 'cookies', 'contextualIdentities', 'storage', 'sessions'],
    incognito: 'not_allowed',
    experiment_apis: {
      zenTabs: {
        schema: 'experiments/zen-tabs/schema.json',
        parent: {
          scopes: ['addon_parent'],
          paths: [['zenTabs']],
          script: 'experiments/zen-tabs/api.js',
        },
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'container-cap@local',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
  webExt: {
    disabled: process.env.CONTAINER_CAP_NO_BROWSER === '1',
    binaries: { firefox: process.env.FIREFOX_BINARY ?? 'zen-beta' },
    firefoxProfile: profile,
    keepProfileChanges: true,
    firefoxPref: {
      'privacy.userContext.enabled': true,
      'extensions.experiments.enabled': true,
    },
  },
});
