# 安裝與使用

Spec v1.3 · 適用 Windows／macOS／Linux 本機 Claude Code。

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

Windows PowerShell 若出現「已停用指令碼執行，無法載入 npm.ps1」，改用 `npm.cmd install`，或先執行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

`verify-installation.mjs` 檢查 Claude Code、Figma MCP 連線、plugin 版本、專案 hooks、skill 與依賴；`problems` 為空才算完成。

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
/figma-ui 讀取這個 Figma 檔案的 library、components 與 variables，延伸做一個成員管理頁。
參考 Figma URL：<你的檔案或 frame 連結>
輸出位置：<檔案／頁面>
```

- 續改：`/figma-ui continue <run-id> 調整列表間距`
- 中斷後恢復：`/figma-ui resume <run-id>`（先對帳，再只問過期或衝突的資訊）

這三種是 skill 自己解析的引數，不是 Claude Code 內建命令。新增的 skill 若沒有出現在 `/` 選單，重啟 Claude Code。

## 4. 本機檔案

| 位置 | 內容 | 版本控制 |
|---|---|---|
| `design-runs/<run-id>/` | brief、capabilities、inventory、plan、ledger、operations.jsonl、audit、handoff | 否（`.gitignore`） |
| `.figma-ui/active-run.json`、`.figma-ui/locks/` | 目前 run 與本機寫入鎖 | 否 |
| `.figma-ui/hook-events.jsonl` | hooks 觸發紀錄（不含程式碼內容，只有 hash） | 否 |

run 結束（或暫停）一定要 `node scripts/state-store.mjs release <run-id>`；否則 hooks 會持續阻擋本專案所有未帶 op 標頭的 Figma 呼叫。

## 5. 工具指令

| 指令 | 用途 |
|---|---|
| `node scripts/state-store.mjs new\|resolve\|parse\|activate\|release\|active` | run 建立、解析、鎖 |
| `node scripts/operation-journal.mjs plan\|verify\|cancel\|reconcile\|summary <run-id> [json]` | 操作紀錄 |
| `node scripts/preflight.mjs diagnose <whoami.json> [planRef]` | 帳號與 seat 診斷 |
| `node scripts/validate-artifacts.mjs design-runs/<run-id>` | schema＋跨檔檢查 |
| `node scripts/evaluate-completion.mjs design-runs/<run-id> [--write]` | 唯一完成判定（§12.1） |
| `node --test "tests/**/*.test.mjs"` | 離線 fixture 測試 |
