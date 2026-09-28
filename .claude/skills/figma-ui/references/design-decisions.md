# 設計決策一律詢問（spec §7.4）

使用者已確認：agent 不自行決定「怎麼做出好設計」。

## 什麼是設計決策（DEC-01）

會影響外觀、資訊層級或使用體驗，且**沒有被下列任一來源明確決定**的選擇：本次使用者指示、已確認的 brief／先前決策、指定 DS（元件、variables、styles）、已盤點並在 plan 確認的既有 pattern。不確定時當作是設計決策。

必問範例（DEC-02，非完整清單）：漸層、陰影、插圖、背景裝飾；強調色或狀態色的位置；DS 未涵蓋的間距、圓角、字級；多個候選元件；表格或卡片、分頁或 tab 等結構取捨；長文字換行或截斷；空狀態與錯誤狀態的呈現與文案語氣；圖示；響應式時隱藏或收合什麼；修正視覺缺陷有多種合理修法；按鈕等文案。

不必逐項問（DEC-03）：直接由 DS、pattern 或指示推得的操作（例如沿用既有 section 間距 variable、使用 DS 的 Primary Button）。這些在 plan 確認時一次列出摘要。

## 問題格式（DEC-04）

同一階段的問題集中一次問，優先在 Plan 問完。

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

- 寫入 `plan.designDecisions`：`id`、`question`、`options`、`recommendation`（可 null）、`answer`（未回答為 null）、`source`（只能是 `user | ds | existing_pattern | brief`）、`evidenceRefs`、`decidedAt`。
- `designDecisions` 與 `plan.decisions`（範圍、授權、例外）分開存，但共用 ID 命名空間。
- 每個 write operation 的 `basisRefs` 必須引用依據。`operation-journal.mjs plan` 與 validator 會拒絕無法解析或引用未回答決策的 basisRefs。
- 未回答不代表同意。受影響的 section 不得寫入；Build／Validate 中途出現新決策 → 暫停相依寫入並詢問，不先做再問。
- 使用者先前的決策互相衝突時（例如「要等寬」與「保留新版 icon」），不自行取捨，列出衝突與選項再問。
