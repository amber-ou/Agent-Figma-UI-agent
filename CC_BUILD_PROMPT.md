# 交給 Claude Code 的建置指令

版本：1.9 · 修訂日期：2026-10-03 · 配套規格：FIGMA_UI_AGENT_SPEC.md v1.9

本檔只放**目前這一版**的建置指令。已執行完畢的舊指令在 `docs/history/`：M0–M4 在 `build-prompts-m0-m4.md`，v1.7、v1.8 各在 `build-prompt-v1.7.md`、`build-prompt-v1.8.md`。

## v1.9 建置指令：提問架構第一階段

把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.9 實作提問架構第一階段。先讀第 20.3 節（v1.9 變更紀錄），再讀：
- 第 7.4 節的 DEC-12 到 DEC-15；
- 第 8.1 節的第 6a、6b 步；
- 第 10.3 節、第 14、15、20 節；
- 第 13.2 節的 T82–T90；
- 背景研究：`docs/research/question-flow-architecture-review.md` 第 9 節。

全程用繁體中文回報。

**離線實作**（不連 Figma）

1. **限定範圍的細節委派**（DEC-12）：
   - schema：designDecision 新增 `kind`、`directionRef`、`dependsOn`；委派授權新增 `allowedKinds`、`excludedKinds`。
   - validator：檢查委派決定的 `kind` 在允許範圍內、不在排除清單，`directionRef` 指向已確認的方向（INVARIANT-29）。
   - 委派只對本 run 有效。
2. **方向打包確認**（DEC-13）：`kind: direction` 的決定可以帶子選擇（`dependsOn`）；validator 拒絕把平台、寫入範圍、品牌素材、文案放進方向的子選擇。
3. **文案來源**（DEC-14）：
   - `screens[].copy[]` 新增 `origin`（`existing | user | draft`）。
   - `draft` 未確認時 Build 邊界拒絕（INVARIANT-30）。
4. **決策分流**（DEC-15）：寫進 `SKILL.md` 第 5 節與 `references/design-decisions.md`，含每一步的例子。
5. **外部規範檢查**（EXT-01）：
   - `inventory.externalRequirements` 的 schema。
   - 在 `references/discovery.md` 寫明觸發條件（第三方登入、平台規範、支付）、記錄欄位，以及 `verified`／`unverified` 的處理。
6. **可匯入性與子節點探測**（第 6b 步）：
   - Discover 在 Plan 前確認 componentMap 和 style 的 key 可以匯入。
   - 在 sandbox 用最小的唯讀 probe 確認讀得到 instance 內被隱藏的子節點，查明原因並記入 `runtime-probes.md`；原因沒查明就標為假設。
7. **字型比對範圍**（第 10.3 節）：Discover 對每個準備新建的 instance 讀主元件的字型，不以參考畫面上 instance 的現況代替。
8. **量測**：`run-report.mjs metrics` 新增實質決策數、委派決定數、方向方案數、返工次數。
9. **handoff** 第 13 項：委派的細節、擬稿文案、外部規範查核結果與未驗證項目。
10. **`SKILL.md` 的 Intake 與 Plan 流程**：
    - 先唯讀探索，再一次問完；缺來源時才先問。
    - Plan 用方向方案加一行委派授權，取代零碎的單題。
    - 第二階段的規則（產品確認、library 每次確認、plugin 版本每次問、全域 Build 邊界）**不改**。
11. **測試**：T82–T90 的離線測試；既有 146 個測試維持通過。

**然後處理既有 run 的 LINE 按鈕**（使用者已同意修改）

離線實作推上去之後，執行：
```text
/figma-ui continue ui-20261003-001 登入按鈕改成符合 LINE 官方登入按鈕規範的樣式
```
- 先依 EXT-01 查 LINE 官方登入按鈕規範，記下網址、查核日期與條文要求。讀不到官方文件就標為未驗證，停下來問我。
- DS 裡沒有 LINE 官方色和官方按鈕，需要新增資源或使用寫死的顏色。把需要核准的項目列給我，核准前不寫入。
- 條款文字目前是 agent 暫定的「登入即表示同意服務條款」，請一起列為待確認文案（DEC-14）。

**本次不做**：
- 第二階段的各項：產品依檔案對應判斷、library 與輸出位置的持續設定、plugin 版本只記錄不問、分區 Build。
- fingerprint fp2、截斷恢復實測、gap-001、`skill-creator` 評測。

限制照舊：
- hooks 放行不得輸出 `allow`；
- read 用獨立 operationId；唯讀腳本不建立暫時節點；
- 腳本存取節點屬性前先依 `node.type` 分流（INVARIANT-19）；
- 回傳上限以位元組計；
- 不改 `product-policies/aiwow.json`；
- 未驗證的推論標為假設；
- 變更推到新分支 `feat/v1.9`，不要直接推 main。

完成時交付：
- 已建立與修改的檔案；
- 測試結果；
- LINE 按鈕修改的結果；
- 未做項目與原因；
- 總結寫進 `docs/history/v1.9-summary.md`。

---
