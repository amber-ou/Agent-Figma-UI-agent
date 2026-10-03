---
name: figma-ui
description: 讀取指定 Figma 檔案的 library、components 與 variables，延伸、修改或審查原生 Figma UI；每次新任務先確認當次需求。手動呼叫：/figma-ui <需求> | continue <run-id> <調整> | resume <run-id>
disable-model-invocation: true
user-invocable: true
argument-hint: "<需求> | continue <run-id> <調整> | resume <run-id>"
---

# /figma-ui 工作流程

規範唯一來源是專案根目錄的 `FIGMA_UI_AGENT_SPEC.md`（v1.9）。本檔只列流程、階段出口與不可違反的規則；細節在 `references/`，需要時才讀。一般設計 run **不需要**讀研究紀錄、建置里程碑或 `docs/` 的歷史總結。Figma runtime API（字型、Auto Layout、頁面載入、helpers）一律依已安裝的官方 skill：呼叫任何 `use_figma` 前先載入 `figma:figma-use`，組畫面時再載入 `figma:figma-generate-design`。本專案不另寫 API 教學。

交付只有原生、可編輯的 Figma；程式實作由前端工程師負責。

**溝通語言（ASK-08）**：提問、進度回報、預填清單、交接一律用**繁體中文**；技術名詞、檔名、ID、指令與工具名稱保留原文（例如 `plan.json`、`dd-03`、`use_figma`）。這是通用規則，不是產品政策，不列入政策建議。

使用者的引數：`$ARGUMENTS`

## Skill 使用規則（§4.7）

`/figma-ui` 執行期間只依下表使用 skill。規則屬模型自律（能否用 Claude Code 設定硬性阻擋尚未驗證）。

| 類別 | Skill | 規則 |
|---|---|---|
| 必用 | `figma-ui`（本檔）、`figma:figma-use`（每次 `use_figma` 前）、`figma:figma-generate-design`（組畫面時） | 照本檔與該 skill 說明 |
| 有條件 | `figma:figma-generate-library` | 只在使用者核准新增元件或 token（`allowNewComponents`／`allowNewTokens`）時載入；它「先建變數基礎」的主張不能凌駕 strict reuse |
| 只當參考 | `ux-knowledge-base`、`design:ux-copy` | 只作預填建議與檢查的參考（錯誤訊息結構、文案長度、啟發式檢查），不是門檻；可及性數值（WCAG 2.1、對比、44pt）和本規格（WCAG 2.2，§9.5）或產品政策衝突時，以本規格與產品政策為準 |
| 排除 | `ux-design-team`、`visual-ui-production-department`、`frontend-design`、`aile-ui-skill`、`figma:figma-swiftui`、`design:accessibility-review`、`design:design-handoff`、`design:design-system` | 不載入、不套用（會自行補假設或預設數值、產出 HTML、屬於別的產品、數值和 WCAG 2.2／產品政策衝突、和自動產生的 handoff 重複、會設計新元件） |
| 保留給 Design QA | `design:design-critique` | 不在 `/figma-ui` 內使用（§16.3） |
| 不使用 | `figma:figma-create-new-file`、官方程式端 skill（design-to-code、code-connect、implement-motion）、FigJam／Slides／圖表／動態／shader 類 skill | 本 agent 只寫既有檔案的原生設計；active run 期間 hook 會阻擋 `create_new_file` |

- 排除的 skill 若仍被載入（例如因任務提到 Figma 而自動載入）：**不採用**其中和本規格衝突的內容，並記入 `plan.excludedSkillsLoaded`（`skill`、`notAdopted`：哪條內容沒有採用、為什麼），handoff 的「待決與未驗證」會列出。
- 新出現的設計類 skill（帳號同步會增減）未評估前，一律視同排除。

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
| Plan | screens（含已確認文案與 `origin`）、requiredCells、flow 判斷、componentMap、variableMap、patternRefs、**方向方案加一行委派授權**（第 5 節）、其餘設計決策、可及性預檢、本次適用的共通規則（`references/common-rules.md`） | `plan.json` `status=confirmed`；設計任務 `validate-artifacts.mjs … --stage build` 通過（寫入授權、flow、決策、能力都齊全）；audit 任務用 `--stage plan` |
| Build | 以可恢復的 composition 為批次，見第 4 節 | 每個 write 都 `verified`（以獨立讀回驗證，不以寫入回應代替） |
| Validate | 結構、截圖實際看圖、狀態、可及性，`references/design-quality.md` | `audit.json`；每個適用 requiredCell 都有**指名該 cell** 且在最後一次相關修改之後的證據 |
| Handoff | `references/handoff.md` | `evaluate-completion.mjs design-runs/<run-id> --write` → `run-report.mjs handoff <run-id> --write`；**釋放鎖** |

- 階段驗證（v1.6）：`--stage intake|plan|build` 只要求該階段應存在的檔案；尚未產生的檔案造成的引用列在 `deferred`，**不算已解析**，也不能流入 Build。不帶 `--stage` 就是完整驗證（final）。
- Build 邊界由程式強制：`operation-journal.mjs plan` 記 write 之前會跑 `--stage build`，不通過就拒絕。
- 完成與否只看 `evaluate-completion.mjs`（§12.1）。它已包含完整驗證，Handoff 不必再另外跑 validator；資料有任何變動就要重跑（判定帶 `inputDigest`，過期時 handoff 與使用者接受都會拒絕）。它直接讀 journal：有 applied 但未 verified 的 write、留著沒送也沒取消的 planned write、dispatched／unknown_outcome，都不能完成。不要自己判定 complete，也不要用分數代替 gates。使用者把未通過的 run「接受為測試成功」時，只記 `ledger.userAcceptance`（`--accept-test-run`），**不改 `ledger.status` 與 `completionEvaluation`，也不能稱為 complete**（INVARIANT-17）。

## 2. Intake（新任務）

**v1.9 順序：先唯讀探索，再一次問完。**需求已給出來源（參考檔、library、輸出位置）時，先做唯讀探索（Preflight 的唯讀部分與 Discover：讀參考畫面、元件、styles、外部規範），把找到的候選與已能決定的事填進清單，**一次**問完剩下的；不要先丟一輪「請提供…」再去讀檔。只有**缺來源**（沒有參考檔、讀不到 library、不知道產品）而無法探索時，才先問那幾項，問到能開始探索就停。探索期間不寫入畫布。

先把使用者已提供的內容整理成摘要讓他確認，只問缺的部分。能先找到候選（檔案、頁面、library、元件）就先找，讓問題變成選擇題。待答的項目一次列成**預填清單**（DEC-09，格式見第 5 節）。送出清單時記 `node scripts/run-report.mjs ask <run-id> <列數> --prefilled <預填列數> --blank <留空列數>`，收到回覆後記 `run-report.mjs answered <run-id>`。

**Intake 順序（v1.7，REQ-05／06、POL-03；v1.8 加第 0 步）**：

0. **Figma plugin 版本**（§4.2.2）：`run-context.mjs` 的 `ask` 最前面出現 `kind: plugin_version` 時，把它放在預填清單**第一列**：一般 plugin 問「先升級，還是這次照舊版跑」；`synced: true`（由 claude.ai 帳號同步）時註明本機不一定能自行升級，選項是「等帳號同步更新」或「這次照舊版跑」，不要求使用者在本機另裝一份。答案寫入 `brief.pluginVersionChoice`（`installed`、`latest`、`choice: upgrade_first | use_current | wait_for_sync`、`confirmation`、`decidedAt`），**只限本 run**，下次 run 仍會再問。`notices` 出現「無法確認 Figma plugin 是否為最新版」時只在 intake 摘要列一行，不建成題目、不擋 run。
1. **確定產品**：需求寫了產品就採用；沒寫就先問（`run-context.mjs` 會把它列在最前面）。**不從上次 run、目標檔案或參考畫面推定**（INVARIANT-25）。
2. **載入產品政策**：`node scripts/product-policy.mjs apply <run-id> <productId>`，把結果記入 `brief.product`。在 intake 摘要列一行它回傳的「已套用產品政策：…」。政策已決定的項目不再問，也不放進預填清單。沒有政策檔 → 問是否建立新產品（POL-02），確認後 `product-policy.mjs init <run-id> <productId> <名稱> --decision <decisionRef>`。政策缺對比政策 → 政策題排在預填清單最前面（DEC-10，見第 5 節）。
3. **確認 library**：使用者提供的 library 直接用於 Discover；沒提供、找不到、讀不到或沒在目標檔啟用時就問，不改用其他 library，也不以 raw value 代替（REQ-06）。`.figma-ui/products/<productId>.local.json` 的 library 和檔案只能當預填候選（`product-policy.mjs local <productId>`），要本次確認才能用。
4. 其餘必須取得的項目如下。

必須取得：

1. 產品（REQ-05）與平台、主要使用者與任務、交付畫面與狀態。
2. 參考檔案（URL）。解析 node-id 後**先辨識節點類型**：可能是頁面（PAGE）而非 frame（§8.1）。
3. **元件 library** 與 **variables library，分開確認**（§6.1）：核准元件 library 不等於核准 variables。寫入 `sources.componentLibraryKeys`／`variableLibraryKeys`，兩者都要在 `approvedLibraryKeys` 內。
4. 輸出位置與方式：新稿（`new_draft`）或改原稿（`edit_existing`）。**預設建議獨立頁面或小範圍 Section**；不要選有大量既有內容的頁面作寫入位置。
5. 修改邊界：可以動哪些節點、不能動哪些。
6. **品牌與產品名稱**（REQ-04）：新畫面用的產品名稱、logo 與品牌資產以使用者指定為準；參考畫面裡的其他品牌不得直接複製，列為設計決策。

已知內容要預填，例如：

> 我先整理你提供的內容：產品＝Aiwow；任務＝延伸；參考＝<連結>（node-id 指向頁面「v1.1.2」）。
> 已套用產品政策：Aiwow — 對比：不適用（不檢查、不詢問對比；其他可及性項照常）
> 還缺的項目列在下面的清單：元件與 variables 各用哪個 library（可能不是同一個）、成果放哪個檔案哪一頁（建議開獨立 Section，不動既有內容）。

brief 確認時寫入 `stage=confirmed`、`output.writeAllowed`、`output.decisionRef`（指向 plan.decisions 中使用者的授權），並跑 `validate-artifacts.mjs … --stage intake`。v1.7 起新 run 的 brief 一定有 `product`；`productId` 還是 null 時 intake 不能確認。

**記憶分層（§4.6，INVARIANT-26）**：本 run 的決策、只限本次的規則（測試回合規則、DEC-07 授權）、使用者在過程中提到的偏好，只存在 `design-runs/<run-id>/`。產品政策只存在 `product-policies/<productId>.json`，而且只經使用者回答或確認後由 `product-policy.mjs write` 寫入（POL-04、INVARIANT-24）。**不得把任何 run 決策或產品政策寫進 Claude Code 的自動記憶（`~/.claude/projects/<project>/memory/`）、`CLAUDE.md` 或其他會被自動載入的檔案**，否則會在使用者不知情時套用到之後的 run。

## 3. Preflight

1. **固定一個 Figma 連線**（§4.2.3，INVARIANT-27）：把本 session 看得到的 MCP 工具名稱（ToolSearch）交給 `node scripts/preflight.mjs connections <tool-names.json | a,b,…>`，它列出所有 Figma 連線前綴。只有一個 → 用它；有多個 → 在預填清單列一題讓使用者選（預填已通過 `whoami` 的那個）。選定的前綴寫入 `capabilities.server.toolPrefix`，其餘寫 `otherFigmaPrefixes`。本 run 所有 Figma 呼叫都走這個前綴；active run 期間 hook 會**阻擋**其他前綴的寫入，`toolPrefix` 還沒記錄時任何寫入都會被擋；讀取只記錄。
2. **每個 run 都做**：用上一步的連線呼叫 `whoami`，把回應**原樣**存成暫存檔後執行 `node scripts/preflight.mjs diagnose <file> [targetPlanRef]`（原始回應、外層包裝或扁平 `{plans:[…]}` 都接受）。`blocked` 時停下，照輸出的 `recoverySteps` 告訴使用者，**不要重試讀取檔案**（配額）。`unrecognized_format`（exit 3）是格式問題，不是帳號問題：檢查存檔內容後重跑，不要照帳號恢復步驟處理。email 與 handle 不寫入任何檔案（CAP-03）。也要確認目標檔案讀得到、需要的工具在本 session 可用。帳號檢查只對這個連線有效。
3. **按需**：`node scripts/verify-installation.mjs`。它自己判斷：同一 session 且環境（Claude Code／Node／OS 版本、Figma plugin 與 MCP 設定、專案 settings／lockfile／skill）沒變，就沿用上次的安裝診斷（`diagnosis.mode=reused`）；首次 session、有變更、上次有問題或紀錄損毀就完整重跑。懷疑環境有問題時加 `--force`。沿用診斷**不代表**本 run 的權限已確認。v1.8 起它每次都會比對 Figma plugin 版本（`pluginVersion`：installed、latest、status、synced）並檢查 hooks matcher 是否涵蓋所有 Figma 前綴（`hookMatcherCoverage`）；查不到最新版只提示、不擋。
4. 寫入 `capabilities.json`（`node scripts/preflight.mjs write-capabilities <run-id> <facts.json>`），把第 3 步的 `diagnosis` 放在 `environmentDiagnosis`；`server.pluginVersion` 沒給時會自動取上次診斷的結果。它寫入前會先驗證 schema，錯誤訊息會附正確格式。只有**這次 run** 實際成功呼叫過的工具與功能才能標 `verified`（`basis: this_run`）；沿用 `references/runtime-probes.md` 或先前 run 的結果標 `basis: history`、`available_unverified`。需要用到、但版本變了或還沒驗證過的能力，才在本 run 做最小 probe。

**不確定 artifact 格式時**：`node scripts/artifact-skeleton.mjs <brief|plan|inventory|capabilities|ledger|audit> <run-id>` 印出一份通過 schema 的骨架與常見欄位的範例（`--write` 只在檔案不存在時寫入）。不要逐欄試錯。

## 4. Build（寫入規則）

每一個寫入都照這個順序，不可省略：

1. 確認 plan 已 confirmed、flow 已確認且沒有開放問題、依據齊全（pattern ID、`answered` 的 designDecision、componentMap／variableMap 項目、已確認的文案）。`skipped` 決策不能當依據，它對應的元素不建立。建立 instance 時依 componentMap 記錄的方式取得主元件：以 key 匯入（library 目前發佈版），或從既有 instance 的 `getMainComponentAsync()` 取得（與既有畫面同版本，§6.2）。
2. 第一次寫入前取得本機鎖：`node scripts/state-store.mjs activate <run-id> <output fileKey>`。鎖被別的 run 持有 → 不搶，先看該 run 的 journal 並詢問使用者。本機鎖擋不住 Figma 裡的人，協作衝突仍靠第 4 步的 guard。
3. 記 planned：`node scripts/operation-journal.mjs plan <run-id> '<json>'`（含 `operationId`、`logicalKey`、`kind`、`mode:"write"`、`fileKey`、`basisRefs`、**`scopeRootIds`（這個 write 影響的 composition 根節點）**、`preconditions`：父節點、既有 child IDs、預期新增數量與類型、預期 fingerprint）。它會先跑 Build 邊界驗證。
4. 呼叫 `use_figma`：第一行是 op 標頭（`snippets/op-header.js`）。建立新根節點的同一腳本內立刻寫所有權標記（`snippets/mark-owned.js`）。修改既有 agent 節點時，腳本開頭先跑 `snippets/precondition-guard.js`；不一致就回傳 conflict、不改任何東西。腳本回傳所有 created／mutated IDs 與必要短摘要（遠低於 20,480 位元組）。
5. 用**另一個** read operationId（`rd-0001`…）讀回驗證，再 `node scripts/operation-journal.mjs verify <run-id> '{"operationId":…,"evidenceRefs":[…],"fingerprint":…}'`。同一個 composition 的多個 write 可以用**一次**獨立讀回一起確認，同時收集結構檢查需要的資料：`verify <run-id> '{"operationIds":["op-0003","op-0004"],"evidenceRefs":["rd-0005"]}'`。v1.8：verify 會自動寫入 `ledger.entities`（每個 logicalKey 一筆：根節點、childNodeIds、fingerprint），單一 write 驗證時可加 `"entity":{"nodeId":"…","type":"FRAME"}` 指定讀回確認的根節點與類型（沒給類型就記 `UNKNOWN`，不猜）；第一個以 `basis: history` 探測的寫入驗證成功後，`capabilities.features.nativeWrite` 會自動升級為本 run 的 `verified`。不需要手動改這兩個檔案。

批次大小：以一個可界定、失敗時可對帳的 composition（例如一個畫面區塊或一個狀態 frame）為一次 write；不為每個屬性各打一次遠端呼叫，也不把整頁硬塞成一個巨大 operation。**同一檔案的 mutation 不平行送出**。

hook 擋下時照原因處理（補標頭、先對帳、取得授權）；**不得繞過 hook、改用別的工具寫入**。寫入只能在 brief 的 output 範圍內。新 top-level 節點放在空白處，放進本 run 的 Section（`figma-ui / <run-id>`）。

## 5. 什麼時候問、怎麼問

- **決策分流順序**（DEC-15，v1.9）：每個未知項目依序判斷，前一步能解決就不往下；不以自評的信心或「高風險」標籤代替這個順序。
  1. **和本次需求相關嗎？**不相關不列。例：只做登入頁，不問設定頁的 tab 樣式。
  2. **能用工具或官方文件查明嗎？**能就先查，不讓使用者猜（EXT-01）。例：LINE 登入按鈕的官方顏色與 logo 規範、元件 key 能不能匯入、主元件用了什麼字型。
  3. **已有決定嗎？**指示、brief、產品政策、DS、已確認 pattern 已決定的，只列摘要（DEC-03）。例：Aiwow 不檢查對比（產品政策）、按鈕用 DS 的 Button。
  4. **在本 run 的委派範圍內嗎？**是就由 agent 決定並驗證（DEC-12）。例：已核准置中版型後，卡片內距取 16、按鈕寬度 Fill。
  5. **會影響本次結果嗎？**不影響就記錄、不打斷。例：Toast 停留幾秒（DEC-11，記 `plan.undefinedBehaviors`）。
  6. **以上都不是才變成問題**：改變目的或主要結構的，用**方向方案**（DEC-13）；缺使用者持有的事實（品牌、文案、帳號）的，留空詢問；來源衝突或超出權限的，阻擋相依工作並詢問。例：版型要置中還是上下分區（方向方案）；條款文字寫什麼（留空，DEC-14）；DS 沒有 LINE 官方色要不要新增（超出權限，另列一題）。
- **方向方案與委派**（DEC-13、DEC-12，v1.9）：Plan 不再把版型、背景、主體組成拆成零碎單題，而是提出**方向方案**：畫面目的、主要操作、整體版型、引用的來源（參考畫面、pattern）、和參考畫面的差異、為什麼選這個參考（有其他候選一併列）。方案記成一筆 `kind: direction` 的 designDecision，同方向的子選擇以 `dependsOn` 指向它；使用者照方案接受時子選擇記 `confirmedWith: direction`，**換方向時**才把子選擇展開成單題（`confirmedWith: row`）。方案下面加**一行委派授權**：「核准方向內的尺寸、留白、對齊、元件寬度、佔位尺寸交給 agent 決定並驗證」。使用者確認後記成 `plan.decisions` 的一筆（`scope: run`、`runOnly: true`、`delegation: { allowedKinds, excludedKinds }`），**每個 run 給一次、不延續到新 run、不寫成產品政策**。委派的決定記 `source: user`、`delegation`、`kind`、`directionRef`，不放進預填清單；Plan 確認時用一段摘要列出 agent 選了什麼（handoff 第 13 項也列出），使用者要改用 `continue`。使用者沒給委派 → 細節回到預填清單逐項確認（A 模式）。
  - **一律不能委派、也不能藏進方案**：文案內容、品牌素材、外部規範合規、新增 token 或元件、寫死數值的例外、平台、寫入範圍與權限（`topic`：`copy | brand_asset | external_requirement | new_token | new_component | raw_value_exception | platform | write_scope`）。這些另列成預填清單的列；validator 會拒絕委派或方案子選擇碰到它們。
- **文案來源**（DEC-14，v1.9）：每段畫面文字記 `screens[].copy[].origin`：`existing`（既有正式文案，`sourceRef` 指向來源）、`user`（使用者寫明的文字，`sourceRef` 指向需求或回答）、`draft`（agent 擬稿，明標「擬稿」列入預填清單，確認後 `status: confirmed`、`decisionRef` 指向確認的決策，`origin` 仍保留 `draft`）。「要不要放」和「寫什麼」是兩題：使用者回答「放」但沒給文字時，文字另外確認，**不把題目裡的舉例當答案**（INVARIANT-30）。沒有授權時不新增需求沒提到的文案元素。
- **外部規範**（EXT-01，v1.9）：需求涉及第三方登入、平台規範、支付時，Discover 先查官方文件（`references/discovery.md` 第 4c 節）。`verified` 的要求直接成為設計約束：不符合的樣式不列為平等候選；是否新增資源或突破 DS 是另一題。讀不到官方文件 → `unverified`，清單上標「未驗證」，由使用者決定。
- **第二階段的規則不變**（§20.3）：產品確認（REQ-05）、library 每次確認（REQ-06）、plugin 版本每次問（§4.2.2）、全域 Build 邊界照舊；這些未經使用者重新確認不改。
- **已決定的不重問**（DEC-03）：DS、已確認 pattern、使用者指示、brief 或**產品政策**已決定的內容，在 Plan 確認時用一段摘要列出（記為 `source: ds | existing_pattern | brief | product_policy` 的 designDecision；`product_policy` 必須帶可解析的 `policyRef`，例如 `aiwow#policies/accessibility.contrast`），不建成待答問題。
- **預填清單**（DEC-09，v1.7）：同一階段所有待決的設計決策，以及要使用者回答的範圍與授權問題，**一次**列成一份清單（取代「每輪 1–3 題」）。每列：編號、問題（含情境與選項摘要）、答案欄。
  - 有建議 → 答案欄填建議並標「建議，請確認」。沒有建議、或屬品牌、產品方向、文案內容、個資等只有使用者能判斷的 → 答案欄留空。
  - 使用者確認前全部是 `pending`（預填值只存在 `recommendation`，`answer` 為 null），不能被 write 引用。
  - 確認後 `answer` 為最後的值、`source: user`、`status: answered`，並記 `confirmation`：照預填確認 `prefilled_confirmed`、改了預填 `user_modified`、填了留空的列 `user_filled`。
  - 留空的列 agent **不得自行填入**。使用者看過該列並明確表示略過 → `status: skipped`、`skippedBy: user`、`confirmation: user_skipped`：這是使用者的回答，**算已解決**，不擋完成判定，對應元素不建立，handoff 第 12 項列出。使用者還沒看過就被標成略過（例如 DEC-07 授權下沒有建議的題目）→ `skippedBy: agent`，**仍是待答**，handoff 列給使用者；使用者確認略過後才改成 `user`。沒有 `skippedBy` 的舊紀錄當 `agent`（INVARIANT-28）。產品政策已決定的項目不出現在清單。
  - **範圍與授權類的列**（產品、平台、library、輸出位置、修改邊界、確認計畫等，記在 `plan.decisions`）也要記 `confirmation`（v1.8），metrics 和設計決策一起計算。例如使用者把「variables library」那列改了 → 該筆 `plan.decisions` 記 `confirmation: user_modified`。
- **動態行為不問**（DEC-11，v1.8）：本 agent 只交付靜態畫面。只影響動態行為、不影響靜態畫面的問題**不提問，也不建 designDecision**，例如 Toast 停留幾秒、能否手動關閉、動畫與轉場、手勢。改記在 `plan.undefinedBehaviors`（`id`、`behavior`：需要決定的是什麼、`kind`、`screenKey`），handoff 第 12 項列為「未定義，交由實作決定」。動態行為會改變靜態畫面時（例如要不要畫出關閉按鈕），只就畫面上看得到的部分提問。
- **產品政策題優先**（DEC-10，v1.7）：產品政策檔還沒有 `accessibility.contrast` 時，在第一個需要它的 run，把政策題排在清單最前面並標「產品政策」（例如「<產品> 的 design system 要遵守對比（WCAG）規則嗎？」）。回答「是」或「否」都用 `product-policy.mjs write` 寫入政策檔（先把使用者的回答記成 plan.decisions 的一筆，再以它作 `decisionRef`），之後該產品的 run 不再問。測試回合「只限本輪」的回答（`runOnly: true`）是本 run 的決策，不是政策題的回答。細節見 `references/product-policy.md`。
- **設計決策**（`references/design-decisions.md`）：DS、已確認 pattern、產品政策或使用者指示沒有決定的外觀／層級／體驗選擇，先找候選，再給 2–3 個選項，放進預填清單，記入 `plan.designDecisions`（帶 `status`）；未回答的決策所影響的 section 不得寫入。不確定算不算設計決策時，當作是。優先在 Build 前問完會影響方向的題目。
- **Flow 判斷**（`references/flow.md`）：依操作歧義與變更影響決定 `unchanged`／`partial`／`task_flow`，不看畫面數。局部樣式修改記 `unchanged` 加理由即可，不做流程訪談；新按鈕去哪裡不清楚，就只問那一題（flow unknown）。不自行補業務規則。
- **授權採用建議**（DEC-07）：使用者可以對**這個 run** 授權「一律採用你的建議」。仍要逐題產生選項與建議；有建議的題目 `answer`＝建議、`source: user`、`status: answered`，並加 `delegation`（指向 plan.decisions 中的授權、`scope: run`、本 run ID）。**沒有建議的題目不得自己決定**：`status: skipped`、`skippedBy: agent`、相關元素不建立、run 結束時列給使用者（仍是待答）。授權不延續到新 run。硬性門檻（例如 G5 對比）不因授權豁免。
- 新增 token／元件、wrap、改共享主元件、替換字型、改範圍、缺權限、資產或字型不可用。
- 發現使用者改了 agent 的節點、在 Section 內新增或刪除節點（`references/collaboration.md`）：不覆寫、不重建，回報差異並詢問；在 ledger entity 記 `userChangeDetectedAt`（相關證據因此失效）。
- 新匯入元件與既有畫面使用的版本外觀不同（§6.2）：列給使用者、記為 `inherited_baseline`；不在目標檔接受 library 更新，也不用 override 模仿舊版，除非使用者決定。
- variables 來源 library 未識別：記為 gap，需要顏色 token 的驗證標 `not_verified`，**不得用 raw value 冒充綁定**。既有 paint／text／effect styles 屬於 DS token，可沿用並計入 tokenBinding。
- **可及性預檢不合格**（§9.5）：照抄參考畫面不算合格理由；Plan 階段記入 `plan.accessibilityPrecheck`，並以設計決策列出替代方案。新畫面沿用不合格 style 是 `introduced`，G5 fail，**不能以例外豁免**。**例外只有產品政策**：`accessibility.contrast.required = false` 時，不檢查、不詢問、不記對比（預檢與 finding 都不能有對比項），G5 記 `contrast: { status: "not_applicable", policyRef }`，點擊區等其他可及性項照常決定 G5；handoff 會註明「依產品政策未檢查對比」。政策尚未決定時先問政策題。
- **字型未安裝**（§10.3）：不換字型；記入 `inventory.fonts` 並在 Plan 列給使用者。比對範圍要包含準備使用的**元件內部**實際使用的字型：用 `snippets/discover-helpers.js` 的 `figmaUiComponentFonts(<主元件 id>)` 讀主元件本身（不建立 instance），再交給 `figmaUiFontCheck`（M4 漏掉了 Status Bar 內的 SF Pro Text）。v1.9：**每個準備新建的 instance** 都讀其主元件的字型，記入 `inventory.componentFontChecks`（`source: main_component`）；參考畫面上的 instance 可能已 override 成已安裝的字型，不能代替（run `ui-20261003-001` 的 Status Bar）。
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
- **共通規則檢查**（v1.9，§9.6）：Validate 依 `references/common-rules.md` 逐條檢查本次適用的規則，結果記 `audit.ruleChecks`（`ruleId`、`nodeIds`、`status`、`before`／`after`、`reason`、`findingRef`、`verification`）。`not_applicable` 要寫原因；`fail` 要寫 `affectsDelivery`，影響交付的轉成 finding（由 G3–G5 判定）；`not_tested` 同時列入 `implementationVerificationRequired`；`needs_review` 沒解決時判定為 `awaiting_user`。逐條結果**不取代** gate。A 級自動修正只限委派類型或只有一種合理修法，其他依第 5 節詢問。新建節點的間距用 `snippets/spacing.js` 的 `figmaUiSpacing` 取值（既有 pattern 值優先，照抄參考畫面不取整，不改既有節點）。
- 每筆 evidence 寫 `cellKeys`（它證明的 requiredCell）、`state`，以及 `subject`（`rootNodeId`、`scopeNodeIds`、`ancestorNodeIds`、`afterOperationId`）。default 的截圖不能拿來證明 error 或另一個 viewport。後來的寫入動到範圍、父層布局或 mode，或偵測到使用者改動，舊證據改 `superseded` 並重讀；無法判定時也重讀，不猜有效。
- Handoff：`evaluate-completion.mjs … --write`，再 `run-report.mjs handoff <run-id> --write`（從 artifacts 組出簡短 handoff，不手寫重複事實）。handoff 第 11 項會列出本 run 套用的產品政策和**政策建議**（`product-policy.mjs suggest <run-id>`；測試回合規則、DEC-07 授權這類只限本次的設定不會列入；沒有建議時寫「無」）。使用者勾選的建議，先記成 plan.decisions 的一筆，再用 `product-policy.mjs write` 寫入；沒勾選的只留在本 run，政策檔不變。handoff 第 13 項（v1.9）列出委派的細節、擬稿文案、外部規範查核結果與未驗證項目、共通規則中 fail／needs_review／not_tested 的項目；第 12 項（v1.8）列出 `plan.undefinedBehaviors`（未定義，交由實作決定）與使用者明確略過的決策；`ledger.entities` 由 verify 自動寫入，handoff 會列出建立與修改的節點。收尾時重複進入 handoff 階段不會重複記錄。最後 `node scripts/state-store.mjs release <run-id>`（owner token 相符才刪除鎖與 `active-run.json`）。**不釋放會讓 hook 持續阻擋本專案所有未帶 op 標頭的 Figma 呼叫。**
- 使用者在 handoff 之後用 `continue` 要求修改時，先記 `node scripts/run-report.mjs rework <run-id> <修改摘要>`（返工次數，§14；`run-context.mjs` 會提醒）。
- 回報時（繁體中文）分開列 implementation 與 integration 狀態、未驗證項與下一步；有 `skippedBy: agent` 的設計決策時一次列出，請使用者回答或確認略過。使用者表示「接受為測試成功」：先把使用者的決定記入 `plan.decisions`，再 `evaluate-completion.mjs … --accept-test-run <decisionRef> <說明>`。
- Design QA agent 尚未接入（`docs/qa-integration-contract.md`）：UI agent 維持目前全部適用驗證，不把交付改成「待 QA」。

## 參考檔

| 檔案 | 何時讀 |
|---|---|
| `references/discovery.md` | Discover：範圍、元件版本、variables 來源、字型、外部規範（EXT-01）、可匯入性與隱藏子節點（第 6b 步） |
| `references/design-decisions.md` | 任何可能是設計決策的時候；預填清單的格式 |
| `references/product-policy.md` | Intake 確定產品、套用或寫入產品政策、Handoff 政策建議 |
| `references/flow.md` | Plan：判斷要不要整理任務流程 |
| `references/design-quality.md` | Plan 與 Validate：品質契約、gates、evidence |
| `references/common-rules.md` | **只在 Plan 與 Validate 讀**（v1.9，§9.6）：共通設計規則、SPACE-001、`audit.ruleChecks`；由規格管轄，不改 gate 與完成判定 |
| `references/collaboration.md` | 寫入前後、使用者可能同時編輯時 |
| `references/runtime-probes.md` | 需要某項 runtime 能力、或 plugin／Claude Code 版本變了 |
| `references/recovery.md` | resume、hook 阻擋、unknown_outcome |
| `references/handoff.md` | Handoff |
| `snippets/*.js` | use_figma 腳本（寫入、guard、Discover helpers、`spacing.js` 的 SPACE-001 取值） |
| `tests/fixtures/m1-run/` | 各種 artifact 的完整範例（已去識別化） |
