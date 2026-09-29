# 待調整項目（backlog）

更新：2026-09-29 · 對應 spec v1.4

研究後**記下、尚未排入實作**的調整。M3 已排定的項目（v1.4 規則、T35–T37 協作實測、PostToolUseFailure、中文回傳上限）在 `CC_BUILD_PROMPT.md` 的「M3 建置指令」，不重複列在這裡。

採用某一項時：先做需要的決策 → 寫回 `FIGMA_UI_AGENT_SPEC.md`（spec 是唯一規範來源）→ 實作與測試 → 在這裡把狀態改為 `done` 並附上 commit 或文件。

狀態：`todo` 未開始 · `needs_decision` 需要使用者先決定 · `needs_probe` 需要先在 sandbox 實測 · `done`

## A. `use_figma` 精準度（來源：`docs/use-figma-quality-research.md`）

| ID | 項目 | 內容摘要 | 狀態 | 依賴 |
|---|---|---|---|---|
| U-01 | 升級 Figma plugin 並重跑 probe | 本機 2.2.118 → 2.2.123 以上；更新 `references/runtime-probes.md` | todo | — |
| U-02 | Probe：腳本 throw 後修改是否保留 | 在 sandbox 先建節點再 throw，讀回確認；決定 U-03 的斷言放置位置 | needs_probe | U-01 |
| U-03 | 寫入腳本內的後置斷言（`snippets/assert.js`） | variant 不用 fallback、setProperties 讀回比對、尺寸與字型斷言 | todo | U-02 |
| U-04 | PreToolUse hook 靜態檢查（lint） | 官方 Pre-Flight Checklist 規則機械化；先 warn 後 deny | needs_decision（5.2：deny 或 warn） | — |
| U-05 | 元件屬性合約 | Discover 時對 library 檔唯讀讀取完整屬性 key（含 `#uid`）、巢狀 TEXT 屬性；inventory schema 新增 `properties` | todo | — |
| U-06 | `snippets/layout-diff.js` | 參考節點 vs 新建節點逐層數值差異，作為 G3 證據 | todo | — |
| U-07 | `snippets/quality-audit.js` | 可編輯性、未綁 token、detach、文字塌陷／裁切、重疊、預設文字、Section 包覆 | todo | — |
| U-08 | 截圖解析度規則 | 風險區域 `scale: 2` 局部截圖；參考與新建同比例 | todo | — |
| U-09 | Variables 精準綁定 | variableMap 加 `layer` 與 `scopeCheck`；每個 requiredMode 設 explicit mode 後 `resolveForConsumer` 讀回 | todo | gap-001 |
| U-10 | 效能寫法 | `Promise.all` 批次 import、`findAllWithCriteria`／`query` 取代全樹 `findAll` | todo | — |
| U-11 | 驗證頻率 | 新建 owned 節點以寫入腳本內讀回為證據；修改既有節點仍另開 read | needs_decision（5.1：建議選項 2） | U-01 |

## B. 設計品質（來源：`docs/design-quality-research.md`）

| ID | 項目 | 內容摘要 | 狀態 | 依賴 |
|---|---|---|---|---|
| D-01 | 產品設計語言側寫（`designProfile`） | 從參考畫面量化 spacing scale、各角色 text／paint styles、圓角、對齊、密度、主按鈕數、詞彙表 | todo | — |
| D-02 | 設計 lint | 對比（含合成背景）、間距在 scale 上、字級、對齊、主次按鈕、點擊區、最小字級、平台慣例；對比在 Plan 預先計算 | todo | D-01；與 M3 的可及性預檢整合 |
| D-03 | 結構化評論 | 固定三組準則、逐區塊 `scale: 2` 截圖、每則評論需節點 ID＋觀察＋信心；評論先記為 hypothesis；可選獨立審查子代理 | todo（子代理部分 needs_probe） | U-08 |
| D-04 | 與參考畫面比較 | 同比例並排，逐維度列差異並對應量測值；修改 §12.3 說明 | todo | D-01、U-06 |
| D-05 | 決策候選先行與視覺選項 | 提問前先從 DS／參考畫面找 2–3 個候選；外觀類決策在 sandbox 做並排小選項 | todo | — |
| D-06 | 平台慣例檢查表 | iOS／Android／Web 檢查項，數值以參考畫面的元件為準 | todo | D-02 |
| D-07 | 內容先行與文案一致 | Plan 必填實際文案與長度；用詞依詞彙表；文案結構化檢查 | todo | D-01 |
| D-08 | 使用者在 Figma 的修改轉成決策 | 偵測到使用者改動後，詢問是否套用到同類區塊，確認後記為決策 | todo | M3 T35–T37 |
| D-09 | 跨 run 評論範例庫 | 累積使用者確認過的 findings 作 few-shot 範例；與 INVARIANT-01 有張力 | needs_decision | D-03 |

## C. 待使用者決定

| 題目 | 選項 | 建議 | 影響項目 |
|---|---|---|---|
| 驗證頻率 | 1 維持每個 write 另開 read｜2 折衷｜3 完全照官方新版 | 2 | U-11 |
| hook lint 強度 | deny｜warn | 先 warn 跑一次真實任務，再改 deny | U-04 |
| 跨 run 評論範例庫 | 採用（Intake 時列出並確認）｜不採用 | 待 D-03 實作並比較效果後再決定 | D-09 |

## D. 建議順序

1. U-01 → U-02（升級與 probe，先確認基礎行為）
2. D-01 ＋ D-02（先做對比、間距、字級、對齊）與 U-04、U-03：確定性、可離線測試，且能把第一次任務的 G5 問題提前到 Plan
3. D-05、U-05、U-06、U-07
4. D-06、D-07、U-08、U-10
5. D-03、D-04（需要真實任務比較效果）
6. U-09（等 gap-001）、D-08（等 M3 協作實測）、D-09（等決策）
