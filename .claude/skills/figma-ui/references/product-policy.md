# 產品政策（spec v1.7 §4.6、§7.5）

產品政策是**單一產品長期有效、使用者明確決定的規則**，例如對比政策。它是記憶分層的第 2 層：所有該產品的 run 自動套用，但只有使用者能改。

## 1. 四層各放什麼（§4.6）

| 層 | 放什麼 | 位置 |
|---|---|---|
| 1 通用規則 | agent 怎麼工作 | 規格、skill、`CLAUDE.md`（只放通用機制，不放任何產品的具體規則） |
| 2 產品政策 | 某產品長期有效的規則 | `product-policies/<productId>.json`（進 git）；網址與 fileKey 另存 `.figma-ui/products/<productId>.local.json`（本機） |
| 3 每次需求的記憶 | 本次需求、計畫、決策、只限本次的規則與授權、過程中提到的偏好 | `design-runs/<run-id>/` |
| 4 本機執行狀態 | 鎖、目前的 run、hook 紀錄、環境診斷 | `.figma-ui/` |

- 第 3 層**不會自動變成**第 2 層。過程中提到、可能長期適用的偏好，先記在本 run 的 `plan.decisions`，加上 `policySuggestion: { text, appliesTo }`，Handoff 時列成政策建議，由使用者決定。
- 只限本次的設定（測試回合規則、DEC-07 授權）記 `runOnly: true`。它們**不會**列成建議，也不能寫入政策。
- **不寫 Claude Code 自己的記憶**（INVARIANT-26）：任何 run 決策、只限本次的規則、產品政策，都不得寫進 `~/.claude/projects/<project>/memory/`、`CLAUDE.md` 或其他會自動載入的檔案。

## 2. Intake：確定產品 → 套用政策（REQ-05、POL-02、POL-03）

1. 需求寫了產品就採用；**沒寫就問**。不從上次 run、目標檔案或參考畫面推定（參考畫面可能混有其他品牌，REQ-04）。
2. `node scripts/product-policy.mjs apply <run-id> <productId> [--source request|user_answer]`：
   - 寫入 `brief.product`（`productId`、`policyDigest`、`appliedPolicies`），並把「product (REQ-05)」從 `openQuestions` 移除。
   - 回傳 `intakeLine`，原樣放進 intake 摘要，例如「已套用產品政策：Aiwow — 對比：不適用（不檢查、不詢問對比；其他可及性項照常）」。
3. 沒有政策檔：問使用者是否建立新產品。確認後先把回答記成 `plan.decisions` 的一筆，再執行 `product-policy.mjs init <run-id> <productId> <名稱> --decision <decisionRef>`。新檔只有 `productId` 和 `displayName`，沒有任何政策。
4. `product-policy.mjs show <productId>` 可以看目前的政策、套用摘要和待問的政策題。
5. 政策已決定的設計決策記為 `source: "product_policy"` 並附 `policyRef`，不放進預填清單。
6. 本次需求的明確指示和政策衝突時，**以本次指示為準，只對本 run 有效**。在 `plan.decisions` 記下，加上 `policySuggestion.conflictsWith: "<policyRef>"`，Handoff 時列成建議。

`run-context.mjs <run-id> new|continue` 的輸出：
- `ask` 最前面依序是：產品（還沒確定時）、政策題（DEC-10）、library（REQ-06）。
- `applied` 列出已套用的政策。
- `notices` 是提示，例如 v1.7 前建立的 run、政策在 run 期間被改過。

## 3. 產品政策題（DEC-10）

- v1.7 只有一題：**對比規則**（`accessibility.contrast`）。
- 政策檔沒有這一項時，在第一個需要它的 run，把它排在預填清單最前面並標「產品政策」。
- 使用者回答後：
  1. 把回答記成 `plan.decisions` 的一筆（`source: "user"`）。
  2. 寫入政策檔：

     ```bash
     node scripts/product-policy.mjs write <run-id> <productId> '{"action":"add","target":"policies/accessibility.contrast","value":{"required":false},"origin":"policy_question","decisionRef":"dec-…"}'
     ```

  3. 它會附加一筆 `history`，並在 `plan.decisions` 自動加一筆 `dec-pol-N`（帶 `policyRef`）。
- 之後該產品的 run 不再問；回答「否」也一樣不再問。

## 4. 對比政策的效果（§9.5、§12.1）

`accessibility.contrast.required = false` 時：

- Plan 的可及性預檢**不放對比項**（`text_contrast`、`non_text_contrast`）；Validate 不產生對比 finding。validator 會拒絕這兩種項目。
- `audit.gates` 的 G5 記錄依政策不適用的對比，其他可及性項（點擊區、focus、狀態公告）照常決定 G5：

  ```json
  {"id": "G5", "status": "pass", "contrast": {"status": "not_applicable", "policyRef": "aiwow#policies/accessibility.contrast"}, "evidenceRefs": ["…"]}
  ```

- Handoff 自動註明「依產品政策未檢查對比」。
- 政策為 `true` 或尚未決定時，照 §9.5 檢查，G5 對比是硬性門檻；尚未決定時先問政策題。
- 產品政策**不能**放寬寫入保護、hooks、journal、完成判定的程序條件，也不能取代本次的輸出授權、帳號與工具確認（POL-06）。

## 5. Handoff：政策建議（POL-05）與寫入（POL-04）

- `node scripts/product-policy.mjs suggest <run-id>` 列出建議。handoff 第 11 項會自動帶出，形式是可勾選的 `- [ ] ps-N：…`。
- 建議的來源有三種：
  - `plan.decisions[].policySuggestion`：使用者在過程中提到的偏好，或和政策衝突的本次指示。
  - 在同產品其他 run 出現過的相同問題與相同答案。
- 排除：`runOnly: true` 的決策、DEC-07 授權回答的題目。
- 寫入政策只有兩種途徑：使用者回答政策題，或使用者在 handoff 勾選建議（或明確指示「把某規則寫進某產品政策」）。
- 寫入前先把將寫入的內容給使用者看。
- `product-policy.mjs write` 的檢查：
  - 必須有本 run `plan.decisions` 中 `source: user`、不是 `runOnly` 的 `decisionRef`，否則拒絕。
  - 寫入前驗證政策檔和本 run 的決策紀錄，任一不合格就什麼都不寫。
  - `history` 只能附加。
- 沒勾選的建議只留在本 run，政策檔不變。

## 6. 政策檔的檢查（§20）

`node scripts/product-policy.mjs validate [productId…] [--against-git]` 檢查以下項目：

- schema 符合 `schemas/product-policy.schema.json`（schemaVersion `1.0`）。
- `productId` 和檔名一致。
- 每個政策和規則都有 `decidedBy: "user"`、`decidedAt`、`origin`。
- 規則 ID 不重複。
- **不含** `figma.com` 網址或 `fileKey`／`fileUrl` 欄位（repo 是公開的）。
- 每個項目都能在 `history` 找到來源。
- 加 `--against-git` 時，和 `HEAD` 比對，確認 `history` 只有附加。

本機檔 `.figma-ui/products/<productId>.local.json` 只驗證格式（`schemas/product-local.schema.json`）。它記錄的 library 和檔案**只是預填候選**，本次仍要確認與授權（REQ-06）。

run 的 `policyRef` 必須解析到政策檔中存在的項目，而且屬於本 run 的產品。`brief.product.policyDigest` 和目前政策檔不同時，validator 會提示政策在 run 期間改過，需要重新確認套用結果。
