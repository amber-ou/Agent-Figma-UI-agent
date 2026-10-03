# Discover（spec §6、§8.1，v1.6 範圍化；v1.9 外部規範與可匯入性）

目標：找出**本次需要的**元件、variables、styles、字型與版面 pattern，寫入 `inventory.json`。只有任務本身要求時才盤點整個檔案或 library。

## 0. 範圍（v1.6）

- 有明確基準（使用者指定的畫面、Plan 引用的 pattern）就先用它；**不固定要找幾張參考**。基準不足或互相衝突時才擴大範圍，並說明為什麼擴大。
- 只讀需求相關的 subtree；大型頁面先取頂層摘要，再縮小。
- 同來源、同版本的元件屬性與版本比較做一次就好；不同 override、mode 或版本分開記，不混用。
- 大型資料分批回傳並保留完整性標記；Discover 的讀取 helper 在 `snippets/discover-helpers.js`：
  - `figmaUiPage(items, { cursor, maxBytes })`：依 UTF-8 位元組分頁，回傳 `complete`／`nextCursor`；單筆超過上限時標 `oversizedItem`，要縮小範圍，不採用被切掉的值。
  - `figmaUiInstanceGroups(root, { limit })`：instance 依元件、主元件節點（版本）、variant、屬性值、override 欄位與 explicit mode 分組；掃描上限寫在結果（`limited`）。
  - `figmaUiFontCheck(required)`：在 Figma 端只比對本次需要的字型，不回傳整份清單。
  - `figmaUiComponentFonts(mainComponentIds)`（v1.7）：從主元件本身收集元件內部用到的字型，交給 `figmaUiFontCheck`。

## 1. 四種資源集合（§6.1）

分開記錄，不可互相推論：

1. 目標檔本地定義的 components／variables／styles。
2. 目標畫面已使用的 remote instances 與 remote variable bindings。
3. 已加入目標檔的 libraries（`get_libraries` 的 `libraries_added_to_file` **且** runtime `teamLibrary.getAvailableLibraryVariableCollectionsAsync()` 一致才算）。
4. 使用者可存取但未加入的 libraries：不是核准的 DS。

本地 variables 為空，不代表沒有 remote variables。查詢失敗記 `unknown`，不能解讀成「沒有設計系統」。每類寫 `discoveryCoverage`：`complete_for_requested_scope | partial | unavailable`。

## 2. 讀取順序

1. 頁面：`use_figma` 讀 `figma.root.children`（id、name、children 數）。
2. 參考畫面：先取頂層摘要（id、type、name、bounds），再只讀相關 frame。大型頁面不要整頁 `get_metadata`。
3. 參考畫面中的 instances：`figmaUiInstanceGroups`（`getMainComponentAsync()` → key、主元件節點 id、`remote`、所屬 component set key、variant 名稱）。抽樣上限要寫明（預設 1,500）。
4. bindings：`boundVariables` → `getVariableByIdAsync` → 名稱、key、collection（名稱、key、modes）、`remote`、scopes；用 `resolveForConsumer(node)` 取得生效值。
5. library 檔（唯讀）：依 key 比對元件是否真的來自核准的元件 library。
6. 未解析的項目才用 `search_design_system`，**一次一個 query**。

## 3. Variables 來源（§6.1，v1.3）

- 元件 library 常常不是 variables 的來源。對每個 remote variable 記錄 collection，並嘗試找出來源 library；找不到就標 `sourceLibraryStatus: "unidentified"`。
- 來源未識別：在 `brief.gaps` 記 gap，請使用者在 Figma 由 variable 標籤查 library 名稱。需要這些 variables 的綁定與 mode 驗證標 `not_verified`；tokenBinding 分母為 0 時記 N/A。
- 只有使用者核准的 variables library 中的 variable 才能新綁定。既有 consumer 已用的 remote variable，也要使用者核准才能引用。

## 4. 元件候選與版本（§6.2）

- 同一語意的候選：依使用者指定 DS → 既有畫面使用情況 → 狀態覆蓋 → token 相容性排序；沒有明確贏家或缺 state 就問。名稱相似不能單獨決定。
- **版本比對**：以 key 匯入會拿到 library 目前發佈的版本，既有畫面可能停在舊版。Plan 前對要用的 variant 比較新舊（子節點、icon、顏色、尺寸）。不同時在 `componentMap[].versionCheck` 記 `differs`、差異清單與 baseline 觀察，並在 plan 確認時列給使用者。
- **從既有 instance 取得主元件（§6.2，v1.4）**：目標檔尚未接受 library 更新時，對既有 instance 呼叫 `getMainComponentAsync()` 取得主元件再建立 instance，可拿到與既有畫面相同的版本。以 key 匯入或從 instance 取得，擇一並在 componentMap 的 `reason` 寫明理由。
- **來源 library 未識別的 remote 元件**（例如 Status Bar、Top bar）：經使用者核准（plan.decisions）後，可用上述方式重用，componentMap `source.kind: "remote_instance"`、inventory 記「來源 library 未識別」；不得重畫或 detach。
- 同一主元件的舊 instance 可能保留舊結構或 override（第一次真實任務：舊 Button instance 只有一個 icon，新建的有兩個）。外觀差異要列給使用者，不用 override 模仿舊樣子；原因未驗證前標為假設。

## 4a. 字型（§10.3，v1.4）

- 收集要用到的字型，在 Figma 端用 `figmaUiFontCheck` 比對，只回傳需要的結果，寫入 `inventory.fonts`（`family`、`style`、`installed`、`usedBy`）。來源有兩種，**兩種都要收**：
  1. 參考畫面與新建文字要用的 text styles；
  2. **準備使用的元件內部實際使用的字型**（v1.7，§10.3）：對 componentMap 每個主元件 id 呼叫 `figmaUiComponentFonts([...])`，它讀主元件本身的文字節點（含巢狀 instance），**不建立 instance**（唯讀腳本不得建立暫時節點）。M4 只比對了參考畫面，漏掉 Status Bar 主元件內的 SF Pro Text，直到 Validate 才發現。本機已有兩份清單時，也可以用 `node scripts/quality-metrics.mjs fonts <required.json> <available.json>`。
- 未安裝：**不換字型**，也不在 `loadFontAsync` 失敗後改用其他字型。記 `inherited_baseline`（`baselineRef` 指向 `plan.baseline.observations`），在 Plan 列給使用者並記 `listedToUserRef`。只有使用者決定替換時才可填 `substitutedWith`。
- 截圖時仍要確認沒有缺字或方框（第一次真實任務：Status Bar 的 SF Pro Text 未安裝，Figma 以替代字型顯示）。
- **比對範圍包含所有會新建的 instance（v1.9，§10.3）**：對 componentMap 中每個準備新建 instance 的項目，讀其**主元件**的字型（不論來源 library 是否找得到；remote 元件用既有 instance 的 `getMainComponentAsync()` 取得主元件 id），記入 `inventory.componentFontChecks`：

  ```json
  {"componentMapRef": "cmap-StatusBar", "mainComponentNodeId": "<主元件 id>", "source": "main_component",
   "fonts": [{"family": "SF Pro Text", "style": "Semibold"}], "evidenceRefs": ["rd-0004"]}
  ```

  每個字型也要在 `inventory.fonts` 記安裝狀態。**不能以參考畫面上 instance 的現況代替**：run `ui-20261003-001` 參考畫面的 Status Bar 已 override 成已安裝的 SF Pro，新建 instance 卻回到主元件的 SF Pro Text（未安裝）。validator 會拒絕只有 `source: reference_instance` 的紀錄。

## 4b. 品牌資產（REQ-04，v1.4）

參考畫面裡的其他品牌名稱或 logo 記下來，不直接複製；新畫面的產品名稱與 logo 以使用者指定為準，不確定時列為設計決策。

## 4c. 外部規範（EXT-01，v1.9，§8.1 第 6a 步）

**觸發條件**：需求涉及第三方品牌、平台或法規，例如第三方登入（LINE、Apple、Google、Facebook）、原生平台介面規範（iOS HIG、Material）、支付（Apple Pay、Google Pay、信用卡品牌標誌）、地圖或商店徽章。

**做法**：

1. 找**官方**文件（品牌的開發者網站或設計指南），實際讀取內容；用 WebFetch 等工具讀不到時，不以記憶或二手文章代替。
2. 每筆記入 `inventory.externalRequirements`：

   | 欄位 | 內容 |
   |---|---|
   | `id` | `ext-01`… |
   | `subject` | 例如「LINE Login button」 |
   | `url` | 官方文件網址；讀不到時為 null |
   | `checkedAt` | 查核時間；讀不到時為 null |
   | `appliesWhen` | 適用條件，例如「畫面提供 LINE 登入」 |
   | `requirement` | 條文所述要求（照文件，不加推論） |
   | `inference` | 本案推論，例如「現有 DS Button 不符合，需官方色與 logo」 |
   | `status` | `verified`：實際讀到官方文件；`unverified`：讀不到或只有二手資料 |
   | `sourceKind` | `official`／`secondary`／`none`（`verified` 必須是 `official`） |
   | `affectsDelivery` | 本次交付是否依賴它 |
   | `decisionRef` | 使用者對未驗證項目或資源核准的決定 |

3. **`verified`**：適用的要求直接成為設計約束。不符合要求的樣式**不能列為平等的候選**（run `ui-20261003-001` 的 dd-03 把不符合 LINE 規範的深藍按鈕列為建議）。是否允許新增資源（官方色 style、官方 logo 元件）或以寫死值例外處理，是另一個需要使用者核准的問題（不能委派，DEC-12）。
4. **`unverified`**：不能寫成事實（INVARIANT-16）；清單上標「未驗證」，由使用者決定怎麼處理。本次交付依賴它（`affectsDelivery: true`）時，Build 邊界要求先有使用者的決定（`decisionRef`）；只影響未來上線的要求可以在已核准的草稿範圍內繼續，handoff 標明未解決。
5. handoff 第 13 項會列出查核結果與未驗證項目。

## 4d. 可匯入性與隱藏子節點（v1.9，§8.1 第 6b 步）

**Plan 之前**確認 componentMap 與要套用的 style 都能在**目標檔**取得，記入 `plan.importChecks`：

```json
{"id": "imp-01", "kind": "component_set", "componentMapRef": "cmap-Button", "key": "<key>", "method": "import_by_key", "status": "importable", "evidenceRefs": ["rd-0005"]}
{"id": "imp-02", "kind": "style", "styleName": "Subtitle/Subtitle 2", "method": "existing_style_on_screen", "status": "not_importable",
 "fallback": "從參考畫面已套用該 style 的節點讀 textStyleId 沿用", "listedToUserRef": "dec-015"}
```

- 匯入不到時改用畫面上已在使用的同一份 style 或 instance，並在 Plan 列給使用者（`listedToUserRef`）；不要在 Build 中途才發現（run `ui-20261003-001` 的 op-0002）。
- 確認匯入是唯讀探測：`import*ByKeyAsync` 會被 hook 視為寫入，不能在 `mode=read` 腳本裡呼叫。可匯入性以「既有節點上讀到的 key 與 library 發佈狀態一致」或在本 run 授權的 sandbox 以 write operation 做最小探測確認；探測方式寫在 `method`／`evidenceRefs`。
- `not_checked` 不能過 Build 邊界。
- **隱藏子節點**：需要操作 instance 內被隱藏的子節點（例如未顯示的 icon 位置）時，先用 `snippets/discover-helpers.js` 的 `figmaUiHiddenChildren(instance)` 唯讀探測讀取方式拿不拿得到。實測結果與原因記在 `references/runtime-probes.md`；原因沒查明就標為假設。

## 5. 版面 pattern（§6.6）

1. 從明確基準開始（使用者指定的畫面，或與本次需求最相近、同產品同平台的既有畫面）；不足或衝突時才加入其他畫面。基準不明就問，不自行挑風格差異大的畫面。
2. 量測：寬度、grid、外距與 section 間距（對應哪個 spacing variable）、頁首／導航、標題層級與 text styles、卡片／列表／表單／dialog 的組合、主次 action 位置、空狀態與錯誤呈現、背景與裝飾（漸層、陰影、插圖）。
3. 每個 pattern：`id`、`sourceNodeIds`、`measured`、使用的元件／variables、`occurrences`、證據。來源畫面互相矛盾 → 列差異並詢問。
4. **重現照抄實際做法**（例如兩顆按鈕都是 FILL 加相同內距），不要用「看起來一樣的數值」替代（例如改成固定寬度）。建好後量測並與範例比對，同時考慮元件版本差異。
5. 限制（例如字數上限）寫在 `constraints`：只有做過實驗、有量測數字才可 `confirmed`；否則 `observed_not_confirmed`，原因推論寫在 `hypothesis`（INVARIANT-16）。
