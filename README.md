# Container Cap

自用的小插件，拿來限制 Zen 每個 container 的分頁數，避免一不小心又開太多。以 Zen 為使用目標，其他瀏覽器未做相容性驗證。

每個 container 各算各的，可以設定共用上限，也能個別調整。額滿時會關掉新開的分頁，保留原本的分頁；工具列徽章顯示目前 container 還剩多少空位。需要時可以暫停限制。

## 打包與安裝

```sh
pnpm install
pnpm package
```

產物在 `web-ext-artifacts/container-cap.xpi`，到 Zen 的 `about:addons`，從齒輪選單選「從檔案安裝附加元件」即可選取。

`pnpm package` 會先建置，再封裝成 XPI，不會替插件簽章。這是未簽章的自用版本，不上架擴充套件市場。

Zen 安裝前需確認 `about:config` 的 `xpinstall.signatures.required` 為 `false`；這會放寬整個 profile 的簽章檢查，請只安裝信任的擴充套件。可參考 [Zen 的本機插件安裝討論](https://github.com/zen-browser/desktop/discussions/808#discussioncomment-12705690)。

## 開發

```sh
pnpm dev:firefox
```

預設會啟動 Zen，使用專案內獨立的 `.dev/zen-profile`。

```sh
pnpm typecheck
pnpm test
```
