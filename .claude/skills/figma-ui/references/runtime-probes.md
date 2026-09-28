# Runtime probe 結果（本專案實測，不是 API 教學）

API 用法以已安裝的官方 Figma skills 為準（`figma:figma-use` 等）。本檔只記錄本專案在使用者本機實測的結果、與文件的差異和我們的處理。**Claude Code 或 Figma plugin 升級後要重測**，並把新結果寫入該 run 的 `capabilities.json`。

測試環境：Windows、Claude Code 2.1.283、Figma plugin `figma@synced` 2.2.118、remote MCP server `figma`（工具名 `mcp__figma__<tool>`，40 個工具）、Node 22.17.0。日期 2026-09-28。

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
| **`use_figma` 回傳上限** | **20,480 字元（20 KiB）。超過時靜默截斷並加上 `// truncated to 20kb`，不回報錯誤。** 以 ASCII 量測；多位元組字元（中文）以字元或位元組計尚未量測 | M2 rd-limit-1m（1,000,000 字元 → 截斷）、rd-limit-pos（位置編碼字串，最後完整區塊為第 20,470–20,479 字元） | 見下方「回傳大小規則」 |
| `get_metadata` 整頁 | 含約 5,600 個 instance 的頁面回傳約 88 萬字元；Claude Code 將超限輸出存成檔案 | M0 | 不整頁呼叫；先取頂層摘要 |
| `get_metadata` 不帶 nodeId | 只列第一頁 | M0 | 頁面清單改用 `figma.root.children` |
| `search_design_system` | 多個 query 被 server 裁成 1 個；library 未啟用時結果為空 | M0 | 一次一個 query；空結果不等於不存在 |
| hooks | PreToolUse／PostToolUse 對 `mcp__figma__use_figma` 觸發；新增設定後免重啟；`tool_input.fileKey` 可讀；PostToolUse stdin 另有 `mcp_server`、`duration_ms` | M1 hooktest-01 | PostToolUseFailure 真實觸發與欄位名尚未驗證 |
| `safeToRetryWithoutCanvasRead` | 官方 figma-use skill Rule 14 描述；尚未在真實錯誤回應中觀察到 | — | 缺欄位視為未知，先讀畫布 |

## 回傳大小規則（依 20 KiB 上限）

- 寫入腳本只回傳 IDs、狀態、fingerprint 與短摘要；**不要**在寫入腳本裡回傳大量節點資料或 screenshot 以外的長文字。回傳被截斷會讓 created IDs 遺失，該 write 就只能以 `unknown_outcome` 對帳。
- 讀取腳本自行分批：先回傳數量與 ID 清單，再分段讀細節；每批估計在 15,000 字元以下。回傳內容結尾以 `// truncated to 20kb` 結束時，視為不完整，縮小範圍重讀，不以截斷的資料做判斷。
- Discover 的 instance 盤點以 component set 去重後回傳，不逐一列出 instance。
