# Agent-Figma-UI-agent

在 Claude Code 中透過官方 Figma MCP 讀取既有 library／components／variables，直接在 Figma 繪製與延伸原生 UI 的 agent。目前規格為 v1.7；M0–M4 已完成（M4 任務 A 實測完成，任務 B、C 由使用者決定略過，見 `docs/history/m4-summary.md`）。v1.7 新增產品政策與記憶分層、預填清單式決策；實作指令見 `CC_BUILD_PROMPT.md`。

啟動：在 Claude Code 輸入 `/figma-ui <需求>`；續改 `/figma-ui continue <run-id> <調整>`；恢復 `/figma-ui resume <run-id>`。詳見 [docs/setup.md](docs/setup.md)，遇到狀況看 [docs/runbook.md](docs/runbook.md)。

| 文件 | 用途 |
|---|---|
| [FIGMA_UI_AGENT_SPEC.md](FIGMA_UI_AGENT_SPEC.md) | 主規格：功能、架構、行為契約與驗收（唯一規範來源） |
| [FIGMA_MCP_RESEARCH.md](FIGMA_MCP_RESEARCH.md) | 研究紀錄：來源、能力差異、未驗證事項 |
| [CC_BUILD_PROMPT.md](CC_BUILD_PROMPT.md) | 交給 Claude Code 的建置指令（只放目前這一版；M0–M4 的舊指令在 `docs/history/`） |
| [product-policies/](product-policies/) | 產品政策：每個產品一份，所有 run 自動套用（規格第 7.5 節） |
| [docs/setup.md](docs/setup.md) | 安裝、帳號恢復與使用方式 |
| [docs/runbook.md](docs/runbook.md) | 日常操作與故障處理 |
| [docs/acceptance-results.md](docs/acceptance-results.md) | P0 必測項驗收結果（M4） |
| [docs/qa-integration-contract.md](docs/qa-integration-contract.md) | Design QA agent 接入契約與就緒條件（階段 B，未就緒） |
| [docs/history/](docs/history/) | 歷史紀錄：M1–M4 總結、v1.6 實作紀錄、M0–M4 建置指令、規格舊版變更紀錄 |
| [docs/research/](docs/research/) | 研究提案（未排入實作）與舊 backlog |

## 安裝

需要 Node.js 22 以上。clone 後先執行一次：

```sh
npm install
```

依賴版本固定在 `package.json`（`ajv` 8.20.0、`ajv-formats` 3.0.1），並以 `package-lock.json` 鎖定；`.npmrc` 設 `save-exact=true`，之後新增的依賴也會固定版本。

測試：`node --test "tests/**/*.test.mjs"`（或 `npm test`）
