# 設計決策一律詢問（spec §7.4）

使用者已確認：agent 不自行決定「怎麼做出好設計」。

## 什麼是設計決策（DEC-01）

會影響外觀、資訊層級或使用體驗，且**沒有被下列任一來源明確決定**的選擇：本次使用者指示、已確認的 brief／先前決策、指定 DS（元件、variables、styles）、已盤點並在 plan 確認的既有 pattern、**本產品的產品政策**（v1.7，`references/product-policy.md`）。不確定時當作是設計決策。

必問範例（DEC-02，非完整清單）：漸層、陰影、插圖、背景裝飾；強調色或狀態色的位置；DS 未涵蓋的間距、圓角、字級；多個候選元件；表格或卡片、分頁或 tab 等結構取捨；長文字換行或截斷；空狀態與錯誤狀態的呈現與文案語氣；圖示；響應式時隱藏或收合什麼；修正視覺缺陷有多種合理修法；按鈕等文案。

不必逐項問（DEC-03）：直接由 DS、pattern、指示或產品政策推得的操作（例如沿用既有 section 間距 variable、使用 DS 的 Primary Button、產品政策說不檢查對比）。這些記為 `source: ds | existing_pattern | brief | product_policy`、`status: answered` 的 designDecision（附 `evidenceRefs`；`product_policy` 必須附 `policyRef`，例如 `aiwow#policies/accessibility.contrast`），在 plan 確認時**一次列出摘要**，不建成待答問題，也不在 continue／resume 時重問。

## 問題格式（DEC-04）與預填清單（DEC-09，v1.7）

v1.7 起，同一階段所有待決的設計決策，以及要使用者回答的範圍與授權問題，**一次列成一份預填清單**（取代 v1.6 的「每輪 1–3 題」）。

- **先找候選再提問**：在 DS、參考畫面與已盤點的元件中找 2–3 個候選，附節點連結；真的找不到才寫「沒有候選」並說明搜尋範圍。
- 不預先準備固定題庫或固定輪數；只問這次真的沒被決定、而且會影響設計的事。產品政策已決定的項目**不出現在清單**，只在 intake 摘要列一行「已套用產品政策：…」。
- 每列：編號、問題（含情境與選項摘要）、答案欄。
  - agent 有建議 → 答案欄填建議並標「**建議，請確認**」。
  - 沒有建議，或屬品牌、產品方向、文案內容、個資等只有使用者能判斷的事 → 答案欄**留空**。
- 產品政策題（DEC-10）排在最前面，標「產品政策」。
- 送出清單時記 `node scripts/run-report.mjs ask <run-id> <列數> --prefilled <預填列數> --blank <留空列數>`，收到回覆記 `answered`（量測提問成本；預填與留空分開計）。

清單範例：

| 編號 | 問題 | 答案 |
|---|---|---|
| pol-1 | **產品政策**：Neo 的 design system 要遵守對比（WCAG）規則嗎？（是：之後每個 run 都檢查；否：之後不檢查也不再問） |  |
| dec-101 | 空狀態版面：A 照 04-01 只放圖示＋標題；B 再加說明＋主按鈕 | B（建議，請確認） |
| dec-102 | 空狀態文案（標題、說明、按鈕） |  |

### 確認方式

- 使用者確認前，所有列都是 `pending`：預填值只存在 `recommendation`，`answer` 為 `null`，**不能被 write 引用**（DEC-05、DEC-08）。
- 使用者可以一次確認全部預填，也可以逐列修改或填寫。確認後 `answer` 為最後的值、`source: user`、`status: answered`、`decidedAt` 有值，並以 `confirmation` 記錄方式：

  | confirmation | 意思 |
  |---|---|
  | `prefilled_confirmed` | 照預填確認 |
  | `user_modified` | 改了預填 |
  | `user_filled` | 填了留空的列 |

- 留空的列 agent **不得自行填入**；使用者表示略過 → `status: skipped`。沒回覆不代表同意。

## 產品政策題優先（DEC-10，v1.7）

「整個產品是否遵循某項規則」的問題是產品政策題，v1.7 只有一題：**對比規則**（是否依 WCAG 對比門檻檢查，§9.5）。

- 產品政策檔還沒有 `accessibility.contrast` 時，在第一個需要它的 run，於 Intake 或 Plan、其他設計決策之前提出，列在清單最前面並標「產品政策」（`run-context.mjs` 會把它排在 `ask` 的最前面）。
- 使用者的回答先記成本 run `plan.decisions` 的一筆（`source: user`），再 `node scripts/product-policy.mjs write <run-id> <productId> '{"action":"add","target":"policies/accessibility.contrast","value":{"required":false},"origin":"policy_question","decisionRef":"dec-…"}'`。之後該產品的 run 不再問；回答「否」也一樣。
- 測試回合「只限本輪」的回答（例如 M4 的 dec-005「這輪對比不擋」）是本 run 的決策：記 `runOnly: true`，**不是**政策題的回答，不寫入政策檔。
- 新增政策題要修訂規格。

```text
【設計決策 dec-00N】<畫面>／<元件或區塊>
<為什麼 DS／pattern 無法決定，附既有畫面節點連結>
選項：
1. <選項>：<視覺差異與取捨>
2. <選項>：<視覺差異與取捨>
3. <選項>：<視覺差異與取捨>
建議：<編號>（僅供參考，請你決定）
```

## 記錄與強制（DEC-05、DEC-06）

- 寫入 `plan.designDecisions`：`id`、`question`、`options`、`recommendation`（可 null）、`answer`（未回答為 null）、`source`（只能是 `user | ds | existing_pattern | brief | product_policy`；`product_policy` 必須附可解析的 `policyRef`）、`evidenceRefs`、`decidedAt`，以及 v1.7 的選填 `confirmation`。
- `designDecisions` 與 `plan.decisions`（範圍、授權、例外）分開存，但共用 ID 命名空間。
- 每個 write operation 的 `basisRefs` 必須引用依據。`operation-journal.mjs plan` 與 validator 會拒絕無法解析或引用未回答決策的 basisRefs。
- 未回答不代表同意。受影響的 section 不得寫入；Build／Validate 中途出現新決策 → 暫停相依寫入並詢問，不先做再問。
- 使用者先前的決策互相衝突時（例如「要等寬」與「保留新版 icon」），不自行取捨，列出衝突與選項再問。

## 決策狀態（DEC-08，v1.4）

每筆 designDecision 帶 `status`：

| status | answer | 可以當 write 的 basisRef？ |
|---|---|---|
| `pending` | `null` | 否（INVARIANT-11） |
| `answered` | 非空字串，`decidedAt` 有值 | 是 |
| `skipped` | `null` | 否；對應元素**不得出現在畫布上** |

`pending` 或 `skipped` 的決策會讓 `evaluate-completion` 回 `awaiting_user`（G7）。舊 plan 沒有 `status` 時，由 `answer` 推定。

## 授權採用建議（DEC-07，v1.4）

使用者可以對某個 run 說「設計決策一律採用你的建議」（例如測試 run）。

1. 把授權記進 `plan.decisions`（例如 `dec-006`：「本 run 的設計決策採用 agent 建議；沒有建議的題目略過」）。
2. 每題仍照上面的格式產生選項與建議。
3. 有建議的題目：

   ```json
   {"id": "dec-102", "recommendation": "check", "answer": "check", "source": "user", "status": "answered",
    "decidedAt": "<時間>", "delegation": {"decisionRef": "dec-006", "scope": "run", "runId": "<本 run>"}}
   ```

4. **沒有建議的題目不得自己回答**：`status: "skipped"`、`answer: null`，相關元素不建立，run 結束時一次列給使用者。
5. 授權只對這個 run 有效。`continue <run-id>` 沿用；開新 run 必須重新取得（INVARIANT-01、INVARIANT-18）。validator 會拒絕 `delegation.runId` 與 plan 不同、或 `decisionRef` 不在 `plan.decisions` 的紀錄。授權本身記 `runOnly: true`：它和用授權回答的題目都不會列成產品政策建議（POL-05）。
6. v1.7：授權等同「本 run 的預填清單一律確認」（DEC-09）；**留空的列仍要使用者回答**，否則為 `skipped`。
7. 硬性門檻不因授權豁免。建議若會造成 G5 對比失敗，Plan 階段就要指出（`references/design-quality.md` 的可及性預檢），不能做完才發現。
