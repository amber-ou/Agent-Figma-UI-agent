# 設計決策一律詢問（spec §7.4）

使用者已確認：agent 不自行決定「怎麼做出好設計」。

## 什麼是設計決策（DEC-01）

會影響外觀、資訊層級或使用體驗，且**沒有被下列任一來源明確決定**的選擇：本次使用者指示、已確認的 brief／先前決策、指定 DS（元件、variables、styles）、已盤點並在 plan 確認的既有 pattern、**本產品的產品政策**（v1.7，`references/product-policy.md`）。不確定時當作是設計決策。

必問範例（DEC-02，非完整清單）：漸層、陰影、插圖、背景裝飾；強調色或狀態色的位置；DS 未涵蓋的間距、圓角、字級；多個候選元件；表格或卡片、分頁或 tab 等結構取捨；長文字換行或截斷；空狀態與錯誤狀態的呈現與文案語氣；圖示；響應式時隱藏或收合什麼；修正視覺缺陷有多種合理修法；按鈕等文案。

**動態行為不問（DEC-11，v1.8）**：本 agent 只交付靜態 Figma 畫面。只影響動態行為、不影響靜態畫面的問題**不提問、不建 designDecision、不放進預填清單**，例如 Toast 停留幾秒後消失、能否手動關閉、動畫、轉場、手勢、載入時間。改記在 `plan.undefinedBehaviors`：

```json
{"id": "ub-01", "behavior": "錯誤 Toast 停留多久、能否手動關閉", "kind": "timing", "screenKey": "share-failed"}
```

handoff 第 12 項會把它們列為「未定義，交由實作決定」，並寫出需要決定的是什麼。動態行為會改變靜態畫面時（例如要不要畫出關閉按鈕、要不要畫出 loading 狀態），**只就畫面上看得到的部分**提問。這是通用規則，不是任何產品的政策。

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
  | `user_skipped` | 使用者看過並明確略過（v1.8；`status: skipped`、`skippedBy: user`） |

- 留空的列 agent **不得自行填入**；使用者表示略過 → `status: skipped`、`skippedBy: user`、`confirmation: user_skipped`。沒回覆不代表同意。
- **範圍與授權類的列**（v1.8）：產品、平台、元件／variables library、輸出位置、修改邊界、確認計畫等記在 `plan.decisions`，也加上同樣的 `confirmation`，例如 `{"id":"dec-002","decision":"variables library：本次沒有","scope":"sources","source":"user","decidedAt":"…","confirmation":"user_modified"}`。metrics 把兩種列一起算（`run-report.mjs metrics` 的 `decisions.confirmationByKind` 分開列）。

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

- 寫入 `plan.designDecisions`：`id`、`question`、`options`、`recommendation`（可 null）、`answer`（未回答為 null）、`source`（只能是 `user | ds | existing_pattern | brief | product_policy`；`product_policy` 必須附可解析的 `policyRef`）、`evidenceRefs`、`decidedAt`，以及 v1.7 的選填 `confirmation`、v1.8 的 `skippedBy`。
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

v1.8 起 `skipped` 要記 `skippedBy`（DEC-08、INVARIANT-28）：

| skippedBy | 什麼時候 | 完成判定（G7） |
|---|---|---|
| `user` | 使用者看過題目並明確略過（`confirmation: user_skipped`） | **已解決**，不擋完成；handoff 第 12 項列出略過的決策與影響 |
| `agent` | 使用者還沒看過就被標成略過（例如 DEC-07 授權下沒有建議的題目） | 仍是待答，`awaiting_user`；handoff 列給使用者，確認略過後改成 `user` |
| （沒有） | v1.8 前的舊紀錄 | 當作 `agent`，不自動放寬 |

`pending` 與 `skippedBy: agent` 的決策會讓 `evaluate-completion` 回 `awaiting_user`（G7）。舊 plan 沒有 `status` 時，由 `answer` 推定。

## 授權採用建議（DEC-07，v1.4）

使用者可以對某個 run 說「設計決策一律採用你的建議」（例如測試 run）。v1.9 起正式使用優先採用下方的**限定範圍委派（DEC-12）**；本節保留給使用者明確要求全面授權的情況（例如測試 run）。

1. 把授權記進 `plan.decisions`（例如 `dec-006`：「本 run 的設計決策採用 agent 建議；沒有建議的題目略過」）。
2. 每題仍照上面的格式產生選項與建議。
3. 有建議的題目：

   ```json
   {"id": "dec-102", "recommendation": "check", "answer": "check", "source": "user", "status": "answered",
    "decidedAt": "<時間>", "delegation": {"decisionRef": "dec-006", "scope": "run", "runId": "<本 run>"}}
   ```

4. **沒有建議的題目不得自己回答**：`status: "skipped"`、`skippedBy: "agent"`、`answer: null`，相關元素不建立，run 結束時一次列給使用者（仍是待答）。
5. 授權只對這個 run 有效。`continue <run-id>` 沿用；開新 run 必須重新取得（INVARIANT-01、INVARIANT-18）。validator 會拒絕 `delegation.runId` 與 plan 不同、或 `decisionRef` 不在 `plan.decisions` 的紀錄。授權本身記 `runOnly: true`：它和用授權回答的題目都不會列成產品政策建議（POL-05）。
6. v1.7：授權等同「本 run 的預填清單一律確認」（DEC-09）；**留空的列仍要使用者回答**，否則為 `skipped`。
7. 硬性門檻不因授權豁免。建議若會造成 G5 對比失敗，Plan 階段就要指出（`references/design-quality.md` 的可及性預檢），不能做完才發現。

## 決策分流順序（DEC-15，v1.9）

每個未知項目依序判斷，前一步能解決就不往下。不以模型自評的信心或「高風險」標籤代替這個順序。

| 步驟 | 問自己 | 能解決時怎麼做 | 例子 |
|---|---|---|---|
| 1 | 和本次需求相關嗎？ | 不相關就不列 | 只做登入頁，不問設定頁的 tab 樣式 |
| 2 | 能用工具或官方文件查明嗎？ | 先查（EXT-01、Discover），不讓使用者猜 | LINE 登入按鈕的官方色與 logo 用法；元件 key 能否匯入；主元件用了什麼字型 |
| 3 | 已有決定嗎？（指示、brief、產品政策、DS、已確認 pattern） | 只列摘要（DEC-03），記 `source: ds \| existing_pattern \| brief \| product_policy` | Aiwow 不檢查對比；主要按鈕用 DS 的 Button；外距沿用參考畫面的 16 |
| 4 | 在本 run 的委派範圍內嗎？ | agent 決定並驗證（DEC-12），Plan 摘要列出 | 已核准置中版型後：卡片內距 16、按鈕寬度 Fill、logo 佔位 80×80 |
| 5 | 會影響本次結果嗎？ | 不影響就記錄、不打斷 | Toast 停留幾秒、轉場動畫（DEC-11，`plan.undefinedBehaviors`） |
| 6 | 以上都不是 | 才變成問題，見下 | — |

第 6 步依性質選格式：

- **改變目的或主要結構** → 方向方案（DEC-13）。例：「歡迎頁置中版型（照 01-02）／上下分區（照 03-01）」。
- **缺使用者持有的事實**（品牌、產品名稱、文案、帳號、商業規則）→ 預填清單留空。例：條款文字寫什麼。
- **來源衝突或超出權限**（新增 token／元件、raw 值例外、改共享主元件、外部規範要求 DS 沒有的資源）→ 阻擋相依工作，另列一題。例：DS 沒有 LINE 官方綠色，要新增 style 還是在本 run 以核准的寫死值例外處理。

## 方向方案（DEC-13，v1.9）

同一個方向的相依選擇合成**一個**方案確認，取代零碎的單題。方案寫出：

1. 畫面目的與主要操作；
2. 整體版型與主體區塊的組成；
3. 引用的來源（參考畫面節點連結、pattern ID）、和參考畫面的差異；
4. 為什麼選這個參考；有其他候選時一併列出。

範例：

| 編號 | 問題 | 答案 |
|---|---|---|
| dd-20 | **方向方案**：歡迎頁，主要操作「使用 LINE 帳號登入」。版型照 01-02 置中：上方 logo 佔位與品牌名、中段 slogan、下方登入按鈕與條款。背景沿用 01-02 的淺灰。和 01-02 的差異：沒有 Top bar。另一候選 03-01（上下分區）較適合有插圖的頁面，本案沒有插圖素材 | 照方案（建議，請確認） |
| dec-020 | **委派授權（只限本 run）**：核准方向內的尺寸、留白、對齊、元件寬度、佔位尺寸交給 agent 決定並驗證 | 同意（建議，請確認） |
| dd-24 | 條款文字（**擬稿**，請確認或改寫）：「登入即表示同意服務條款」 | |

記錄：

```json
{"id": "dd-20", "kind": "direction", "topic": "layout", "question": "方向方案：…", "options": ["照方案", "改用 03-01 上下分區"],
 "recommendation": "照方案", "answer": "照方案", "source": "user", "status": "answered", "confirmation": "prefilled_confirmed", "decidedAt": "<時間>", "evidenceRefs": []}
{"id": "dd-22", "kind": "other", "topic": "visual", "question": "背景沿用 01-02 的淺灰", "dependsOn": "dd-20", "confirmedWith": "direction",
 "recommendation": "淺灰", "answer": "淺灰", "source": "user", "status": "answered", "decidedAt": "<同上>", "options": ["淺灰", "白"], "evidenceRefs": []}
```

- 使用者照方案接受 → 子選擇記 `confirmedWith: "direction"`，不另算一題實質決策。
- 使用者**換方向**（`confirmation: user_modified`）→ 新方向的子選擇展開成單題，各自確認後記 `confirmedWith: "row"`。validator 會拒絕換方向後仍以 `direction` 確認的子選擇。
- **不能藏進方案**：平台、寫入範圍、品牌素材、文案內容、外部規範（`topic`：`platform`、`write_scope`、`brand_asset`、`copy`、`external_requirement`）。這些另列；validator 會拒絕。這是 ASK-07「不把大型規格表包成一題」的例外：允許的是同一方向的整合，不是把不同性質的問題合併。

## 限定範圍的細節委派（DEC-12，v1.9；B 模式）

方向由使用者確認，方向內的細節由 agent 決定並驗證。這是 DEC-07 的縮小版，**正式使用優先採用本節**。

1. **每個 run 給一次**：在方向方案下加一行委派授權（上方範例的 dec-020）。使用者確認後記：

   ```json
   {"id": "dec-020", "decision": "核准方向內的尺寸、留白、對齊、元件寬度、佔位尺寸交給 agent 決定並驗證", "scope": "run", "runOnly": true,
    "source": "user", "decidedAt": "<時間>", "confirmation": "prefilled_confirmed",
    "delegation": {"allowedKinds": ["size", "spacing", "alignment", "component_width", "placeholder_size"],
                   "excludedKinds": ["copy", "brand_asset", "external_requirement", "new_token", "new_component", "raw_value_exception", "platform", "write_scope"]}}
   ```

   不變成產品政策，也不延續到新 run（INVARIANT-18）；`continue` 同一 run 時沿用。
2. **委派的決定**：

   ```json
   {"id": "dd-21", "kind": "spacing", "topic": "detail", "question": "卡片內距", "options": ["16", "24"], "recommendation": "16", "answer": "16",
    "source": "user", "status": "answered", "decidedAt": "<時間>", "evidenceRefs": [], "directionRef": "dd-20",
    "delegation": {"decisionRef": "dec-020", "scope": "run", "runId": "<本 run>"}}
   ```

   必須在 DS 的範圍內（既有 style、間距或元件屬性）並符合已核准的方向。留白依 `snippets/spacing.js`（SPACE-001：既有 pattern 值優先，沒有 token 時用 4px 尺度）。
3. validator 檢查（INVARIANT-29）：`kind` 在 `allowedKinds` 內、不是 `direction`／`other`；`topic` 不屬於排除類型；`directionRef` 指向**已確認**的 `kind: direction` 決定。只檢查 ID 存在不夠。
4. 委派的決定**不出現在預填清單**；Plan 確認時以一段摘要列出 agent 選了什麼，handoff 第 13 項同樣列出。
5. 使用者沒有給委派 → 回到預填清單逐項確認（A 模式）。

## 文案來源（DEC-14，v1.9）

| origin | 什麼 | 必要欄位 | Build 前 |
|---|---|---|---|
| `existing` | 既有正式文案 | `sourceRef`（來源畫面或文件） | `status: confirmed` |
| `user` | 使用者在需求或回答中寫明的文字 | `sourceRef`（需求或決策 ID） | `status: confirmed` |
| `draft` | agent 擬稿，明標「擬稿」並列入預填清單 | 確認後加 `decisionRef` | 使用者確認後才 `confirmed`；`origin` 仍是 `draft` |

- 「要不要放某段文字」和「寫什麼」是兩題。使用者回答「放」但沒給文字 → 文字另列一題（擬稿或留空），**不把題目裡的舉例當成答案**（run `ui-20261003-001` 的 dd-08）。validator 會拒絕 `origin: user` 但文字只出現在題目或選項、不在使用者回答裡的紀錄。
- 沒有授權時不新增需求沒提到的文案元素（例如 slogan）；要新增，先問要不要放，再問寫什麼。
- Build 邊界只接受 confirmed 文案；未確認的擬稿會以「擬稿」名義被擋下（INVARIANT-30）。
