# 交給 Claude Code 的建置指令

版本：1.6 · 修訂日期：2026-09-29 · 配套規格：FIGMA_UI_AGENT_SPEC.md v1.6

> **狀態：**M0–M3 與 v1.6 流程精簡（階段 A，離線實作，見 `docs/workflow-simplification-record.md`）已完成。前面的指令保留作紀錄；**接下來請使用文末的「M4 建置指令」**，它已改為 v1.6。

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

---

## M2 建置指令（v1.3）

M1 完成後，把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.3 進行 M2「工作流程與契約」。M1 已完成（`docs/m1-summary.md`），請以 M1 已實作的 `scripts/hooks/*`、`scripts/evaluate-completion.mjs` 與既有 13 個測試為基礎擴充，不要重寫。

這次要交付：

1. **`/figma-ui` workflow skill**（主規格第 4.1、4.3、7、8 節）：`.claude/skills/figma-ui/SKILL.md`，手動呼叫（`disable-model-invocation: true`）、在主會話執行。支援 `new`／`continue <run-id>`／`resume <run-id>` 三種入口。SKILL.md 保持精簡，細節放 `references/`（discovery、design-decisions、design-quality、collaboration、runtime-probes、recovery、handoff）。runtime API 用法指向已安裝的官方 Figma skills，不另寫教學。
2. **Preflight**：每個新 run 先做第 4.2.1 節帳號與 seat 診斷，並列出實際工具名稱與 plugin 版本，寫入 capabilities。
3. **Intake**：分別確認元件 library 與 variables library（第 6.1 節）；URL node-id 先辨識節點類型；寫入位置預設為獨立頁面或小範圍 Section。
4. **Discover**：頁面清單改用 `figma.root.children`、不整頁 `get_metadata`、`search_design_system` 一次一個 query（第 8.1 節）；pattern 盤點依第 6.6 節，限制狀態分 `observed_not_confirmed | confirmed`；比對元件版本差異（第 6.2 節）。
5. **Plan 與設計決策**：`plan.designDecisions` 與 write operation 的 `basisRefs`（第 7.4 節）；DS／pattern 沒有決定的設計選擇一律以選項形式問我。
6. **snippets**：`op-header.js`、`fingerprint.js`、`mark-owned.js`、`precondition-guard.js`，把 M1 實際用過的寫法整理成可重用片段。
7. **JSON Schemas**（第 20 節）：brief、plan、inventory、capabilities、ledger、operation、audit，schemaVersion 維持 `1.2`（與 M1 紀錄一致）；validator 分語法與跨檔檢查；`evaluate-completion.mjs` 接上 schema 驗證。把 M1 的 run 紀錄（去識別化後）轉成完整 fixtures。
8. **本機工具腳本**：`state-store.mjs`（原子寫入）、`operation-journal.mjs`（planned／verified 記錄）、鎖的取得與釋放（run 結束必須釋放並移除 `active-run.json`）。
9. **測試**：新增 T43–T46 與第 13.2 節中 M2 範圍的 P0 fixture；指令一律為 `node --test "tests/**/*.test.mjs"`。
10. **量測回傳上限**：以唯讀方式在 sandbox 頁量測 `use_figma` 回傳上限，寫入 capabilities。

限制與注意：

- 真實 Figma 寫入只能在測試檔的「figma-ui sandbox」頁（`34014:8`），每個 run 開新 Section；寫入前照舊列計畫給我確認。
- hooks 放行不得輸出 `allow`；read 使用獨立 operationId。
- 變數來源 library（gap-001）尚未識別；需要顏色 token 的驗證先標 not_verified，不要用 raw value 冒充。我查到 library 名稱後會告訴你。
- 未經實驗證實的原因推論要標示為假設。
- 所有變更 commit 到新分支 `feat/m2-skill` 並推上去，不要直接推 main。

完成時交付：建立與修改的檔案清單、`/figma-ui` 的啟動方式、implementationStatus／integrationStatus、實際執行的測試指令與結果、未完成項目，以及下一次我呼叫 `/figma-ui` 時會看到的開場詢問範例。

---

## M3 建置指令（v1.4）

把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.4 進行 M3。先讀第 20.3 節（v1.4 變更紀錄）與 `docs/m3-first-run-summary.md`。以 M2 已實作的 skill、schemas、scripts 與 60 個測試為基礎擴充，不要重寫。

第一部分：實作 v1.4 規則（離線，附測試）

1. **schema 與 validator**：`plan.designDecisions[]` 新增選填的 `status`（pending／answered／skipped）與 `delegation`（decisionRef、scope=run）；`ledger` 新增選填的 `userAcceptance`（kind=test_run、decisionRef、note、acceptedAt）。validator 規則：skipped 的決策不得被 write operation 引用；userAcceptance 不得改變 status 或 completionEvaluation（INVARIANT-17）；delegation 的 run 與目前 run 不同時拒絕（INVARIANT-18）。schemaVersion 維持 1.2。
2. **skill**：更新 `SKILL.md` 與 references：
   - DEC-07 授權採用建議的流程；沒有建議的題目標 skipped、run 結束時列出。
   - Plan 階段可及性預檢（第 9.5 節）。
   - 字型比對（第 10.3 節）：未安裝的字型不得替換，要列出。
   - REQ-04 品牌與產品名稱。
   - 從既有 instance 取得主元件（第 6.2 節）。
   - styles 計入 tokenBinding（第 10.1、12.2 節）。
   - handoff 同時列出完成判定與 userAcceptance。
3. **tokenBinding 計算**：`quality-metrics.mjs`（或併入現有腳本），分開統計 variable binding 與 style 套用，raw 值計入分母。
4. **測試**：T47–T51，以及上面每條 validator 規則的反例。指令為 `node --test "tests/**/*.test.mjs"`。
5. **文件**：`docs/setup.md` 補上 Windows PowerShell 的注意事項：`npm` 被執行原則擋下時改用 `npm.cmd install`，或執行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

第二部分：M3 真實整合（在 sandbox 頁，寫入前照舊列計畫給我確認）

6. **協作情境 T35–T37**：先建立一個小節點；請我在 Figma 手動修改、新增或刪除；確認 agent 偵測到、不覆寫、不重建，並回報差異。
7. **PostToolUseFailure**：用一個必定失敗、且不會改動畫布的唯讀腳本觸發，記錄實際的 stdin 欄位與 `safeToRetryWithoutCanvasRead` 是否出現。
8. **中文回傳上限**：唯讀量測 20KB 上限對中文是以字元還是位元組計算。

限制：hooks 放行不得輸出 `allow`；read 用獨立 operationId；run 結束必須釋放鎖；未驗證的推論標為假設；所有變更推到新分支 `feat/m3`，不要直接推 main。

完成時交付：檔案清單、implementationStatus／integrationStatus、測試指令與結果、T35–T37 與 PostToolUseFailure 的實測結果、未完成項目，並把總結寫進 `docs/m3-summary.md`。

---
## M4 建置指令（v1.5）

把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.6 進行 M4「完整驗收與交付」（第 13.3、15、17 節）。先讀第 20.3 節（v1.6 變更紀錄）、`docs/workflow-simplification-record.md` 與 `docs/m3-summary.md`。v1.6 的流程（階段式驗證、按需 flow、按需環境診斷、`run-report.mjs` 產生的 handoff 與量測）只有離線測試，M4 的三組任務同時是它的第一次真實驗證：每組任務結束後附上 `node scripts/run-report.mjs metrics <run-id>` 的結果。

1. **先收尾兩個待決的 run**（照我的回覆記錄，不自行決定）：`ui-20260928-001` 與 `ui-20260929-001`。
2. **設計三組基準任務草案**，內容改用 Aiwow 電子名片 LINE OA 的產品情境，先列給我確認，不要直接開始：
   - A：新增一個多狀態畫面（至少 default／loading／empty／error），手機尺寸加一個較窄或較寬的壓力寬度。
   - B：既有畫面的局部改版（在 sandbox 頁複製一份既有畫面當作改版對象，不動原頁），含長文字與混合語言，不能改共享主元件。
   - C：中斷恢復，包含一個已生效但沒收到回應的寫入，以及一處我的人工改動。
3. 我確認後，每組任務用 `/figma-ui` 跑一次，全部只寫在 sandbox 頁。設計決策依規格詢問我；我可能會對某個 run 授權採用建議（DEC-07）。
4. **交付文件**：`docs/runbook.md`（日常使用、帳號與權限恢復、hook 阻擋、未知結果對帳的處理步驟），以及 `docs/acceptance-results.md`（P0 必測項逐項結果，標明 offline_fixture／sandbox_integration／visual_review 層級，未測項目與原因）。
5. **M4 期間順便補的項目**：若我提供 variables 來源 library，補驗 color variable 綁定、mode 切換與 variable import-by-key；有機會時記錄逾時或權限類的失敗事件。

限制照舊：hooks 放行不得輸出 `allow`；read 用獨立 operationId；腳本存取節點屬性前先依 `node.type` 分流（INVARIANT-19）；回傳上限以位元組計；每個 run 結束釋放鎖；未驗證的推論標為假設；變更推到新分支 `feat/m4`，不要直接推 main。

完成時交付：三組任務的完成判定與截圖、runbook、驗收報告、implementationStatus／integrationStatus，並把總結寫進 `docs/m4-summary.md`。

---

