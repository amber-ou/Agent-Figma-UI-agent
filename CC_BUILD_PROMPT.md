# 交給 Claude Code 的建置指令

版本：1.2 · 修訂日期：2026-09-28 · 配套規格：FIGMA_UI_AGENT_SPEC.md v1.2

把本檔與 `FIGMA_UI_AGENT_SPEC.md`、`FIGMA_MCP_RESEARCH.md` 放在同一專案。直接將下方指令貼給 Claude Code；CC 應讀取檔案後開始實作，而不是只回覆建議。

---

請依本目錄的 `FIGMA_UI_AGENT_SPEC.md` 與 `FIGMA_MCP_RESEARCH.md` 建立一個可實際使用的 Figma UI 設計 agent。

我的核心需求已確認：

1. 宿主是 Claude Code。
2. agent 能讀取我指定 Figma 檔案的 libraries、components 與 variables，再沿用它們延伸製作原生可編輯 UI。
3. 我手動呼叫 `/figma-ui` 啟動新任務時，詢問產品／平台、參考來源、核准的設計系統、輸出檔案／頁面、要做新稿或改原稿，以及要延伸的內容。已提供資訊用摘要確認；continue 不重問已確認資訊，resume 先對帳，只重問過期或衝突部分。
4. 預設 strict reuse；新增 token／component、包裝元件、改共享主元件、替換字型、改變範圍或遇到阻礙時先問我。未改動的既有 library 問題列為 baseline，不為了追求綁定比例而改造整套元件庫；影響本次功能／硬性可及性要求的問題仍必須處理。
5. 品質優先，需要結構與視覺驗證、狀態覆蓋、局部修正、恢復與交付證據。
6. 我在本機的 Claude Code 使用這個 agent。
7. 我可能在 agent 工作時同時編輯同一個 Figma 檔。agent 必須偵測我的改動、絕不覆寫，並依主規格第 11.2 節詢問我。
8. 「怎麼做出好設計」的選擇（例如要不要漸層、陰影、用表格或卡片、長文字換行或截斷）只要 DS、既有畫面 pattern 或我的指示沒有決定，一律以選項形式問我，不要自行決定（主規格第 7.4 節）。

請先檢查這個專案現有指令、檔案及 Claude Code／MCP 設定。使用現有可用配置，避免覆寫我其他 agent、skills 或 server。不要照搬其他宿主的工具前綴、絕對路徑或未驗證 schema。

先依主規格第 17 節做 **M0–M1 最小真實流程**，再完成其餘 P0。M1 的測試檔與唯讀 library 見主規格第 17.1 節：

1. 檢查既有 CC／remote MCP 配置，取得明確來源與授權的測試輸出區域。
2. 讀取一個真實 library 元件和相關語意 variable；分清 source 與 output 的權限。
3. 保存最小 brief、父層基線、操作意圖及識別，再在授權區域沿用該元件／變數做一個小畫面。
4. 讀回主元件關係、binding、consumer 的生效值／mode，並取得截圖實際審查。
4a. 同時完成主規格 CAP-05 的 probes（sharedPluginData、resolveForConsumer、import-by-key、字型、截圖、回傳上限），並以最小 PreToolUse／PostToolUse hook 確認 hooks 會對實際 Figma 工具名稱觸發。
5. 記錄結果及精確 IDs，按既有授權保留或清理。未知結果先停止對帳，不以測試為由重送 create。

不要等所有 schema、工具框架與測試架構都完成才首次驗證 Figma。M1 是可行性證明，不取代完整驗收。缺乏真實條件時先問我，同時進行不依賴回答的離線工作，但不能把未驗證假設寫成已證實能力。

M2–M4 再完成：

- 一個手動呼叫、主會話內執行的 `/figma-ui` workflow skill，包含 new／continue／resume 語意與必要 references；專用 agent 入口可加，但不以多 agent 為前置。
- 可驗證的 brief／plan／inventory／capabilities／ledger／operation／audit JSON schemas。
- library／component／variables 解析依主規格第 6 節；consumer 的 runtime 解析優先，alias trace 與有效值驗證分開。
- 主規格第 4.5 節的 hooks 強制層：寫入授權、本機鎖、未知結果阻擋與 journal 由 hooks 自動處理；合併到專案 `.claude/settings.json`，不覆寫我的其他設定。
- 單 writer、操作 journal、idempotency、未知 create 對帳、簡化的本機鎖（heartbeat／PID 重用檢查屬 P1），以及第 11.2 節的人機協作：run Section、sharedPluginData 所有權標記、同一腳本內 precondition guard、使用者改動不覆寫；不宣稱具備 Figma 原子交易。
- 第 6.6 節版面 pattern 盤點，以及第 7.4 節的設計決策問答與 `plan.designDecisions`／operation `basisRefs` 驗證。
- runtime API 細節依我本機已安裝的官方 Figma plugin skills，不另寫一份 API 教學。
- extend／modify／audit 任務分流、當次 requiredCells、baseline／regression 分離、evidence 與 handoff。
- 唯一完成判定依主規格第 12.1 節；硬性 gates 與有效證據決定完成，診斷分數不作通關門檻。唯讀 audit 可以完整回報含嚴重缺陷的設計，不代表該設計通過。
- 離線 contract／recovery tests、授權 sandbox integration 的執行方式、setup／runbook／驗收報告。

以主規格為規範唯一來源；本指令只決定執行入口與順序，研究文件提供證據，不重複定義另一套完成規則。架構可以簡化，但不能省略必要行為與驗收。不要另建 Web app、SaaS 或第三方 MCP server；capture／前端程式碼實作先列為可選擴充。

安裝或修改連線前先檢查既有 Figma plugin／remote MCP。OAuth 由我完成，不要求我貼秘密。若安裝、權限或目標檔案缺少，提出精確問題，同時繼續不依賴該回答的本機實作和離線測試。

任何真實 Figma 寫入前，取得本次明確目標檔案／測試區域與許可。用 mock 測試的結果不能當作 Figma 整合通過。缺少真實測試條件時，把整合結果標記未驗證，列出我需要補的資訊；不得聲稱 agent 已端到端驗收。

對規格中示範的 JSON、YAML、工具名稱與 helpers 做實際驗證；欄位片段不可冒充完整 fixture，示例識別占位符不可進入工具呼叫。schemaVersion 使用 1.2，跨檔案引用也要驗證。截圖證據預設以工具參照＋審查摘要保存，本機 PNG 為選配（主規格第 12.5 節）。若官方文件、plugin skill 與 runtime schema 不同，保存差異，依實際支持能力調整 adapter；影響成果時先問我。

完成時交付：

1. 建立與修改的檔案清單，以及啟動方式。
2. 已實作的 P0 功能與 spec／test 對應，分開列 implementationStatus／integrationStatus。
3. 實際執行的測試指令、結果與未跑項目，區分 fixture／真實整合／視覺審查。
4. 已知限制、未完成的外部授權或 integration steps。
5. 一個完整示範 run 的 brief、資源沿用報告、ledger、audit、handoff；若只能離線示範，明確標註為 fixture。
6. 下一次我呼叫 `/figma-ui` 時會出現的詢問範例，以及一個設計決策問題的範例。

不要只產生一份長 system prompt 就宣布完成。先讀兩份文件，再開始建置；遇到問題先問我。

---

## 建好後的使用範例

```text
/figma-ui
讀取這個 Figma 檔案的 library、components 與 variables，延伸做一個成員管理頁。
參考 Figma URL：<貼上你的真實檔案或 frame 連結>
輸出位置：<指定檔案／頁面；可與參考檔案相同>
先確認這次的產品、平台、設計系統、畫面範圍，以及做新稿或改原稿。
使用現有元件與語意變數；缺少的地方先提出選項，不要自行另建一套。
```

具體平台、品牌與 states 應在當次 intake 確定。以上連結占位符須由使用者替換。

agent 遇到設計決策時的詢問範例（示意內容，非真實檔案資料；格式依主規格 DEC-04）：

```text
【設計決策 dec-004】成員列表頁／頁首背景
DS 沒有頁首背景的規範，參考的兩個既有畫面也不一致（A 用純色 surface/default，B 用品牌色漸層）。
選項：
1. 純色 surface/default：與 A 一致，視覺較安靜，主要 action 更突出
2. 沿用 B 的品牌漸層：品牌感較強，但需確認 B 的漸層是否為正式規範
3. 純色 surface/brand-subtle：介於兩者之間，已有對應 variable
建議：1（僅供參考，請你決定）
```

續改與恢復的 skill 引數範例：`/figma-ui continue <run-id> 調整列表間距`、`/figma-ui resume <run-id>`。這些不是另行安裝的 Claude Code 內建命令。
