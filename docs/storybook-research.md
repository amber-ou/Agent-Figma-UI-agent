# Storybook 整合研究

研究日期：2026-09-29 · 對應規格：FIGMA_UI_AGENT_SPEC.md v1.4 · 性質：研究與提案，**不修改主規格**。第 5 節的規格改動要等使用者回答第 7 節的問題後，再依慣例修訂成新版 spec。

證據分級沿用 `FIGMA_MCP_RESEARCH.md` 第 1 節：**D** 官方文件或官方套件原始碼、**E** 本環境觀察、**P** 本專案的設計提案、**U** 尚未驗證。

## 0. 結論摘要

1. **Storybook 不會取代 Figma 寫入路徑。** 本 agent 的成果是可編輯的 Figma 節點，Storybook 管的是程式元件。它能幫上忙的地方在「程式這一側」：告訴 agent 程式裡實際有哪些元件、props、已實作的狀態，以及在 design-to-code 階段驗證實作。（P）
2. **最有價值的切入點是 Storybook 10 的 MCP server（`@storybook/addon-mcp`）。** 它提供 docs／development／testing 三組工具，agent 可以查元件文件、找 story、跑元件測試（含 axe 可及性檢查）。Claude Code 可以用 HTTP MCP 連上，和現在連 Figma remote MCP 的方式相同。（D）
3. **建議分三段導入，都不阻擋 P0：**
   - S1：Discover 與 Handoff 加入「唯讀的程式元件來源」，對照 Figma 元件與程式元件是否一致。
   - S2：Handoff 補上 story 連結、`parameters.design` 片段與 Code Connect 狀態。
   - S3：併入 M5 design-to-code，用 Storybook 測試驗證實作。
4. **目前最大的前提未知：** 使用者的產品（Aiwow 電子名片 LINE OA）有沒有前端 repo、有沒有 Storybook、用什麼框架。docs 工具組只支援 React、`@storybook/angular-vite`、`@storybook/vue3-vite`。回答前無法決定要不要做 S1。

## 1. 研究方式與限制

- `storybook.js.org` 與 `developers.figma.com` 被本雲端環境的網路政策阻擋（E）。Storybook 文件改讀 GitHub `storybookjs/storybook` 的 `main` 分支 `docs/` 原始檔（網站由它產生）；工具名稱與設定另以 npm 上**已發佈的 10.6.0 套件內容**交叉確認。
- Figma 這一側讀 `@figma/code-connect` 2.0.1 套件與 `figma/mcp-server-guide` README。
- 本次**沒有**安裝 Storybook，沒有連使用者的 repo 或 Figma 檔，也沒有實際呼叫 Storybook MCP。所有「在本專案可行」的判斷都屬 U，要在使用者本機實測。
- Storybook 的 AI 功能官方標示為 **preview**，API 可能變（D）。本文是 2026-09-29 的快照，不得把工具名稱寫死（同 spec 第 19 節）。

## 2. Storybook 現況

### 2.1 版本

| 套件 | 版本（npm latest） | 發佈日 |
|---|---|---|
| `storybook` | 10.6.0（`next` 為 11.0.0-alpha.1） | 2026-09-02 |
| `@storybook/addon-mcp` | 10.6.0，peer：`storybook ^10.6.0`、`@storybook/addon-vitest ^10.6.0` | 2026-09-02 |
| `@storybook/mcp`（自架用函式庫） | 10.6.0 | 2026-09-02 |
| `@storybook/addon-a11y`、`@storybook/addon-vitest` | 10.6.0 | 2026-09-02 |
| `@storybook/addon-designs`（Figma 嵌入） | 11.1.4 | 2026-07-07 |
| `@chromatic-com/storybook`（視覺測試） | 5.3.1 | 2026-09-02 |
| `@figma/code-connect` | 2.0.1 | 2026-09-10 |

（D，npm registry）

### 2.2 MCP server（`@storybook/addon-mcp`）

安裝 addon 後，Storybook dev server 在 `http://localhost:6006/mcp` 提供 MCP server（路徑可用 `endpoint` 選項改）。任何支援 MCP 的 agent 都能連，官方文件直接列出 Claude Code。（D）

工具分三組，可用 `toolsets: { dev, docs, test }` 個別關閉：

| 工具組 | 工具（10.6.0 套件內確認） | 用途 | 前提 |
|---|---|---|---|
| docs | `docs-list` | 列出有文件的元件與獨立文件頁 | 框架能產生 components manifest |
| docs | `docs-show` | 單一元件的 props、前三個 story、其餘 story 索引、補充文件 | 同上 |
| docs | `docs-show-story` | 單一 story 的完整內容 | 同上 |
| dev | `get-storybook-story-instructions` | 撰寫 story 與互動測試的規範 | 無 |
| dev | `stories-preview` | 在支援 MCP Apps 的 client 內預覽 story，否則回傳連結 | 無 |
| dev | `stories-changed` | 依本機檔案變更列出受影響的 story | 開啟 change detection |
| dev | `stories-find-by-component` | 由元件原始檔找出渲染它的 story | 無 |
| dev | `review-create` | 推送一份變更審查頁並回傳網址 | 開啟 review 功能 |
| test | `test-run` | 對指定 story 跑元件測試，含可及性檢查（若已設定） | 安裝並啟用 `@storybook/addon-vitest` |

（D：`docs/ai/mcp/overview.mdx`、`docs/ai/mcp/api.mdx`；工具名以 10.6.0 套件內容比對）

**工具名稱已改過一次：** 較早的 addon（0.x，獨立 repo）用 `list-all-documentation`、`get-documentation`、`preview-stories`、`run-story-tests` 等名稱，網路上的教學仍在用舊名（D，套件 CHANGELOG）。因此本專案必須像處理 Figma 工具一樣，以 Preflight 實際讀到的工具清單為準。

**Claude Code 的指令截斷：** addon 的 CHANGELOG 記錄「Claude Code 會把 MCP server instructions 截在 2,048 字元」，官方因此把重要規則移到工具描述裡（D，官方套件記錄；對 Claude Code 行為本身屬 U）。對本專案的意思是：使用 Storybook 工具的規則要寫在 `figma-ui` skill 內，不能依賴 server 自帶的 instructions。

### 2.3 Manifests

Storybook 從 CSF（stories 檔）與元件原始碼產生兩種 JSON（D，`docs/ai/manifests.mdx`）：

- **components manifest**（`/manifests/components.json`）：元件 id、名稱、stories 路徑、每個 story 的程式片段、import 寫法、description、JSDoc tags，以及 docgen 解析出的 props（型別、預設值、union 值）。預設關閉，要在 `.storybook/main.ts` 的 `features.componentsManifest` 開啟。
- **docs manifest**（`/manifests/docs.json`）：MDX 文件頁內容，例如 typography、design tokens、使用準則。

框架支援：

| 框架 | 需開啟的 feature | docs 工具組 |
|---|---|---|
| 所有 React 框架（`react-vite`、`nextjs`、`nextjs-vite` 等） | `componentsManifest` | 可用 |
| `@storybook/angular-vite` | `componentsManifest` | 可用 |
| `@storybook/vue3-vite` | `componentsManifest`＋`experimentalDocgenServer` | 可用 |
| `@storybook/angular`（Webpack）、Nuxt、其他框架 | 不產生 manifest | 不可用；dev／test 工具組仍可用 |

限制：

- manifest schema 在 preview 期間**不是公開 API**（D）。本專案只能透過 MCP 工具讀，或讀取後做正規化，不能把欄位結構寫死在 validator 裡。
- 文件列出的 manifest 欄位**沒有** story 的 `parameters`（D，文件範例；是否完全不輸出屬 U），所以 story 上的 Figma 連結（`parameters.design.url`）要另外讀 stories 原始檔取得。
- 開啟 `experimentalDocgenServer` 時，dev server 的 JSON 路徑回 404，只能透過 MCP 工具或 build 後的靜態檔讀取（D）。
- 多個 Storybook 透過 composition 組合時，MCP 會合併各自的 manifest（D）。

### 2.4 測試

- **元件測試：** `@storybook/addon-vitest` 把 story 轉成 Vitest browser mode 測試（Playwright 渲染）；story 的 `play` function 就是互動測試。CI 可跑 `vitest --project=storybook`。（D）
- **可及性：** `@storybook/addon-a11y` 以 axe-core 檢查渲染後的 DOM，官方引用的數字是自動化「最多抓到約 57% 的 WCAG 問題」，另有需人工確認的 Incomplete 分類（D）。這和 spec 第 2.2 節「不宣稱完整 WCAG 合規」一致。
- **視覺回歸：** `@chromatic-com/storybook` 把每個 story 拍照並和 baseline 比對，需要 Chromatic 雲端帳號（D）。

### 2.5 與 Figma 的整合方式

| 方式 | 方向 | 機制 | agent 能否自動操作 | 條件 |
|---|---|---|---|---|
| Storybook Connect（Figma plugin） | Storybook → Figma | 在 Figma 選元件、貼上 Chromatic 上的 story 網址，側欄顯示 story | 否，需在 Figma UI 手動操作（U：plugin 資料是否能由 Plugin API 讀取） | Storybook 需發佈到 Chromatic；不支援連到一般圖層 |
| `@storybook/addon-designs` | Figma → Storybook | story 加 `parameters.design = { type: 'figma', url }`，面板嵌入 Figma | 可以，改的是 repo 內 stories 檔 | 無 |
| Code Connect 的 Storybook 整合 | 程式 → Figma Dev Mode | story 的 `parameters.design` 加上 `examples`、`props`、`imports`、`links`，由 CLI 發佈到 Figma | 可以，但發佈 mapping 是對 Figma 的寫入 | **Organization 或 Enterprise 方案**，且需 Full Design 或 Dev Mode seat |
| Figma code-to-canvas（`generate_figma_design`） | 渲染中的網頁 → Figma 圖層 | 擷取 story 的 iframe 頁面 | 可以（spec 第 16.1 節的 capture 模式） | 見 spec 第 1、16.1 節；擷取圖層不是元件 instance |

（D：`docs/sharing/design-integrations.mdx`、`@figma/code-connect` README 與 `dist/storybook/convert.js`、`figma/mcp-server-guide`）

Code Connect 的 story 寫法（D，套件內範例）：

```ts
export default {
  component: Button,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/<fileKey>/?node-id=<id>',
      examples: [Primary],
      imports: ['import { Button } from "./Button"'],
      links: [{ name: 'Storybook', url: '<story-url>' }],
    },
  },
};
```

同一個 `parameters.design` 同時被 addon-designs（嵌入）與 Code Connect（mapping）使用。對本 agent 來說，這是**程式元件與 Figma 節點之間唯一由人明確寫下的對應**，比名稱比對可靠。

### 2.6 分享 MCP server

dev／test 工具組只在本機 Storybook 運作；docs 工具組可以分享（D，`docs/ai/mcp/sharing.mdx`）：

- 發佈到 Chromatic 時自動產生 MCP 網址，權限跟著 Storybook 專案走（私有 Storybook 的 MCP 也是私有）。
- 或用 `@storybook/mcp` 自架（Node 20+，需要 `components.json`，`docs.json` 可選）。

對本專案的意義：設計師本機不一定有前端 repo 或能跑 dev server。如果團隊把 Storybook 發佈到 Chromatic，agent 只要連遠端 MCP 就能讀程式元件文件，不必在設計師電腦上建前端環境。（P）

## 3. 放進現有流程的位置

現有流程是 `Intake → Preflight → Discover → Plan → Build → Validate → Handoff`（spec 第 8 節）。Storybook 對各階段的作用（P）：

| 階段 | Storybook 的作用 | 不做的事 |
|---|---|---|
| Intake | 詢問是否有程式元件來源（Storybook 網址或 repo、分支）。和 Figma 的元件、variables library 一樣**分開核准**（對照 spec 第 6.1 節 v1.3 的作法） | 不自動假設有程式碼 |
| Preflight | 探測 Storybook MCP：server 名稱、實際工具清單、docs 工具組是否可用、manifest 是否產生、Storybook 版本。寫入 `capabilities.json` | 探測不到不等於沒有；記 `unknown` |
| Discover | 落實 spec 第 8.1 節第 2 步（「若有程式碼，檢索 Code Connect 與 tokens」）：用 `docs-list`／`docs-show` 取得本次需要的元件；讀 stories 檔的 `parameters.design.url`，建立 Figma 節點與程式元件的對應；比較 Figma variant 軸和程式 props、Figma 狀態和已有 story 的狀態 | 不整份下載所有元件；不以名稱相近認定對應 |
| Plan | component map 每一項多一個「程式對應」狀態：`mapped`（有明確連結）、`candidate`（只有名稱相近）、`none`、`unknown`。選用沒有程式實作的 Figma 元件，或 Figma 與程式的狀態不一致時，列給使用者（spec 第 7.4 節） | 不自行判定以誰為準 |
| Build | 無變化，Storybook 不參與 Figma 寫入 | — |
| Validate | 無變化。靜態 Figma 只能證明設計面；鍵盤、DOM 語意、螢幕報讀等仍標 `implementation_verification_required`（spec 第 9.5 節），之後可在 S3 由 Storybook 測試驗證 | 不以 Storybook 測試結果冒充 Figma 設計的驗證 |
| Handoff | 補上每個元件的 story 連結、程式對應狀態、需要新建的程式元件清單、可直接貼進 stories 的 `parameters.design` 片段、Code Connect 狀態（spec 第 15 節第 9 項） | 未經要求不修改 repo（spec 第 15 節「不額外輸出前端專案」） |
| M5 design-to-code | `docs-show` 查 props → 寫元件與 stories（`get-storybook-story-instructions`）→ `test-run`（互動＋axe）→ 修正後重跑 → `stories-preview` 給使用者看 → 和 Figma `get_screenshot` 對照；需要時用 Chromatic 做視覺回歸 | 不把 Figma 參考程式碼當成可直接上線（spec 第 1 節） |

**寫入邊界。** 目前的 hooks 只攔 `mcp__.*figma.*__(use_figma|create_new_file|upload_assets)`（E，`.claude/settings.json`），Storybook 的工具不會被攔，也不需要攔：S1、S2 只用唯讀工具。會改東西的只有：

- 修改 stories 檔（改的是 repo）；
- `review-create`（推送審查頁）；
- Code Connect 發佈（對 Figma 的寫入，spec 第 5.2 節已規定「更新 mapping 視為獨立寫入」）。

這三種都要使用者明確授權，S3 之前不做。

## 4. 建議的導入分期

| 階段 | 內容 | 通過條件 | 對應里程碑 |
|---|---|---|---|
| S0 決定範圍 | 使用者回答第 7 節；依回答修訂 spec | 有 decisionRef；spec 版本更新 | M3 前 |
| S1 唯讀程式來源 | Intake 問題、Preflight 探測、Discover 對照、inventory 新欄位、Plan 的程式對應狀態；以 manifest fixture 寫離線契約測試 | 真實 Storybook 上：工具清單記入 capabilities；至少一個元件完成 Figma↔程式對照並有證據；沒有 Storybook 時流程不變（N/A） | 可與 M3 並行，不阻擋 P0 |
| S2 Handoff 強化 | story 連結、`parameters.design` 片段、需新建程式元件清單、Code Connect 狀態 | 第一次真實任務類型的 handoff 含上述內容；未發佈元件不宣稱已連接 | M4 |
| S3 實作驗證 | design-to-code 迴圈，含 `test-run` 與截圖對照；可選 Chromatic | 另立驗收，依 spec 第 17 節 M5 | M5 |

S1 的建議實作方式（P）：

- 不寫本機腳本直接呼叫 Storybook MCP。和 Figma 一樣，由 skill 指導 Claude Code 呼叫已連線的工具，本機腳本只做正規化與驗證（spec 第 4.4 節）。
- Claude Code 連線方式與現有 Figma 設定相同：`claude mcp add --transport http <名稱> http://localhost:6006/mcp`（名稱由使用者決定，Preflight 記錄實際前綴）。
- Figma↔程式的對應只有三種可信來源：story 的 `parameters.design.url`、Code Connect mapping、使用者指定。名稱相近只能列為 `candidate`，沿用 spec 第 6.2 節「名稱相近不能單獨決定」的規則。

## 5. 規格需要的改動（草案，待確認）

| spec 位置 | 建議改動 |
|---|---|
| 第 0.1 節 | 新增一列「程式元件來源」：每次呼叫詢問，可為 N/A |
| 第 3 節 P1 | 「Code Connect 對應探索」擴充為「Code Connect 與 Storybook 程式元件對應探索」 |
| 第 5.2 節 | 能力表新增「程式元件文件」（`docs-list`／`docs-show` 等）與「元件測試」（`test-run`），規則寫「依 Preflight 實際工具清單」 |
| 第 6.1 節 | 在四種 Figma 資源集合之外，新增獨立的「程式元件來源」，明確不能和 Figma library 互相推論 |
| 第 7.3 節 | 新增衝突類型：Figma 與程式的 variant、狀態或 props 不一致 → 詢問，不自行擇一 |
| 第 8.1 節第 2 步 | 具體化為第 3 節 Discover 列的作法 |
| 第 15 節第 9 項 | 擴充為「Code Connect 與 Storybook 對應狀態、story 連結、需新建的程式元件」 |
| 第 16.2 節 | 加入 S3 的驗證迴圈；Storybook 測試結果只證明實作 |
| schemas | `brief.sources` 加入程式來源；`inventory` 新增 `codeComponents` 與每個 component map 項目的 `codeParity`；`capabilities.tools` 允許記錄第二個 MCP server |
| `references/discovery.md`、`handoff.md` | 對應 S1、S2 的步驟 |

## 6. 風險與限制

1. **Preview API。** 工具名稱已改過一次，manifest schema 不是公開 API（D）。每次 run 以 Preflight 結果為準；升級 Storybook 後重跑契約測試（同 spec 第 19 節）。
2. **框架限制。** docs 工具組只支援 React、Angular（Vite）、Vue 3（Vite）（D）。LINE OA 常見 LIFF 網頁，框架未知（U）。
3. **需要跑起來的 Storybook。** 本機 dev server 才有 dev／test 工具組。設計師電腦上沒有前端環境時，只能用 Chromatic 發佈版或自架的 docs 工具組。
4. **Code Connect 方案限制。** 需要 Organization 或 Enterprise 方案（D）。M0 記錄的帳號是「Pro team 與 Organization guest」（E，研究紀錄第 10 節），測試檔所屬方案能否用 Code Connect 未知（U）。
5. **Storybook Connect 靠 Chromatic 且需手動操作。** agent 無法自動建立連結；Chromatic 上公開的 Storybook，其 MCP 也公開（D），要注意產品資訊外流。
6. **自動可及性檢查有上限。** axe 約抓 57% 的 WCAG 問題（D）；`test-run` 通過不能寫成「符合 WCAG」。
7. **兩個真實來源的衝突。** Figma 與程式常常不同步。本研究不預設以誰為準，這是使用者要決定的事（第 7 節第 3 題）。
8. **上下文成本。** `docs-show` 會回傳 props 與 story 片段，元件多時很長。沿用 spec 第 14 節：只查本次需要的元件，回傳摘要。

## 7. 需要使用者決定的問題

1. 產品有沒有前端 repo 與 Storybook？框架與 Storybook 版本？Storybook 有沒有發佈（Chromatic 或其他）？
2. 範圍：先做 S1＋S2（Storybook 只當唯讀參考與交付資訊，**建議**），還是連 S3（agent 寫程式並用 Storybook 驗證）一起規劃？
3. Figma 與程式不一致時，預設以哪一邊為準，或每次都問？
4. 可以使用 Chromatic 嗎（Storybook Connect、視覺測試、遠端 MCP 都需要）？
5. 測試檔所在的 Figma team 是 Organization／Enterprise 方案嗎（決定 Code Connect 能不能用）？

## 8. 必須實測的事項

1. 使用者本機的 Claude Code 能連上 Storybook MCP，工具名稱前綴為何（例如 `mcp__<名稱>__docs-list`）。
2. Claude Code 是否真的把 MCP server instructions 截在 2,048 字元。
3. 使用者專案的框架能否產生 components manifest；`docs-show` 回傳的大小。
4. stories 檔的 `parameters.design.url` 能否穩定解析出 Figma fileKey／nodeId，並和 Discover 讀到的節點對上。
5. Storybook Connect 的連結能否由 Figma Plugin API（`use_figma`）讀取。
6. Figma remote MCP 的 Code Connect 相關工具在使用者帳號下的實際名稱與權限（M0 記錄了 40 個工具，但沒有列出名稱）。
7. `generate_figma_design` 擷取 Storybook iframe 網址的結果（S3 或 capture 模式才需要）。

## 9. 來源索引

| ID | 來源 | 用途 |
|---|---|---|
| SB01 | [Using Storybook with AI](https://storybook.js.org/docs/ai)（原始檔 [docs/ai/index.mdx](https://github.com/storybookjs/storybook/blob/main/docs/ai/index.mdx)） | AI 功能總覽、Claude Code 連線、AGENTS.md 範例 |
| SB02 | [MCP server overview](https://storybook.js.org/docs/ai/mcp/overview)（[原始檔](https://github.com/storybookjs/storybook/blob/main/docs/ai/mcp/overview.mdx)） | 工具組、工具說明、框架支援、composition |
| SB03 | [MCP server API](https://storybook.js.org/docs/ai/mcp/api)（[原始檔](https://github.com/storybookjs/storybook/blob/main/docs/ai/mcp/api.mdx)） | `toolsets` 選項與各工具組的啟用條件 |
| SB04 | [Manifests](https://storybook.js.org/docs/ai/manifests)（[原始檔](https://github.com/storybookjs/storybook/blob/main/docs/ai/manifests.mdx)） | components／docs manifest 內容與限制 |
| SB05 | [Sharing your MCP server](https://storybook.js.org/docs/ai/mcp/sharing)（[原始檔](https://github.com/storybookjs/storybook/blob/main/docs/ai/mcp/sharing.mdx)） | Chromatic 發佈與 `@storybook/mcp` 自架 |
| SB06 | [Agentic setup](https://storybook.js.org/docs/ai/setup)、[Best practices](https://storybook.js.org/docs/ai/best-practices) | agent 安裝 Storybook、JSDoc 與 story 撰寫建議 |
| SB07 | [Design integrations](https://storybook.js.org/docs/sharing/design-integrations)（[原始檔](https://github.com/storybookjs/storybook/blob/main/docs/sharing/design-integrations.mdx)） | Storybook Connect、addon-designs |
| SB08 | [How to test UIs with Storybook](https://storybook.js.org/docs/writing-tests)、[Accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing)、[Visual tests](https://storybook.js.org/docs/writing-tests/visual-testing) | Vitest addon、axe、Chromatic |
| SB09 | npm：[storybook](https://www.npmjs.com/package/storybook)、[@storybook/addon-mcp](https://www.npmjs.com/package/@storybook/addon-mcp)、[@storybook/mcp](https://www.npmjs.com/package/@storybook/mcp)、[@storybook/addon-designs](https://www.npmjs.com/package/@storybook/addon-designs) | 版本、peer 依賴、10.6.0 實際工具名稱、CHANGELOG |
| SB10 | [figma/code-connect](https://github.com/figma/code-connect)、npm [@figma/code-connect](https://www.npmjs.com/package/@figma/code-connect) 2.0.1 | Code Connect 方案條件、Storybook 寫法 |
| SB11 | [Storybook Connect（Figma Community）](https://www.figma.com/community/plugin/1056265616080331589/storybook-connect) | Figma 端 plugin |
| SB12 | [figma/mcp-server-guide](https://github.com/figma/mcp-server-guide) | Figma MCP 與 Code Connect 的關係 |

SB01–SB08 讀的是 GitHub `main` 分支的文件原始檔（網站被網路政策阻擋），工具名稱另以 npm 10.6.0 套件內容確認一致。
