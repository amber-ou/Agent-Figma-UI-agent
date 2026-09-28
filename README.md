# Agent-Figma-UI-agent

在 Claude Code 中透過官方 Figma MCP 讀取既有 library／components／variables，直接在 Figma 繪製與延伸原生 UI 的 agent。目前規格為 v1.3；M0–M1（真實 Figma 垂直流程、hooks 強制層、最小完成判定）已完成，下一步為 M2（`/figma-ui` skill 與資料契約）。

| 文件 | 用途 |
|---|---|
| [FIGMA_UI_AGENT_SPEC.md](FIGMA_UI_AGENT_SPEC.md) | 主規格：功能、架構、行為契約與驗收（唯一規範來源） |
| [FIGMA_MCP_RESEARCH.md](FIGMA_MCP_RESEARCH.md) | 研究紀錄：來源、能力差異、未驗證事項 |
| [CC_BUILD_PROMPT.md](CC_BUILD_PROMPT.md) | 交給 Claude Code 的建置指令（含 M2 指令） |
| [docs/m1-summary.md](docs/m1-summary.md) | M1 實測總結 |

測試：`node --test "tests/**/*.test.mjs"`
