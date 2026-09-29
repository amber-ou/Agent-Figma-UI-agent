# Handoff（spec v1.6 §2.3、§15）

## 順序

1. 確認沒有 `dispatched`／`unknown_outcome`；applied 的 write 都已讀回並 verified；`pendingQuestions` 為空，或誠實保留（此時結果會是 `awaiting_user`）。
2. 有 `audit.metrics.propertyBindings` 時：`node scripts/quality-metrics.mjs token-binding design-runs/<run-id> --write`。
3. `node scripts/evaluate-completion.mjs design-runs/<run-id> --write`：唯一的最終判定入口，已包含完整 schema 與跨檔驗證，**不必再另外跑 validator**。它寫回 `audit.completionEvaluation`（含 `inputDigest`）與 `ledger.status`。**不要手動填 complete。**之後任何資料變動都要重跑。
4. 使用者若把未通過的 run 接受為測試成功：先把使用者的決定記入 `plan.decisions`，重跑第 3 步，再 `evaluate-completion.mjs … --accept-test-run <decisionRef> <說明>`。它只寫 `ledger.userAcceptance`，`ledger.status` 與 `completionEvaluation` 不變（INVARIANT-17）。
5. `node scripts/run-report.mjs handoff <run-id> --write`：從 artifacts 組出 `design-runs/<run-id>/handoff.md`。判定過期時它會拒絕，先回第 3 步。
6. `node scripts/state-store.mjs release <run-id>`。
7. 回報使用者：狀態、連結、未驗證與待決項目、下一步。implementation 與 integration 狀態分開說。

## handoff.md 的內容（自動產生，不要手寫同一份事實）

主文只有：

1. **完成判定**（與 evaluator 一致）與使用者接受（若有，註明「接受為測試成功不等於 complete」）。
2. **Figma 連結**：輸出檔案與本 run 建立或修改的主要節點。
3. **交付範圍**：畫面，以及每個 requiredCell（viewport · state · mode）對應的證據；缺的標「缺」。
4. **必要互動與狀態**：flow 程度、步驟、分支、結束方式與目的地。
5. **驗證結果**：覆蓋率、gates、tokenBinding、findings 與已接受例外；註明 Design QA 尚未接入，驗證由 UI agent 完成。
6. **待決與未驗證**：待答問題、未回答或 skipped 的設計決策、flow 待確認、open findings、fail／not_verified 的 gates、判定原因、實作層待驗項目。精簡不能讓這些消失。
7. **下一步**。

之後附兩段短資料：**依據**（指向 brief、plan、inventory、audit、operations.jsonl，不重抄資源與操作細節）與**量測**（階段時間、讀／寫／截圖次數、工具時間、截斷、失敗、重試、提問輪數、使用者等待時間、實質決策數；沒有紀錄的標 unknown，不填 0）。

Code Connect、Storybook 與 agent 開發里程碑不列在一般 handoff；只有本次交付確實相關時才另外補充。不另外輸出前端專案，除非使用者要求。
