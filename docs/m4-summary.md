# M4 總結：完整驗收與交付

Spec v1.6 · schemaVersion 1.2 · 日期 2026-09-29 · 分支 `feat/m4`

M4 依 `CC_BUILD_PROMPT.md` 的「M4 建置指令」進行。使用者決定**任務 B、C 略過，以任務 A 的結果收尾**。逐項驗收結果見 `docs/acceptance-results.md`，操作與故障處理見 `docs/runbook.md`。

## 1. 狀態

| 項目 | 狀態 | 說明 |
|---|---|---|
| implementationStatus | `m4_complete` | v1.6（PR #8）已合併進 feat/m4，另外修了兩個 v1.6 的問題（第一次寫入死結、確定無改動的寫入）；新增唯讀腳本靜態檢查、handoff 顯示修正；新增 runbook 與驗收報告。測試 **125 pass／0 fail** |
| integrationStatus | `m4_partial` | 任務 A 在 sandbox 實測完成（`complete_with_exceptions`）；任務 B、C 由使用者決定略過，未測。其中「回應截斷後以所有權標記找回節點」完全沒有實測；人工改動偵測與未知結果對帳引用 M3 的實測 |
| 舊 run 收尾 | 完成 | `ui-20260928-001`：awaiting_user，並記錄 userAcceptance dec-007；`ui-20260929-001`：complete（修正「確定無改動」後重新判定）；兩者都帶 v1.6 的 inputDigest |
| 進行中的 run／鎖 | 無 | `state-store.mjs active` → `null` |

## 2. 任務 A：「名片夾」列表頁（run `ui-20260929-002`）

- **判定**：`complete_with_exceptions`（rule 12.1@1.6），6/6 cell 都有指名該 cell 的證據。
  - G1–G4、G6、G7 pass。
  - G5 標為 **not_applicable**，依據是本輪決策 dec-005：這一輪對比不擋，只列出。
  - 例外有兩項：ex-001 背景漸層、ex-002 圖示底色，都是 raw 值。
- **畫面**（Section `34070:85`，sandbox 頁）：

  | 畫面 | 節點 | 尺寸 |
  |---|---|---|
  | loading 390 | `34070:86` | 390×833 |
  | empty 390 | `34071:130` | 390×792 |
  | error 390 | `34072:181` | 390×765 |
  | default 390 | `34073:297` | 390×883 |
  | error 360 | `34072:261` | 360×765 |
  | default 360 | `34073:558` | 360×883 |

- **截圖**：`design-runs/ui-20260929-002/evidence/`，總覽圖是 `ev-section-overview.png`，另有各畫面的最終截圖。
- **token 綁定**：本 run 設定的屬性共 54 個，45 個套用既有 style（paint 41、text 4），9 個 raw 值都登記為例外；variables 綁定 0（gap-001）。
- **設計決策**：共 17 題。
  - 使用者直接回答 7 題。
  - 依使用者指示採用建議 10 題（delegation 指向 dec-006）。
  - 沒有待決或略過的題目。
  - dec-103（Tab 計數）提問 1 輪。
  - dec-117（360 長姓名重疊）是 Build 中途新增的決策，依本輪規則採用建議。
- **Findings**：
  - F-001 major（execution）：rd-0009 越界暫時寫入，見第 3 節。
  - F-006 major：360 長姓名重疊，已依 dec-117 修正。
  - F-008 major G5：對比不合格清單，本輪依 dec-005 不擋。
  - 其餘為 minor，只記錄：360 Top bar 圖示擁擠、error Toast 蓋住搜尋框、Button 自帶兩個 Return 圖示、skeleton 卡與搜尋框尺寸不同、公司名被擠掉、Status Bar 字型未安裝、fingerprint 不涵蓋截斷設定。

### Metrics（`node scripts/run-report.mjs metrics ui-20260929-002`）

| 項目 | 數值 |
|---|---|
| 階段時間 | plan 473 秒、build 1,846 秒、validate 154 秒 |
| 等待使用者 | 1,177 秒（dec-103 提問 1 輪），包含在 build 的時間裡 |
| 工具呼叫 | 讀取 16、寫入 5、截圖 8；工具時間 68.1 秒；**8 次呼叫沒有記到耗時**；失敗 0、截斷 0 |
| 寫入紀錄 | 5 個寫入全部讀回驗證；unknown_outcome、重試、對帳都是 0 |
| 設計決策 | 共 17：使用者回答 7、依指示採用建議 10、DS 或 pattern 直接決定 0、待決 0、略過 0 |

注意：
- plan 的時間包含 v1.6 遷移，以及重開 Claude Code 前的等待；build 的時間包含等待使用者回覆。這些數字**不能當作效能基準**。
- 這是第一次有真實量測資料，沒有可以比較的基準，所以不宣稱有加速。

## 3. 本輪發現

| # | 發現 | 影響 | 處理 | commit |
|---|---|---|---|---|
| 1 | **第一次寫入死結**：v1.6 的 Build 邊界要求 nativeWrite 必須是本 run 已驗證，但只有寫入才能驗證它，所以任何新 run 都無法規劃第一個寫入 | 新 run 完全無法開始寫入 | `nativeWriteReady()`：先前 run 已驗證過（`basis: history`）且本 run 還沒有寫入時，第一個寫入可以兼作探測；之後必須是本 run 的 verified。已補測試 | b8dff22 |
| 2 | **確定無改動的寫入被當成影響不明**：guard 擋下的寫入（T35–T37），created 和 mutated 都是空的，讓更早的證據被判為「無法確定」 | ui-20260929-001 從 complete 變成 partial | `verify` 加上 `noChange`；新增 `confirm-no-change`（要附讀回證據，不改 status）；有標記的寫入不讓舊證據失效，沒標記的仍判為無法確定。補了 5 個測試，舊 run 重新判定為 complete | 7d60be0 |
| 3 | **唯讀腳本改動畫布**：rd-0009 標為唯讀，卻在 COVER 頁（授權範圍外）建立並刪除 6 個暫時 instance，用來讀元件的預設文字。rd-0010 確認淨結果為零 | 違反「讀取不得寫入畫布」；hook 只看標頭，攔不到 | 保留為任務 A 的 F-001（major、execution）。hook 新增**啟發式**靜態檢查：mode=read 腳本出現 create、remove、appendChild、import、屬性賦值等寫法就擋下。限制寫在 `lib.mjs` 和 runtime-probes.md：間接呼叫會漏掉，也可能誤擋；通過檢查不代表腳本真的唯讀 | 36cdbe4 |
| 4 | **fingerprint 不涵蓋截斷設定**：op-0005 把姓名改成單行截斷後，fp1 的值沒變 | guard 偵測不到使用者只改截斷或行數這類屬性 | 記在 runtime-probes.md；需要時再訂 fp2（未實作） | 36cdbe4（文件） |
| 5 | **部分工具呼叫沒有記到耗時**：metrics 顯示 8 次呼叫沒有 duration | 工具時間偏低 | 未處理。**推測（未驗證）**：8 次剛好等於截圖次數，可能是 `get_screenshot` 不在會記錄耗時的 hook 匹配範圍內 | — |
| 6 | 環境診斷在重開後顯示 `session unknown` | 沿用診斷只能靠時間窗（60 分）判斷，不是依 session | 未處理；需要確認 `log-figma-call.mjs` 的 session 記錄在本機是否觸發 | — |
| 7 | 自動產生的 handoff 對舊格式 tokenBinding（字串）顯示 `undefined` | 舊 run 的 handoff 可讀性差 | `formatTokenBinding()` 同時處理字串、完整物件和部分物件，缺值顯示 unknown；補了測試，並重新產生兩個 run 的 handoff | 本次收尾 commit |
| 8 | Discover 的字型比對漏掉 Status Bar 的 SF Pro Text（未安裝） | 應在 Plan 列給使用者，直到 Validate 才發現 | 記為 F-009；沒有替換字型。之後 Discover 要比對元件內部實際使用的字型，不能只看參考畫面 | — |

另外，本輪依使用者指示採用了「只限本輪」的規則（dec-005）：對比不擋、照抄參考畫面的問題並記錄。這是測試用的設定，**不是產品政策**；正式任務仍依 §9.5，G5 是硬性門檻。

## 4. 交付檔案（M4）

| 檔案 | 內容 |
|---|---|
| `scripts/validate-artifacts.mjs` | `nativeWriteReady()`；`isConfirmedNoChange()` 與證據有效性判定；noChange 和 node IDs 矛盾時報錯 |
| `scripts/operation-journal.mjs` | `verify` 的 `noChange`；`confirm-no-change` 指令 |
| `scripts/hooks/lib.mjs`、`scripts/hooks/pre-figma-call.mjs` | `readScriptMutations()` 啟發式檢查與 deny 訊息 |
| `scripts/run-report.mjs` | `formatTokenBinding()` |
| `tests/contracts/v16-workflow.test.mjs`、`no-change-writes.test.mjs`、`run-report.test.mjs`、`tests/hooks/figma-hooks.test.mjs` | 新增 9 個測試 |
| `.claude/skills/figma-ui/references/runtime-probes.md` | 唯讀檢查的限制、fingerprint 涵蓋範圍 |
| `docs/acceptance-results.md`、`docs/runbook.md`、`docs/m4-summary.md` | 本輪交付文件 |

## 5. 未完成

1. 任務 B、C（使用者決定略過）：局部改版、長 email、共享元件、寫入回應被截斷後以所有權標記找回節點。
2. variables 匯入與綁定、mode 切換（gap-001：來源 library 找不到）。
3. 逾時或權限類的真實失敗事件，以及這類錯誤下是否會出現 `safeToRetryWithoutCanvasRead`。
4. 發現 5、6、8 的修正，以及 fingerprint fp2。
5. `ui-20260928-001` 的三題待決事項（說明文字對比、成功圖示、Status Bar 字型）仍開著（已記錄使用者接受）。
