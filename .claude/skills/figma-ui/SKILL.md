---
name: figma-ui
description: 讀取指定 Figma 檔案的 library、components 與 variables，延伸、修改或審查原生 Figma UI；每次新任務先確認當次需求。手動呼叫：/figma-ui <需求> | continue <run-id> <調整> | resume <run-id>
disable-model-invocation: true
user-invocable: true
argument-hint: "<需求> | continue <run-id> <調整> | resume <run-id>"
---

# /figma-ui 工作流程

規範唯一來源是專案根目錄的 `FIGMA_UI_AGENT_SPEC.md`（v1.6）。本檔只列流程、階段出口與不可違反的規則；細節在 `references/`，需要時才讀。一般設計 run **不需要**讀研究紀錄、建置里程碑或 `docs/` 的歷史總結。Figma runtime API（字型、Auto Layout、頁面載入、helpers）一律依已安裝的官方 skill：呼叫任何 `use_figma` 前先載入 `figma:figma-use`，組畫面時再載入 `figma:figma-generate-design`。本專案不另寫 API 教學。

交付只有原生、可編輯的 Figma；程式實作由前端工程師負責。

使用者的引數：`$ARGUMENTS`

## 0. 入口判斷

執行 `node scripts/state-store.mjs parse $ARGUMENTS`，依 `mode`：

- **new**（預設）：建立新 run（`node scripts/state-store.mjs new <需求摘要>`），走 Intake。把需求裡已寫明的內容預填，只問缺的部分。**不沿用任何先前 run 的平台、品牌、DS 或「採用建議」授權**（INVARIANT-01、18）。使用者明確說「沿用上次設定」時，展示上次摘要，並把該指示記為本次決策。
- **continue `<run-id>`**：`node scripts/state-store.mjs resolve <run-id>`。找不到或多義 → 列候選並詢問，不另開 run。再跑 `node scripts/run-context.mjs <run-id> continue`：`confirmed` 列出的已確認內容**不重問**，只處理 `ask` 裡的開放項目與本次調整帶來的差異。調整超出範圍（新檔案、平台、未授權區域）→ 需新決策，必要時開新 run。
- **resume `<run-id>`**：`node scripts/run-context.mjs <run-id> resume`，先照 `next` 對帳（`references/recovery.md`），之後只問過期或衝突的項目。

## 1. 流程與出口

`INTAKE → PREFLIGHT → DISCOVER → PLAN → BUILD → VALIDATE → HANDOFF`；任一階段可進入 `awaiting_user` 或 `blocked`。`audit` 任務沒有 BUILD，且**全程不得寫入畫布**（含暫存 clone）。進入每個階段時記錄：`node scripts/run-report.mjs phase <run-id> <phase>`（同時更新 `ledger.phase`）。

| 階段 | 做什麼 | 出口（沒達到就不能往下） |
|---|---|---|
| Intake | 見第 2 節 | brief `stage=confirmed`、`openQuestions` 為空；`validate-artifacts.mjs design-runs/<run-id> --stage intake` 通過 |
| Preflight | 見第 3 節 | `capabilities.json`；帳號 `ok`（寫入任務需目標 plan 的 Full seat） |
| Discover | `references/discovery.md`（範圍化，只盤點本次需要的） | `inventory.json`；缺口列入 `brief.gaps` |
| Plan | screens（含已確認文案）、requiredCells、flow 判斷、componentMap、variableMap、patternRefs、設計決策、可及性預檢 | `plan.json` `status=confirmed`；設計任務 `validate-artifacts.mjs … --stage build` 通過（寫入授權、flow、決策、能力都齊全）；audit 任務用 `--stage plan` |
| Build | 以可恢復的 composition 為批次，見第 4 節 | 每個 write 都 `verified`（以獨立讀回驗證，不以寫入回應代替） |
| Validate | 結構、截圖實際看圖、狀態、可及性，`references/design-quality.md` | `audit.json`；每個適用 requiredCell 都有**指名該 cell** 且在最後一次相關修改之後的證據 |
| Handoff | `references/handoff.md` | `evaluate-completion.mjs design-runs/<run-id> --write` → `run-report.mjs handoff <run-id> --write`；**釋放鎖** |

- 階段驗證（v1.6）：`--stage intake|plan|build` 只要求該階段應存在的檔案；尚未產生的檔案造成的引用列在 `deferred`，**不算已解析**，也不能流入 Build。不帶 `--stage` 就是完整驗證（final）。
- Build 邊界由程式強制：`operation-journal.mjs plan` 記 write 之前會跑 `--stage build`，不通過就拒絕。
- 完成與否只看 `evaluate-completion.mjs`（§12.1）。它已包含完整驗證，Handoff 不必再另外跑 validator；資料有任何變動就要重跑（判定帶 `inputDigest`，過期時 handoff 與使用者接受都會拒絕）。它直接讀 journal：有 applied 但未 verified 的 write、留著沒送也沒取消的 planned write、dispatched／unknown_outcome，都不能完成。不要自己判定 complete，也不要用分數代替 gates。使用者把未通過的 run「接受為測試成功」時，只記 `ledger.userAcceptance`（`--accept-test-run`），**不改 `ledger.status` 與 `completionEvaluation`，也不能稱為 complete**（INVARIANT-17）。

## 2. Intake（新任務）

先把使用者已提供的內容整理成摘要讓他確認，只問缺的部分；**每輪 1–3 個實質問題**，格式「目前狀況 → 影響 → 選項 → 建議」。能先找到候選（檔案、頁面、library、元件）就先找，讓問題變成選擇題。送出一輪問題時記 `node scripts/run-report.mjs ask <run-id> <題數>`，收到回覆後記 `run-report.mjs answered <run-id>`。必須取得：

1. 產品與平台、主要使用者與任務、交付畫面與狀態。
2. 參考檔案（URL）。解析 node-id 後**先辨識節點類型**：可能是頁面（PAGE）而非 frame（§8.1）。
3. **元件 library** 與 **variables library，分開確認**（§6.1）：核准元件 library 不等於核准 variables。寫入 `sources.componentLibraryKeys`／`variableLibraryKeys`，兩者都要在 `approvedLibraryKeys` 內。
4. 輸出位置與方式：新稿（`new_draft`）或改原稿（`edit_existing`）。**預設建議獨立頁面或小範圍 Section**；不要選有大量既有內容的頁面作寫入位置。
5. 修改邊界：可以動哪些節點、不能動哪些。
6. **品牌與產品名稱**（REQ-04）：新畫面用的產品名稱、logo 與品牌資產以使用者指定為準；參考畫面裡的其他品牌不得直接複製，列為設計決策。

已知內容要預填，例如：

> 我先整理你提供的內容：任務＝延伸；參考＝<連結>（node-id 指向頁面「v1.1.2」）。還缺：元件與 variables 各用哪個 library（可能不是同一個，我可以先盤點給你選）？成果放哪個檔案、哪一頁？建議開獨立 Section，不動既有內容。

brief 確認時寫入 `stage=confirmed`、`output.writeAllowed`、`output.decisionRef`（指向 plan.decisions 中使用者的授權），並跑 `validate-artifacts.mjs … --stage intake`。

## 3. Preflight

1. **每個 run 都做**：呼叫 `whoami`，把結果存成暫存檔後執行 `node scripts/preflight.mjs diagnose <file> [targetPlanRef]`。`blocked` 時停下，照輸出的 `recoverySteps` 告訴使用者，**不要重試讀取檔案**（配額）。email 與 handle 不寫入任何檔案（CAP-03）。也要確認目標檔案讀得到、需要的工具在本 session 可用。
2. **按需**：`node scripts/verify-installation.mjs`。它自己判斷：同一 session 且環境（Claude Code／Node／OS 版本、Figma plugin 與 MCP 設定、專案 settings／lockfile／skill）沒變，就沿用上次的安裝診斷（`diagnosis.mode=reused`）；首次 session、有變更、上次有問題或紀錄損毀就完整重跑。懷疑環境有問題時加 `--force`。沿用診斷**不代表**本 run 的權限已確認。
3. 寫入 `capabilities.json`（`node scripts/preflight.mjs write-capabilities <run-id> <facts.json>`），把第 2 步的 `diagnosis` 放在 `environmentDiagnosis`。只有**這次 run** 實際成功呼叫過的工具與功能才能標 `verified`（`basis: this_run`）；沿用 `references/runtime-probes.md` 或先前 run 的結果標 `basis: history`、`available_unverified`。需要用到、但版本變了或還沒驗證過的能力，才在本 run 做最小 probe。

## 4. Build（寫入規則）

每一個寫入都照這個順序，不可省略：

1. 確認 plan 已 confirmed、flow 已確認且沒有開放問題、依據齊全（pattern ID、`answered` 的 designDecision、componentMap／variableMap 項目、已確認的文案）。`skipped` 決策不能當依據，它對應的元素不建立。建立 instance 時依 componentMap 記錄的方式取得主元件：以 key 匯入（library 目前發佈版），或從既有 instance 的 `getMainComponentAsync()` 取得（與既有畫面同版本，§6.2）。
2. 第一次寫入前取得本機鎖：`node scripts/state-store.mjs activate <run-id> <output fileKey>`。鎖被別的 run 持有 → 不搶，先看該 run 的 journal 並詢問使用者。本機鎖擋不住 Figma 裡的人，協作衝突仍靠第 4 步的 guard。
3. 記 planned：`node scripts/operation-journal.mjs plan <run-id> '<json>'`（含 `operationId`、`logicalKey`、`kind`、`mode:"write"`、`fileKey`、`basisRefs`、**`scopeRootIds`（這個 write 影響的 composition 根節點）**、`preconditions`：父節點、既有 child IDs、預期新增數量與類型、預期 fingerprint）。它會先跑 Build 邊界驗證。
4. 呼叫 `use_figma`：第一行是 op 標頭（`snippets/op-header.js`）。建立新根節點的同一腳本內立刻寫所有權標記（`snippets/mark-owned.js`）。修改既有 agent 節點時，腳本開頭先跑 `snippets/precondition-guard.js`；不一致就回傳 conflict、不改任何東西。腳本回傳所有 created／mutated IDs 與必要短摘要（遠低於 20,480 位元組）。
5. 用**另一個** read operationId（`rd-0001`…）讀回驗證，再 `node scripts/operation-journal.mjs verify <run-id> '{"operationId":…,"evidenceRefs":[…],"fingerprint":…}'`。同一個 composition 的多個 write 可以用**一次**獨立讀回一起確認，同時收集結構檢查需要的資料：`verify <run-id> '{"operationIds":["op-0003","op-0004"],"evidenceRefs":["rd-0005"]}'`。

批次大小：以一個可界定、失敗時可對帳的 composition（例如一個畫面區塊或一個狀態 frame）為一次 write；不為每個屬性各打一次遠端呼叫，也不把整頁硬塞成一個巨大 operation。**同一檔案的 mutation 不平行送出**。

hook 擋下時照原因處理（補標頭、先對帳、取得授權）；**不得繞過 hook、改用別的工具寫入**。寫入只能在 brief 的 output 範圍內。新 top-level 節點放在空白處，放進本 run 的 Section（`figma-ui / <run-id>`）。

## 5. 什麼時候問、怎麼問

- **已決定的不重問**（DEC-03）：DS、已確認 pattern、使用者指示或 brief 已決定的內容，在 Plan 確認時用一段摘要列出（記為 `source: ds | existing_pattern | brief` 的 designDecision），不建成待答問題。
- **設計決策**（`references/design-decisions.md`）：DS、已確認 pattern 或使用者指示沒有決定的外觀／層級／體驗選擇，先找候選，再以 2–3 個選項詢問，記入 `plan.designDecisions`（帶 `status`）；未回答的決策所影響的 section 不得寫入。不確定算不算設計決策時，當作是。同階段的問題集中，每輪 1–3 題，優先在 Build 前問完會影響方向的題目。
- **Flow 判斷**（`references/flow.md`）：依操作歧義與變更影響決定 `unchanged`／`partial`／`task_flow`，不看畫面數。局部樣式修改記 `unchanged` 加理由即可，不做流程訪談；新按鈕去哪裡不清楚，就只問那一題（flow unknown）。不自行補業務規則。
- **授權採用建議**（DEC-07）：使用者可以對**這個 run** 授權「一律採用你的建議」。仍要逐題產生選項與建議；有建議的題目 `answer`＝建議、`source: user`、`status: answered`，並加 `delegation`（指向 plan.decisions 中的授權、`scope: run`、本 run ID）。**沒有建議的題目不得自己決定**：`status: skipped`、相關元素不建立、run 結束時列給使用者。授權不延續到新 run。硬性門檻（例如 G5 對比）不因授權豁免。
- 新增 token／元件、wrap、改共享主元件、替換字型、改範圍、缺權限、資產或字型不可用。
- 發現使用者改了 agent 的節點、在 Section 內新增或刪除節點（`references/collaboration.md`）：不覆寫、不重建，回報差異並詢問；在 ledger entity 記 `userChangeDetectedAt`（相關證據因此失效）。
- 新匯入元件與既有畫面使用的版本外觀不同（§6.2）：列給使用者、記為 `inherited_baseline`；不在目標檔接受 library 更新，也不用 override 模仿舊版，除非使用者決定。
- variables 來源 library 未識別：記為 gap，需要顏色 token 的驗證標 `not_verified`，**不得用 raw value 冒充綁定**。既有 paint／text／effect styles 屬於 DS token，可沿用並計入 tokenBinding。
- **可及性預檢不合格**（§9.5）：照抄參考畫面不算合格理由；Plan 階段記入 `plan.accessibilityPrecheck`，並以設計決策列出替代方案。新畫面沿用不合格 style 是 `introduced`，G5 fail，**不能以例外豁免**。
- **字型未安裝**（§10.3）：不換字型；記入 `inventory.fonts` 並在 Plan 列給使用者。
- **品牌名稱或 logo** 與使用者指定不同（REQ-04）。

沒有回覆不代表同意；可以繼續不相依的唯讀工作。

## 6. 讀取規則（配額與輸出上限）

- 頁面清單用 `use_figma` 讀 `figma.root.children`；`get_metadata` 不帶 nodeId 只會列第一頁。
- 不對整頁呼叫 `get_metadata`（大型頁面會超過輸出上限）；先取頂層摘要，再縮小到 frame／section。
- **`use_figma` 單次回傳上限 20,480 個 UTF-8 位元組（不是字元；中文每字 3 B，約 6,800 字），超過會靜默截斷**（結尾出現 `// truncated to 20kb`，不報錯，可能切在字中間留下 `�`；M3 實測）。寫入腳本只回傳 IDs、狀態與 fingerprint；讀取要分批，每批約 15,000 位元組以內（`snippets/discover-helpers.js` 的 `figmaUiPage` 依位元組分頁並標示 `complete`）。看到截斷標記就當作資料不完整，縮小範圍重讀。
- 字型比對在 Figma 端先篩（`figmaUiFontCheck`），不回傳整份可用字型清單。
- `search_design_system` 一次只送 1 個 query；library 未啟用時空結果不代表不存在。
- library 是否已加入目標檔，以 `get_libraries` 與 runtime `teamLibrary` 兩種讀法一致為準。

## 7. Validate 與收尾

- 截圖以完成的 composition 或一個修正批次為單位；高風險的版面或文字修正後**立即**截該局部看圖。最後仍要覆蓋每個適用 requiredCell。
- 每筆 evidence 寫 `cellKeys`（它證明的 requiredCell）、`state`，以及 `subject`（`rootNodeId`、`scopeNodeIds`、`ancestorNodeIds`、`afterOperationId`）。default 的截圖不能拿來證明 error 或另一個 viewport。後來的寫入動到範圍、父層布局或 mode，或偵測到使用者改動，舊證據改 `superseded` 並重讀；無法判定時也重讀，不猜有效。
- Handoff：`evaluate-completion.mjs … --write`，再 `run-report.mjs handoff <run-id> --write`（從 artifacts 組出簡短 handoff，不手寫重複事實）。最後 `node scripts/state-store.mjs release <run-id>`（owner token 相符才刪除鎖與 `active-run.json`）。**不釋放會讓 hook 持續阻擋本專案所有未帶 op 標頭的 Figma 呼叫。**
- 回報時分開列 implementation 與 integration 狀態、未驗證項與下一步；有 `skipped` 的設計決策時一次列出。使用者表示「接受為測試成功」：先把使用者的決定記入 `plan.decisions`，再 `evaluate-completion.mjs … --accept-test-run <decisionRef> <說明>`。
- Design QA agent 尚未接入（`docs/qa-integration-contract.md`）：UI agent 維持目前全部適用驗證，不把交付改成「待 QA」。

## 參考檔

| 檔案 | 何時讀 |
|---|---|
| `references/discovery.md` | Discover：範圍、元件版本、variables 來源、字型 |
| `references/design-decisions.md` | 任何可能是設計決策的時候 |
| `references/flow.md` | Plan：判斷要不要整理任務流程 |
| `references/design-quality.md` | Plan 與 Validate：品質契約、gates、evidence |
| `references/collaboration.md` | 寫入前後、使用者可能同時編輯時 |
| `references/runtime-probes.md` | 需要某項 runtime 能力、或 plugin／Claude Code 版本變了 |
| `references/recovery.md` | resume、hook 阻擋、unknown_outcome |
| `references/handoff.md` | Handoff |
| `snippets/*.js` | use_figma 腳本（寫入、guard、Discover helpers） |
| `tests/fixtures/m1-run/` | 各種 artifact 的完整範例（已去識別化） |
