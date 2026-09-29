# 與使用者同時編輯（spec §11.2）

使用者可能在 agent 工作時編輯同一個檔案。目標：偵測衝突、**絕不覆寫使用者的改動**、讓使用者看得到 agent 在哪裡工作。Figma 沒有 agent 可取得的編輯鎖；本機鎖只擋本專案的其他程序。

## 工作區

- 每個 run 在 output 頁空白處建一個 Section：`figma-ui / <run-id>`。新畫面都放在裡面。
- agent 只寫自己建立的節點，以及 `modify` 任務中使用者明確指定的範圍。

## 所有權與 fingerprint

- 建立根節點的同一腳本內寫所有權標記（`snippets/mark-owned.js`）：`runId`、`operationId`、`logicalKey`、`agentFingerprint`。子節點依根節點判定。
- fingerprint 只在 Figma 端用 `snippets/fingerprint.js` 計算；本機只保存最後一次 agent 驗證的值（ledger entity `agentFingerprint`、operation `fingerprint`）。
- 修改既有 agent 節點：腳本開頭跑 `snippets/precondition-guard.js`，與最後驗證值比對；不一致就回傳 conflict、不改任何東西（INVARIANT-12）。

## 偵測到使用者改動

| 情況 | 做法 |
|---|---|
| 使用者改了 agent 建立的節點（`user_modified`） | 視為使用者的決定：不覆寫、不還原。回報差異並問：採納（更新 plan 與 fingerprint 基準）或怎麼處理 |
| Section 或 agent frame 內出現新節點（`user_added_nodes`） | 保留，不移動、不刪除；回報並問是否納入範圍 |
| agent 節點被刪除（`deleted`／`user_removed_nodes`） | 不自動重建；詢問 |
| 改動影響已驗證的 requiredCell | 在 ledger 該 entity 記 `userChangeDetectedAt`；該格 evidence 改 `superseded`，重驗前不能宣稱完成（validator 會把之前擷取的證據判為過期） |

多個節點帶相同所有權標記（使用者複製過）→ 多義，停下來問，不挑一個刪。

## 暫停與交棒

使用者說「暫停」：完成或對帳目前的 operation 後停止寫入，釋放鎖。恢復時先讀回 Section 範圍並對帳（`references/recovery.md`）。

在 Section 名稱顯示「agent 編輯中」屬 P1，目前不做。
