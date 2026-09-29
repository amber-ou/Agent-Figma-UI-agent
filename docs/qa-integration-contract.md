# Design QA agent 接入契約（階段 B，**未就緒**）

日期：2026-09-29 · spec v1.6 §16.3 · 狀態：`not_ready`

使用者將另建獨立的 Design QA agent。本文件只定義接入條件與交接格式；**現在不啟用**。在就緒條件全部成立之前，UI agent 維持目前全部適用驗證（完整視覺評論、狀態矩陣、可及性等），不把交付改成「待 QA」，也不得把 QA 未執行寫成 `not_applicable` 或 `pass`。

## 1. 就緒條件（全部成立才啟用）

1. 有可實際執行的 QA 入口（skill、agent 或指令），不是只有設計文件。
2. QA 能讀取本文件第 3 節的交付包。
3. QA 回傳結構化 findings（第 5 節格式）到獨立結果檔。
4. 有同一交付版本的「審查 → 修正 → 複驗」紀錄至少一次。

2026-09-29 查核：專案內沒有 QA 入口、交付包產生器的 QA 版本、QA 結果檔或複驗紀錄 → **未就緒**。

## 2. 啟用後的狀態模型

- 分開「可送審」與「完成」：UI agent 完成自有檢查後為 `ready_for_qa`；QA 結果為 `pending | passed | changes_required | blocked`。
- 仍只有**一個**最終完成判定（evaluator）：QA 結果是它的輸入之一。schema、validator、evaluator 同步修改。
- QA 未執行 ≠ 通過；已有版本的 QA 結果不得自動套用到更新後的畫面（以交付版本比對）。

## 3. 交付包（由既有資料產生，不另手寫）

| 內容 | 來源 |
|---|---|
| runId、交付版本（`completionEvaluation.inputDigest`、最後 verified 的 write） | audit、operations.jsonl |
| Figma 檔案與節點連結 | brief.output、ledger.entities |
| brief／plan／flow 的引用（任務、畫面、requiredCells、決策） | brief.json、plan.json |
| 變更範圍 | journal 的 created／mutated／scopeRootIds |
| 有效證據（current、指名 cellKeys） | audit.evidence |
| 待決事項 | pendingQuestions、未回答決策、flow unknowns、open findings |

## 4. 分工（啟用後）

| 移轉給 QA | 仍由 UI agent 負責 |
|---|---|
| 完整視覺評論、跨畫面一致性 | 製作前品質預檢（可及性預檢、字型、版本差異） |
| 長內容、響應式、狀態矩陣的完整審查 | 操作確認：每個 write 的獨立讀回與 verify |
| 完整設計可及性審查 | 基本看圖（每個 composition） |
| 獨立 audit 任務 | 自有變更的正確性與全部寫入保護（hooks、鎖、guard、對帳） |

QA 初期**唯讀**：以獨立結果檔寫 findings，不與 UI agent 同時寫同一份 audit／ledger；開始前先確認交付版本仍相符。

## 5. Finding 格式

每筆 finding：節點／畫面、觀察、預期與依據（DS、pattern、決策或準則）、嚴重度、證據、是否需要設計決策。修正後依影響範圍重驗（沿用 evidence 失效規則，spec §12.1 v1.6）。
