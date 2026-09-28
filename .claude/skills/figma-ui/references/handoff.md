# Handoff（spec §6.5、§15）

## 順序

1. 確認所有 write 都是 `verified`、沒有 `dispatched`／`unknown_outcome`；`pendingQuestions` 為空，或誠實保留（此時結果會是 awaiting_user）。
2. `node scripts/evaluate-completion.mjs design-runs/<run-id> --write`：先做 schema 與跨檔檢查，再依 §12.1 計算，寫回 `audit.completionEvaluation` 與 `ledger.status`。**不要手動填 complete。**
3. 寫 `design-runs/<run-id>/handoff.md`（見下）。
4. `node scripts/state-store.mjs release <run-id>`。
5. 回報使用者：狀態、連結、例外、未驗證項、下一步。implementation 與 integration 狀態分開說。

## handoff.md 必須包含

1. 任務目的、`ledger.status`、run ID、spec 版本（v1.3，schemaVersion 1.2）。
2. Figma 檔案、page、主要節點的可開啟連結（`https://www.figma.com/design/<fileKey>/?node-id=<id 的 : 換成 ->`）。
3. requiredCells 索引與對應 evidence（設計：畫面／尺寸／狀態／模式；audit：檢查項）。audit 報告完成不代表受查設計合格。
4. 資源沿用報告（§6.5）：用到的 libraries；沿用的主元件（set key、variant）與 instance IDs；variable collections／modes；新增項與授權依據；沒用的候選與理由；無法解析的資源（gaps）；元件版本差異。
5. 互動說明：trigger、狀態變化、目的地、錯誤恢復、focus 行為。
6. Responsive 規則與長內容策略（含未確認的 pattern 限制與其狀態）。
7. 圖片／圖示來源與限制。
8. audit 結果：gates、findings（引用 ID，不另抄一份）、已接受例外與 decisionRef、baseline 觀察、實作層未驗證項。
9. Code Connect mapping 狀態（沒有就寫 N/A）。
10. 恢復方式與下一步。

不另外輸出前端專案，除非使用者要求。
