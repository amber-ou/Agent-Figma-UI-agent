# 調整計畫（待確認）

日期：2026-09-29 · 基準：spec v1.4 ＋ `feat/m3`（commit `b98036d`，尚未合併到 main） · 目標版本：spec **v1.5**

這份文件整合三份研究的**全部調整**，確認後才執行。研究細節見：

- `docs/use-figma-quality-research.md`（U-xx：`use_figma` 精準度）
- `docs/design-quality-research.md`（D-xx：設計品質）
- `docs/extension-spec-research.md`（S-xx：延伸規格表與提問）
- 狀態追蹤：`docs/backlog.md`

## 0. 怎麼確認

請回覆以下任一種：

- 「全部照建議」
- 只寫要改的編號，例如「B3 選 b、C1 選 1、移除 D-09」
- 對某個項目的疑問

第 1 節的決定會直接改變第 3 節的做法；確認後，我會把結果寫進 spec v1.5，然後依第 3 節的階段執行。

## 1. 需要你決定的事項

### A. 流程

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| A1 | 延伸規格表的確認，算不算「每輪只問 1–3 題」（ASK-02）裡的一題？ | a. 算，一次確認整份表，有錯就指出編號 ｜ b. 不算，規格也要拆成每輪 1–3 題 | a |
| A2 | 規格要放在哪裡？ | a. 獨立 `spec.json`，由 Discover 產出、Plan 引用 ｜ b. 併入 `plan.json` | a |
| A3 | `unbasedProperties`（沒有依據的屬性數）要當硬性門檻嗎？ | a. 先當指標，跑一次真實任務後再決定 ｜ b. 直接成為硬性門檻，必須為 0 才能完成 | a |
| A4 | 規則要多一致，才能摺疊成摘要讓你整批確認？ | a. 用預設：出現 ≥ 3 處、一致率 ≥ 90%、有綁 token、品質合格；出現 2 處或一致率 70–90% 要逐條確認；其餘轉成問題 ｜ b. 你指定數字 | a（之後用真實任務校正） |
| A5 | 要從檔案抽的規格類別 L0–L13，要增減嗎？（清單見第 2 節） | a. 照現有 14 類 ｜ b. 增減（請說明） | a |

### B. 政策題的預設（只對單一 run 有效，每次 run 仍會讓你確認）

| # | 情況 | 選項 | 建議 |
|---|---|---|---|
| B1 | 參考畫面之間不一致 | a. 明顯多數（≥ 2/3）為準，並列出差異 ｜ b. 一律逐項問 | a |
| B2 | 需要 DS 沒有的值（間距、字級、顏色） | a. 一律問 ｜ b. 取最接近的既有值並標記 ｜ c. 禁止，改用別的做法 | a |
| B3 | 參考畫面裡沒有 token 的值（例如漸層） | a. 可以照抄，記為例外 ｜ b. 不可用 | a（和既有產品一致） |
| B4 | 新增元件或 token | a. 禁止 ｜ b. 允許，但每次都問 | a |
| B5 | 參考畫面的文字對比不合格 | 固定規則：不可照抄，從同系列的 style 列出合格的候選讓你選。請確認這條規則 | 確認 |
| B6 | 元件版本 | a. 跟既有畫面同版（從既有 instance 取得主元件） ｜ b. 用 library 最新發佈版 | a |
| B7 | 文字超過參考畫面的長度 | a. 換行 ｜ b. 截斷加「…」 ｜ c. 縮短文案並問你；也可以依角色分開規定 | 標題 c、內文 a、按鈕 c |
| B8 | 要交付的狀態，在參考畫面裡沒有範例 | a. 做成畫面，並先問呈現方式 ｜ b. 只寫規格 ｜ c. 本次不做 | a |
| B9 | 平台慣例和參考畫面衝突 | a. 以參考畫面為準 ｜ b. 以平台慣例為準 | a |
| B10 | 設計決策的預設處理 | a. 每題都問 ｜ b. 採用 agent 的建議，沒有建議的題目略過（DEC-07） | a |

### C. 驗證與檢查

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| C1 | 寫入後怎麼驗證 | 1. 維持現狀，每次寫入都另外讀回 ｜ 2. 折衷：新建的節點用寫入回傳的資料當證據，修改既有節點仍另外讀回 ｜ 3. 完全照官方新版，寫入回傳一律當證據 | 2 |
| C2 | hook 對 `use_figma` 腳本做靜態檢查時，違規怎麼處理 | a. 先只警告，跑一次真實任務收集誤判後再改成擋下 ｜ b. 直接擋下 | a |
| C3 | 跨 run 的評論範例庫（D-09） | a. 暫不做，等 D-03 做完、比較過效果再說 ｜ b. 現在就做，每次 Intake 時列出讓你確認 | a |

### D. 執行方式

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| D1 | 執行範圍 | a. 依第 3 節分階段，**這次做階段 1–4**（雲端可離線完成的部分），階段 5–6 等真實任務 ｜ b. 你指定項目 | a |
| D2 | spec 怎麼改 | a. 先把確認的內容寫成 spec v1.5，再實作，最後補 fixture 測試 ｜ b. 只改 skill 和腳本，不動 spec | a（spec 是唯一的規範來源） |
| D3 | 以哪個分支為基礎 | a. 等 `feat/m3` 合併到 main 後，從 main 開新分支 `feat/v15-spec-extraction` ｜ b. 直接從 `feat/m3` 開新分支，之後一起合併 ｜ c. 繼續用目前的 `claude/wizardly-allen-atzgrb` | b（`feat/m3` 的 `quality-metrics.mjs`、`accessibilityPrecheck`、`inventory.fonts` 會被直接擴充） |

## 2. 延伸規格表 L0–L13（A5 要確認的清單）

| 類別 | 從檔案抽什麼 | 什麼情況要問 |
|---|---|---|
| L0 任務 | 無法抽，只能問：目的、使用者任務、交付畫面與狀態、輸出位置、可改範圍、平台 | 一律問 |
| L1 參考畫面 | 候選 3–5 張（同頁、同寬、名稱相近、instance 組成相似），附截圖 | 選哪幾張為標準、哪些是反例 |
| L2 畫面骨架 | frame 尺寸、背景、Status Bar／瀏海、Top bar、tab bar、home indicator、安全區、捲動區 | 參考之間不一致 |
| L3 間距與對齊 | 邊距、內容寬、區塊與元件間距的數值分佈與對應 variable、layout grid | 同角色多個值、沒綁 token、只出現一次 |
| L4 字體排印 | 各文字角色的 text style、字型與安裝狀態、對齊、行數與截斷 | 角色不唯一、對比不足、字型未安裝 |
| L5 色彩角色 | 各顏色角色的 paint style／variable、mode、raw 值清單 | raw 值、需要的狀態色沒出現 |
| L6 形狀與裝飾 | 圓角、邊框、陰影、漸層、插圖是否使用、用在哪 | 新畫面要不要用裝飾 |
| L7 元件對應 | 語意元素 → 元件、variant、版本來源、屬性合約、每畫面數量與位置 | 多個候選、版本差異、DS 中找不到 |
| L8 組合 pattern | 頁首、卡片、列表、表單、dialog、toast、空狀態、底部按鈕列的量測值 | 本次用哪些、參考矛盾 |
| L9 內容與文案 | 詞彙表、品牌名稱、標點、數字與日期格式、各角色文字長度 | 品牌、語氣、新文案、過長 |
| L10 圖示與圖片 | icon 來源、尺寸、線或面、顏色；圖片比例與裁切 | 新圖示（先找 2–3 個候選） |
| L11 狀態呈現 | loading／empty／error／success／disabled 的呈現方式與元件 | 需要哪些狀態、缺範例的狀態 |
| L12 互動與導覽 | 返回方式、按鈕目的頁（prototype 連線）、toast 時間 | 目的頁與行為 |
| L13 品質底線 | 參考畫面的對比與點擊區量測 | 不合格時換成哪個 style |

## 3. 全部調整項目（依執行階段）

每一項的「在哪執行」：**雲端** = 本環境可離線完成並以 fixture 測試；**本機** = 需要你的 Claude Code 與 Figma。

### 階段 0：前置

| ID | 調整 | 修改內容 | 在哪執行 | 驗收 |
|---|---|---|---|---|
| P0-1 | 合併基礎 | 依 D3 建立分支 | 雲端 | 76 個既有測試通過 |
| U-01 | 升級 Figma plugin | 2.2.118 → 2.2.123 以上；重跑 `runtime-probes.md` 的 probe | **本機** | `runtime-probes.md` 更新版本與結果 |
| U-02 | Probe：腳本 throw 後修改是否保留 | sandbox 先建節點再 throw，讀回確認 | **本機** | 結果寫入 `runtime-probes.md`；決定 U-03 的斷言位置 |

階段 1–4 不等 U-01／U-02：U-03 在 U-02 結果出來前，斷言一律放在修改之前。

### 階段 1：寫入 spec v1.5

| 修改的 spec 章節 | 內容 | 來源項目 |
|---|---|---|
| §6.1、§6.6 | 新增延伸規格表（L0–L13）、證據與信心分級；pattern 盤點併入規格表 | S-01、S-06、D-01、S-07 |
| §7.1、§7.2 | 三輪提問流程；規格表確認算一題（依 A1）；REQ-02 改為依規格表呈現 | S-02 |
| §7.4 | 政策題 P-1～P-10 與預設（依 B）；設計決策提問前先找候選、外觀類附並排小樣 | S-03、D-05 |
| §8.2 | Plan 必填實際文案與長度；平台檢查表 | D-06、D-07 |
| §8.3、§12.5 | 驗證頻率（依 C1）；截圖解析度規則 | U-11、U-08 |
| §4.5 | hook 靜態檢查（依 C2） | U-04 |
| §10.2、§10.3 | 元件屬性合約；variant 不用 fallback；setProperties 讀回；字型斷言 | U-05、U-03 |
| §12.1、§12.2 | 新指標 `unbasedProperties`（依 A3）；設計 lint 的檢查項 | S-05、D-02 |
| §12.3 | rubric 改以「與參考畫面的差異清單」為主，分數保留作診斷 | D-04 |
| §13.2 | 新增測試 T52 起（見第 5 節） | — |
| §20.3 | v1.5 變更紀錄 | — |
| `FIGMA_MCP_RESEARCH.md` | 補官方 skill 2.2.123 的差異與新研究來源 | — |

### 階段 2：規格抽取與提問流程

| ID | 調整 | 修改的檔案 | 在哪執行 |
|---|---|---|---|
| S-04 | 規格檔與凍結 | 新增 `schemas/spec.schema.json`（規則：id、layer、statement、value、tokenRef、evidence、confidence、status、source）；`validate-artifacts.mjs` 加跨檔檢查（basisRefs 可引用規則 ID，且必須 confirmed；凍結後改動需 decisionRef） | 雲端 |
| S-01、D-01 | 規格抽取 | 新增 `snippets/extract-spec.js`（唯讀，依 L2–L13 分批回傳、每批 < 15,000 字元）；新增 `scripts/spec-profile.mjs`（把抽取結果算成數值分佈、一致率、信心等級，產出 spec.json 草稿） | 雲端（腳本與測試）；真實抽取在**本機** |
| S-06 | 信心分級 | `spec-profile.mjs` 內實作 A4 的門檻，可設定 | 雲端 |
| S-07 | 參考畫面候選排序 | `snippets/extract-spec.js` 的 L1 部分：依同頁、同寬、名稱、instance 組成相似度排序 | 雲端 |
| S-02、S-03 | 提問流程與政策題 | `SKILL.md` 第 2 節（Intake）與新階段出口；新增 `references/extension-spec.md`（規格表格式、政策題、回覆方式）；`scripts/spec-profile.mjs render`（產出規格表的確認文字，異常優先） | 雲端 |
| D-05 | 決策候選先行 | `references/design-decisions.md`：提問前先搜尋 DS 與參考畫面的候選；外觀類決策在 run Section 旁建並排小樣 | 雲端 |
| D-07 | 內容先行 | `plan.schema.json` 的 screens 加文案欄位（文字、角色、長度）；validator 檢查必填 | 雲端 |

### 階段 3：檢查機制

| ID | 調整 | 修改的檔案 | 在哪執行 |
|---|---|---|---|
| D-02 | 設計 lint | 擴充 `feat/m3` 的 `scripts/quality-metrics.mjs`：半透明色的合成背景對比、間距在 scale 上、字級與 style 屬於規格、對齊、主按鈕數量、點擊區、最小字級、平台慣例；新增 `snippets/design-lint.js` 在 Figma 端收集量測值 | 雲端 |
| S-05 | `unbasedProperties` | `quality-metrics.mjs` 新增計算：每個新節點的可見屬性，比對規格規則、設計決策、元件預設值；寫入 `audit.metrics` | 雲端 |
| U-03 | 腳本內斷言 | 新增 `snippets/assert.js`：variant 精確比對（找不到就 throw 並列出選項）、setProperties 讀回、`width > 0`、字型斷言 | 雲端 |
| U-04 | hook 靜態檢查 | `scripts/hooks/pre-figma-call.mjs` 加 lint：`figma.notify`、`figma.currentPage =`、async IIFE、`closePlugin`、沒有 `return`、色值 > 1、paint color 有 `a`、未 await、多次切頁、寫入沒回傳 IDs、`detachInstance`、`|| defaultVariant`；依 C2 先 warn。需新增依賴 `acorn`（固定版本） | 雲端 |
| U-06 | 版面差異報表 | 新增 `snippets/layout-diff.js`：參考與新建節點逐層比對尺寸、auto-layout、sizing、bindings、variant、字型 | 雲端 |
| U-07 | 品質稽核 | 新增 `snippets/quality-audit.js`：可編輯性、未綁 token、detach、文字塌陷與裁切、重疊、預設文字、Section 包覆 | 雲端 |

### 階段 4：流程改善

| ID | 調整 | 修改的檔案 | 在哪執行 |
|---|---|---|---|
| U-05 | 元件屬性合約 | `inventory.schema.json` 的 components 加 `properties`（完整 key 含 `#uid`、型別、預設值、巢狀 TEXT 屬性）；`references/discovery.md` 加讀取 library 檔的唯讀腳本 | 雲端 |
| U-08 | 截圖解析度 | `references/design-quality.md`：風險區域 `scale: 2` 局部截圖；參考與新建同比例 | 雲端 |
| U-10 | 效能寫法 | `references/runtime-probes.md` 或新 reference：`Promise.all` 批次匯入、`findAllWithCriteria`／`query` | 雲端 |
| U-11 | 驗證頻率 | 依 C1 修改 `SKILL.md` 第 4 節、`operation-journal.mjs verify` 接受寫入回傳作為證據的條件 | 雲端 |
| D-06 | 平台檢查表 | 新增 `references/platform-checklist.md`（iOS／Android／Web）；數值以參考畫面元件為準 | 雲端 |

### 階段 5：需要真實任務比較效果（本機）

| ID | 調整 | 做法 |
|---|---|---|
| D-03 | 結構化評論 | 固定三組準則、逐區塊 `scale: 2` 截圖、每則評論附節點 ID 與信心、先記為 hypothesis；比較有無獨立審查子代理 |
| D-04 | 與參考畫面比較 | 同比例並排，逐維度列差異並對應量測值；交換順序各判一次 |
| S-06 校正 | 信心門檻 | 用真實任務的規格表檢查門檻是否合理 |
| 整體驗收 | 用 v1.5 流程跑一次延伸任務 | 記錄：提問數、確認時間、Validate 的 findings 數、被略過的決策數、`unbasedProperties`；和第一次任務比較 |

### 階段 6：等待其他條件

| ID | 等待 |
|---|---|
| U-09 variables 精準綁定 | gap-001（variables 來源 library 未識別） |
| D-08 使用者修改轉成決策 | M3 的 T35–T37 協作實測 |
| D-09 跨 run 評論範例庫 | C3 決策與 D-03 的結果 |

## 4. 新增與修改的檔案總覽（階段 1–4）

| 類型 | 新增 | 修改 |
|---|---|---|
| spec 與文件 | — | `FIGMA_UI_AGENT_SPEC.md`（v1.5）、`FIGMA_MCP_RESEARCH.md`、`CC_BUILD_PROMPT.md`（v1.5 本機驗證指令）、`docs/backlog.md`、`README.md`、`CLAUDE.md`（版本號） |
| skill | `references/extension-spec.md`、`references/platform-checklist.md`；`snippets/extract-spec.js`、`design-lint.js`、`assert.js`、`layout-diff.js`、`quality-audit.js` | `SKILL.md`、`references/discovery.md`、`design-decisions.md`、`design-quality.md`、`runtime-probes.md` |
| schema | `schemas/spec.schema.json` | `plan.schema.json`（文案欄位、規則引用）、`inventory.schema.json`（元件屬性）、`audit.schema.json`（lint 結果、`unbasedProperties`） |
| 腳本 | `scripts/spec-profile.mjs` | `scripts/quality-metrics.mjs`、`validate-artifacts.mjs`、`evaluate-completion.mjs`（依 A3）、`operation-journal.mjs`（依 C1）、`hooks/pre-figma-call.mjs` |
| 依賴 | `acorn`（固定版本，給 hook lint 解析語法） | `package.json`、`package-lock.json` |
| 測試 | `tests/contracts/v15-*.test.mjs`、`tests/hooks/script-lint.test.mjs`；`tests/fixtures/` 新增規格表 fixture（由 M1／第一次任務去識別化資料製作） | — |

`snippets/*.js` 在 Figma 端執行，本環境只能用假節點（fake nodes）測試邏輯，和現有 `contracts/snippets` 測試相同做法；真實行為在階段 5 驗證。

## 5. 測試計畫（spec §13.2 新增，編號暫定）

| ID | 情境 | 預期 |
|---|---|---|
| T52 | 規格規則只出現 1 次或一致率 < 70% | 轉成問題，不得以 confirmed 呈現 |
| T53 | write 的 basisRefs 引用未確認或已凍結後被改的規則 | validator 拒絕 |
| T54 | 規格表凍結後修改規則但沒有 decisionRef | validator 拒絕 |
| T55 | 參考畫面的文字 style 對比不合格（第一次任務的 3.34:1） | 規格表標為品質不合格並列出同系列候選；不得 confirmed 照抄 |
| T56 | 新節點的間距不在規格的 scale 上，且沒有決策 | lint 回報違規；`unbasedProperties` > 0 |
| T57 | 半透明文字色疊在有色背景上 | 以合成後的顏色計算對比 |
| T58 | 腳本含 `figma.notify`、`r: 255`、未 await 的 `loadFontAsync` | hook lint 回報（C2=a 時為 warn，不擋；=b 時擋下） |
| T59 | 寫入腳本沒有回傳 created／mutated IDs | hook lint 回報 |
| T60 | 選 variant 時找不到符合的 variant | `assert.js` throw 並列出可用選項，不退回預設 variant |
| T61 | setProperties 使用錯誤的屬性 key | `assert.js` 讀回比對失敗並 throw |
| T62 | 政策題未回答，但有依賴該政策的 write | validator 拒絕（同 DEC-06） |
| T63 | 設計決策題目沒有任何候選 | 必須附「已搜尋的範圍」證據才能標為無建議 |
| T64 | layout-diff：參考與新建的 padding、sizing、binding 不同 | 列出差異欄位，無差異的欄位不輸出 |
| T65 | Plan 缺少畫面文案或長度 | validator 拒絕 plan confirmed |

## 6. 這次不做或做不到的

- 任何真實 Figma 讀寫：本環境沒有 Figma 連線；階段 0 的 U-01、U-02 與階段 5 都在本機執行。
- 升級 plugin：需要在你的電腦上操作。
- 學術來源的全文確認：本環境擋住 arxiv.org 等網站；寫進 spec 的只會是規則，不引用未確認的數字作為規範依據。

## 7. 風險

| 風險 | 處理 |
|---|---|
| 規格表太長，使用者直接「全部確認」 | 異常優先、高信心摺疊；階段 5 記錄確認時間與後續 findings |
| 角色推測（標題、內文、次要文字）錯誤 | 低信心一律轉成問題；使用者可用編號修改 |
| hook lint 誤判擋住合法腳本 | C2 預設先 warn；規則保守；每條規則有測試 |
| 信心門檻不合理 | 可設定；階段 5 校正 |
| `feat/m3` 尚未合併，之後有衝突 | 依 D3=b 從 `feat/m3` 開分支；若 `feat/m3` 再更新，以合併（不 rebase）同步 |
| spec 規則增加，skill 變長 | 細節放 references，`SKILL.md` 只放流程與出口（與現在相同） |
