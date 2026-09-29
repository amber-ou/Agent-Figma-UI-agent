# 驗收結果：P0 必測項（M4）

Spec v1.6 · schemaVersion 1.2 · 日期 2026-09-29 · 分支 `feat/m4`

## 層級定義

| 層級 | 意思 |
|---|---|
| `offline_fixture` | 自動測試，使用假資料與假 Figma 物件執行：`node --test "tests/**/*.test.mjs"` → **125 pass／0 fail** |
| `sandbox_integration` | 在使用者本機、測試檔的 sandbox 頁實際呼叫 Figma（run ID 列在證據欄） |
| `visual_review` | 實際看過截圖並寫下審查摘要（證據存在該 run 的 `evidence/`） |

## 基準任務

| 任務 | 狀態 | 說明 |
|---|---|---|
| A 新增多狀態畫面 | **已執行** | run `ui-20260929-002`，判定 `complete_with_exceptions`，6/6 cell；詳見 `docs/m4-summary.md` |
| B 既有畫面局部改版 | **使用者決定略過，未測** | 複製 04-11、長文字、混合語言、不改共享主元件都沒有在 sandbox 驗證 |
| C 中斷恢復 | **使用者決定略過，未測** | 其中「人工改動偵測」與「未知結果對帳」已在 M3 實測（見 T35、T40）；「寫入回應被截斷後以所有權標記找回節點」**未實測** |

## P0 逐項結果

「結果」欄的值有五種：
- `pass`：該層級已驗證。
- `pass（部分）`：只驗證了一部分，缺的部分寫在說明裡。
- `未測`：沒有驗證。
- `n/a`：這次沒有出現適用的情境。
- `未測（略過）`：屬於使用者略過的任務 B 或 C。

| ID | 情境 | offline_fixture | sandbox_integration | visual_review | 說明 |
|---|---|---|---|---|---|
| T02 | 既有 library＋既有頁面 | 未測 | **pass** | pass | ui-20260928-001、ui-20260929-002：Aiwow 元件都取自既有 instance 的主元件，沒有另外建立重複的元件 |
| T03 | local variables 為空但 library 有變數 | 未測 | **pass（部分）** | — | ui-20260928-001 從綁定反查到 remote collections（Size、Typography），但來源 library 找不到（gap-001）；沒有驗證 variables 的匯入與綁定 |
| T04 | 同一 run 重複執行 | 未測 | 未測 | — | 沒有執行重跑測試 |
| T05 | create 已生效但回應逾時 | pass（部分）：對帳邏輯（operation-journal 測試） | 未測（C 略過） | — | M3 op-0001 是 JS 例外失敗、畫布被還原，不是「已生效但逾時」 |
| T06 | 修改前有人變更目標節點 | pass（snippets guard 測試） | **pass**（M3 ui-20260929-001 op-0003） | — | guard 回傳 conflict，沒有改動任何節點 |
| T07 | 繁中＋混合字型＋長 email | 未測 | **pass（部分）** | pass | 任務 A 在 360 寬測了中英混排的長姓名、職稱、公司名；中文用替代字型顯示，沒有方框。長 email 屬於任務 B，未測 |
| T08 | default／loading／empty／error | 未測 | **pass** | pass | 任務 A 在 390 寬做了四種狀態，360 寬做了 default 和 error；錯誤狀態有重試 |
| T10 | 缺 `use_figma`／沒有寫入權 | pass（部分）：帳號 blocked 的診斷（T43 測試） | 未測 | — | 真實環境沒有缺工具的情況；實際帳號兩個 plan 都是 Full seat |
| T11 | screenshot 不可用 | 未測 | 未測 | — | 截圖工具一直可用，沒有實測不可用的情境 |
| T13 | 需要改共享元件 | 未測 | 未測（B 略過） | — | 任務 A 沒有遇到需要改共享元件的情況 |
| T15 | 惡意圖層文字指令 | 未測 | 未測 | — | — |
| T16 | ledger 最後寫入中斷 | **pass** | 未測 | — | operation-journal 測試（journal 最後一行截斷就擋下寫入） |
| T21 | 第二次呼叫，換產品／平台 | **pass**（workflow） | **pass** | — | 每個新 run 都重新做 Intake，不沿用先前 run 的授權（INVARIANT-01、18） |
| T22 | 語意 token 與相同色值的 primitive | 未測 | 未測 | — | 這個檔案沒有 color variables 可以驗證（gap-001） |
| T23 | library 缺 loading variant | 未測 | **pass（部分）** | pass | 任務 A：v1.1.2 沒有 loading 樣式，先以 dec-105 詢問再做 skeleton，沒有新增元件 |
| T24 | 既有元件含未綁定屬性 | 未測 | **pass（部分）** | — | 任務 A 的 propertyBindings：45 個套 style、9 個 raw 值都已登記例外；「本次破壞既有綁定」的情況沒有測 |
| T25 | inherited mode＋跨 collection alias | **pass**（variable-trace） | pass（M1 resolveForConsumer） | — | — |
| T26 | 缺值／循環 alias | **pass**（variable-trace） | 未測 | — | — |
| T27 | create 生效但 ID 未回傳 | **pass**（operation-journal） | 未測（C 略過） | — | 回應截斷後以所有權標記找回節點：**未實測** |
| T29 | audit 找出 critical 缺陷 | **pass**（cross-file） | 未測 | — | 沒有在 sandbox 跑 audit 任務 |
| T31 | 參考、library、輸出分開 | **pass**（cross-file） | pass（部分） | — | 參考頁 v1.1.2 保持唯讀、只寫 sandbox，但參考和輸出是同一個檔案；另見 F-001（rd-0009 在 COVER 頁的暫時寫入） |
| T32 | audit 少 gate／懸空證據／過期截圖 | **pass**（cross-file、evaluate-completion） | pass | — | 任務 A 在 Validate 階段被 validator 擋下懸空 evidenceRef 和過期證據，修正後才通過 |
| T33 | new／continue／resume | **pass**（workflow） | **pass（部分）** | — | 重開 Claude Code 後用 `continue` 接續任務 A，沒有重問已確認的內容；resume 沒有實測 |
| T35 | 使用者改了 agent 節點 | **pass**（snippets） | **pass**（M3 op-0003） | pass（M3 ev-002） | 引用 M3 實測（T35–T37 皆通過），詳見 `docs/m3-summary.md` §4.4 |
| T38 | 未決定的裝飾／多種修法 | **pass**（cross-file） | **pass** | — | 任務 A：dec-103 待決時，只有 default 畫面沒有寫入；新發現的 major 缺陷記為 dec-117 |
| T39 | 缺 op 標頭、fileKey 不符、有 unknown_outcome | **pass**（figma-hooks） | pass | — | M3 op-0001 變成 unknown_outcome 後，下一個寫入被擋到對帳完成；M4 新增唯讀腳本靜態檢查 |
| T40 | 失敗觸發 PostToolUseFailure | **pass**（figma-hooks、operation-journal） | **pass**（M3 rd-0005、op-0001） | — | 引用 M3：讀取失敗記 failed_known，寫入失敗記 unknown_outcome；對帳後才能再寫 |
| T41 | write 沒有 basisRefs 或引用未回答決策 | **pass**（cross-file、operation-journal） | pass | — | 任務 A 的每個寫入都通過 Build 邊界檢查 |
| T43 | View／Dev seat 或沒有權限 | **pass**（workflow） | 未測 | — | 實際帳號是 Full seat |
| T44 | hook 放行時不輸出 decision | **pass**（figma-hooks） | pass | — | — |
| T45 | variables 來自未識別的 library | **pass**（cross-file、schemas） | **pass** | — | 所有 run 都記錄 gap-001，沒有用 raw 值冒充綁定 |
| T46 | 新匯入元件與既有畫面版本不同 | **pass**（cross-file、schemas） | pass | — | 主元件從既有 instance 取得（版本相同）；Button 的 icon 差異記為 baseline |
| T47 | 授權採用建議，其中一題沒有建議 | **pass**（v14-rules） | **pass** | — | ui-20260928-001 的 dec-105 標為略過；任務 A 的 delegation 指向 dec-006 |
| T48 | 參考畫面文字對比不足 | **pass**（v14-rules） | pass（部分） | — | 任務 A 在 Plan 階段列出 5 項；本輪規則 dec-005 讓 G5 不擋（not_applicable），所以沒有驗證「G5 fail 且不能例外」這條實際路徑 |
| T49 | 元件字型未安裝 | **pass**（v14-rules） | pass（部分） | pass | Status Bar 的 SF Pro Text 未安裝，**直到 Validate 才發現**（F-009），Discover 的字型比對漏掉了；有照規定不替換字型 |
| T50 | 使用者接受未完成的 run | **pass**（v14-rules） | **pass** | — | ui-20260928-001：userAcceptance 記為 dec-007，status 維持 awaiting_user，handoff 同時列出兩者 |
| T51 | write 回應被截斷 | **pass**（v14-rules、figma-hooks） | 未測（C 略過） | — | M3 只測了讀取截斷（位元組上限），沒有測寫入截斷 |
| T52 | intake 階段的 deferred 引用 | **pass**（v16-workflow A02） | pass | — | 任務 A 以 `--stage plan`／`--stage build` 驗證 |
| T53 | 寫入依據未確認時 Build 邊界拒絕 | **pass**（v16-workflow A02；M4 補的第一次寫入測試） | **pass** | — | 實測中發現「新 run 無法寫入第一筆」的死結，已修正（b8dff22） |
| T54 | journal 有未驗證或遺留的寫入 | **pass**（v16-workflow A02） | pass | — | 判定直接讀 journal |
| T55 | 證據 cellKeys 對應 | **pass**（v16-workflow A03） | **pass** | pass | 任務 A 共 17 筆證據，都有 cellKeys 和 subject |
| T56 | 證據過期或無法判定 | **pass**（v16-workflow A03；M4 no-change 測試） | **pass** | — | ui-20260929-001 因 guard 無改動的寫入被誤判為無法判定；補上「確定無改動」標記後回到 complete（7d60be0） |
| T57 | flow 判斷 | **pass**（v16-workflow A04） | pass | — | 任務 A 的 flow 為 partial（loading 分支到三種狀態，錯誤可重試） |
| T58 | 環境診斷沿用或重跑 | **pass**（diagnosis A06） | pass | — | 重開後 `diagnosis.mode=reused`；但 session id 是 unknown，只能靠時間判斷（見 m4-summary） |
| T59 | 判定過期、handoff 精簡 | **pass**（v16-workflow A07、run-report） | pass | — | inputDigest 生效；舊 run 重新判定後才產生 handoff；undefined 顯示問題已修 |
| T60 | QA 未就緒 | **pass**（v16-workflow） | pass | — | handoff 註明 QA 尚未接入，驗證仍由 UI agent 完成 |

## 未測項目與原因

| 項目 | 原因 |
|---|---|
| 任務 B 全部（T07 長 email、T13 共享元件、局部改版前後比對） | 使用者決定略過 |
| 任務 C 的「寫入回應被截斷後以所有權標記找回節點」（T27／T51 的 sandbox 部分）、T05 | 使用者決定略過；M3 只測了失敗還原與讀取截斷 |
| T04、T11、T15、T22、T29（sandbox）、T43（sandbox） | 這一輪沒有安排對應情境；T22 另外受 gap-001 影響（沒有 color variables） |
| variables 匯入與綁定、mode 切換 | gap-001：variables 來源 library 找不到，使用者也查不到 |
| 逾時或權限類的失敗事件 | 這一輪沒有遇到 |
