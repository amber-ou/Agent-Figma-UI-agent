# 品質契約與驗證（spec §9、§10、§12）

## Plan 階段

- 每個 screen：使用者任務、主要 action、資訊排序、sections、viewport、states、元件來源、引用的 pattern ID、內容長度限制、互動目的地。
- `requiredCells` 明列 screenKey × viewport × state × mode 的組合，不做笛卡兒積；不適用要寫理由。資料型頁面至少評估 loading／empty／error；表單至少評估 focus／invalid／submitting／success。改變 requiredCells 需要 decisionRef。
- 只驗證本次 `requiredModes`；不為了完整硬加 dark mode。
- **可及性預檢（§9.5，v1.4）**：Build 前，對準備沿用的 pattern 與 styles 檢查文字對比與點擊區，記入 `plan.accessibilityPrecheck`（`kind`、`subject`、`styleName`、`foreground`／`background`、`fontSize`、`bold`、`status`）。計算用 `node scripts/quality-metrics.mjs contrast <#fg> <#bg> [fontSizePx] [bold]`；validator 會重算並比對 status。漸層或圖片背景讀不到單一色時標 `not_verified`，截圖人工補查。
  - `fail`：參考畫面本身的問題記 `inherited_baseline`（`baselineRef`），並以 designDecision 列出替代（`decisionRef`，優先同系列、對比足夠的既有 style）。參考畫面不合格不能當作照抄的理由。
  - 新畫面沿用不合格的 style 是 `introduced`：finding 標 `gate: "G5"`，G5 為 fail，**不能**用 acceptedExceptions 或 accepted finding 豁免（validator 會拒絕）。第一次真實任務的 01-04 說明文字 style 對白底只有 3.34:1，就是在 Validate 才被擋下。

## 結構（G3）

- 重複控制項用既有 COMPONENT／COMPONENT_SET 的 INSTANCE；不 detach；透過公開 properties 改 label／icon／state。
- 元件沒有 TEXT property：只能 override 內層文字節點；先載入該節點實際字型，只改 `characters`，記入 operation 與證據（baseline）。
- 有排列關係的 children 用 Auto Layout；先 append 再設 HUG／FILL；`resize()` 在設定 sizing 前。
- **FILL 不保證等寬**：要求等寬就在建好後量測；不相等回報使用者決定（接受、改做法或查原因）。
- tokenBinding 分母只含本次新建／修改、runtime 支援、且有核准 DS token 的屬性；分母 0 記 N/A。未改動的既有硬編碼是 `inherited_baseline`，本次破壞既有 binding 是 regression。
- **styles 也是 DS token（§10.1、§12.2，v1.4）**：套用既有 paint／text／effect style 的屬性計入 tokenBinding，並以讀回的 style ID 驗證。Validate 時把每個本次新建／修改屬性的讀回結果寫進 `audit.metrics.propertyBindings`（`nodeId`、`property`、`binding: variable|style|raw`、`styleKind`／`styleId` 或 `variableId`、`origin`、`verified`，raw 已接受為例外時加 `exceptionRef`），再跑 `node scripts/quality-metrics.mjs token-binding design-runs/<run-id> --write`。輸出分開列 variable binding 與 style 套用數量；raw 值（例如沒有 style 的漸層）留在分母，已接受的例外另列，原比例（`ratio`）不隱藏。
- 字型：Discover 以 `listAvailableFontsAsync()` 比對會用到的字型（`node scripts/quality-metrics.mjs fonts <required.json> <available.json>`）。未安裝的字型不替換，記 `inventory.fonts` 並列給使用者（§10.3）。

## 視覺（G4）

每完成一個 composition 或局部修正都要截圖並**實際看圖**：文字被切、重疊、缺字或方框、placeholder、對齊與層級。

- CJK：Inter 等拉丁字型沒有中文字形，Figma 用 fallback 顯示（baseline）；仍要確認沒有缺字或方框，並檢查 `hasMissingFont`。
- 長內容：2 倍文字長度、長英文無空白、大數字、空值、驗證錯誤等適用案例寫入 evidence。

## 設計可及性（G5）

一般文字對比 ≥ 4.5:1，大字 ≥ 3:1（14px Bold 不算大字）；必要非文字 UI ≥ 3:1；pointer target ≥ 24×24（44×44 只是體驗目標）。透明色要算合成背景。鍵盤、螢幕閱讀器、zoom 屬實作層，列在 `implementationVerificationRequired`。

## Evidence（§12.5）

- 預設：`toolRef`（實際工具名、擷取時間）＋ nodeId ＋ 看圖後的審查摘要。本機 PNG 選配（`artifactRef`）。
- 每個 requiredCell 需要「最後一次修改之後」的結構與截圖證據；有新修改時，舊證據改 `superseded`。
- `modify` 任務先截修改前基線，完成後再截，確認範圍外沒變。

## Gates 與完成（§12.1）

G1 範圍、G2 覆蓋、G6 可追溯、G7 阻礙一律 pass；G3–G5 pass 或有 plan 依據的 not_applicable。G5 的 finding 是硬性門檻，不能接受為例外；G5 不能在有 open 的 G5 finding 時標 pass。`not_verified` 不能完成，也不能改成 not_applicable。設計任務不能留有影響交付的 open critical／major finding；audit 任務可以回報任何嚴重度的受查缺陷。例外只能是非硬性，且要 decisionRef。分數只作診斷。

最後一律跑 `node scripts/evaluate-completion.mjs design-runs/<run-id> --write`，它會先做 schema 與跨檔檢查。

原因推論在實驗前一律標 `causeStatus: "hypothesis"`。M1 曾把寬度差異歸因於文字長度，改字後結果不變，推論被推翻。
