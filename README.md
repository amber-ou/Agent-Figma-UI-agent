# Agent-Figma-UI-agent

在 Claude Code 中透過官方 Figma MCP 讀取既有 library／components／variables，直接在 Figma 繪製與延伸原生 UI 的 agent。目前規格為 v1.4；M0–M2 已完成，第一次真實任務（名片分享成功）已跑完整個流程並接受為測試成功。下一步為 M3（實作 v1.4 規則、協作情境與失敗事件實測），指令見 `CC_BUILD_PROMPT.md` 文末。

啟動：在 Claude Code 輸入 `/figma-ui <需求>`；續改 `/figma-ui continue <run-id> <調整>`；恢復 `/figma-ui resume <run-id>`。詳見 [docs/setup.md](docs/setup.md)。

| 文件 | 用途 |
|---|---|
| [FIGMA_UI_AGENT_SPEC.md](FIGMA_UI_AGENT_SPEC.md) | 主規格：功能、架構、行為契約與驗收（唯一規範來源） |
| [FIGMA_MCP_RESEARCH.md](FIGMA_MCP_RESEARCH.md) | 研究紀錄：來源、能力差異、未驗證事項 |
| [CC_BUILD_PROMPT.md](CC_BUILD_PROMPT.md) | 交給 Claude Code 的建置指令（含 M2 指令） |
| [docs/m1-summary.md](docs/m1-summary.md) | M1 實測總結 |
| [docs/m3-first-run-summary.md](docs/m3-first-run-summary.md) | 第一次真實任務總結 |
| [docs/m2-summary.md](docs/m2-summary.md) | M2 交付、測試對應與限制 |
| [docs/setup.md](docs/setup.md) | 安裝、帳號恢復與使用方式 |
| [docs/use-figma-quality-research.md](docs/use-figma-quality-research.md) | `use_figma` 品質與精準度研究（建議，未實作） |
| [docs/design-quality-research.md](docs/design-quality-research.md) | 設計品質提升研究（建議，未實作） |
| [docs/extension-spec-research.md](docs/extension-spec-research.md) | 延伸既有畫面時，要從檔案抽哪些規格、問哪些問題（建議，未實作） |
| [docs/adjustment-plan.md](docs/adjustment-plan.md) | 整合所有研究的調整計畫與待確認決策（確認後才執行） |
| [docs/backlog.md](docs/backlog.md) | 研究後記下、尚未排入實作的調整項目與待決定事項 |

## 安裝

需要 Node.js 22 以上。clone 後先執行一次：

```sh
npm install
```

依賴版本固定在 `package.json`（`ajv` 8.20.0、`ajv-formats` 3.0.1），並以 `package-lock.json` 鎖定；`.npmrc` 設 `save-exact=true`，之後新增的依賴也會固定版本。

測試：`node --test "tests/**/*.test.mjs"`（或 `npm test`）
