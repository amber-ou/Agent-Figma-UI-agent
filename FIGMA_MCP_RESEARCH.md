# Figma MCP UI 設計研究紀錄

版本：1.1 · 原研究日期：2026-09-27 · 補充查核／修訂：2026-09-28。

目的：為「Claude Code 讀取指定檔案的 library／variables 並延伸 UI」提供來源與限制。規範以 FIGMA_UI_AGENT_SPEC.md v1.1 為唯一來源；本文件不另定義完成條件。

## 1. 研究方式與可信度

本次查閱 Figma 官方 developer docs、Figma 官方 GitHub guide、Claude Code 官方 docs、W3C 文件，並交叉閱讀目前環境安裝的 Figma 13.0.0 技能文件與已提供的工具描述。

證據分級：

- **D：官方文件事實**，代表研究日期查到的文件說明。
- **E：本環境觀察**，代表此環境的工具／技能；不保證使用者 CC 相同。
- **P：專案設計決策**，是本 spec 為品質與可恢復性提出的規則。
- **U：尚未驗證**，需要在 CC 與指定 Figma 檔案實測。

本次沒有連線讀取使用者的 Figma 檔案、沒有查詢其帳戶／seat，也沒有在真實畫布試寫。沒有安裝或配置 Claude Code。故所有實機權限、library 存取與寫入品質皆屬 U；本研究不能替代 integration tests。

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

## 3. 已發現的不一致與處理方式

| 議題 | 查到的差異 | Spec 採取的處理 |
|---|---|---|
| 圖片支援 | Write-to-canvas 限制段仍列圖片限制；工具頁列 `upload_assets` 等資產能力；本地技能又描述透過 capture 的 imageHash 路徑 | 不把「所有圖片都支援」或「圖片完全不能用」寫死；依 schema、檔案與最小 probe 驗證 |
| 新檔／擷取 | 公開工具文件描述新檔、既有檔、clipboard 情境；本環境工具／skill 描述偏向先有 fileKey | adapter 依實際 schema；需先建檔時取得真實 fileKey，不能猜參數 |
| 並行 | 本地 figma-use 鼓勵跨頁 fan-out；figma-generate-library 要求序列化 use_figma | 專案明確採單 writer，記為 P，不假稱官方通則 |
| API helpers | 本地 runtime 提供 query/set/createAutoLayout 等便利功能 | helper feature detection；不把 helper 當所有標準 Plugin API 都有 |
| 配額 | 方案、seat 與工具分類影響限額；頁面亦保留變更權利 | 不複製固定配額常數，當下偵測與遵循回應 |
| Skills 路徑 | 此環境為 Codex plugin cache | CC 查自己的 plugin／skill 入口，不能依賴本機絕對路徑 |

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

下表「用途」說明本次用到的部分，不代表完整轉錄來源。原查閱日為 2026-09-27；S02、S10 於 2026-09-28 補查，S13 為同日新增。

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

## 7. 必須留到實作驗證的事項

1. 使用者 CC 的版本、安裝範圍與 Figma plugin 是否包含預期 skills。
2. 實際暴露的工具名、schema、runtime helpers 及輸出限制。
3. 指定 Figma 檔案與 library 的讀取、匯入和編輯權限。
4. 元件 properties、variables／aliases／modes 是否完整可讀。
5. 本次產品字型、圖片與 SVG 資產的相容性。
6. 真實 UI 的視覺品質、響應式、狀態完整性與恢復正確性。

以上項目不能在本次研究階段勾選通過。`CC_BUILD_PROMPT.md` 要求實作者在離線測試與真實整合之間清楚區分結果。

## 8. v1.1 審查決策紀錄

使用者於 2026-09-28 同意全部優化建議：基線與新變更分離、統一完成條件、runtime variables 解析優先、補中斷／鎖恢復、任務分流、明確啟動語意、來源輸出分離、資料契約收斂，以及先驗證真實垂直流程。這是對文件方向的同意，不構成任何特定 Figma 檔案的寫入授權。

這次仍僅修訂文件，未建立 agent 或執行真實 Figma integration。主規格的 M1 用來優先消除可行性疑問，M4 才是完整 P0 驗收。
