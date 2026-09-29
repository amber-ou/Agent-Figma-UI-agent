# Handoff（spec §2.3、§6.5、§15）

## 順序

1. 確認所有 write 都是 `verified`、沒有 `dispatched`／`unknown_outcome`；`pendingQuestions` 為空，或誠實保留（此時結果會是 awaiting_user）。
2. `node scripts/quality-metrics.mjs token-binding design-runs/<run-id> --write`（有 `audit.metrics.propertyBindings` 時）。
3. `node scripts/evaluate-completion.mjs design-runs/<run-id> --write`：先做 schema 與跨檔檢查，再依 §12.1 計算，寫回 `audit.completionEvaluation` 與 `ledger.status`。**不要手動填 complete。**
4. 使用者若把未通過的 run 接受為測試成功：先把使用者的決定記入 `plan.decisions`，再 `node scripts/evaluate-completion.mjs design-runs/<run-id> --accept-test-run <decisionRef> <說明>`。它只寫 `ledger.userAcceptance`，`ledger.status` 與 `completionEvaluation` 不變（INVARIANT-17）；之後重新評估也不會因此變成 complete。
5. 寫 `design-runs/<run-id>/handoff.md`（見下）。
6. `node scripts/state-store.mjs release <run-id>`。
7. 回報使用者：狀態、連結、例外、未驗證項、下一步。implementation 與 integration 狀態分開說。

## handoff.md 必須包含

1. 任務目的、`ledger.status`、run ID、spec 版本（v1.4，schemaVersion 1.2）。
2. **完成判定與使用者接受分開列**（§2.3）：`completionEvaluation.result` 與 reasons；若有 `userAcceptance`，寫明它的 decisionRef、說明與時間，並註明「接受為測試成功不等於 complete」。validator 會檢查 handoff 同時出現兩者。
3. Figma 檔案、page、主要節點的可開啟連結（`https://www.figma.com/design/<fileKey>/?node-id=<id 的 : 換成 ->`）。
4. requiredCells 索引與對應 evidence（設計：畫面／尺寸／狀態／模式；audit：檢查項）。audit 報告完成不代表受查設計合格。
5. 資源沿用報告（§6.5）：用到的 libraries；沿用的主元件（set key、variant、以 key 匯入或從既有 instance 取得）與 instance IDs；variable collections／modes；沿用的 styles；tokenBinding（variable binding 與 style 套用分開、raw 值與例外、原比例）；新增項與授權依據；沒用的候選與理由；無法解析的資源（gaps）；元件版本差異；未安裝字型。
6. 互動說明：trigger、狀態變化、目的地、錯誤恢復、focus 行為。
7. Responsive 規則與長內容策略（含未確認的 pattern 限制與其狀態）。
8. 圖片／圖示來源與限制；品牌名稱與 logo 依使用者指定（REQ-04）。
9. audit 結果：gates、findings（引用 ID，不另抄一份）、已接受例外與 decisionRef、baseline 觀察、可及性預檢結果、實作層未驗證項。
10. **仍開啟的項目**：open findings、`pendingQuestions`、`skipped` 的設計決策（DEC-07：沒有建議而略過、未建立的元素）。
11. Code Connect mapping 狀態（沒有就寫 N/A）。
12. 恢復方式與下一步。

不另外輸出前端專案，除非使用者要求。
