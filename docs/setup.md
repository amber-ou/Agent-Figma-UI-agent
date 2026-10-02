# 安裝與使用

Spec v1.6 · 適用 Windows／macOS／Linux 本機 Claude Code。

## 1. 需求

- Node.js 22 以上。
- Claude Code（已驗證 2.1.283）。
- Figma remote MCP server。先用 `claude mcp list` 檢查是否已有 `figma`；沒有才加入：

  ```sh
  claude mcp add --transport http figma https://mcp.figma.com/mcp
  ```

  既有設定不要刪除或改名。工具名稱依安裝方式而異（手動設定為 `mcp__figma__<tool>`），hooks 的 matcher 以 regex 涵蓋。
- 官方 Figma plugin skills（`figma:figma-use` 等），本機已驗證 `figma@synced` 2.2.118。
- Figma 帳號在目標檔所屬 plan 上是 **Full seat**（寫入需要）。View／Dev seat 或讀取回「沒有 edit access」時，照下一節恢復。

## 2. 安裝

```sh
git clone https://github.com/amber-ou/Agent-Figma-UI-agent.git
cd Agent-Figma-UI-agent
npm install
node scripts/verify-installation.mjs
```

### Windows PowerShell 注意事項

- `npm install` 若出現「已停用指令碼執行，無法載入 npm.ps1」（PowerShell 執行原則擋下 `npm.ps1`），擇一處理：
  - 改用 `npm.cmd install`（不改任何系統設定，建議先用這個）；之後的 npm 指令也用 `npm.cmd`，例如 `npm.cmd test`。
  - 或執行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`，只改目前使用者的執行原則，之後可直接用 `npm`。
- 測試指令的 glob 要加引號：`node --test "tests/**/*.test.mjs"`。`node --test tests/` 在 Node 22 會失敗。
- `node` 指令本身不受執行原則影響，`node scripts/*.mjs` 可直接執行。

`verify-installation.mjs` 檢查 Claude Code、Figma MCP 連線、plugin 版本、專案 hooks、skill 與依賴；`problems` 為空才算完成。v1.6 起它是**按需**的：同一個 Claude Code session 裡、環境（Claude Code／Node／OS 版本、Figma plugin 與 MCP 設定、專案 settings／lockfile／skill）沒變時沿用上次的診斷（輸出 `diagnosis.mode: "reused"`），首次 session、有變更、上次有問題或紀錄損毀時完整重跑。要強制重跑加 `--force`；沒有 session id 時的沿用時間可用環境變數 `FIGMA_UI_DIAG_MAX_AGE_MIN` 調整（預設 60 分鐘）。沿用診斷不代表 run 的帳號與檔案權限已確認，這些每個 run 都會重新檢查。

在 Claude Code 內執行 `/mcp` 完成 Figma OAuth（由使用者操作，不貼 token）。

### 帳號不對時（spec §4.2.1）

1. `/mcp` → figma → **Clear authentication**。
2. 在預設瀏覽器（或無痕視窗）確認 figma.com 登入的是正確帳號。
3. `/mcp` → figma → **Authenticate**，在授權頁確認帳號後才允許。
4. 仍拿到舊帳號：重啟 Claude Code（`claude --continue`），必要時 `claude mcp remove figma` 後重新加入。
5. 也可以把終端機顯示的授權網址貼到只登入正確帳號的無痕視窗（callback 為本機 localhost）。
6. 以 `/figma-ui` 的 Preflight（`whoami`）確認後才算切換成功。

## 3. 使用

```text
/figma-ui Aiwow：讀取這個 Figma 檔案的 library、components 與 variables，延伸做一個成員管理頁。
參考 Figma URL：<你的檔案或 frame 連結>
輸出位置：<檔案／頁面>
```

需求裡寫明**產品**（例如 Aiwow），agent 才會自動套用該產品的政策；沒寫就會先問（v1.7 REQ-05）。library 也請在需求中提供，沒提供或找不到時 agent 會問（REQ-06）。

- 續改：`/figma-ui continue <run-id> 調整列表間距`
- 中斷後恢復：`/figma-ui resume <run-id>`（先對帳，再只問過期或衝突的資訊）

這三種是 skill 自己解析的引數，不是 Claude Code 內建命令。新增的 skill 若沒有出現在 `/` 選單，重啟 Claude Code。

## 4. 本機檔案

| 位置 | 內容 | 版本控制 |
|---|---|---|
| `design-runs/<run-id>/` | brief、capabilities、inventory、plan、ledger、operations.jsonl、audit、handoff | 否（`.gitignore`） |
| `.figma-ui/active-run.json`、`.figma-ui/locks/` | 目前 run 與本機寫入鎖 | 否 |
| `.figma-ui/hook-events.jsonl` | hooks 觸發紀錄（不含程式碼內容，只有 hash；v1.6 另記工具類別、耗時與 session id） | 否 |
| `.figma-ui/session.json`、`.figma-ui/diagnostics.json` | 最近一次 Figma 呼叫的 session id；上次的安裝診斷（按需沿用） | 否 |
| `.figma-ui/products/<productId>.local.json` | 產品的 Figma 檔案與 library 網址（預填候選，v1.7） | 否 |
| `product-policies/<productId>.json` | 產品政策（v1.7） | **是** |

run 結束（或暫停）一定要 `node scripts/state-store.mjs release <run-id>`；否則 hooks 會持續阻擋本專案所有未帶 op 標頭的 Figma 呼叫。

## 5. 產品政策（v1.7）

每個產品有兩份檔案（spec §7.5）：

| 檔案 | 內容 | 版本控制 |
|---|---|---|
| `product-policies/<productId>.json` | 使用者決定、長期有效的產品規則（例如對比政策）、每次變更的 history | **進 git**；不得含 Figma 網址、fileKey、帳號或秘密 |
| `.figma-ui/products/<productId>.local.json` | 這台電腦知道的 Figma 檔案與 library 網址、fileKey | 否（`.figma-ui/` 不進 git） |

**本機檔的用途**：intake 時當作預填候選，例如「這個產品通常用 Aiwow Library」。它**不代表**本次已授權讀寫，每個 run 仍要確認 library 和輸出位置。格式見 `schemas/product-local.schema.json`，例如：

```json
{
  "schemaVersion": "1.0",
  "productId": "aiwow",
  "files": [{ "role": "reference", "name": "Aiwow LINE OA", "fileUrl": "https://www.figma.com/design/<fileKey>/…", "fileKey": "<fileKey>" }],
  "libraries": [{ "name": "Aiwow Library", "provides": ["components"], "libraryKey": "lk-…" }]
}
```

檢查格式：`node scripts/product-policy.mjs local <productId>`。

**換電腦時**：政策檔會跟著 git 過來，只需要在新電腦補 `.figma-ui/products/<productId>.local.json`。沒有這份檔也能用，只是 intake 時要你提供檔案和 library 連結。`design-runs/` 也不進 git，換電腦後舊 run 就不在了（使用者已接受，§4.6）。

**新增一個產品**：
1. 在需求裡寫明產品名稱，例如「Neo 的設定頁」。
2. 找不到 `product-policies/neo.json` 時，agent 會問你是否建立。你確認後才執行 `product-policy.mjs init`，新檔只有 `productId` 和 `displayName`，沒有任何政策。
3. 第一個需要對比政策的 run，agent 會在預填清單最前面問政策題；你的回答寫入政策檔，之後不再問。

**看、改產品政策**：
- 看：`node scripts/product-policy.mjs show <productId>`，或直接開 `product-policies/<productId>.json`。
- 改：只能經你回答政策題、在 handoff 勾選政策建議，或明確指示「把某規則寫進某產品政策」。agent 會先給你看將寫入的內容，再用 `product-policy.mjs write` 寫入，並附加 history；它會拒絕沒有你確認紀錄的寫入，也拒絕只限本次的設定。
- 手動編輯政策檔也可以，但 history 只能附加；提交前執行 `node scripts/product-policy.mjs validate --against-git` 檢查。
- agent 不會把產品政策或 run 的決策寫進 Claude Code 的記憶或 `CLAUDE.md`（INVARIANT-26）。

## 6. 工具指令

| 指令 | 用途 |
|---|---|
| `node scripts/state-store.mjs new\|resolve\|parse\|activate\|release\|active` | run 建立、解析、鎖 |
| `node scripts/operation-journal.mjs plan\|verify\|cancel\|reconcile\|summary <run-id> [json]` | 操作紀錄 |
| `node scripts/preflight.mjs diagnose <whoami.json> [planRef]` | 帳號與 seat 診斷 |
| `node scripts/run-context.mjs <run-id> new\|continue\|resume` | 這次還要問什麼、已確認什麼（不重問）、下一步 |
| `node scripts/validate-artifacts.mjs design-runs/<run-id> [--stage intake\|plan\|build\|final]` | 階段式 schema＋跨檔檢查；不帶 `--stage` 為完整檢查 |
| `node scripts/evaluate-completion.mjs design-runs/<run-id> [--write]` | 唯一完成判定（§12.1），Handoff 的最終入口（已含完整檢查） |
| `node scripts/run-report.mjs phase\|ask\|answered\|metrics\|handoff <run-id> …` | 階段與提問紀錄（`ask <run-id> <列數> --prefilled N --blank M`）、最低量測、由 artifacts 產生 handoff.md |
| `node scripts/product-policy.mjs show\|validate\|local\|apply\|suggest\|write\|init …` | 產品政策：查看、檢查、本機候選、套用到 run、政策建議、經使用者確認後寫入、建立新產品（v1.7） |
| `node scripts/verify-installation.mjs [--force]` | 按需的安裝診斷 |
| `node scripts/evaluate-completion.mjs design-runs/<run-id> --accept-test-run <decisionRef> <說明>` | 記錄使用者接受為測試成功（§2.3）；不改 status 與完成判定 |
| `node scripts/quality-metrics.mjs token-binding design-runs/<run-id> [--write]` | tokenBinding：variable binding 與 style 套用分開統計（§12.2） |
| `node scripts/quality-metrics.mjs contrast <#fg> <#bg> [fontSizePx] [bold]` | 可及性預檢的對比計算（§9.5） |
| `node scripts/quality-metrics.mjs fonts <required.json> <available.json>` | 字型安裝比對（§10.3） |
| `node --test "tests/**/*.test.mjs"` | 離線 fixture 測試 |
