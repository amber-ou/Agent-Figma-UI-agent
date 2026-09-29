# Runtime probe 結果（本專案實測，不是 API 教學）

API 用法以已安裝的官方 Figma skills 為準（`figma:figma-use` 等）。本檔只記錄本專案在使用者本機實測的結果、與文件的差異和我們的處理。

**何時重測（v1.6）：**不是每個 run 都重跑整組 probe。本 run 要用到某項能力，而且 Claude Code／Figma plugin 版本與下表不同、或該能力從未驗證過，才做最小 probe。沿用下表的結果寫進 `capabilities.json` 時標 `basis: "history"`、狀態 `available_unverified`；只有本 run 實際成功呼叫過才標 `verified`（`basis: "this_run"`）。安裝診斷是否沿用由 `verify-installation.mjs` 決定，它不能代替本 run 的帳號、檔案與工具確認。

測試環境：Windows、Claude Code 2.1.283、Figma plugin `figma@synced` 2.2.118、remote MCP server `figma`（工具名 `mcp__figma__<tool>`，40 個工具）、Node 22.17.0。日期 2026-09-28；M3 整合測試 2026-09-29（run ui-20260929-001）。

| 能力 | 結果 | 證據 | 對流程的影響 |
|---|---|---|---|
| 帳號與 seat | 寫入需目標 plan 的 Full seat；View seat 讀取回「沒有 edit access」 | M0 | Preflight 先 `whoami`；blocked 時不重試讀取 |
| sharedPluginData 寫入／讀回 | verified（同腳本與跨呼叫） | M1 op-0001、rd-0001 | 所有權標記用 `setSharedPluginData('figma_ui', …)`；`setPluginData`（非 shared）不支援 |
| `resolveForConsumer` | verified（既有節點與新建節點，含 alias） | M1 probe-05、rd-0003 | 變數生效值以 runtime 為準；手動 trace 只作診斷 |
| `importComponentSetByKeyAsync` | verified；取得 library **目前發佈版** | M1 op-0003 | 需比對與既有畫面使用的版本差異（§6.2） |
| `swapComponent` 換 variant | verified | M1 op-0006 | 換 variant 後重設文字 override |
| variable import-by-key | not verified | — | 需要綁新 variables 的 run 先 probe |
| 字型 | `listAvailableFontsAsync` 8,927 筆；載入 Inter Bold 後改文字成功；Inter 無 CJK 字形（fallback 顯示，`hasMissingFont=false`） | M1 | 截圖確認無缺字 |
| 截圖 | `get_screenshot` 回傳可檢視影像（`enableBase64Response: true` 時 inline） | M1 ev-002…ev-006 | 證據用 toolRef＋審查摘要 |
| **`use_figma` 回傳上限** | **20,480 個 UTF-8 位元組（20 KiB），不是字元數。超過時靜默截斷並加上 `// truncated to 20kb`，不回報錯誤；截斷可能切在多位元組字元中間，留下 `�`（U+FFFD）。** 純中文（每字 3 B）約 6,826 字 | M2 rd-limit-1m、rd-limit-pos（ASCII）；M3 ui-20260929-001 rd-0003（6,815 字＋`|END`＝20,449 B，完整）、rd-0004（6,830 字＋`|END`＝20,494 B，截斷）、rd-0002（位置編碼中文，截在 `<07100>` 區塊，符合位元組計算） | 見下方「回傳大小規則」 |
| `get_metadata` 整頁 | 含約 5,600 個 instance 的頁面回傳約 88 萬字元；Claude Code 將超限輸出存成檔案 | M0 | 不整頁呼叫；先取頂層摘要 |
| `get_metadata` 不帶 nodeId | 只列第一頁 | M0 | 頁面清單改用 `figma.root.children` |
| `search_design_system` | 多個 query 被 server 裁成 1 個；library 未啟用時結果為空 | M0 | 一次一個 query；空結果不等於不存在 |
| hooks | PreToolUse／PostToolUse 對 `mcp__figma__use_figma` 觸發；新增設定後免重啟；`tool_input.fileKey` 可讀；PostToolUse stdin 另有 `mcp_server`、`duration_ms` | M1 hooktest-01 | — |
| PostToolUseFailure | **verified**：腳本 throw 時觸發。stdin 欄位：`session_id`、`transcript_path`、`cwd`、`scratchpad_dir`、`prompt_id`、`permission_mode`、`effort`、`hook_event_name`、`tool_name`、`tool_input`、`tool_use_id`、`error`、`is_interrupt`、`duration_ms`、`mcp_server`。**沒有 `tool_response`**；`error` 是字串（錯誤訊息＋stack＋`Figma Debug UUID`）；`is_interrupt=false` | M3 rd-0005（刻意 throw）、op-0001（真實寫入失敗）；ui-20260928-001 rd-0017 | read 失敗 → `failed_known`；write 失敗 → `unknown_outcome`，先唯讀對帳 |
| `safeToRetryWithoutCanvasRead` | 官方 figma-use skill Rule 14 描述；**3 次真實 JS 例外的 `error` 中都沒有出現**（其他錯誤類型未測） | M3 rd-0005、op-0001；rd-0017 | 缺欄位視為未知，先讀畫布 |
| 腳本中途 throw 的副作用 | op-0001 在建立 Section 與 frame 之後 throw；對帳時畫布**沒有任何殘留**（變更被整批還原） | M3 op-0001、rd-0006 | **hypothesis**：只觀察到 1 次，不能當成保證；仍一律唯讀對帳後才記 `failed_known` |
| 節點屬性存取 | 讀取節點不支援的屬性會**丟例外**（`no such property 'findAllWithCriteria' on TEXT node`），不是回傳 undefined；`x.prop ? … : …` 不能當防護 | M3 op-0001 | 依 `node.type` 分流（`snippets/fingerprint.js` 已修正） |
| 協作偵測 T35–T37 | 使用者手動改文字、在 Section 新增方塊、刪除 frame 後，precondition guard 分別回傳 `user_modified`、`user_added_nodes`（同時列出缺少的 child）、`deleted`；三次都沒有修改或重建 | M3 op-0003～op-0005、rd-0008、ev-002 | 照 `collaboration.md` 回報並詢問 |

## 回傳大小規則（依 20 KiB 上限）

- 寫入腳本只回傳 IDs、狀態、fingerprint 與短摘要；**不要**在寫入腳本裡回傳大量節點資料或 screenshot 以外的長文字。回傳被截斷會讓 created IDs 遺失，該 write 就只能以 `unknown_outcome` 對帳。
- 讀取腳本自行分批：先回傳數量與 ID 清單，再分段讀細節；每批估計在 15,000 **位元組**以下（中文每字 3 B，約 5,000 字）。回傳內容結尾以 `// truncated to 20kb` 結束時，視為不完整，縮小範圍重讀，不以截斷的資料做判斷。
- Discover 的 instance 盤點以 component set 去重後回傳，不逐一列出 instance。
