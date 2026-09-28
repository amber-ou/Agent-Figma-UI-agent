# Discover（spec §6、§8.1）

目標：找出本次需要的元件、variables、styles 與版面 pattern，寫入 `inventory.json`。範圍以本次需求為限，不下載整個組織 library。

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
3. 參考畫面中的 instances：`getMainComponentAsync()` → key、`remote`、所屬 component set key、variant 名稱；依 set key 去重。抽樣上限要寫明（M1 為前 1,500 個 instance）。
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

## 5. 版面 pattern（§6.6）

1. 選 2–3 個與本次需求最相近的既有畫面，請使用者確認；找不到就問，不自行挑風格差異大的畫面。
2. 量測：寬度、grid、外距與 section 間距（對應哪個 spacing variable）、頁首／導航、標題層級與 text styles、卡片／列表／表單／dialog 的組合、主次 action 位置、空狀態與錯誤呈現、背景與裝飾（漸層、陰影、插圖）。
3. 每個 pattern：`id`、`sourceNodeIds`、`measured`、使用的元件／variables、`occurrences`、證據。來源畫面互相矛盾 → 列差異並詢問。
4. **重現照抄實際做法**（例如兩顆按鈕都是 FILL 加相同內距），不要用「看起來一樣的數值」替代（例如改成固定寬度）。建好後量測並與範例比對，同時考慮元件版本差異。
5. 限制（例如字數上限）寫在 `constraints`：只有做過實驗、有量測數字才可 `confirmed`；否則 `observed_not_confirmed`，原因推論寫在 `hypothesis`（INVARIANT-16）。
