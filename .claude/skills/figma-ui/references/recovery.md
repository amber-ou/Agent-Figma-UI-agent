# 恢復、對帳與 hook 阻擋（spec §11.1、§11.3–§11.6）

## resume <run-id>

1. `node scripts/state-store.mjs resolve <run-id>`；不存在或多義 → 問。
2. `node scripts/validate-artifacts.mjs design-runs/<run-id>`：記錄 schema／跨檔錯誤；有 `operations.jsonl` 截斷最後一行 → 必須對帳。
3. `node scripts/operation-journal.mjs summary <run-id>`，依 `nextStep`：
   - `reconcile`：有 `dispatched`（CC 中斷、沒有後續事件）或 `unknown_outcome` → 下面的對帳流程。**不要重送 create。**
   - `verify`：有 `applied` 未驗證 → 用 read operationId 讀回再 verify。
   - `dispatch_planned` / `none`：繼續上次未完成的階段。
4. 讀回 ledger 的 entities（`figma.getNodeByIdAsync` 逐一檢查存在、type、parent、所有權標記與 fingerprint）。有差異依 `collaboration.md` 處理。
5. 只重問過期或有衝突的資訊（例如檔案權限改變、使用者改了節點）；其餘沿用已確認的 brief 與 plan。
6. 需要寫入時重新 `activate`；鎖被其他 run 持有 → 不搶，先看該 run 的 journal 再問使用者是否接手。

## 未知結果對帳（§11.4）

對 `unknown_outcome`／遺留的 `dispatched` write：

1. 從 operation 的 `preconditions` 取父節點、既有 child IDs、預期新增數量與類型、logicalKey。
2. 唯讀讀取父節點：比對 child IDs 前後差異；在父節點範圍內找帶相同 `runId`／`operationId`／`logicalKey` 標記的節點（`snippets/mark-owned.js` 的 `figmaUiFindOwned`），再退回名稱＋類型＋結構比對。
3. 只有候選唯一且類型、結構、內容都符合意圖時，才記 `node scripts/operation-journal.mjs reconcile <run-id> '{"operationId":…,"outcome":"applied","evidenceRefs":["rd-…"],"createdNodeIds":[…]}'`。
4. 確定沒有副作用（父節點完全沒變、沒有帶標記的節點）才記 `failed_known`，然後建新的 attempt（新 operationId）。
5. 多個候選、部分建立、有協作者新增、或證據不足 → 保持 unknown，保留現況並詢問；不刪、不重建。

## `use_figma` 錯誤

- 回應含 `safeToRetryWithoutCanvasRead: true` → 修正後可重試（新 attempt）；`false`、缺欄位或無法判讀 → 先唯讀讀畫布再決定（§11.5）。觀察到的值記入 operation 與 capabilities（目前尚未在真實失敗中觀察到）。
- 同類錯誤重複 → 停止該步、查根因，不拆成更多無效呼叫。
- permission denied／OAuth 過期 → `blocked`，照 Preflight 的恢復步驟；rate limit → 依回應退避，保存恢復點。

## hook 阻擋

| 原因 | 做法 |
|---|---|
| missing op header | 第一行補 `// figma-ui run=<run-id> op=<id> mode=…` |
| brief not confirmed / fileKey 非授權 output | 回 Intake 取得授權；不能寫到其他檔案 |
| lock not held | `state-store.mjs activate`；被他人持有就問 |
| not planned / basisRefs 空 / mode 或 fileKey 不符 | 用 `operation-journal.mjs plan` 補正確的 planned 紀錄 |
| unresolved writes | 先對帳 |
| read uses a write operationId | 換成獨立的 `rd-` id |
| truncated journal | 對帳後才能寫 |

**不得繞過 hook**、改用其他工具寫入，或刪掉 `active-run.json` 來解除阻擋。

## 本機鎖（P0 簡化版）

`.figma-ui/locks/<fileKey>.json`，O_EXCL 取得、owner token 相符才釋放。持有者程序已不存在時也不自動搶鎖：先讀其 journal，有 dispatched／unknown_outcome 就先對帳，確認沒有未知寫入後詢問使用者是否接手。heartbeat 與 PID 重用檢查屬 P1。
