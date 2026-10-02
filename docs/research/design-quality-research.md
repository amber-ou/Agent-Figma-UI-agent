# 設計品質提升研究

日期：2026-09-29 · 對應 spec v1.4 · 狀態：研究建議，**尚未實作、尚未實測**

> **v1.6 狀態（2026-09-29）：**研究紀錄；本文件的建議未排入 v1.6。


`docs/research/use-figma-quality-research.md` 處理的是「做得對不對」（API 用法、DS 選用、版面數值）。本文件處理「做得好不好」：畫面的層級、一致性、文案與可用性。建議項目登記在 `docs/research/backlog.md`（D-xx）。

## 1. 來源與限制

- 本專案實測：M1（`docs/history/m1-summary.md`）與第一次真實任務（`docs/history/m3-first-run-summary.md`，run `ui-20260928-001`）。
- 學術研究：以網路搜尋取得摘要。**本次雲端環境擋住 arxiv.org、berkeley.edu、machinelearning.apple.com，未能讀全文**；引用的數字來自搜尋結果中的論文摘要，若要寫進 spec 應先讀原文確認。
- 分級沿用 `FIGMA_MCP_RESEARCH.md`：D 官方／論文、E 本環境觀察、P 專案設計、U 未驗證。

## 2. 第一次真實任務暴露的設計品質問題

| 問題 | 發現時機 | 本質 |
|---|---|---|
| 說明文字對比 3.34:1，照抄參考畫面 01-04 | Validate（G5） | 沿用 pattern 時沒有同時檢查 pattern 本身的品質；v1.4 已加 Plan 預檢 |
| Status Bar 沒有瀏海，與參考不一致 | Validate，自行修正 | 平台慣例（安全區、系統列）沒有在 Plan 列成檢查項 |
| 成功圖示（dec-105）沒有建議，被略過 | Plan | agent 沒有從 DS 盤點出候選，所以無法給建議 |
| 漸層是 raw 值 | Plan，已標為例外 | 參考畫面本身沒有 token；屬 baseline |
| 新舊 Button instance 結構不同（1 個 vs 2 個 icon） | Validate | 同一元件的版本／override 差異 |

共同點：**缺陷大多在 Validate 才被看見，而且靠模型看截圖發現**。品質提升的方向是：把能計算的檢查提前到 Plan、變成數字；把只能靠判斷的部分，改成有依據、可複查的評論。

## 3. 研究發現

### 3.1 LLM 的設計評論有用，但準確度有限

**D：**

- Duan 等人（CHI 2024）以 GPT-4 在 Figma plugin 內依文字化的 heuristics 產生回饋，測 51 個 UI、3 組 guidelines（Nielsen 10 項可用性 heuristics、CrowdCrit 的視覺設計原則、5 條語意分組 guidelines）。建議中 **52% 準確、19% 部分準確、29% 不準確**；49% 被評為有幫助。擅長抓細微錯誤、改善文字、考慮 UI 語意；**重複迭代後回饋的效用下降**。
- 2025 年一項研究讓 GPT-4o 以 Nielsen heuristics 評估網頁截圖：只找到人類專家所發現問題的 **21.2%**，另外提出 27 個新問題，也有因幻覺與臆測產生的誤報。美學與極簡、與真實世界一致這兩類表現較好；彈性、控制與效率類較差。作者建議 LLM 先做初篩，再由人過濾。

**P，對本專案的意義：**模型看截圖的自我評論只能當「待查的假設」，不能當通過證據，也不能自動套用修正。要讓評論有用，需要（a）固定的準則，（b）可定位的證據，（c）人工確認。

### 3.2 範例與「放大」讓評論更準

**D：**

- UICrit（UIST 2024）收集 7 位資深設計師對 983 個手機 UI 的 3,059 則評論與評分。以**依任務與視覺相似度挑選的 few-shot 範例**，再加上**視覺提示**（為每則評論標出 bounding box），LLM 回饋品質提升 55%，設計專家評為顯著優於 zero-shot。
- 後續研究（Visual Prompting with Iterative Refinement）讓模型同時看整張圖與**放大的局部區塊**（邊緣附座標刻度），反覆修正評論文字與位置，直到評論和區域相符。

**P：**

- 評論要綁定到節點 ID 與局部截圖，而不是對整張縮圖泛泛而談。本專案可以做得比論文更精確：我們有節點樹，可以直接用 `node.screenshot({ scale: 2 })` 截局部，並附上該節點的量測值。
- few-shot 範例可以來自本專案過去的 findings（F-001～F-004、第一次任務的 G5 等）與使用者對評論的接受／否決紀錄，逐步累積成產品專屬的評論範例庫。

### 3.3 絕對評分與兩兩比較各有偏差

**D，證據不一致：**

- 支持比較的一方：LLM-as-judge 的綜述與 UI 評測研究指出，絕對評分（例如 0–5 分）有向中間集中、錨定等偏差；兩兩比較讓模型專注在差異上，與人類的一致率較高（搜尋摘要稱平均高約 8%）。人類設計師之間也是比較式判斷比量表更一致。
- 反對的一方：「Pairwise or Pointwise?」（2025）發現，加入表面特徵的干擾時，**兩兩比較的偏好有 35% 會翻轉，絕對評分只有 9%**；生成端可能利用評審偏好的表面特徵拿到高分。兩兩比較另有位置偏差。

**P，對本專案的意義：**兩種方式都不應單獨作為品質證據。本專案的目標是「延伸既有設計」，好不好的基準是既有產品，所以建議做**以參考畫面為基準、以量測為依據的差異檢查**：「新畫面與參考畫面在標題層級／間距節奏／主次按鈕上是否一致？哪裡不同？」每個差異都要對應到節點與量測值，這樣就不依賴模型的偏好判斷，也不怕表面特徵干擾。spec §12.3 的 0–5 rubric 已明訂只作診斷，維持。

### 3.4 很多設計違規可以用規則偵測

**D：**

- UIS-Hunter（ICSE 2021）把 Material Design 的 93 條「不要這樣做」準則（layout、typography、iconography、navigation、communication、color、shape，以及元件的 anatomy、placement、behavior、usage）轉成規則，從元件資訊、字型、圖示、顏色、邊界偵測違規；在 9,286 個 app 的 60,756 個 UI 中，有 7,497 個 UI 至少違反一條。
- UISGPT（2024）用 LLM 把 guidelines 形式化後偵測違規，F1 0.729。

**P：**本專案讀得到完整節點樹（座標、尺寸、styles、bindings、元件、字型），比從截圖或 APK 推測的研究條件更好。**可量化的品質項目應該用確定性的規則檢查**，模型判斷留給規則做不到的部分（語意、層級是否合理、文案）。

### 3.5 設計師的回饋方式影響成效

**D：**Apple 2025 年的研究讓 21 位設計師用熟悉的方式（評論、草圖、直接修改）對生成的 UI 提供 1,500 則標註，用這些資料微調的模型勝過用傳統排序回饋訓練的模型。

**P：**本專案不微調模型，但原則可以借用：讓使用者**直接在 Figma 改**或指著某個區域說明，比回答「A 或 B」提供更多資訊。collaboration 模組已能偵測使用者對 agent 節點的修改；可以把使用者的修改轉成本 run 的明確設計決策（例如「使用者把間距從 16 改成 24」→ 記錄並套用到同類區塊，先詢問確認）。

### 3.6 官方與產品端的經驗

**D（官方 skill 與 Figma 說明）：**

- 延伸畫面時優先依序參考：Code Connect → **既有畫面實際使用的元件與 bindings** → library 搜尋。本專案沒有程式庫，既有畫面就是最權威的來源（已在 discovery.md）。
- Figma 的 agent 說明也強調：品質與 DS 的組織程度、提示中是否明確引用元件／變數／styles 直接相關。

## 4. 建議

依「效益／成本」排序。每項對應 backlog 的 D-xx。

### D-01 產品設計語言側寫（Design profile）

在 Discover 從 2–3 張參考畫面**量化**產品的設計語言，寫進 `inventory.json` 的新欄位（例如 `designProfile`）：

- 間距：所有 padding／gap 值的分佈 → 實際使用的 spacing scale 與對應 variable
- 字級：各角色（頁面標題、區塊標題、內文、說明、按鈕）實際使用的 text style
- 顏色：各角色使用的 paint style／variable（背景、卡片、主要文字、次要文字、強調、錯誤、成功）
- 圓角、陰影（effect style）、分隔線
- 對齊：主要內容的左右邊界、欄寬
- 密度：每個畫面的主要區塊數、每區塊元件數
- 主次按鈕：每個畫面主按鈕的數量與位置
- 用詞：參考畫面的關鍵詞彙（例如「名片」「分享」「返回」），供文案一致性使用

這把 v1.2 的 pattern 盤點（§6.6）從「逐項記錄」提升為「可比對的基準」。後面的 lint（D-02）與比較（D-04）都以它為準。

### D-02 設計 lint：可計算的品質檢查

在 Validate（部分提前到 Plan）用一次唯讀 `use_figma` 對本 run 的新節點計算，回傳違規清單：

| 檢查 | 做法 | 對應 |
|---|---|---|
| 文字對比 | 讀每個文字節點的生效文字色與**合成後的背景色**（往上找第一個不透明填色，考慮透明度），算對比；< 4.5（大字 < 3）列出 | G5，自動化 v1.4 預檢 |
| 間距在 scale 上 | 新節點的 padding／gap 值 ∈ `designProfile` 的 scale；否則要有 decisionRef | UI 9.2、DS-01 |
| 字級與 styles | 新文字只使用 profile 中該角色的 text style；新增的字級要有決策 | 9.2 |
| 對齊 | 同一容器中主要子節點的左邊界差距 ≤ 1px；非 auto-layout 容器裡兄弟節點不重疊 | G4 |
| 主次按鈕 | 每個畫面主按鈕數量與 profile 一致（通常 1 個） | UI-01 |
| 點擊區 | 可互動 instance ≥ 24×24（觸控體驗目標 44×44 另列） | G5 |
| 最小字級 | 不小於 profile 中出現過的最小字級 | 9.2 |
| 文字截斷與溢出 | 見 use_figma 研究 4.5 | G4 |
| 平台慣例 | 手機：status bar、安全區、home indicator、導航列高度與參考一致 | D-06 |

**Plan 階段**：對 plan 引用的 styles 預先算對比（不需要畫布上已有新節點，只要有 style 的顏色與預期背景），這樣第一次任務的 3.34:1 會在 Plan 就被抓到，並從同系列 styles 中列出對比足夠的替代品。

### D-03 結構化評論：有準則、有定位、有證據

取代「看截圖、覺得哪裡怪」的自由評論：

1. **固定準則**：分三組，與 Duan 等人的做法相同——可用性（Nielsen 10 項）、視覺設計原則（層級、對齊、對比、一致、留白）、語意分組（相關的東西放一起、區塊邊界清楚）。規則已經能檢查的（D-02）不再交給模型判斷。
2. **逐區塊**：每個 section 用 `scale: 2` 截局部，連同該 section 的量測值與 profile 一起看。
3. **每則評論必須有**：節點 ID、準則編號、具體觀察（量測值或截圖中的位置）、建議修改、信心（高／中／低）。沒有節點 ID 或觀察的評論丟棄。
4. **評論是假設**：記為 finding `status: hypothesis`；只有能用量測或讀回確認的才升為正式 finding。多種合理修法時照 §7.4 詢問。
5. **獨立的審查者**（P，未驗證）：用一個只拿到截圖、brief、profile 與準則的子代理來評論，不給它建構過程的上下文，降低「自己做的自己看都對」的偏差。效益需要實測比較。
6. **次數上限**：研究顯示迭代後效用下降；spec §8.3 已規定同一問題連續 3 次修正無改善就回報，維持。

### D-04 與參考畫面比較，取代絕對評分

Validate 時把新畫面與最相近的參考畫面**同比例**截圖並排，逐維度問「一致或不一致、差在哪」，而不是各自打 0–5 分：

- 維度沿用 §12.3（任務與資訊層級、排版與視覺一致、DS 結構、響應式與狀態、可及性、交付清晰度）。
- 每個「不一致」要對應到 D-02／`layout-diff` 的數值差異才成立；只有觀感、沒有量測的差異記為 `hypothesis`。
- 交換圖片順序各判一次；兩次結果不同的項目視為不確定（3.3 的位置偏差與干擾問題）。
- §12.3 的分數可保留作診斷，但報告以「差異清單」為主。需要修改 spec §12.3 的說明。

### D-05 設計決策用視覺選項呈現，並先從 DS 找候選

- dec-105（成功圖示）被略過，是因為 agent 沒有候選可建議。規則：**每個設計決策題目在提問前，先從 DS 與參考畫面找候選**（例如在 icon set 搜尋 success／check／complete，列出 2–3 個並附使用次數）。真的找不到才標為「無建議」。
- 影響外觀的決策（漸層與否、圖示、版面排法），在 sandbox 的 run Section 旁建立 2–3 個**小型並排選項**（只做受影響的區塊），截圖後讓使用者選。§8.2 已允許小範圍概念稿；選完刪除未選的選項（屬於本 run 的 owned 節點）。
- 選項要帶上對硬性門檻的影響（例如「選項 2 的文字對比 3.3:1，不符 G5」），v1.4 DEC-07 已要求。

### D-06 平台慣例檢查表

在 Intake 確認平台後，於 Plan 產生平台檢查項，Validate 用 D-02 檢查：

- iOS：status bar 高度與瀏海／動態島、安全區、home indicator、導航列、44pt 觸控體驗目標
- Android：status bar、系統導航列、48dp 觸控體驗目標
- Web：斷點、捲動區域、sticky 行為（UI-05／06 已有）

數值以參考畫面實際使用的元件為準（例如 Status Bar instance），平台文件只作為「有沒有漏掉」的清單。第一次任務的瀏海問題屬於此類。

### D-07 內容先行與文案一致

- Plan 階段先寫出**所有實際文案與範例資料**（含長度），再建畫面；UI-02、UI-07 已有原則，這裡把它變成 plan 的必要欄位。
- 文案用詞以 D-01 的詞彙表為準；新詞列為設計決策（REQ-04 的品牌名稱是其中一種）。
- LLM 在改善文字上表現較好（3.1），可以在 Plan 對文案做一次結構化檢查：是否清楚、是否與既有用詞一致、錯誤訊息是否說明原因與下一步、長度是否在元件可容納範圍內。
- 使用者的帳號裡有 `ux-knowledge-base` skill（含 UX 文案框架與 checklist）；**本機 Claude Code 是否可用未確認（U）**，可用時在 Plan 的文案檢查中引用。

### D-08 把使用者在 Figma 的修改轉成決策

當 collaboration 偵測到使用者改了 agent 的節點（§11.2），除了不覆寫之外，詢問使用者：「你把 X 從 16 改成 24，要套用到同類的其他區塊嗎？」確認後記為本 run 的設計決策（`source: user`），並更新 profile 中本 run 的規則。這讓使用者用最自然的方式（直接改）表達偏好。

### D-09 跨 run 的評論範例庫（需決策）

累積過去 runs 中**使用者確認過**的 findings 與設計決策，作為 D-03 的 few-shot 範例。這和 INVARIANT-01（新 run 不沿用舊設定）有張力：範例庫不是設定，而是評論的參考。若採用，應在 Intake 列出「本次會參考哪些過去的範例」讓使用者確認。需要使用者決定是否採用。

## 5. 不建議的做法

- **以模型自評分數判定品質**：研究顯示準確率約一半，且有誤報；spec 已禁止分數參與完成判定，維持。
- **自動套用模型的修正建議**：先確認問題存在（量測或讀回），多種修法時詢問。
- **增加截圖數量代替檢查**：用 D-02 的數值檢查與 D-03 的局部截圖取代重複的整頁截圖。
- **以平台規範覆蓋產品既有做法**：延伸設計以產品一致性為先；平台規範只用來發現遺漏，衝突時列出並詢問。

## 6. 建議的順序

1. D-01 profile ＋ D-02 lint（先做對比、間距 scale、字級、對齊四項）：確定性、可寫 fixture 測試，而且能把第一次任務的 G5 問題提前到 Plan。
2. D-05 候選先行與視覺選項：直接減少被略過的決策，也讓決策品質更好。
3. D-06 平台檢查表、D-07 內容先行。
4. D-03 結構化評論、D-04 參考比較：需要真實任務比較效果。
5. D-08、D-09：需要先完成 M3 的協作實測（T35–T37），D-09 另需使用者決策。

## 7. 來源

- 本專案：`docs/history/m1-summary.md`、`docs/history/m3-first-run-summary.md`、`FIGMA_UI_AGENT_SPEC.md` v1.4 §6.6、§7.4、§8.2–8.3、§9、§12.3
- Duan, Warner, Li, Hartmann. [Generating Automatic Feedback on UI Mockups with Large Language Models](https://dl.acm.org/doi/10.1145/3613904.3642782). CHI 2024.（[arXiv](https://arxiv.org/abs/2403.13139)）
- Duan et al. [UICrit: Enhancing Automated Design Evaluation with a UI Critique Dataset](https://dl.acm.org/doi/10.1145/3654777.3676381). UIST 2024.（[arXiv](https://arxiv.org/abs/2407.08850)）
- [Visual Prompting with Iterative Refinement for Design Critique Generation](https://arxiv.org/abs/2412.16829)
- [Can GPT-4o Evaluate Usability Like Human Experts? A Comparative Study on Issue Identification in Heuristic Evaluation](https://arxiv.org/abs/2506.16345)
- [Pairwise or Pointwise? Evaluating Feedback Protocols for Bias in LLM-Based Evaluation](https://arxiv.org/abs/2504.14716)；[A Survey on LLM-as-a-Judge](https://arxiv.org/abs/2411.15594)；[UI-Bench](https://arxiv.org/html/2508.20410v3)
- Yang et al. [Don't Do That! Hunting Down Visual Design Smells in Complex UIs Against Design Guidelines](https://dl.acm.org/doi/10.1109/ICSE43902.2021.00075). ICSE 2021（UIS-Hunter）
- [UISGPT: Automated Mobile UI Design Smell Detection with Large Language Models](https://www.mdpi.com/2079-9292/13/16/3127)
- Apple ML Research. [Improving User Interface Generation Models from Designer Feedback](https://arxiv.org/abs/2509.16779). 2025
- [figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)（`figma-generate-design`）；[Figma Help：Work with the Figma agent in design files](https://help.figma.com/hc/en-us/articles/37998629035799-Work-with-the-Figma-agent-in-design-files)
