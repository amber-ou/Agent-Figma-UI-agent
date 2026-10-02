# v1.6 流程精簡：實作紀錄（階段 A）

日期：2026-09-29 · 依據：使用者接受的「UI Agent 流程精簡：Agent 實作任務書」1.0 · spec v1.6 · schemaVersion 1.2 · 分支：`claude/wizardly-allen-atzgrb`（已合併 main 3742cda，含 M3 與 spec v1.5）

- 驗證層級：全部為 **offline_fixture**。本次在雲端環境執行，沒有 Figma 連線，**沒有真實 Figma 驗證，也沒有效能量測**；只能說已實作批次、按需診斷與量測機制，不能說已加速。
- 測試：`node --test "tests/**/*.test.mjs"` → 開始前 78 pass／0 fail；完成後 **116 pass／0 fail**（新增 38 項）。沒有既有失敗；本次唯一改動的既有測試是 `cross-file.test.mjs` 的一個 regex（新的過期檢查回報第一個相關寫入 op-0003，而舊寫法只接受 op-0007；兩者都是正確的過期原因）。
- 歷史的「M3 78 項通過」只作基準參考，不是本次結果。

## A01–A07

| 項目 | 狀態 | 修改位置 | 驗證 | 剩餘 |
|---|---|---|---|---|
| **A01** 同步現況與規範 | `done` | `FIGMA_UI_AGENT_SPEC.md`（v1.6：0.1、4.5、5.1 CAP-06、6.6、7.2 ASK-06／07、8.2、8.3、12.1、13.2 T52–T60、14、15、16.3、17、20、INVARIANT-20–23、20.3 變更紀錄）；`FIGMA_MCP_RESEARCH.md`（位元組更正、§14）；`docs/history/build-prompts-m0-m4.md`（M4 改 v1.6）；`README.md`、`CLAUDE.md`、`docs/setup.md`；`SKILL.md` 與 references | 回傳上限在規範與 skill 皆寫為 20,480 **UTF-8 位元組**、批次約 15,000 **位元組**；歷史文件（m2-summary、m3-first-run-summary）保留原始時點的寫法 | — |
| **A02** 階段式驗證與單一完成入口 | `done` | `scripts/validate-artifacts.mjs`（`--stage intake\|plan\|build\|final`、deferred、`buildReadiness`、`inputDigest`、`evaluationIsCurrent`）；`scripts/evaluate-completion.mjs`（讀 journal、`writeEvaluation`、判定摘要）；`scripts/operation-journal.mjs`（記 write 前強制 build 邊界）；`schemas/audit.schema.json` | `tests/contracts/v16-workflow.test.mjs` A02 項（9 項） | — |
| **A03** 證據對應的最低補強 | `done` | `schemas/audit.schema.json`（`cellKeys`、`state`、`subject`）、`schemas/ledger.schema.json`（`userChangeDetectedAt`）；validator（`evidenceCoversCell`、`evidenceValidity`）；evaluator 逐 cell 比對；`references/design-quality.md`、`collaboration.md` | v16-workflow A03 項（7 項） | 真實 run 中 skill 是否確實填寫 `subject`／`scopeRootIds` 待 M4 驗證 |
| **A04** 減少重問、按需 flow | `done` | `schemas/plan.schema.json`（`flow`、`screens[].copy`）；validator（flow 對應與 Build 邊界）；evaluator（flow 未確認／open unknowns → awaiting_user）；新 `scripts/run-context.mjs`；`SKILL.md` §0、§2、§5；新 `references/flow.md`；`references/design-decisions.md` | v16-workflow A04 項（5 項，含 new／continue／resume 三種代表情境） | 對話行為（模型是否真的少問）只有規則與情境測試，未做模型實測 |
| **A05** 範圍化 Discover 與受控批次 | `done` | 新 `snippets/discover-helpers.js`（位元組分頁、Figma 端字型比對、instance 分組不混用 override／mode／版本）；`references/discovery.md`（移除固定 2–3 張）；`SKILL.md` §4、§6、§7（composition 批次、一次讀回確認多個 write、同檔不平行、截圖節奏）；`operation-journal verify` 接受多個 operationIds | `tests/contracts/discover-helpers.test.mjs`（4 項，假 Figma 物件）；既有 hooks／journal 對帳測試不退步 | helper 未在真實 runtime 執行；加速效果未量測 |
| **A06** 環境診斷按需執行 | `done` | `scripts/verify-installation.mjs`（`decideReuse`、`environmentFingerprint`、`--force`、`.figma-ui/diagnostics.json`）；新 `scripts/hooks/log-figma-call.mjs`（記 session id）；`schemas/capabilities.schema.json`（`environmentDiagnosis`、`features.*.basis`）；`scripts/preflight.mjs`；`references/runtime-probes.md` | `tests/contracts/diagnosis.test.mjs`（7 項）；雲端煙霧測試：第一次 full、上次有問題時再次 full | `~/.claude/plugins/installed_plugins.json` 的格式依 Claude Code 版本而異，讀不到時 plugin 欄位為 null（仍可比較，但資訊較少），需在使用者本機確認 |
| **A07** 精簡 handoff 與最低量測 | `done` | 新 `scripts/run-report.mjs`（`phase`／`ask`／`answered`／`metrics`／`handoff`）；`schemas/ledger.schema.json`（`phaseHistory`、`questionRounds`）；post hook 記 `durationMs`／`sessionId`／`truncatedResponse`；`.claude/settings.json` 註冊只記錄的 hook；`references/handoff.md` | `tests/contracts/run-report.test.mjs`（5 項）、`tests/hooks/figma-hooks.test.mjs` 新增 1 項 | 真實工具時間與提問成本要等 M4 的 run 才有資料 |

## 相容性與資料遷移

- **舊命令不變寬鬆**：`validate-artifacts.mjs <runDir>` 預設仍是完整驗證（final）。
- **schemaVersion 維持 1.2**：新欄位全部選填；必要性由 Build 邊界與 evaluator 規則強制。
- **舊證據（沒有 `cellKeys`）**：只有該畫面恰好一個適用 cell、且 viewport／state／mode 不矛盾時才算數；否則判定原因會要求補證據，不猜配。
- **舊 plan（沒有 `flow`）**：可以照舊評估（不會因缺 flow 被判失敗）；但要再記新的 write，必須先補 flow（Build 邊界）。M1 fixture 已補 `flow: unchanged`（理由寫明是 v1.6 契約遷移）。
- **舊判定（沒有 `inputDigest`）**：重新執行 `evaluate-completion --write` 後才能產生 handoff 或記錄使用者接受。使用者本機的 `ui-20260928-001`、`ui-20260929-001` 收尾時（M4 第 1 步）需要重新判定一次。
- **hooks**：新增的 `log-figma-call.mjs` 只記錄、不阻擋；寫入保護的 matcher 與行為沒有改變。`checkHooks` 改為分別確認 pre／post 寫入 hook，只有記錄 hook 時不算安裝完成。

## 保留的保護（未變）

output 範圍與權限、basisRefs、planned／dispatched／applied／verified 紀錄、hooks、本機鎖、所有權標記、fingerprint／precondition guard、鎖的釋放與不搶占、unknown_outcome 唯讀對帳、**每次寫入後獨立讀回**、skipped／pending 決策不能當依據、字型／variant／屬性／binding 與基本看圖、最終完整契約與既有可及性硬門檻。

## 階段 B：QA 接入 → `not_ready`

專案內沒有可執行的 QA 入口、QA 版交付包、QA 結果檔或複驗紀錄。接入契約與就緒條件寫在 `docs/qa-integration-contract.md`。在此之前，下列完整審查仍由 UI agent 負責：完整視覺評論、跨畫面一致性、長內容／響應式／狀態矩陣、完整設計可及性審查、獨立 audit 任務。

## 階段 C：未做（依任務書）

取消獨立讀回、跨 run 證據快取與依賴圖、評論範例庫、`unbasedProperties` 硬門檻、完整 L0–L13 規則引擎、固定三輪問答與十題政策、多數決處理參考衝突、廣泛 AST lint、平台規則引擎、強制視覺小樣、Storybook、前端實作、Code Connect 整合。

先前研究提案（`docs/adjustment-plan.md`（v1.7 已刪除，見 git 歷史）、`docs/research/extension-spec-research.md`、`docs/research/backlog.md` 的 S 與 U 項）與本任務書不同的部分不在本次範圍，已在各文件開頭標注。

## 尚缺的真實驗證（需使用者本機）

1. 以 v1.6 流程跑 M4 的三組任務（`docs/history/build-prompts-m0-m4.md` 文末），確認階段驗證、flow、證據 `cellKeys`／`subject`、handoff 產生在真實 run 中可用。
2. 確認 `log-figma-call.mjs` 對所有 Figma 工具觸發，且 `session.json` 能讓同一 session 的第二個 run 沿用診斷。
3. 效能比較：局部樣式修改、既有 pattern 延伸一頁、含分支／狀態的新流程，各記錄 `run-report.mjs metrics`（提問成本、工具時間、返工與缺陷）。
