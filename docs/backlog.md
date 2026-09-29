# 待調整項目（backlog）

更新：2026-09-29（加入 S-xx 與研究問題紀錄） · 對應 spec v1.4

> **v1.6 狀態（2026-09-29）：**本清單是研究提案。已實作的是 spec v1.6 流程精簡（`docs/workflow-simplification-record.md`），與本清單不同；S-01～S-07、U-04（廣泛 lint）、U-11（以寫入回傳代替讀回）、D-09 屬 v1.6 階段 C「本次不做」。其餘項目仍是未排程的提案。


研究後**記下、尚未排入實作**的調整。全部項目的執行計畫與待確認決策整理在 `docs/adjustment-plan.md`。M3 已排定的項目（v1.4 規則、T35–T37 協作實測、PostToolUseFailure、中文回傳上限）在 `CC_BUILD_PROMPT.md` 的「M3 建置指令」，不重複列在這裡。

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

## B2. 延伸規格表與提問（來源：`docs/extension-spec-research.md`）

| ID | 項目 | 內容摘要 | 狀態 | 依賴 |
|---|---|---|---|---|
| S-01 | 規格抽取清單 L0–L13 | Discover 依固定欄位抽取規格（骨架、間距、字體、色彩、形狀、元件、pattern、文案、圖示、狀態、互動、品質底線），每條附證據與信心 | todo | D-01（合併實作） |
| S-02 | 三輪提問流程 | Intake（任務＋選參考與反例）→ Discover 後確認規格表＋政策題 → Plan 只問剩下的個案決策 | needs_decision（規格表確認是否算 ASK-02 的一題） | S-01 |
| S-03 | 政策題 P-1～P-10 | 參考不一致、DS 沒有的值、raw 值、新元件、不合格參考、元件版本、文字過長、缺少的狀態、平台衝突、決策委託 | needs_decision（各題預設建議要不要採用） | — |
| S-04 | 規格檔與凍結 | `spec.json`（或併入 plan）；確認後凍結，改動需 decision；`basisRefs` 可引用規則 ID | needs_decision（獨立檔或併入 plan） | S-01 |
| S-05 | 逐屬性依據檢查 `unbasedProperties` | 每個新節點的可見屬性必須對應已確認規則、使用者回答或元件預設值；完成前為 0 或登錄 finding | needs_decision（是否成為硬性門檻） | S-04、D-02 |
| S-06 | 信心分級門檻 | 高／中／低的出現次數與一致率門檻（預設 3 處／90%／70%），以真實任務校正 | needs_probe | S-01 |
| S-07 | 參考畫面候選排序 | 依同頁、同寬、名稱、instance 組成相似度列 3–5 張候選附截圖；記錄反例 | todo | — |

## C. 待使用者決定

| 題目 | 選項 | 建議 | 影響項目 |
|---|---|---|---|
| 驗證頻率 | 1 維持每個 write 另開 read｜2 折衷｜3 完全照官方新版 | 2 | U-11 |
| hook lint 強度 | deny｜warn | 先 warn 跑一次真實任務，再改 deny | U-04 |
| 跨 run 評論範例庫 | 採用（Intake 時列出並確認）｜不採用 | 待 D-03 實作並比較效果後再決定 | D-09 |
| 規格表確認是否算一題 | 算（一次確認、指出編號修改）｜不算（仍每輪 1–3 題） | 算，並寫入 ASK-02 | S-02 |
| 政策題預設 | 逐題採用 `extension-spec-research.md` 第 4 節的建議｜逐題修改 | 待你看過第 4 節的表 | S-03 |
| 規格檔位置 | 獨立 `spec.json`｜併入 `plan.json` | 獨立檔（Discover 產出、Plan 引用，階段較清楚） | S-04 |
| `unbasedProperties` 是否為硬性門檻 | 硬性（必須為 0）｜只作指標 | 先作指標跑一次真實任務，再決定 | S-05 |

## D. 研究問題紀錄

使用者提出的研究題目與對應結果：

| 日期 | 題目 | 結果文件 | 產出項目 |
|---|---|---|---|
| 2026-09-28 | 讓 `use_figma` 品質更好、更精準的方法 | `docs/use-figma-quality-research.md` | U-01～U-11 |
| 2026-09-29 | 如何提升設計品質 | `docs/design-quality-research.md` | D-01～D-09 |
| 2026-09-29 | 延伸既有畫面時，要問哪些問題、從檔案抽哪些規格讓使用者確認，以縮小 AI 的規則範圍 | `docs/extension-spec-research.md` | S-01～S-07、政策題 P-1～P-10 |

研究過程中發現、尚未解答的問題：

- 腳本中途 throw 時，已做的修改是否保留（U-02）。
- 本機 Claude Code 能否使用 `ux-knowledge-base` skill（D-07）。
- 獨立審查子代理是否真的比自我檢查準（D-03）。
- 信心分級門檻是否合理、規格表是否造成使用者負擔（S-06）。
- 學術來源只讀到搜尋摘要，寫進 spec 前需讀原文確認數字。

## E. 建議順序

1. U-01 → U-02（升級與 probe，先確認基礎行為）
2. S-01 ＋ D-01 ＋ D-02（規格抽取與設計 lint 一起做；先做對比、間距、字級、對齊）與 U-04、U-03：確定性、可離線測試，且能把第一次任務的 G5 問題提前到 Plan
   - 同時決定 S-02～S-05 的問題，讓 Intake／Plan 的提問流程可以一起改
3. D-05、U-05、U-06、U-07
4. D-06、D-07、U-08、U-10
5. D-03、D-04（需要真實任務比較效果）
6. U-09（等 gap-001）、D-08（等 M3 協作實測）、D-09（等決策）
