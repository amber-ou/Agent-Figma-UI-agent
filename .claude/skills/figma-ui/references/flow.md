# Flow 判斷（spec v1.6 §8.2）

Flow 的用途是**消除會影響設計的需求歧義**，不是每次都要畫流程圖。依「操作是否有歧義」與「變更影響多大」判斷，**不看畫面數量**。

## 三種程度（`plan.flow.level`）

| level | 什麼時候 | 要記什麼 |
|---|---|---|
| `unchanged` | 沿用既有流程不變：局部樣式、文案、間距修改；在既有 pattern 上延伸、操作與去向都不變 | `reason`（為什麼不需要整理流程）；`sources` 可為空；`confirmedBy: "brief"` |
| `partial` | 只有局部新增或改變：新按鈕、新狀態、新分支 | 只寫改變的步驟（`steps`），加上來源 |
| `task_flow` | 多步驟任務、有必要分支或跨畫面 | 入口、操作、結果、必要分支、結束方式，以及每一步對應的畫面／狀態 |

最小紀錄（必填）：`level`、`reason`、`sources`、`status`；確認後加 `confirmedBy`（`brief` 或 `user`＋`decisionRef`）。

## 規則

- 局部樣式修改不做流程訪談：記 `unchanged` 與理由就好。
- 新按鈕的目的不明確 → 只問這一題：記為 `unknowns[]`（`status: open`），相關畫面在答覆前不建立。回答後填 `answer` 與 `decisionRef`。
- **不自行補業務規則**（例如失敗後要不要重試、多久後關閉）。未知就標待確認。
- 沒有適用的既有 flow 時**不偽造來源**；`partial`／`task_flow` 至少要有一個真實來源（brief、使用者、pattern、參考節點或決策）。
- 每一步的 `screenKey` 要在 `plan.screens`，`state` 要有對應的 requiredCell；分支的 `to` 要指向存在的步驟。validator 會檢查。
- Build 前 `flow.status` 必須是 `confirmed`、沒有 open 的 unknowns（`--stage build` 與 `operation-journal plan` 會擋）。

## 例子

```json
{"level": "unchanged", "reason": "只改卡片內距與標題字級，操作與去向不變", "sources": [], "status": "confirmed", "confirmedBy": "brief"}
```

```json
{"level": "partial", "reason": "新增「分享」按鈕", "sources": [{"kind": "brief", "ref": "goal"}], "status": "pending",
 "steps": [{"id": "st-1", "action": "點「分享」", "result": "開啟分享面板", "screenKey": "card", "state": "default"}],
 "unknowns": [{"id": "fq-1", "question": "分享失敗時要顯示什麼？", "status": "open"}]}
```
