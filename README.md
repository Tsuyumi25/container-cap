# Container Cap

自用的小插件，拿來限制 Zen 每個 container 的分頁數，避免一不小心又開太多。使用 Zen 專用 API，僅支援 Zen。

每個 container 各算各的，可以設定共用上限，也能個別調整。額滿時會關掉新開的分頁，保留原本的分頁；工具列徽章顯示目前 container 還剩多少空位，超出上限時顯示負數，例如 `-8` 代表超出 8 個分頁。需要時可以暫停限制。

同一個 container 的分頁會跨 workspace、跨視窗合併計數，包含未切換過的 workspace。

## 打包與安裝

```sh
pnpm install
pnpm package
```

產物在 `web-ext-artifacts/container-cap.xpi`，到 Zen 的 `about:addons`，從齒輪選單選「從檔案安裝附加元件」即可選取。

`pnpm package` 會先建置，再封裝成 XPI，不會替插件簽章。這是未簽章的自用版本，不上架擴充套件市場。

Zen 安裝前需在 `about:config` 確認：

- `xpinstall.signatures.required` = `false`
- `extensions.experiments.enabled` = `true`

前者會放寬整個 profile 的簽章檢查；後者允許插件執行具有瀏覽器內部權限的 Experiment API，請只安裝信任的擴充套件。這個插件透過 Zen 內部 API 取得所有 workspace 的分頁，Zen 更新後可能需要配合調整。

參考：[Zen 本機插件安裝](https://github.com/zen-browser/desktop/discussions/808#discussioncomment-12705690)、[Experiment API 權限與設定](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/basics.html#adding-experimental-apis-in-privileged-extensions)。

## 開發

```sh
pnpm dev:firefox
```

預設會啟動 Zen，使用專案內獨立的 `.dev/zen-profile`。

```sh
pnpm typecheck
pnpm test
```
