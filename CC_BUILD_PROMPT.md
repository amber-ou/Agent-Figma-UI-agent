# 交給 Claude Code 的建置指令

版本：1.7 · 修訂日期：2026-10-02 · 配套規格：FIGMA_UI_AGENT_SPEC.md v1.7

本檔只放**目前這一版**的建置指令。M0–M4 的指令已執行完畢，保留在 `docs/history/build-prompts-m0-m4.md`。

## v1.7 建置指令：產品政策、記憶分層、預填清單

把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.7 實作產品政策與預填清單。先讀第 20.3 節（v1.7 變更紀錄），再讀第 4.6、7.1（REQ-05／06）、7.4（DEC-09／10）、7.5、9.5、12.1、15、20 節與第 13.2 節的 T64–T71。`product-policies/aiwow.json` 已存在，是使用者決定的內容：可以為了符合 schema 調整格式，**不得改變政策內容**。

**第一部分：離線實作**（不連 Figma）

1. **產品政策契約**：新增 `schemas/product-policy.schema.json`（schemaVersion `1.0`），依第 20 節的檢查實作驗證，包括拒絕 `figma.com` 網址與 `fileKey`／`fileUrl` 欄位、`history` 只能附加。用它驗證 `product-policies/aiwow.json`。
2. **`scripts/product-policy.mjs`**：
   - 讀取政策檔，以及本機的 `.figma-ui/products/<productId>.local.json`（可能不存在）。
   - 把套用結果寫入 `brief.product`（productId、policyDigest、appliedPolicies）。
   - 依 POL-05 從 run 產生政策建議清單，排除只限本次的設定（測試回合規則、DEC-07 授權）。
   - 只在有使用者回答或確認的 decisionRef 時寫入政策，並附加 history（POL-04）。
3. **run artifacts**：
   - brief：新增選填的 `product`。
   - plan：designDecisions 的 `source` 新增 `product_policy`（必須有可解析的 `policyRef`），以及選填的 `confirmation`（`prefilled_confirmed | user_modified | user_filled`）。
   - schemaVersion 維持 `1.2`。v1.7 前建立、沒有 `product` 的 run 只提示，不拒絕。
4. **完成判定**：G5 的對比項可依產品政策的 `policyRef` 判為 not_applicable，其他可及性項照常（第 9.5、12.1 節）。規則改了，`RULE_VERSION` 改為 `12.1@1.7`。
5. **`run-context.mjs`**：
   - 回報產品未知或 library 未提供時要先問（REQ-05／06）。
   - 產品政策缺對比政策時，把政策題列在最前面（DEC-10）。
   - 已由政策決定的項目列為已套用，不列入待答。
6. **`run-report.mjs`**：
   - handoff 加第 15 節第 11 項：本 run 套用的政策與政策建議；沒有建議時寫「無」。對比依政策未檢查時，handoff 要註明。
   - 提問紀錄把預填與留空的列數分開計。
   - `SPEC_VERSION` 改為 `1.7`。
7. **Skill**：
   - 更新 `SKILL.md` 與 `references/design-decisions.md`：預填清單的格式與確認方式（DEC-09）、政策題優先（DEC-10）。
   - 新增 `references/product-policy.md`。
   - Intake 流程：確定產品（沒寫就問）→ 載入政策 → 列一行「已套用產品政策：…」→ 確認 library（沒提供或找不到就問）。
   - 寫明不得把 run 決策或政策寫進 Claude Code 的自動記憶或 `CLAUDE.md`（INVARIANT-26）。
8. **字型比對**（M4 發現 8）：Discover 的字型比對要涵蓋準備使用的元件內部實際使用的字型（第 10.3 節）。
9. **測試**：T64–T71 的離線測試；既有 125 個測試維持通過。
10. **文件**：`docs/setup.md`、`docs/runbook.md` 補上：
    - 本機 `.figma-ui/products/<productId>.local.json` 的用途與換電腦時要補的內容；
    - 怎麼新增一個產品；
    - 怎麼看、怎麼改產品政策（只經使用者回答或確認）。

**第二部分：一次真實驗證**（sandbox 頁，簡短即可）

先把測試內容的草案列給我確認，再開始。至少要涵蓋：

- 需求沒寫產品時，agent 會先問；
- 寫了 Aiwow 時自動套用對比政策、不問對比；
- 設計決策以預填清單呈現；
- Handoff 列出政策建議，我沒勾選時政策檔不變。

這是測試回合，設計決策以建議為主，無法決策的先略過並在最後告訴我。

**本次不做**：fingerprint fp2、工具耗時缺口與 session unknown 的修正（先查原因）、原任務 B／C、gap-001（等我提供 library）。

限制照舊：
- hooks 放行不得輸出 `allow`；
- read 用獨立 operationId；唯讀腳本不建立暫時節點；
- 腳本存取節點屬性前先依 `node.type` 分流（INVARIANT-19）；
- 回傳上限以位元組計；
- 每個 run 結束釋放鎖；
- 未驗證的推論標為假設；
- 變更推到新分支 `feat/v1.7`，不要直接推 main。

完成時交付：
- 已建立與修改的檔案、測試結果；
- 真實 run 的判定與截圖；
- 未做項目與原因；
- 總結寫進 `docs/history/v1.7-summary.md`。

---
