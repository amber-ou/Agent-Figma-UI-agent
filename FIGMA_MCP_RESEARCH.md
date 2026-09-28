# Figma MCP UI 設計研究紀錄

版本：1.2 · 原研究日期：2026-09-27 · 補充查核／修訂：2026-09-28（v1.1、v1.2）。

目的：為「Claude Code 讀取指定檔案的 library／variables 並延伸 UI」提供來源與限制。規範以 FIGMA_UI_AGENT_SPEC.md v1.2 為唯一來源；本文件不另定義完成條件。

## 1. 研究方式與可信度

本次查閱 Figma 官方 developer docs、Figma 官方 GitHub guide、Claude Code 官方 docs、W3C 文件，並交叉閱讀目前環境安裝的 Figma 13.0.0 技能文件與已提供的工具描述。

證據分級：

- **D：官方文件事實**，代表研究日期查到的文件說明。
- **E：本環境觀察**，代表此環境的工具／技能；不保證使用者 CC 相同。
- **P：專案設計決策**，是本 spec 為品質與可恢復性提出的規則。
- **U：尚未驗證**，需要在 CC 與指定 Figma 檔案實測。

本次沒有連線讀取使用者的 Figma 檔案、沒有查詢其帳戶／seat，也沒有在真實畫布試寫。沒有安裝或配置 Claude Code。故所有實機權限、library 存取與寫入品質皆屬 U；本研究不能替代 integration tests。

**v1.2 補查限制：**2026-09-28 的 v1.2 修訂在雲端環境進行。Claude Code hooks 文件可連線查證（S14）；`developers.figma.com` 被該環境的網路政策阻擋，因此 v1.2 新增、依賴 Figma Plugin API 的項目（sharedPluginData、同一腳本內 precondition guard）標為 U，須在 M1 以 CAP-05 probe 驗證。

## 2. 對使用者需求最重要的結論

### 2.1 可用官方 remote MCP 作原生設計

官方說明 remote `use_figma` 能操作原生 Figma 結構，並列 Claude Code 為支援 client。原生寫入需要 Full seat，修改既有檔案還需要 edit permission。這支持「直接在 Figma 延伸 UI」作核心架構。[Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)

**P：**第一版不需要自架第三方 bridge。先在 CC 驗證官方工具；缺工具或權限時明確阻擋，不替換成圖片成果。

### 2.2 官方提供 library／variable 相關讀取入口

工具清單包含 library 列舉、design-system 搜尋、variable definitions、metadata、screenshots 與原生執行入口。[Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)

**P：**需要一個分層資源解析器，區分本地資產、已引用遠端資產、已加入 library 與其他可存取 library；設計輸出需可追溯到實際元件和變數。

**E：**本地技能特別提醒 local variables API 不會包含所有遠端 library variables，以及 library discovery 分頁與搜尋範圍的重要性。將這些寫成 acceptance cases，比單純寫「請沿用 DS」更可驗收。

### 2.3 擷取與原生寫入是不同工作流

官方 code-to-canvas 將已呈現的 Web UI 轉成可編輯圖層；其 seat／drafts 情境及使用流程與原生寫入有所不同。工具由 remote server 提供，desktop server 不提供這兩個寫入／擷取入口。[Code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/)

**P：**使用者本次核心需求不依賴 Web 擷取，故它只列為擴充。不能為了用 capture，先多做一個前端專案。

### 2.4 宿主採 Claude Code 原生配置

官方建議安裝 Figma plugin，或以 HTTP remote MCP 手動配置並完成 OAuth。[Remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)

Claude Code 提供 project agents 和 skills；agent 可使用 frontmatter 配置角色，skill 適合承載可重用流程與按需參考。[Subagents](https://code.claude.com/docs/en/sub-agents)、[Skills](https://code.claude.com/docs/en/skills)

**P：**採互動主 workflow skill 最直接，因為使用者希望每次呼叫先問問題。專用 agent 入口可加，但不需多個背景 agents。

### 2.5 Variables 生效值與 trace 應分開

**D，2026-09-28 補查：**Variable API 的 `resolveForConsumer(consumer)` 提供 variable 對特定節點的生效值與型別；`valuesByMode` 本身不會解析 aliases。[Figma Variable API](https://developers.figma.com/docs/plugins/api/Variable/)

**P：**主規格改成已探測支援的 runtime consumer 解析優先；手動解析保留作 trace／診斷與已驗證 fallback。讀不到完整 remote alias chain 不等於無法驗證生效值，兩者用獨立狀態表示。輸出節點建立後需重驗，不能以來源節點結果代替目標 mode 的證據。

### 2.6 手動入口與續做

**D，2026-09-28 補查：**Claude Code skill 可使用 `disable-model-invocation: true` 限制為使用者手動呼叫。[Claude Code skills](https://code.claude.com/docs/en/skills)

**P：**本 agent 採主會話手動入口。new／continue／resume 是本專案的 skill 引數語意，用以區分新任務需求確認與現有 run 恢復，不是宣稱 CC 有同名內建子命令。

### 2.7 Hooks 可作為寫入保護的強制層

**D，2026-09-28 查證：**Claude Code 的 PreToolUse／PostToolUse matcher 支援 MCP 工具名稱 `mcp__<server>__<tool>` 與 regex（例如 `mcp__.*__write.*`）；PreToolUse 以 exit code 2 或 `permissionDecision: "deny"` 阻擋；hook 由 stdin 取得 `tool_name`、`tool_input`、`tool_use_id`、`session_id`、`cwd` 等欄位；工具成功觸發 PostToolUse，失敗觸發獨立的 PostToolUseFailure；command hook 預設 timeout 600 秒。[Claude Code hooks](https://code.claude.com/docs/en/hooks)

**P：**v1.1 讓模型在每次 `use_figma` 前後自行呼叫 journal 腳本，會增加呼叫次數且可能遺漏。v1.2 改由 hooks 自動記錄與阻擋（主規格第 4.5 節）。`use_figma` 同時承擔讀與寫，hook 無法從程式碼判定是否 mutation，所以採 op 標頭自我聲明，這是已知邊界。

**U：**hooks 對 plugin 安裝的 Figma 工具實際名稱是否如預期觸發、`tool_input` 內是否能取得 fileKey，須在使用者本機 M1 驗證。

### 2.8 節點所有權標記

**U（依 Figma Plugin API 既有知識，本次無法連線查證）：**Plugin API 提供 `setSharedPluginData(namespace, key, value)`／`getSharedPluginData`，資料保存在檔案內的節點上，可由其他 plugin 讀取。若 `use_figma` runtime 支援，可用來標記 agent 建立的節點（runId、operationId、logicalKey、fingerprint），比 v1.1 的「暫時名稱＋結構比對」可靠。

**P：**主規格第 11.2、11.4 節以此為優先方案，不支援時退回名稱＋結構比對並標為降級。標記會隨使用者複製節點一起複製，所以多個節點帶相同標記時仍視為多義。

### 2.9 與使用者同時編輯

使用者於 2026-09-28 確認可能在 agent 工作期間同時編輯同一 Figma 檔。

**P：**目前沒有查到可供 agent 取得的 Figma 編輯鎖，本機鎖也限制不了 Figma 內的使用者。因此 v1.2 採：run Section 隔離工作區、所有權標記、在同一個 `use_figma` 腳本內先比對 fingerprint 再寫入（把衝突窗口縮到單次腳本執行）、偵測到使用者改動一律不覆寫並詢問。這不是原子交易，不能保證零衝突。

**U：**單一 `use_figma` 腳本執行期間，其他協作者的改動如何與之合併（多人即時協作的語意），研究未查證；M1／T35 以實測記錄行為。

### 2.10 設計決策交給使用者

**P，使用者 2026-09-28 指示：**DS、既有 pattern 或使用者指示未決定的設計選擇（例如是否使用漸層）一律詢問。主規格第 7.4 節將它資料化為 `plan.designDecisions`，並要求 write operation 以 `basisRefs` 引用依據，讓 validator 可以檢查「有沒有依據」。另新增第 6.6 節版面 pattern 盤點，讓大部分版面選擇能從既有畫面取得依據，減少需要問的題數。

## 3. 已發現的不一致與處理方式

| 議題 | 查到的差異 | Spec 採取的處理 |
|---|---|---|
| 圖片支援 | Write-to-canvas 限制段仍列圖片限制；工具頁列 `upload_assets` 等資產能力；本地技能又描述透過 capture 的 imageHash 路徑 | 不把「所有圖片都支援」或「圖片完全不能用」寫死；依 schema、檔案與最小 probe 驗證 |
| 新檔／擷取 | 公開工具文件描述新檔、既有檔、clipboard 情境；本環境工具／skill 描述偏向先有 fileKey | adapter 依實際 schema；需先建檔時取得真實 fileKey，不能猜參數 |
| 並行 | 本地 figma-use 鼓勵跨頁 fan-out；figma-generate-library 要求序列化 use_figma | 專案明確採單 writer，記為 P，不假稱官方通則 |
| API helpers | 本地 runtime 提供 query/set/createAutoLayout 等便利功能 | helper feature detection；不把 helper 當所有標準 Plugin API 都有 |
| 配額 | 方案、seat 與工具分類影響限額；頁面亦保留變更權利 | 不複製固定配額常數，當下偵測與遵循回應 |
| Skills 路徑 | 此環境為 Codex plugin cache | CC 查自己的 plugin／skill 入口，不能依賴本機絕對路徑 |
| 重試欄位（v1.2） | v1.1 主規格寫出 `safeToRetryWithoutCanvasRead`，未找到出處 | v1.2 移除欄位名；2026-09-28 M0 在官方 figma-use skill Rule 14 找到出處後寫回主規格第 11.5 節，仍須依實際回應驗證（見第 10 節） |
| 安裝名稱與工具前綴（v1.2） | `figma@claude-plugins-official` 未在 CC 實測；plugin 與手動設定的工具名稱前綴可能不同 | 安裝前以 CLI 查證；hooks matcher 用 regex，實際名稱記入 capabilities |
| 截圖保存（v1.2） | 截圖工具通常把圖片交給模型檢視，CC 未必能存成本機檔 | 預設證據改為工具參照＋審查摘要，本機 PNG 選配 |

圖片差異的依據：[Write-to-canvas limitations](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)、[Asset tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)。配額依據：[Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)。

這些差異不是本次文件工作的阻礙，因此已以可驗證規則處理；真正執行時若差異影響要求的成果，agent 必須先問使用者。

## 4. 設計品質研究轉為工程規格

以下為 P，並非官方對設計品質的保證：

| 常見失敗 | 規格化解法 |
|---|---|
| 會調工具但畫面沒有主次 | 在 build 前定主要任務、action、資訊排序 |
| 找到顏色就用，忽略語意 | variable matching 看用途、collection、mode 與 alias chain |
| 元件看起來相似就重畫 | component map 記錄來源、properties、決策與 gaps |
| 只做 happy path | 明列當次適用 cells 與必要覆蓋；不做無關模式的笛卡兒積 |
| 截圖好看但全部是 rectangles | instances、bindings、Auto Layout、可編輯性檢查 |
| 結構正常但文字被切 | 實際截圖審查＋長內容／窄寬度測試 |
| timeout 重送造成重複 | 寫入前父層基線／操作意圖＋journal＋未知結果對帳；證據不足先問 |
| 聊天中斷後忘記 node IDs | schema-validated ledger，從真實畫布對帳 |
| 把人工更改覆蓋掉 | scope、fingerprint、衝突確認與局部補償 |
| 把限制當成功 | not_verified 和 partial 狀態不能等同 pass／complete |
| 既有 library 沒綁定就被迫重構 | baseline 與本次新增／regression 分開，保留原元件 |
| 自評高分但缺證據 | 單一完成判定看 gates／證據；分數僅診斷 |
| 先建大框架才發現工具不可用 | 先以授權的真實小畫面驗證完整路徑，再工程化 |

可及性數值與原則取自 W3C；spec 中的診斷評分權重與修正迴圈預設為專案政策，不能引用 W3C 替它們背書。v1.1 已移除 85 分的完成門檻，採主規格的唯一完成判定。[WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)

## 5. 本機技能參考

本次主要讀取：

- `figma-use/SKILL.md`：runtime 規則、字型、layout、回傳 IDs、錯誤恢復。
- `figma-generate-design/SKILL.md`：元件與變數探索、畫面組裝、capture 與原生設計關係。
- `figma-generate-library/SKILL.md`：tokens、元件 variants、ledger、分頁探索與元件庫治理。

來源套件：目前環境 `figma/13.0.0/skills/`；本地文件用於研究，不構成 CC 的可攜式依賴。官方可追蹤入口為 [figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)。實作應記錄 CC 實際安裝版本與取得的 skill 來源，不直接複製 Codex 專用名稱、路徑或前綴。

## 6. 來源索引

下表「用途」說明本次用到的部分，不代表完整轉錄來源。原查閱日為 2026-09-27；S02、S10 於 2026-09-28 補查，S13 為同日新增；S14 於 2026-09-28 v1.2 修訂時新增。

| ID | 一手來源 | 用途 |
|---|---|---|
| S01 | [Figma MCP introduction](https://developers.figma.com/docs/figma-mcp-server/) | 官方能力範圍與入口 |
| S02 | [Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/) | 原生寫入、seat、權限、限制 |
| S03 | [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) | 工具分類與功能 |
| S04 | [Remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | CC plugin／manual setup、OAuth |
| S05 | [Code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/) | capture、remote／desktop 差異 |
| S06 | [Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) | 動態配額、權限診斷 |
| S07 | [Working with Text](https://developers.figma.com/docs/plugins/working-with-text/) | 字型載入與文字修改 |
| S08 | [Figma MCP server guide repository](https://github.com/figma/mcp-server-guide) | 官方指南與技能追蹤入口 |
| S09 | [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | project agent 格式與欄位 |
| S10 | [Claude Code skills](https://code.claude.com/docs/en/skills) | skill 組織與載入模型 |
| S11 | [Claude Code MCP](https://code.claude.com/docs/en/mcp) | MCP 配置與連線管理 |
| S12 | [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | 對比、target size、可及性檢查邊界 |
| S13 | [Figma Variable API](https://developers.figma.com/docs/plugins/api/Variable/) | resolveForConsumer、valuesByMode、變數解析邊界 |
| S14 | [Claude Code hooks](https://code.claude.com/docs/en/hooks) | MCP matcher、阻擋方式、stdin 欄位、PostToolUseFailure、timeout（v1.2 新增） |

## 7. 必須留到實作驗證的事項

1. 使用者 CC 的版本、安裝範圍與 Figma plugin 是否包含預期 skills。
2. 實際暴露的工具名、schema、runtime helpers 及輸出限制。
3. 指定 Figma 檔案與 library 的讀取、匯入和編輯權限。
4. 元件 properties、variables／aliases／modes 是否完整可讀。
5. 本次產品字型、圖片與 SVG 資產的相容性。
6. 真實 UI 的視覺品質、響應式、狀態完整性與恢復正確性。
7. （v1.2）`use_figma` 是否支援 `setSharedPluginData`／`getSharedPluginData`，以及單次回傳大小上限。
8. （v1.2）hooks 是否對使用者本機實際的 Figma 工具名稱觸發，`tool_input` 能否解析出 fileKey。
9. （v1.2）Aiwow Library 是否已發佈並在測試檔啟用，元件與 variables 能否以 key 匯入。
10. （v1.2）使用者在 `use_figma` 腳本執行期間編輯時的實際行為（T35）。

以上項目不能在本次研究階段勾選通過。`CC_BUILD_PROMPT.md` 要求實作者在離線測試與真實整合之間清楚區分結果。

## 8. v1.1 審查決策紀錄

使用者於 2026-09-28 同意全部優化建議：基線與新變更分離、統一完成條件、runtime variables 解析優先、補中斷／鎖恢復、任務分流、明確啟動語意、來源輸出分離、資料契約收斂，以及先驗證真實垂直流程。這是對文件方向的同意，不構成任何特定 Figma 檔案的寫入授權。

這次仍僅修訂文件，未建立 agent 或執行真實 Figma integration。主規格的 M1 用來優先消除可行性疑問，M4 才是完整 P0 驗收。

## 9. v1.2 審查決策紀錄

使用者於 2026-09-28 回答：

1. 執行環境為本機 Claude Code。
2. 可能與 agent 同時編輯，請評估如何達成 → 主規格第 11.2 節。
3. 提供可寫測試檔 `B0FKsPFvTG11Tt1P7ZXxxn`（起始節點 `14442:37607`）與唯讀 library `IBq10PHhCxczFX6hBzQvaC` → 主規格第 17.1 節。
4. 詢問截圖用途 → 主規格第 12.5 節補充說明，預設不要求本機 PNG。
5. 同意將審查建議直接修訂為 v1.2。
6. 另指示：「怎麼做出好設計」的決策（例如要不要漸層）一律詢問 → 主規格第 7.4 節。

這是對文件方向的同意與測試檔的寫入許可；每次真實寫入的具體範圍仍依主規格在 intake 確認。

## 10. M0 實測差異紀錄（2026-09-28）

環境：使用者本機 Claude Code 2.1.283；Figma plugin `figma@synced` 2.2.118（含 figma-use 等 skills）；remote MCP server 名稱 `figma`，工具名稱為 `mcp__figma__<tool>`；帳號為 Full seat（Pro team 與 Organization guest）。以下皆為 **E（本環境觀察）**，只有唯讀操作，尚未寫入。

| 議題 | 實測結果 | 對 spec／實作的影響 |
|---|---|---|
| `get_metadata` 頁面清單不完整 | 不帶 nodeId 呼叫時，測試檔只列 `COVER`，library 檔也只列 `COVER`；以 `use_figma` 讀 `figma.root.children` 實際為 3 頁（COVER、`---`、`v1.1.2`）與 4 頁（COVER、Components、v1.3.0 Components、Rich menu） | 頁面盤點不得依賴 `get_metadata` 的頁面清單；改以 `use_figma` 唯讀讀 `figma.root.children` |
| 整頁讀取超過回傳上限 | `get_metadata(14442:37607)`（頁面 `v1.1.2`，168 個頂層節點、約 5,600 個 instance）回傳約 88 萬字元，超過 CC 的工具輸出上限，被存成本機暫存檔 | Discover 須先縮小到 frame／section 範圍；CAP-05「回傳上限」記為已觀察到超限，確切上限值仍未量測 |
| 起始節點類型 | `14442:37607` 是頁面（CANVAS），不是 frame | intake 解析 URL node-id 時需辨識節點類型 |
| 檔案與 library 的角色 | 測試檔沒有已啟用的 library（`libraries_added_to_file` 為空）；Aiwow Library 在「可加入」清單內（organization） | 已啟用與否屬第 6.1 節第 3、4 類的區分；使用者將自行啟用 |
| 既有 instance 來源 | 測試檔頁面 `v1.1.2` 前 1,500 個 instance 對應 40 個主元件，其中 39 個為 remote；抽查的 16 個 key 有 12 個與 Aiwow Library「Components」頁（`0:1`）的元件相符，其餘（Status Bar、Top bar/Web page、Page Content、Menu/Light）來自其他 library | 「Aiwow Library」只是元件來源之一；component map 需記錄實際來源 |
| Variables 不在 Aiwow Library | Aiwow Library 檔本身只有 1 個 local variable；測試檔與 Aiwow 元件使用的 variables 全為 remote，來自其他 library，collections 名為 `Size`、`Global`、`Colors`（Light／Dark）、`System Colors`（6 modes，名稱與 iOS 系統色一致）、`Variable collection` | 使用者核准的 DS 來源需包含 variables 的實際來源 library；只核准 Aiwow Library 不足以涵蓋 variables |
| `search_design_system` 批次上限 | 送 3 個 query 被 server 限制為 1 個（回傳 warning「Batch was clamped from 3 to 1」）；在 library 未啟用的測試檔搜尋 `Space/400` 回傳空陣列 | 每次只送 1 個 query；空結果不能解讀為「不存在」（第 6.1 節） |
| `teamLibrary` 可見範圍 | 在測試檔 `getAvailableLibraryVariableCollectionsAsync()` 回傳空陣列（library 尚未啟用） | 啟用後需重測 |
| `resolveForConsumer` | 對 remote variable 與既有 consumer 呼叫成功（例如 `Space/400` → 16、`Radius/200` → 8、`Error/colorError`（alias）→ 解析出實際色值） | CAP-05 此項可標為 verified（唯讀）；新建節點仍需重測 |
| sharedPluginData | `setSharedPluginData`／`getSharedPluginData` 在 runtime 為 function；唯讀 `getSharedPluginData` 成功（回傳空字串）。`use_figma` 工具說明列 `setPluginData` 為不支援，但未提及 shared 版本 | 讀取已驗證；寫入尚未驗證，需在授權寫入區 probe |
| import-by-key | `importComponentByKeyAsync`、`importComponentSetByKeyAsync`、`variables.importVariableByKeyAsync` 在 runtime 為 function | 實際匯入屬寫入，未驗證 |
| 字型 | `listAvailableFontsAsync()` 回傳 8,927 筆；既有畫面使用 SF Pro、Roboto、Inter、Outfit；測試檔有 local text styles（Heading／Subtitle／Body／Button） | 字型可列舉已驗證；載入與寫入未驗證 |
| `safeToRetryWithoutCanvasRead` | v1.2 主規格因找不到出處而移除此欄位名；但本機 figma-use skill（plugin 2.2.118）的 Critical Rule 14 明確要求依 `use_figma` 錯誤回應中的此欄位決定是否可重試 | 出處已找到（官方 plugin skill）。使用者 2026-09-28 決定寫回主規格第 11.5 節，註明來源並須依實際錯誤回應驗證 |
| 其他 runtime helpers | `figma.createAutoLayout`、`figma.createSection`、`figma.createPage` 為 function；`editorType=figma` | 屬 feature detection 結果，寫入行為未驗證 |
| Library 啟用重測 | 使用者表示已加入 Aiwow Library 與 variables library 後，`get_libraries` 的 `libraries_added_to_file` 仍為空，runtime `teamLibrary.getAvailableLibraryVariableCollectionsAsync()` 也仍為空；remote collection `Colors` 在測試檔只可見 2 個已引用的 variables（`Error/colorError`、`Colors/red/6`） | 啟用狀態以兩種讀法一致為準；未啟用前無法列出 `Colors` 全部 variables，不能據此判定「沒有 surface 語意 variable」 |
| Library 啟用第二次重測 | `get_libraries` 顯示 Aiwow Library 已加入（source 由 `organization` 變為 `team`）；runtime `teamLibrary` 只看到 `Aiwow Library / Collection 1`（1 個 variable：`Boolean`）。以 `search_design_system` 將範圍限定在 4 個 organization library（Aiwow、程曦卡、UUPON、一起生活卡）搜尋 `Space/400`，結果為空 | `Size`／`Global`／`Colors`／`System Colors` 的來源 library 仍未識別，也未啟用；可能在清單以外的 team／未發佈檔案，屬未驗證 |

### 10.1 Baseline 觀察

- **`inherited_baseline`：Aiwow Library `Button`（component set `1:1545`，key `f90477a86f723dc5362f382e1d9686ffc08a93cb`）沒有 TEXT component property**，只有 VARIANT 屬性 `type`（Default／Disabled／Secondary／Button／Active／Media／Activity）。延伸設計要改按鈕文字時，只能 override instance 內層文字節點。依使用者 2026-09-28 指示記為 baseline 觀察，不修改該元件；本次改文字的 override 需記入 operation 與 audit 的結構證據。
