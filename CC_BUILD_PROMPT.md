# 交給 Claude Code 的建置指令

版本：1.8 · 修訂日期：2026-10-03 · 配套規格：FIGMA_UI_AGENT_SPEC.md v1.8

本檔只放**目前這一版**的建置指令。已執行完畢的舊指令在 `docs/history/`：M0–M4 在 `build-prompts-m0-m4.md`，v1.7 在 `build-prompt-v1.7.md`。

## v1.8 建置指令：流程修正、skill 規則、版本檢查與固定連線

把下方兩條分隔線之間的內容貼給本機 Claude Code。

---

請依 `FIGMA_UI_AGENT_SPEC.md` v1.8 實作。先讀第 20.3 節（v1.8 變更紀錄），再讀第 4.2.2、4.2.3、4.5、4.7、7.2（ASK-08）、7.4（DEC-08、DEC-09、DEC-11）、12.1、15、20 節，以及第 13.2 節的 T72–T81。全程用繁體中文回報。

**離線實作**（不連 Figma）

1. **略過題目的判定**：
   - designDecision 新增 `skippedBy`（`user | agent`），`confirmation` 新增 `user_skipped`。
   - 完成判定：`skippedBy: user` 算已解決；`skippedBy: agent` 和沒有 skippedBy 的舊紀錄仍是待答。
   - `RULE_VERSION` 改為 `12.1@1.8`。
2. **動態行為不問**（DEC-11）：
   - skill 與 `references/design-decisions.md` 寫明不提問、不建 designDecision。
   - handoff 新增第 12 項：「未定義，交由實作決定」的項目，以及使用者略過的決策。
3. **範圍與授權類的列也記確認方式**：`plan.decisions` 新增選填的 `confirmation`，提問紀錄與 metrics 一起計算。
4. **v1.7 run 的自動化問題**（第 20 節「v1.8 自動化修正」）：
   - preflight 接受 whoami 兩種格式。
   - schema 錯誤訊息直接給出正確格式，並提供產生 artifact 骨架的指令。
   - verify 後自動寫入 `ledger.entities`。
   - 第一個寫入驗證成功後，nativeWrite 自動升級為 verified。
   - 同一階段不重複記錄。
5. **Figma plugin 版本檢查**（第 4.2.2 節）：
   - `verify-installation.mjs` 讀本機版本，並向 `figma/mcp-server-guide` 的 `.claude-plugin/plugin.json` 查最新版。
   - 結果記入 `capabilities.server.pluginVersion`。
   - `run-context.mjs` 在本機版本較舊時，把「先升級，還是這次照舊版跑」列在 Intake 預填清單最前面，答案只限本 run。
   - 查不到最新版時只提示，不擋 run；synced 的 plugin 在題目中註明。
6. **固定 Figma 連線**（第 4.2.3 節）：
   - Preflight 列出所有 Figma 連線前綴，記錄本 run 使用的 `capabilities.server.toolPrefix`。
   - `pre-figma-call.mjs` 對其他前綴的寫入，以及 `toolPrefix` 未記錄時的寫入一律阻擋；讀取只記錄。
   - 檢查 hooks matcher 是否涵蓋所有可能的前綴。
7. **Skill 使用規則**（第 4.7 節）：在 `SKILL.md` 加上必用、有條件、只當參考、排除四類清單。排除的 skill 若被載入，不採用衝突內容，並在 handoff 記錄。
8. **溝通語言**（ASK-08）：`SKILL.md` 寫明提問、回報、交接一律用繁體中文，技術名詞與 ID 保留原文。
9. **測試**：T72–T80 的離線測試（T81 是行為規則，不寫離線測試）；既有 135 個測試維持通過。
10. **文件**：`docs/runbook.md` 補上：
    - plugin 版本提問怎麼回答；
    - synced plugin 無法在本機升級；
    - 多個 Figma 連線時怎麼選。

**真實驗證**：這次先不排，等下一個正式需求時一起確認。完成離線實作後告訴我，我再決定。

**本次不做**：fingerprint fp2、截斷恢復實測（原任務 C）、gap-001、`skill-creator` 評測、Figma plugin 升級（等帳號同步）。

限制照舊：
- hooks 放行不得輸出 `allow`；
- read 用獨立 operationId；唯讀腳本不建立暫時節點；
- 腳本存取節點屬性前先依 `node.type` 分流（INVARIANT-19）；
- 回傳上限以位元組計；
- 不改 `product-policies/aiwow.json`；
- 未驗證的推論標為假設；
- 變更推到新分支 `feat/v1.8`，不要直接推 main。

完成時交付：
- 已建立與修改的檔案；
- 測試結果；
- 未做項目與原因；
- 總結寫進 `docs/history/v1.8-summary.md`。

---
