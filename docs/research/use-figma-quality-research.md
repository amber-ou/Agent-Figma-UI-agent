# `use_figma` 品質與精準度研究

日期：2026-09-28 · 對應 spec v1.3 · 狀態：研究建議，**尚未實作、尚未實測**

> **v1.6 狀態（2026-09-29）：**研究紀錄。v1.6 採用了批次與截圖節奏、位元組分頁、Figma 端字型比對，但**保留每次寫入後的獨立讀回**（不採第 5.1 節的選項 2／3）。


建議項目已登記在 `docs/research/backlog.md`（U-01～U-11），狀態以該檔為準。

目的：找出能讓 `/figma-ui` 透過 `use_figma` 產出的畫面「更像既有設計、更正確使用 DS、錯誤更少」的方法，並對應到本專案現有的流程與 M0–M2 發現。本文件不修改 spec；要採用的項目需另行決策後寫回 `FIGMA_UI_AGENT_SPEC.md`。

## 1. 來源與證據分級

分級沿用 `FIGMA_MCP_RESEARCH.md`（D 官方、E 本環境觀察、P 專案設計、U 未驗證）。

- 主要來源：官方 [figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)，commit `38308b7`（2026-09-25，skills **2.2.123**）的 `skills/figma-use/`、`skills/figma-generate-design/` 全文與 references（gotchas、component-patterns、variable-patterns、validation-and-recovery、working-with-design-systems）。
- 使用者本機的 plugin 是 **2.2.118**（M0）。已比對 2.2.118 → 2.2.123 的差異（第 2 節）。
- `developers.figma.com` 在本次雲端環境仍被網路政策阻擋，未能直接查證 Plugin API 文件；依賴 API 行為的項目標 U。
- 本次沒有連線到任何 Figma 檔案，所有建議都未在真實畫布驗證。

## 2. 官方 skill 最新變化（2.2.118 → 2.2.123）

**D：**官方把 Rule 5 從「拆成小步驟、每步都驗證」改成：

- 以「可安全重試」決定呼叫邊界，**不為了驗證而拆**；一個完整 section 甚至一頁可以在一次呼叫內建好。只有跨頁、部分執行難以恢復、或實際失敗需要針對性重試時才拆。
- 寫入腳本回傳的 IDs、數量、名稱、bounds **本身就算結構驗證**；只有缺證據或之後又有相關修改時才另外讀。
- 截圖：組合完成一張、視覺修正後一張，最後一張通過的就是最終證據；不要逐 section 截圖，也不要重複截沒有變化的畫面。
- `figma-generate-design` 新增硬性門檻：交付物必須是可編輯的圖層，完成前要讀回 wrapper 的後代數量與各節點類型數量，以及所有圖片填色節點；整頁截圖只能當參考，不能放進交付物。

**與本專案的差異（P）：**`SKILL.md` 第 4 節要求「一次一個 operation，並用另一個 read operation 讀回驗證」，spec §12 要求「以讀回驗證，不以寫入回應代替」。這比官方新版保守。本專案有協作與恢復的理由（fingerprint、unknown_outcome），所以不建議直接照搬，但可考慮第 5.1 節的折衷。

**建議：**升級 plugin 到 2.2.123 以上，並依 `references/runtime-probes.md` 重跑 probe；把 plugin 版本寫入每個 run 的 `capabilities.json`（已有欄位）。

## 3. 品質問題的四個來源

「不精準」多半來自以下其中一類，對策不同：

| 類別 | 典型症狀 | 本專案已有的處理 | 缺口 |
|---|---|---|---|
| A. DS 選用 | 選錯 variant、文字 override 沒生效、綁錯或沒綁 variable、字型錯 | component map、variable map、resolveForConsumer、baseline 分開 | 元件屬性合約沒有系統性取得；variant 選取與 setProperties 可能靜默失敗；沒有字型斷言 |
| B. 腳本正確性 | API 誤用（HUG/FILL 順序、0–255 色值、未 await、字型未載入） | 依賴官方 skill 的 Critical Rules | 全靠模型自律，沒有機械檢查 |
| C. 版面還原 | 數值「看起來差不多」但與參考畫面不同（M1 的 131／129） | discovery §5「照抄實際做法」、建好後量測 | 量測與比對是手動的，沒有固定的差異報表 |
| D. 驗證 | 截圖解析度低看不出裁切；證據不一致 | G3–G5、evidence 規則 | 缺少自動化的結構稽核腳本 |

## 4. 建議（依效益排序）

### 4.1 元件屬性合約：在 Discover 從 library 檔唯讀取得（A，高效益）

**D：**TEXT／BOOLEAN／INSTANCE_SWAP 屬性的 key 帶 `#uid` 後綴（例如 `Label#1234`），只有 VARIANT 是純名稱。**`setProperties` 用錯 key 會靜默無效**。官方建議先讀 `componentProperties`，並檢查**巢狀 instance** 自己的 TEXT 屬性；只有不受任何屬性管理的文字才直接改 `characters`。讀 `componentPropertyDefinitions` 必須在 COMPONENT_SET 或非 variant 的 COMPONENT 上，在 variant 上讀會 throw（Rule 18）。

**P，建議做法：**

1. Discover 時對 `componentMap` 裡每個元件，對 **library 檔本身**執行唯讀 `use_figma`（官方 generate-design 2a-i 就是這樣對 library fileKey 解析 key），回傳：屬性定義（含 `#uid` 完整 key、型別、預設值、variant 選項）、巢狀 instance 的 TEXT 屬性、各 TEXT 節點的 `componentPropertyReferences`、各 variant 的尺寸與子節點摘要。
   - 這樣不必在目標檔建立暫存 instance（官方做法是建立後再刪除，在本專案屬於寫入，要走 journal）。
2. 存進 `inventory.json` 的 componentMap（schema 需要新增 `properties` 欄位）。
3. M1 的 bl-001（Button 無 TEXT property）應再確認**巢狀 instance** 是否有 TEXT 屬性；若有，改用巢狀 instance 的 `setProperties` 比覆寫 `characters` 更穩定（官方說直接改受屬性管理的文字可能在渲染時被屬性系統覆蓋）。

### 4.2 寫入腳本內的後置斷言（A、B，高效益，低成本）

很多失敗是**靜默**的：`setProperties` key 錯、`find(...) || defaultVariant` 退回預設 variant、TEXT 在 `WIDTH_AND_HEIGHT` 模式下忽略 FILL 而塌成細線、字型載入成功但不是產品字型。

**P，建議做法（新增 `snippets/assert.js`）：**

- **選 variant 不用 fallback**：把 variant 名稱解析成屬性表後完全比對；找不到就 `throw`，列出可用選項。不要照抄官方範例的 `|| compSet.defaultVariant`。
- **setProperties 後讀回**：比對 `instance.componentProperties[key].value` 是否等於設定值，不等就 throw。
- **尺寸斷言**：`width > 0`、wrap 文字 `textAutoResize === 'HEIGHT'`、要求等寬的元素量測後回傳實際寬度。
- **字型斷言**：官方 `discover-product-font.md` 的讀回腳本，把自己建立的文字（要修）和 DS 管理的文字（instance 內或有 text style，只記 gap）分開。M0 觀察到既有畫面使用 SF Pro、Roboto、Inter、Outfit，但 M1 新文字只驗證了 Inter 能用，沒有驗證「應該用哪個」。

**U，需先 probe：**腳本中途 throw 時，之前的修改是否保留（部分寫入）。官方以 `safeToRetryWithoutCanvasRead` 表示可能部分套用。建議在 sandbox 測：先建一個節點再 throw，讀回看節點是否存在，把結果寫入 `runtime-probes.md`。在驗證前，斷言要放在所有修改**之前**（讀取與檢查放前面），或把 throw 的寫入當成 `unknown_outcome` 處理。

### 4.3 在 PreToolUse hook 加入腳本靜態檢查（B，高效益，完全可離線測試）

**D：**官方 Pre-Flight Checklist 列出的錯誤大多可以用字串或簡單語法規則偵測。**E：**本專案的 hook 已經能讀到 `tool_input`（M1 hooktest-01）。

**P，建議在 `scripts/hooks/pre-figma-call.mjs` 加一層 lint**（違反時 deny 並附原因，模型修正後重送）：

| 規則 | 偵測 | 官方依據 |
|---|---|---|
| 不可 `figma.notify(` | 字串 | Rule 3 |
| 不可 `figma.currentPage =` | regex | Rule 9 |
| 不可包 async IIFE、不可 `figma.closePlugin(` | regex | Rule 1–2 |
| 必須有頂層 `return` | 語法解析（例如 `acorn`，需新增依賴） | Rule 15 |
| 色值 > 1（`r: 255` 之類）、paint color 內有 `a:` | regex／AST | Rule 6 |
| `loadFontAsync`、`setCurrentPageAsync`、`import*ByKeyAsync` 未 await | AST | Rule 17 |
| 同一腳本多次 `setCurrentPageAsync` | 計數 | Rule 9 |
| write 腳本回傳物件不含 created／mutated IDs | AST（找 return 物件的鍵） | Rule 15 |
| 寫入腳本含 `detachInstance(` | 字串；本專案本來就禁止 detach | spec G3 |
| `|| defaultVariant` fallback | 字串 | 本文件 4.2 |

這一層是機械、確定性的，可以寫 fixture 測試（`tests/hooks/`），和現有 op 標頭檢查同一個位置。風險：誤判時會擋住合法腳本，所以規則要保守，並提供明確訊息。

### 4.4 版面差異報表：參考節點 vs 建立節點（C，高效益）

M1 的寬度問題（131／129 vs 130／130）是靠人工比對發現的，原因推論還被推翻過一次。

**P，建議新增 `snippets/layout-diff.js`：**一次唯讀 `use_figma`，傳入參考節點 ID 與建立節點 ID，**逐層**對齊子節點（依 mainComponent key 或名稱），回傳差異清單：

- 尺寸、`layoutMode`、padding、`itemSpacing`、對齊、`layoutSizingHorizontal/Vertical`、`layoutGrow`、`primaryAxisSizingMode`／`counterAxisSizingMode`
- `boundVariables`（哪些屬性綁了哪個 variable，參考有綁但新建沒綁 → 差異）
- instance 的 mainComponent key、variant 屬性、`componentProperties`
- 文字的 `fontName`、`fontSize`、`textStyleId`、`lineHeight`

輸出只列有差異的欄位（控制在 20 KiB 內），作為 G3 的結構證據，也作為 finding 的量測依據（符合 INVARIANT-16：先有量測，再談原因）。

### 4.5 自動化結構稽核腳本（D，中高效益）

**P，建議新增 `snippets/quality-audit.js`**，對本 run 的 Section 或 wrapper 執行一次，回傳精簡 JSON：

- 後代總數與各節點類型數量；圖片填色節點清單（對應官方新版的可編輯性門檻）
- 本次新建節點中，**有 raw 色值／間距但沒有 `boundVariables`** 的屬性（tokenBinding 分母與分子）
- 被 detach 的節點（原本應該是 instance 的 FRAME）；不是 auto-layout 但有多個子節點的容器（官方 Rule 12a）
- 文字：`hasMissingFont`、`textAutoResize`、寬度接近 0、文字高度超出有 `clipsContent` 的父層（裁切風險）
- 非 auto-layout 容器中，兄弟節點 bounds 互相重疊
- 仍為 `placeholder = true` 的節點；仍是元件預設文字的 instance（例如「Button」「Title」）
- Section 是否包住全部內容（**D：**Section 不會自動調整大小；M1 op-0003 也手動調過）

這些是截圖容易漏看的項目；截圖仍然需要，但用來看層級、平衡與整體觀感。

### 4.6 截圖解析度與比對方式（D，中效益）

**D：**`node.screenshot()` 預設 0.5x，且最大邊限制在 1024px；指定 `{ scale: N }` 會取消上限。整頁縮圖會藏住文字裁切、錯的 variant 與未替換的預設文字（2.2.118 版還明確要求逐 section 截圖，2.2.123 改為一張組合圖）。

**P：**

- 組合圖照官方新版一張；對**小元件或有風險的區域**（按鈕列、表單欄位、長文字）另外用 `scale: 2` 截局部。
- 參考畫面與新建畫面用**相同 scale** 各截一張，並排比對。
- 截圖只交給模型看，本機拿不到檔案（M0），因此無法做像素 diff；精準比對要靠 4.4 的數值差異報表，截圖負責數值看不出的問題。

### 4.7 Variables 與 styles 的精準綁定（A，中效益，受 gap-001 限制）

**D：**

- 優先用最具體的一層：有元件層 token 就用元件層，其次語意層，最後才是 primitive。
- `variable.scopes` 表示該 variable 適用的屬性；綁定前檢查 scope 是否涵蓋目標欄位（例如 `GAP`、`FRAME_FILL`、`TEXT_FILL`），不符就不綁。
- 只有 SOLID paint 能綁顏色；`setBoundVariableForPaint` 回傳新的 paint，要重新指定。圓角要綁四個角，不綁 `cornerRadius`。
- 沒有設定 explicit mode 時，節點用 collection 的預設（第一個）mode；預設 mode 可能不是使用者預期的 mode。
- 文字排版優先套 text style（`importStyleByKeyAsync` → `textStyleId`），不要自己設 fontSize／lineHeight 的原始值。

**P：**`variableMap` 每一項加上 `layer: component|semantic|primitive` 與 `scopeCheck`；每個 requiredMode 都設定 explicit mode 後，以 `resolveForConsumer` 讀回生效值（M1 已證實可用）。在 gap-001（variables 來源 library）解決前，這些仍然是 `not_verified`。

### 4.8 效能與可恢復性（B，中效益）

**D：**

- 互不相依的 `import*ByKeyAsync`、`getNodeByIdAsync`、`loadFontAsync` 用 `Promise.all` 一次完成；依型別搜尋用 `findAllWithCriteria`，名稱／屬性搜尋用 `node.query('TEXT[name=Title]')`，不要全樹 `findAll`。
- 搜尋範圍限縮在最小的已知祖先節點。

**P：**呼叫越快，越不容易逾時，`unknown_outcome` 也越少；這直接降低 recovery 的成本。M0 的 `v1.1.2` 頁有約 5,600 個 instance，這類大頁面特別需要。

## 5. 需要使用者決定的取捨

### 5.1 驗證頻率：官方新版 vs 本專案

| 選項 | 內容 | 優點 | 代價 |
|---|---|---|---|
| 1. 維持現狀 | 每個 write 後都另開 read 讀回 | 最保守；證據鏈完整 | 呼叫多、慢、配額消耗大 |
| 2. 折衷（建議） | **新建**且屬於本 run 的節點：寫入腳本內讀回並回傳證據（IDs、bounds、屬性、fingerprint），視為結構證據；**修改既有節點或使用者可能改過的節點**：仍另開 read 驗證 | 對齊官方新版；減少一半以上呼叫；保留協作情境的保護 | 需修改 spec §12 與 `SKILL.md` 第 4 節；回傳被截斷時仍以 `unknown_outcome` 處理 |
| 3. 完全照官方新版 | 寫入回應一律當作證據 | 最快 | 與 spec「讀回驗證」衝突；協作衝突時證據較弱 |

建議：2，僅供參考，請你決定。

### 5.2 靜態 lint 的阻擋強度

`deny`（擋下，要求修正）或 `warn`（只記錄）。建議先用 `warn` 跑一次真實 `/figma-ui` 任務，收集誤判，再改為 `deny`。

## 6. 建議的實作順序

1. 升級 plugin、重跑 probe；加測「腳本 throw 後修改是否保留」（4.2 的 U 項）。
2. `snippets/assert.js`（4.2）與 hook lint（4.3）：純本機、可寫 fixture 測試、效益最大。
3. 元件屬性合約（4.1）與 inventory schema 擴充。
4. `layout-diff.js`（4.4）與 `quality-audit.js`（4.5），接到 Validate 階段與 `audit.json` evidence。
5. 解決 gap-001 後做 4.7 的 variables 綁定驗證。

每一項完成後都需要在授權的 sandbox 頁以真實 `/figma-ui` 任務驗證，並區分 offline_fixture 與真實整合結果。

## 7. 不會提升品質的項目

- `use_figma` 的 `skillNames` 參數：官方說明只用於記錄，不影響執行。仍建議照官方填寫，但不要期待它改善品質。
- 用 `generate_figma_design`（web capture）提升像素精準度：只適用於有可執行 web app 的情況；本專案的需求是延伸既有 Figma 設計，不在範圍內（研究文件第 2.3 節）。
- 增加截圖次數：官方新版明確反對重複截圖；精準度應由 4.4、4.5 的數值檢查補足。

## 8. 來源

- [figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)（commit `38308b7`，skills 2.2.123；比對 `2978194`，2.2.118）
  - `skills/figma-use/SKILL.md`：Critical Rules 1–18、Pre-Flight Checklist、`node.query`／`node.set`／`node.screenshot`／`placeholder`
  - `skills/figma-use/references/gotchas.md`：HUG／FILL、TEXT 塌陷、Section 不自動調整大小、`Promise.all`、索引搜尋
  - `skills/figma-use/references/component-patterns.md`、`working-with-design-systems/wwds-components--using.md`：`#uid` 屬性 key、`setProperties` 靜默失效、巢狀 instance
  - `skills/figma-use/references/variable-patterns.md`、`wwds-variables--using.md`：綁定、scopes、explicit mode、最具體的 collection
  - `skills/figma-generate-design/SKILL.md`、`references/discover-product-font.md`：元件來源優先序、可編輯性門檻、字型斷言
- [Figma Help：Code to canvas with your design system](https://help.figma.com/hc/en-us/articles/40287261761559-Code-to-canvas-with-your-design-system)（搜尋摘要：大型變更要漸進、先檢查再改、衝突要回報不要硬編碼）
