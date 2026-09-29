---
name: figma-ui
description: 讀取指定 Figma 檔案的 library、components 與 variables，延伸、修改或審查原生 Figma UI；每次新任務先確認當次需求。手動呼叫：/figma-ui <需求> | continue <run-id> <調整> | resume <run-id>
disable-model-invocation: true
user-invocable: true
argument-hint: "<需求> | continue <run-id> <調整> | resume <run-id>"
---

# /figma-ui 工作流程

規範唯一來源是專案根目錄的 `FIGMA_UI_AGENT_SPEC.md`（v1.4）。本檔只列流程、階段出口與不可違反的規則；細節在 `references/`，需要時才讀。Figma runtime API（字型、Auto Layout、頁面載入、helpers）一律依已安裝的官方 skill：呼叫任何 `use_figma` 前先載入 `figma:figma-use`，組畫面時再載入 `figma:figma-generate-design`。本專案不另寫 API 教學。

使用者的引數：`$ARGUMENTS`

## 0. 入口判斷

執行 `node scripts/state-store.mjs parse $ARGUMENTS`，依 `mode`：

- **new**（預設）：建立新 run（`node scripts/state-store.mjs new <需求摘要>`），走完整 Intake。**不沿用任何先前 run 的平台、產品或 DS**（INVARIANT-01）。使用者明確說「沿用上次設定」時，展示上次摘要，並把該指示記為本次決策。
- **continue `<run-id>`**：`node scripts/state-store.mjs resolve <run-id>`。找不到或多義 → 列候選並詢問，不另開 run。brief 須為 `confirmed`；沿用已確認範圍，不重問。調整超出範圍（新檔案、平台、未授權區域）→ 需新決策，必要時開新 run。
- **resume `<run-id>`**：先對帳再做事，見 `references/recovery.md`。只重問過期或衝突的資訊。

## 1. 流程與出口

`INTAKE → PREFLIGHT → DISCOVER → PLAN → BUILD → VALIDATE → HANDOFF`；任一階段可進入 `awaiting_user` 或 `blocked`。`audit` 任務沒有 BUILD，且**全程不得寫入畫布**（含暫存 clone）。每個階段結束更新 `ledger.json` 的 `phase`。

| 階段 | 做什麼 | 出口（沒達到就不能往下） |
|---|---|---|
| Intake | 見第 2 節 | brief `stage=confirmed`，`openQuestions` 為空 |
| Preflight | 見第 3 節 | `capabilities.json`；帳號 `ok`（寫入任務需目標 plan 的 Full seat） |
| Discover | `references/discovery.md` | `inventory.json`（含 patterns、元件版本比對、variables 來源狀態、`fonts` 安裝比對）；缺口列入 `brief.gaps` |
| Plan | screens、requiredCells、componentMap、variableMap、patternRefs、設計決策、**可及性預檢** | `plan.json` `status=confirmed`；被引用的 designDecision 都是 `answered`；`accessibilityPrecheck` 的 fail 都有對應設計決策；未安裝字型已列給使用者 |
| Build | 一次一個 operation，見第 4 節 | 每個 write 都 `verified`（以讀回驗證，不以寫入回應代替） |
| Validate | 結構、截圖實際看圖、狀態、可及性，`references/design-quality.md` | `audit.json`；evidence 在最後一次修改之後 |
| Handoff | `references/handoff.md` | `node scripts/evaluate-completion.mjs design-runs/<run-id> --write`；`handoff.md`（完成判定與使用者接受分開列）；**釋放鎖** |

完成與否只看 `evaluate-completion.mjs` 的結果（第 12.1 節）。不要自己判定 complete，也不要用分數代替 gates。使用者把未通過的 run「接受為測試成功」時，只記 `ledger.userAcceptance`（`--accept-test-run`），**不改 `ledger.status` 與 `completionEvaluation`，也不能稱為 complete**（INVARIANT-17）。

## 2. Intake（新任務必做）

先把使用者已提供的內容整理成摘要讓他確認，只問缺的部分；一次最多 1–3 題，格式「目前狀況 → 影響 → 選項 → 建議」。必須取得：

1. 產品與平台、主要使用者與任務、交付畫面與狀態。
2. 參考檔案（URL）。解析 node-id 後**先辨識節點類型**：可能是頁面（PAGE）而非 frame（v1.3 §8.1）。
3. **元件 library** 與 **variables library，分開確認**（v1.3 §6.1）：核准元件 library 不等於核准 variables。寫入 `sources.componentLibraryKeys`／`variableLibraryKeys`，兩者都要在 `approvedLibraryKeys` 內。
4. 輸出位置與方式：新稿（`new_draft`）或改原稿（`edit_existing`）。**預設建議獨立頁面或小範圍 Section**；不要選有大量既有內容的頁面作寫入位置。
5. 修改邊界：可以動哪些節點、不能動哪些。
6. **品牌與產品名稱**（REQ-04，v1.4）：新畫面用的產品名稱、logo 與品牌資產以使用者指定為準。參考畫面可能混有其他品牌的名稱或 logo（第一次真實任務：Aiwow 參考畫面帶有 AileCard logo），不得直接複製，列為設計決策。

開場範例（已知內容要預填）：

> 這次要做什麼：新增、修改，還是審查？產品與平台是？
> 參考哪個 Figma 檔案或 frame？元件用哪個 library？variables（顏色、間距等）來自哪個 library？這兩個可能不是同一個，我也可以先盤點給你確認。
> 成果放在哪個檔案、哪一頁？建議開一個獨立頁面或 Section，不動既有內容。要做新稿還是直接改原稿？

brief 確認時寫入 `stage=confirmed`、`output.writeAllowed`、`output.decisionRef`（指向 plan.decisions 中使用者的授權），並跑 `node scripts/validate-artifacts.mjs design-runs/<run-id>`。

## 3. Preflight

1. 呼叫 `whoami`，把結果存成暫存檔後執行 `node scripts/preflight.mjs diagnose <file> [targetPlanRef]`。`blocked` 時停下，照輸出的 `recoverySteps` 告訴使用者，**不要重試讀取檔案**（配額）。email 與 handle 不寫入任何檔案（CAP-03）。
2. 執行 `node scripts/verify-installation.mjs`，並從目前 session 的工具清單記下實際 Figma 工具名稱（例如 `mcp__figma__use_figma`）與 plugin 版本。
3. 寫入 `capabilities.json`（`node scripts/preflight.mjs write-capabilities <run-id> <facts.json>`）。只有這次實際成功呼叫過的工具與功能才能標 `verified`；其他是 `available_unverified`。已知的 runtime 結果見 `references/runtime-probes.md`，plugin 版本不同時要重測。

## 4. Build（寫入規則）

每一個寫入都照這個順序，不可省略：

1. 確認 plan 已 confirmed、依據齊全（pattern ID、`answered` 的 designDecision、componentMap／variableMap 項目）。`skipped` 決策不能當依據，它對應的元素不建立。
   建立 instance 時，依 componentMap 記錄的方式取得主元件：以 key 匯入（library 目前發佈版），或從既有 instance 的 `getMainComponentAsync()` 取得（與既有畫面同版本，§6.2）；兩者擇一並在 plan 記錄理由。
2. 第一次寫入前取得本機鎖：`node scripts/state-store.mjs activate <run-id> <output fileKey>`。鎖被別的 run 持有 → 不搶，先看該 run 的 journal 並詢問使用者。
3. 記 planned：`node scripts/operation-journal.mjs plan <run-id> '<json>'`（含 `operationId`、`logicalKey`、`kind`、`mode:"write"`、`fileKey`、`basisRefs`、`preconditions`：父節點、既有 child IDs、預期新增數量與類型、預期 fingerprint）。
4. 呼叫 `use_figma`：第一行是 op 標頭（`snippets/op-header.js`）。建立新根節點的同一腳本內立刻寫所有權標記（`snippets/mark-owned.js`）。修改既有 agent 節點時，腳本開頭先跑 `snippets/precondition-guard.js`；不一致就回傳 conflict、不改任何東西。腳本回傳所有 created／mutated IDs。
5. 用**另一個** read operationId（`rd-0001`…）讀回驗證，再 `node scripts/operation-journal.mjs verify <run-id> '{"operationId":…,"evidenceRefs":[…],"fingerprint":…}'`。

hook 擋下時照原因處理（補標頭、先對帳、取得授權）；**不得繞過 hook、改用別的工具寫入**。寫入只能在 brief 的 output 範圍內。新 top-level 節點放在空白處，放進本 run 的 Section（`figma-ui / <run-id>`）。

## 5. 一律先問的情況

- **設計決策**（`references/design-decisions.md`）：DS、已確認 pattern 或使用者指示沒有決定的外觀／層級／體驗選擇，一律以 2–3 個選項詢問，記入 `plan.designDecisions`（帶 `status`）；未回答的決策所影響的 section 不得寫入。不確定算不算設計決策時，當作是。
- **授權採用建議**（DEC-07，v1.4）：使用者可以對**這個 run** 授權「一律採用你的建議」。仍要逐題產生選項與建議；有建議的題目 `answer`＝建議、`source: user`、`status: answered`，並加 `delegation`（指向 plan.decisions 中的授權、`scope: run`、本 run ID）。**沒有建議的題目不得自己決定**：`status: skipped`、相關元素不建立、run 結束時列給使用者。授權不延續到新 run（`continue` 同一 run 才沿用）。硬性門檻（例如 G5 對比）不因授權豁免；建議會造成 G5 失敗時，要在 Plan 階段指出。
- 新增 token／元件、wrap、改共享主元件、替換字型、改範圍、缺權限、資產或字型不可用。
- 發現使用者改了 agent 的節點、在 Section 內新增或刪除節點（`references/collaboration.md`）：不覆寫、不重建，回報差異並詢問。
- 新匯入元件與既有畫面使用的版本外觀不同（v1.3 §6.2）：列給使用者、記為 `inherited_baseline`；不在目標檔接受 library 更新，也不用 override 模仿舊版，除非使用者決定。
- variables 來源 library 未識別：記為 gap，需要顏色 token 的驗證標 `not_verified`，**不得用 raw value 冒充綁定**。既有 paint／text／effect styles 屬於 DS token，可沿用並計入 tokenBinding（§10.1）；優先用參考畫面實際使用的 style，不以名稱或色值相近自行挑選。
- **可及性預檢不合格**（§9.5，v1.4）：準備沿用的 style 對比不足時，照抄參考畫面不算合格理由。Plan 階段記入 `plan.accessibilityPrecheck`（`status: fail`），參考畫面本身記 `inherited_baseline`，並以設計決策列出替代方案（優先同系列、對比足夠的既有 style）。新畫面沿用不合格 style 是 `introduced`，G5 為 fail，**不能以例外豁免**。
- **字型未安裝**（§10.3，v1.4）：不換字型，也不在 `loadFontAsync` 失敗後改用別的字型。記入 `inventory.fonts`（`installed: false`、`baselineRef`）並在 Plan 列給使用者（`listedToUserRef`）；截圖時仍要確認沒有缺字。
- **品牌名稱或 logo** 與使用者指定不同（REQ-04）。

沒有回覆不代表同意；可以繼續不相依的唯讀工作。

## 6. 讀取規則（配額與輸出上限）

- 頁面清單用 `use_figma` 讀 `figma.root.children`；`get_metadata` 不帶 nodeId 只會列第一頁。
- 不對整頁呼叫 `get_metadata`（大型頁面會超過輸出上限）；先取頂層摘要，再縮小到 frame／section。
- **`use_figma` 單次回傳上限 20,480 個 UTF-8 位元組（不是字元；中文每字 3 B，約 6,800 字），超過會靜默截斷**（結尾出現 `// truncated to 20kb`，不報錯，可能切在字中間留下 `�`；M3 實測）。寫入腳本只回傳 IDs、狀態與 fingerprint；讀取要分批，每批約 15,000 位元組以內。看到截斷標記就當作資料不完整，縮小範圍重讀（`references/runtime-probes.md`）。
- `search_design_system` 一次只送 1 個 query；library 未啟用時空結果不代表不存在。
- library 是否已加入目標檔，以 `get_libraries` 與 runtime `teamLibrary` 兩種讀法一致為準。

## 7. 收尾

Handoff 後、或使用者要求停止時：`node scripts/state-store.mjs release <run-id>`（owner token 相符才刪除鎖與 `active-run.json`）。**不釋放會讓 hook 持續阻擋本專案所有未帶 op 標頭的 Figma 呼叫。** 回報時分開列 implementation 與 integration 狀態、未驗證項與下一步；有 `skipped` 的設計決策時一次列出。

使用者表示「接受為測試成功」：先把使用者的決定記入 `plan.decisions`，再執行 `node scripts/evaluate-completion.mjs design-runs/<run-id> --accept-test-run <decisionRef> <說明>`。回報與 handoff 同時寫完成判定結果（例如 `awaiting_user`）與使用者接受，並列出仍開啟的 findings 與待決項目。

## 參考檔

| 檔案 | 何時讀 |
|---|---|
| `references/discovery.md` | Discover：盤點範圍、pattern、元件版本、variables 來源 |
| `references/design-decisions.md` | 任何可能是設計決策的時候 |
| `references/design-quality.md` | Plan 與 Validate：品質契約、gates、evidence |
| `references/collaboration.md` | 寫入前後、使用者可能同時編輯時 |
| `references/runtime-probes.md` | Preflight；plugin 或 Claude Code 升級後 |
| `references/recovery.md` | resume、hook 阻擋、unknown_outcome |
| `references/handoff.md` | Handoff |
| `snippets/*.js` | 每個 use_figma 寫入腳本 |
| `tests/fixtures/m1-run/` | 各種 artifact 的完整範例（已去識別化） |
