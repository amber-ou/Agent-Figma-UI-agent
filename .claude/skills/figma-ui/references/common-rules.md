# 共通設計規則（spec §9.6，v1.9）

**什麼時候讀**：Plan（建立本次適用規則與狀態矩陣）與 Validate（逐條檢查、修正）。其他階段不需要讀。

**層級**：本檔由 `FIGMA_UI_AGENT_SPEC.md` 管轄；兩者不一致時以規格為準。gate（G1–G7）與完成判定（§12.1）不因本檔改變。原始提案與調整理由見 `docs/research/common-rules-proposal.md`。

本檔是設計工作規則，不是完整 WCAG 合規清單。優先度、自動修正策略與預設數值是本專案政策；引用的標準只適用於其指定情境。

## 1. 前提

- 平台沒寫或有歧義時先問（REQ-01），不預設 Web，不沿用上次平台。平台確認前可以做共通盤點，但不套用平台專屬的尺寸、單位、安全區、手勢與斷點。
- **對比不在本檔**：是否檢查文字與非文字對比依產品政策（§9.5、DEC-10）。政策為不適用時，本檔任何規則（含主題、焦點）都不重新加入對比門檻。CORE-04「不只靠顏色傳達資訊」與對比無關，照常適用。
- 遇到來源衝突、必要資訊缺漏或需要改變範圍時，依 §7.2 先問；不受影響的檢查可以繼續。
- 只影響動態行為的規則（多數 ADD 類、標 V 的項目）不提問（DEC-11），列入 handoff 給實作端驗證。

## 2. 分級、修正權限與結果

| 類別 | 定義 |
|---|---|
| P0 | 適用時優先處理，避免無法理解、操作或完成任務 |
| P1 | 建立一致、可維護且能適應內容的設計 |
| P2 | 依任務情境提升理解與效率，不機械套用 |
| 標準 | 引用 WCAG 的 Web 條件；原生 App 另查平台依據 |
| 指引 | 官方設計系統、Figma 文件或 UX 研究建議 |
| 政策 | 本專案選定的做法，不能宣稱為普遍標準 |
| A | 可自動修正，**只限**：屬於本 run 委派的類型（DEC-12），或只有一種合理修法（§8.3）；且語意明確、修正後驗證通過 |
| S | 提出建議；涉及取捨或資訊不足時依 §7.4 詢問 |
| V | 需要實作驗證；Figma 只驗證設計與交付註記 |

- 優先度不等於修改權限。唯讀審查只回報；不得為了通過規則擅改共享主元件、另建 tokens、detach instance 或擴大編輯範圍。
- 已核准 DS 的特殊值先視為可能的例外；影響本次功能時提出衝突，不靜默忽略或改庫。
- **逐條規則的結果**：`pass`、`fail`、`needs_review`、`not_applicable`、`not_tested`，記在 `audit.ruleChecks`（§20）。這組狀態**不取代** gate 與完成判定的狀態：
  - `not_applicable` 要寫原因；缺少互動資訊或測試證據不能標 `pass`。
  - `not_tested` 列入 `implementationVerificationRequired`，不算 `pass`。
  - `fail` 依影響轉成 finding（P0 影響交付時通常為 critical／major），由既有的 G3–G5 判定。
  - `needs_review` 在交付前要解決，或明確列為待決項目；不能當作通過。
- 每筆修正記錄：規則 ID、節點、原值與新值、原因、例外、來源、驗證方式、結果。

## 3. P0：核心可用性

| ID／規則 | 適用、判定與例外 | 處理／驗證 | 依據 |
|---|---|---|---|
| CORE-01 內容與操作可見 | 關鍵文字、錯誤訊息與主要操作不被意外重疊、裁切或浮層遮蔽；有意義的圖片裁切與可操作的捲動除外 | A/S：讀取邊界並看截圖；不一律關閉 Clip content | 政策、[S01] |
| CORE-02 點擊範圍 | Web 以至少 24×24 CSS px 為 AA 基準，依標準處理間距、等效控制、行內文字、原生控制與必要呈現的例外；量測 hit area，不只量 icon；重疊的不同操作不重複計入。44×44 是本專案觸控體驗目標（§9.5） | S/V：標出互動區；不能只憑外框判定通過。原生 App 另查平台要求 | 標準、[S02] |
| CORE-03 鍵盤與焦點 | 提供焦點樣式與合理操作順序；Web 焦點不被作者內容完全遮住；Modal 定義初始焦點、內部循環、關閉與返回位置 | S/V：檢查狀態與註記；Tab、Shift+Tab、Escape 等由實作測試 | 標準／指引、[S03][S04] |
| CORE-04 不只靠顏色 | 錯誤、成功、選取與圖表分類有文字、符號或其他辨識線索；重要 icon 操作註明可存取名稱 | S/V：檢查語意線索與實作名稱；不含對比計算 | 標準、[S05] |
| CORE-05 縮放與重排 | Web 文字放大到 200% 不遺失內容與功能；一般垂直閱讀內容在 320 CSS px 寬可重排（二維表格、地圖另處理）；320 不是所有平台的最小畫布 | A/S/V：窄版與長文字的設計檢查；瀏覽器縮放由實作驗證 | 標準、[S06][S07][S08] |
| CORE-06 表單與錯誤 | 標籤持續可辨識，不用 placeholder 取代；說明必填與格式；錯誤指出原因與修正方式，保留可用的輸入 | S/V：檢查正常、錯誤與重試；涉及敏感資料保留策略時先確認 | 指引、[S09][S10] |
| CORE-07 回饋與復原 | 重要操作有進行中、成功、失敗與適用的復原路徑；破壞性操作依後果決定確認或復原，不為每個動作加確認框 | S/V：走查提交、失敗、重試、取消；成功畫面不在取得成功結果前顯示。只影響動態行為的部分依 DEC-11 列入 handoff | 指引／政策、[S01] |

## 4. P1：設計系統與布局

| ID／規則 | 適用、判定與例外 | 處理／驗證 | 依據 |
|---|---|---|---|
| SYS-01 優先沿用資源 | 使用既有元件、variables、styles；按語意綁定，不因數值相同就互換品牌與狀態 token（INVARIANT-07） | A/S：讀回元件關係、binding 與 mode 生效值；缺資源先問 | 指引／政策、[S11] |
| SPACE-001 間距尺度 | padding、固定 gap、頁面外距採核准的 spacing token；沒有 spacing token 時才用 4px 尺度。**範圍與優先序見第 6 節** | A/S | 政策、[S12][S13] |
| SYS-03 布局與尺寸策略 | 規律列表、表單、操作群優先 Auto Layout；依內容選 Hug、Fill、Fixed、min／max；定位用的裝飾不強制改 Auto Layout | A/S：檢查文字增長、容器縮窄、項目增減；不全部改 Fill | 指引／政策、[S12] |
| SYS-04 文字角色 | 沿用標題、內文、標籤、說明、數據的 text style；字級不受 4px 倍數限制 | A/S：檢查字型可用性（含新建 instance 主元件的字型，§10.3）與中英數混排；不擅自替換缺失字型 | 政策 |
| SYS-05 元件狀態 | 依用途涵蓋 default、hover、focus、pressed、selected、disabled、loading、error 等，不要求每個元件全部具備；只交付 brief 約定的 requiredCells | A/S/V：建立適用狀態矩陣；觸控不能依賴 hover 才能完成操作 | 政策 |
| SYS-06 視覺一致 | 同角色的按鈕、欄位、圓角、邊框、icon 沿用規格；一般、緊密與觸控密度可以不同 | A/S：比較同角色、同密度元件；光學補償可註記例外 | 指引／政策、[S01] |
| SYS-07 響應式行為 | 定義何時換行、堆疊、收合、捲動、限制寬度；依內容決定斷點 | S/V：測斷點前後、長文字、大量項目；縮窄時不直接刪除重要功能 | 政策、[S12] |
| SYS-08 主題與模式 | 逐一檢查支援 mode 的 token 解析、文字／邊框／狀態語意與浮層呈現；不以換背景代表 mode 完成。只檢查本次 `requiredModes` | A/S：看各 mode 截圖；不含對比門檻 | 指引／政策、[S11] |

## 5. P2：理解與效率

| ID／規則 | 適用、判定與例外 | 處理／驗證 | 依據 |
|---|---|---|---|
| UX-01 操作層級 | 同一決策區域主要操作清楚；不強制整頁只能有一個主要按鈕 | S：依使用者當前任務走查 | 指引／政策、[S01] |
| UX-02 明確文案 | 按鈕描述實際動作，同概念用詞一致；避免含糊的「確定」與內部術語。文案內容依 DEC-14 確認，不由 agent 自行定稿 | S | 指引、[S01] |
| UX-03 資訊分組 | 以標題、對齊、距離呈現同組關係；組內距離通常小於組間距離，但不僅憑座標推定語意 | S | 政策 |
| UX-04 非理想情境 | 適用時提供空資料、無搜尋結果、載入、失敗、無權限、離線，說明原因與下一步；只交付 brief 約定的狀態，其餘列為建議 | S/V：與 CORE-07 共用回饋設計，不重複造元件 | 指引／政策、[S01] |
| UX-05 真實內容與語言 | 測長名稱、多行文案、日期、金額、翻譯膨脹；重要內容截斷時可取得全文 | A/S/V：用真實或明確標記的測試資料；不任意縮小字級塞內容 | 政策 |
| UX-06 動效 | 動效說明狀態或空間變化，並提供減少動態方案；有閃爍或自動播放風險時升為 P0 | 依 DEC-11 不提問，列入 handoff；閃爍風險另行標註 | 政策／標準、[S05] |

## 6. SPACE-001 細則

這是本專案約定，不是 WCAG 或所有設計系統的共同要求；官方系統也可能有 2px 等間距 [S13]。

**範圍（v1.9 調整）**：

- **只套用在 agent 本 run 新建的節點**，且屬於本 run 委派的 `spacing` 類型（DEC-12）或只有一種合理值。
- **既有 pattern 的數值優先**：照參考畫面或已確認 pattern 建立時，沿用其原值（例如 13px），不取整（DEC-03）。
- 不修改既有節點、參考畫面或共享元件的間距；`modify` 任務也只在使用者指定的範圍內，且仍以既有 pattern 為準。

**取值順序**：

1. 先確認平台與核准 DS；Figma 的 padding、gap 與頁面外距分別辨識，不假設所有節點都有 CSS margin 欄位 [S12]。
2. 有 spacing token 時用語意適用的核准 token；既有合法 binding 不因數值非 4 的倍數就覆寫。
3. 沒有 spacing token、也沒有適用的既有 pattern 時，採 `0、4、8、12、16、20、24、32、40、48、64` 尺度。這是取值集合，**不代表已獲准新增 variables**。
4. 在合法且符合布局限制的候選中選最接近原意的值；等距時取較大值（例如 14 → 16）；若 16 造成布局失效而 12 可用，改 12 並記錄原因。本次需求可以覆寫這個策略。
5. 0 可用，但不自動消除原本有意義的分隔。負間距、刻意重疊、極小光學補償交由例外判定，不套一般取整。
6. 不取整：Auto gap、比例或剩餘空間計算值、字級、描邊、向量路徑、圖片比例、平台安全區、核准例外。
7. 修改後檢查受影響父子層的溢出、換行、對齊、分組與互動區；不通過就試下一個合法候選，沒有安全候選就還原並回報。
8. 比較時可用 0.01 Figma 單位容差防浮點誤差（政策），不得藉此把語意不明的值當成合法。

## 7. 情境規則（功能存在時才啟用）

不為了清單新增功能。標準條款按 Web 使用，原生平台另查。這些多屬實作行為：設計上看得到的部分照常檢查，只影響動態行為的部分依 DEC-11 列入 handoff，不提問。

| ID／優先度／規則 | 判定、例外與處理 | 驗證 | 依據 |
|---|---|---|---|
| ADD-01／P0 拖曳替代操作 | 拖曳排序、看板搬移、滑桿提供單一指標、不需拖曳的等效操作（上移／下移、移至選單、數值輸入）；只有鍵盤替代不足 | S/V | 標準、[S14] |
| ADD-02／P0 Hover／Focus 額外內容 | 自訂 tooltip、子選單能不移走指標或焦點而關閉（如 Escape）；指標可移入額外內容；必要資訊不只在 hover 可得 | S/V | 標準／政策、[S15] |
| ADD-03／P1 避免重複輸入 | 同一流程已提供的資訊自動帶入或可選取；必要、安全或失效資訊除外 | S/V | 標準、[S16] |
| ADD-04／P0 可輔助的登入驗證 | 登入不只依賴記憶／抄寫等認知測驗；支援密碼管理器、自動填寫與貼上；不把此規則誤寫成禁止密碼，也不強制新增特定登入服務 | S/V | 標準、[S17] |
| ADD-05／P0 可預期的輸入結果 | 改變欄位或選項不在未預告時自動導頁、提交或改變情境 | S/V | 標準、[S18] |
| ADD-06／P1 重要提交前核對與完成憑據 | 多步驟或後果重大的提交提供核對與修改路徑；完成頁說明已完成事項、參考編號（如有）與下一步；輕量操作不強制 | S/V：與 CORE-07 共用一次驗證 | 指引／政策、[S19][S20] |

ADD-03 標 P1 是本專案的處理順序，不代表來源的 WCAG A 要求可以忽略；採用的條款都要列入交付狀態。

## 8. 審閱與修正循環

1. Plan：建立本次適用規則、平台、頁面、尺寸、主題、狀態矩陣；不適用的逐項寫原因。
2. Validate：先結構檢查，再看實際截圖與流程；數值合法不等於布局或 UX 良好。
3. 每輪先處理 P0，再 P1、P2；新問題依影響重新分級，不為了修間距破壞關鍵操作。
4. 修正後重檢受影響規則與相鄰容器；同樣的輸入再跑一次，不應產生來回修改或重複元件。
5. 每輪記錄問題、假設、改動與證據。未達條件時換其他有依據的修法再驗證，**不重跑同一個失敗動作**；沒有新證據、規則互斥或缺必要資訊時先問，保留進度。連續 3 次修正仍未改善同一問題時回報（§8.3）。
6. 實作未測的項目標 `not_tested` 並寫出檢查方法，不算 pass，也不據此宣稱完整 WCAG 合規。
7. 未解決的缺陷與已接受的例外分開列；例外要有理由、影響與使用者的接受紀錄，agent 不能自行把失敗改成例外。

**證據限制**：本規則集只完成文件與來源審閱，尚未以真實 Figma 任務驗證誤報率或自動修正效果。需要時再依平台補查原生觸控目標、文字縮放、安全區與系統導覽，或依產品補充高密度表格、複雜圖表、多語／RTL、媒體與時間限制規則；這些是待研究項，不冒充已完成的規則。

## 9. 來源

查核日：2026-10-03（由原提案作者查核；雲端 session 未逐一重新開啟）。WCAG Understanding 用於解釋條款，正式要求以 WCAG 規範為準。

- [S01：NN/g，10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [S02：W3C，Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [S03：W3C，Focus Not Obscured Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- [S04：W3C APG，Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [S05：W3C，WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [S06：W3C，Resize Text](https://www.w3.org/TR/WCAG22/#resize-text)
- [S07：W3C，Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [S08：W3C，Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)
- [S09：GOV.UK，Text Input](https://design-system.service.gov.uk/components/text-input/)
- [S10：GOV.UK，Error Message](https://design-system.service.gov.uk/components/error-message/)
- [S11：Figma，Variables Collections and Modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)
- [S12：Figma，Auto Layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- [S13：SAP，Spacing](https://www.sap.com/design-system/digital/foundations/layout/spacing/)
- [S14：W3C，Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- [S15：W3C，Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
- [S16：W3C，Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry)
- [S17：W3C，Accessible Authentication Minimum](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)
- [S18：W3C，On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html)
- [S19：GOV.UK，Check Answers](https://design-system.service.gov.uk/patterns/check-answers/)
- [S20：GOV.UK，Confirmation Pages](https://design-system.service.gov.uk/patterns/confirmation-pages/)
