# Agent-Figma-UI-agent

在 Claude Code 中透過官方 Figma MCP 讀取既有 library／components／variables，直接在 Figma 繪製與延伸原生 UI 的 agent。目前規格為 v1.3；M0–M1（真實 Figma 垂直流程、hooks 強制層、最小完成判定）已完成，下一步為 M2（`/figma-ui` skill 與資料契約）。

| 文件 | 用途 |
|---|---|
| [FIGMA_UI_AGENT_SPEC.md](FIGMA_UI_AGENT_SPEC.md) | 主規格：功能、架構、行為契約與驗收（唯一規範來源） |
| [FIGMA_MCP_RESEARCH.md](FIGMA_MCP_RESEARCH.md) | 研究紀錄：來源、能力差異、未驗證事項 |
| [CC_BUILD_PROMPT.md](CC_BUILD_PROMPT.md) | 交給 Claude Code 的建置指令（含 M2 指令） |
| [docs/m1-summary.md](docs/m1-summary.md) | M1 實測總結 |

## 安裝

需要 Node.js 22 以上。clone 後先執行一次：

```sh
npm install
```

依賴版本固定在 `package.json`（`ajv` 8.20.0、`ajv-formats` 3.0.1），並以 `package-lock.json` 鎖定；`.npmrc` 設 `save-exact=true`，之後新增的依賴也會固定版本。

測試：`node --test "tests/**/*.test.mjs"`（或 `npm test`）
