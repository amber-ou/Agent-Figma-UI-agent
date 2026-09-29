# Discover（spec §6、§8.1，v1.6 範圍化）

目標：找出**本次需要的**元件、variables、styles、字型與版面 pattern，寫入 `inventory.json`。只有任務本身要求時才盤點整個檔案或 library。

## 0. 範圍（v1.6）

- 有明確基準（使用者指定的畫面、Plan 引用的 pattern）就先用它；**不固定要找幾張參考**。基準不足或互相衝突時才擴大範圍，並說明為什麼擴大。
- 只讀需求相關的 subtree；大型頁面先取頂層摘要，再縮小。
- 同來源、同版本的元件屬性與版本比較做一次就好；不同 override、mode 或版本分開記，不混用。
- 大型資料分批回傳並保留完整性標記；Discover 的讀取 helper 在 `snippets/discover-helpers.js`：
  - `figmaUiPage(items, { cursor, maxBytes })`：依 UTF-8 位元組分頁，回傳 `complete`／`nextCursor`；單筆超過上限時標 `oversizedItem`，要縮小範圍，不採用被切掉的值。
  - `figmaUiInstanceGroups(root, { limit })`：instance 依元件、主元件節點（版本）、variant、屬性值、override 欄位與 explicit mode 分組；掃描上限寫在結果（`limited`）。
  - `figmaUiFontCheck(required)`：在 Figma 端只比對本次需要的字型，不回傳整份清單。

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

- 收集要用到的字型（重用元件內的文字、參考畫面的 text styles），在 Figma 端用 `figmaUiFontCheck` 比對，只回傳需要的結果，寫入 `inventory.fonts`（`family`、`style`、`installed`、`usedBy`）。本機已有兩份清單時，也可以用 `node scripts/quality-metrics.mjs fonts <required.json> <available.json>`。
- 未安裝：**不換字型**，也不在 `loadFontAsync` 失敗後改用其他字型。記 `inherited_baseline`（`baselineRef` 指向 `plan.baseline.observations`），在 Plan 列給使用者並記 `listedToUserRef`。只有使用者決定替換時才可填 `substitutedWith`。
- 截圖時仍要確認沒有缺字或方框（第一次真實任務：Status Bar 的 SF Pro Text 未安裝，Figma 以替代字型顯示）。

## 4b. 品牌資產（REQ-04，v1.4）

參考畫面裡的其他品牌名稱或 logo 記下來，不直接複製；新畫面的產品名稱與 logo 以使用者指定為準，不確定時列為設計決策。

## 5. 版面 pattern（§6.6）

1. 從明確基準開始（使用者指定的畫面，或與本次需求最相近、同產品同平台的既有畫面）；不足或衝突時才加入其他畫面。基準不明就問，不自行挑風格差異大的畫面。
2. 量測：寬度、grid、外距與 section 間距（對應哪個 spacing variable）、頁首／導航、標題層級與 text styles、卡片／列表／表單／dialog 的組合、主次 action 位置、空狀態與錯誤呈現、背景與裝飾（漸層、陰影、插圖）。
3. 每個 pattern：`id`、`sourceNodeIds`、`measured`、使用的元件／variables、`occurrences`、證據。來源畫面互相矛盾 → 列差異並詢問。
4. **重現照抄實際做法**（例如兩顆按鈕都是 FILL 加相同內距），不要用「看起來一樣的數值」替代（例如改成固定寬度）。建好後量測並與範例比對，同時考慮元件版本差異。
5. 限制（例如字數上限）寫在 `constraints`：只有做過實驗、有量測數字才可 `confirmed`；否則 `observed_not_confirmed`，原因推論寫在 `hypothesis`（INVARIANT-16）。
