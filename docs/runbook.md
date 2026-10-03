# Runbook：/figma-ui 日常操作與故障處理

Spec v1.8 · 適用於本機 Claude Code（Windows 實測）· 最後更新 2026-10-03（v1.8）

規範以 `FIGMA_UI_AGENT_SPEC.md` 為準，流程細節在 `.claude/skills/figma-ui/SKILL.md` 與 `references/`。本文件只寫**遇到狀況時照做的步驟**。

---

## 1. 日常使用

### 1.1 開始、續改、恢復

| 要做什麼 | 指令 | agent 會怎麼做 |
|---|---|---|
| 新任務 | `/figma-ui <需求>` | 建立新 run，重新做 Intake；不沿用先前 run 的平台、品牌、DS 或「採用建議」授權。需求寫了產品就自動套用該產品政策，並在摘要列一行「已套用產品政策：…」；沒寫就先問產品 |
| 在同一個 run 上調整 | `/figma-ui continue <run-id> <調整>` | 跑 `run-context.mjs <run-id> continue`，已確認的內容不重問，只問新增的差異 |
| 中斷後恢復 | `/figma-ui resume <run-id>` | 先照 `run-context.mjs <run-id> resume` 的 `next` 對帳，再繼續 |

### 1.2 一個 run 的流程

`INTAKE → PREFLIGHT → DISCOVER → PLAN → BUILD → VALIDATE → HANDOFF`

- **Plan 結束前不會寫入 Figma。** 待決的項目會一次列成**預填清單**（v1.7 DEC-09）：
  - agent 有建議的列，答案欄已填好並標「建議，請確認」；需要你決定的列留空。
  - 你可以一次確認全部，也可以逐列修改或填寫。留空的列 agent 不會自己填，你說略過就略過。v1.8 起，你明確略過的題目算「已回答」，不會讓 run 卡在 `awaiting_user`；只有 agent 自己標成略過、你還沒看過的題目才算待答。
  - 只影響動態行為的事（Toast 停留幾秒、能否手動關閉、動畫、手勢）不會問你，handoff 會列為「未定義，交由實作決定」（v1.8 DEC-11）。
  - 確認前不會寫入受影響的部分。
  - 產品還沒有對比政策時，政策題排在第一列。
- **寫入只在 brief 授權的範圍**，而且放在本 run 的 Section（`figma-ui / <run-id>`）。
- **每個寫入都會另外讀回驗證**，不以寫入時的回應為準。
- **完成與否只看 `evaluate-completion.mjs` 的結果。** 你把未完成的 run「接受為測試成功」時，只會記錄 `userAcceptance`，run 的狀態不會變成 complete。

### 1.3 常用指令

```bash
node scripts/state-store.mjs active                          # 目前有沒有進行中的 run／鎖
node scripts/run-context.mjs <run-id> continue|resume        # 還需要問什麼、下一步是什麼
node scripts/validate-artifacts.mjs design-runs/<run-id> --stage intake|plan|build   # 階段驗證
node scripts/evaluate-completion.mjs design-runs/<run-id> --write                    # 唯一的完成判定
node scripts/run-report.mjs handoff <run-id> --write         # 從 artifacts 產生 handoff.md
node scripts/run-report.mjs metrics <run-id>                 # 階段時間、工具次數、提問與決策統計
node scripts/state-store.mjs release <run-id>                # 釋放鎖（每個 run 結束一定要做）
node scripts/product-policy.mjs show <productId>             # 看產品政策（v1.7）
node scripts/product-policy.mjs validate --against-git       # 檢查政策檔（不含網址／fileKey、history 只附加）
node scripts/artifact-skeleton.mjs <contract> <run-id>       # 印出通過 schema 的 artifact 骨架與範例（v1.8）
node scripts/verify-installation.mjs [--offline]             # 安裝診斷、plugin 版本、hooks matcher 涵蓋（v1.8）
node --test "tests/**/*.test.mjs"                            # 全部測試（不要用 node --test tests/）
```

Windows PowerShell 如果擋下 `npm`，改用 `npm.cmd install`，或先執行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（見 `docs/setup.md`）。

### 1.4 收尾檢查

1. `evaluate-completion.mjs … --write` 的結果和原因都有記下來。
2. `run-report.mjs handoff <run-id> --write` 已產生 handoff。
3. `state-store.mjs release <run-id>` 已執行，`state-store.mjs active` 顯示 `null`。
4. 程式碼的修改推到功能分支，不直接推 main。

---

### 1.5 產品政策（v1.7）

- **怎麼看**：`node scripts/product-policy.mjs show <productId>`。handoff 第 11 項也會列出本 run 套用了哪些政策，依政策沒檢查對比時會註明。
- **怎麼改**：只有你能決定。途徑有三種：
  - 回答政策題；
  - 在 handoff 勾選政策建議（`- [ ] ps-N：…`）；
  - 明確說「把某規則寫進某產品政策」。

  agent 會先給你看將寫入的內容，再寫入並附加 history。沒勾選的建議只留在那個 run，政策檔不變。
- **新增產品**：需求寫新產品名稱，agent 會問你是否建立政策檔；細節見 `docs/setup.md` 的「產品政策」。
- **換電腦**：政策檔在 git 裡；只需補本機的 `.figma-ui/products/<productId>.local.json`（檔案與 library 網址，預填候選用）。
- **政策在 run 期間被改過**：`validate-artifacts` 和 `run-context` 會提示 digest 不同；請 agent 重新套用並確認。
- **不會寫進 Claude Code 記憶**：run 決策和產品政策都不寫入 `~/.claude/projects/…/memory/` 或 `CLAUDE.md`（INVARIANT-26）。如果你發現有，請刪除並告訴 agent。

### 1.6 Figma plugin 版本題（v1.8，§4.2.2）

本機 Figma plugin 比官方最新版（`figma/mcp-server-guide` 的 `.claude-plugin/plugin.json`）舊時，每個 run 的 Intake 預填清單**第一列**都會問一次。答案只對這個 run 有效，下次 run 還會再問（你已確認要這樣）。

| 你看到的題目 | 怎麼回答 | 之後會怎樣 |
|---|---|---|
| 「先升級，還是這次照舊版跑？」（一般安裝的 plugin） | `upgrade_first`：先停下來升級；`use_current`：這次照舊版跑 | 升級後重開 Claude Code，再跑 `node scripts/verify-installation.mjs --force` 確認版本號；依 spec §19 重跑工具契約與最小整合測試，結果記入 `references/runtime-probes.md`。版本號以實際讀到的為準 |
| 「要等帳號同步更新，還是這次照舊版跑？」（`figma@synced`） | `wait_for_sync`：這次先不跑；`use_current`：這次照舊版跑 | 見下方「synced plugin」 |
| 摘要只有一行「無法確認 Figma plugin 是否為最新版」 | 不用回答 | 查不到最新版（例如沒有網路）時只提示，不擋 run |

答案記在 `brief.pluginVersionChoice`。想自己看版本：`node scripts/verify-installation.mjs` 輸出的 `pluginVersion`（installed、latest、status、synced）。沒有網路時加 `--offline`，結果會是 `latest_unknown`。

**synced plugin 無法在本機升級**：`figma@synced` 是 claude.ai 帳號同步下來的 plugin，本機的 `claude plugin` 指令不一定能升級它；重開 Claude Code 也不會變（2026-10-03 實測仍是 2.2.118，官方最新 2.2.126）。不要在本機另裝一份 `figma` plugin 來「升級」：那會多出第二個 Figma 連線（見 1.7），OAuth 也要另外授權。等帳號同步更新後，`verify-installation.mjs` 會讀到新版本號，題目就不再出現。

### 1.7 有多個 Figma 連線時（v1.8，§4.2.3）

同一台電腦可能有好幾個 Figma MCP 連線：手動加入的 `figma`（工具前綴 `mcp__figma__`）、Figma plugin 帶入的連線、claude.ai 連接器（`mcp__claude_ai_Figma__`），以及其他 plugin（例如 `design` plugin）各自註冊的連線。每個連線的 OAuth 是分開的，可能登入不同帳號。

- Preflight 會用 `node scripts/preflight.mjs connections …` 列出所有 Figma 前綴。只有一個就直接用；有多個時，預填清單會列一題讓你選，預填的是 `whoami` 帳號檢查通過的那個。
- 選定的前綴記在 `capabilities.server.toolPrefix`。這個 run 的帳號檢查只對它有效；run 進行中，**經其他前綴送出的寫入會被 hook 擋下**，讀取只記錄。
- 怎麼選：選登入「擁有目標檔案、且有 Full seat」帳號的那個連線。不確定時，分別對各連線呼叫 `whoami` 比對；不要為了統一名稱刪掉你自己加的連線。
- `verify-installation.mjs` 的 `hookMatcherCoverage` 會檢查 hooks 是否涵蓋所有已知與已設定的前綴；`problems` 有內容時先修 `.claude/settings.json` 再跑 run。

## 2. 帳號與權限恢復

每個 run 都會在 Preflight 呼叫 `whoami`，再執行 `node scripts/preflight.mjs diagnose <whoami.json> [targetPlanRef]`。

| 症狀 | 原因 | 處理 |
|---|---|---|
| diagnose 回 `unrecognized_format`（exit 3，「格式不符」） | 存下來的 whoami 回應找不到 plans 陣列 | 這**不是**帳號問題。把 `whoami` 回應原樣存檔再跑（原始回應、外層包裝、扁平 `{plans:[…]}` 都接受） |
| diagnose 回 `blocked`：`no Full seat…` | 目標 plan 只有 View／Dev seat，不能寫入 | 在 Figma 取得 Full seat，或換成擁有檔案的帳號（依下方步驟）；只讀的 audit 任務不受影響 |
| diagnose 回 `blocked`：`not a member of the target plan` | 登入的是別的帳號 | 依下方「切換帳號」 |
| 讀取回報「沒有 edit access／存取被拒」 | 帳號或 seat 不對 | **不要重試讀取**，因為會耗用配額；先做 `whoami`，再依下方步驟處理 |
| 回報 rate limit | 配額用完 | 依回應等待後再試；agent 會保存進度，不會重複送出寫入 |
| MCP 工具不見、`/mcp` 顯示未連線 | OAuth 過期或 plugin 沒載入 | 先 `node scripts/verify-installation.mjs --force` 看是哪一項，再依下方步驟重新授權 |

**切換或重新授權帳號**（照 `preflight.mjs` 輸出的 `recoverySteps`）：

1. 在 Claude Code 執行 `/mcp`，選 figma，然後選 **Clear authentication**。
2. 在瀏覽器（或私密視窗）確認 figma.com 登入的是擁有目標檔案的帳號。
3. 再執行 `/mcp` → figma → **Authenticate**，在同意頁確認帳號後才允許。
4. 如果又出現舊帳號，重開 Claude Code（`claude --continue`）；必要時執行 `claude mcp remove figma` 再重新加入。
5. 授權後重新呼叫 `whoami`，確認看到正確帳號才算切換完成。

email 和 handle 不會寫進任何檔案（CAP-03）。

---

## 3. hook 阻擋

有進行中的 run 時，`.claude/settings.json` 的 hook 會檢查每一個 Figma 呼叫。**不要繞過 hook**：不要改用其他工具寫入，也不要手動刪 `active-run.json`。

| 阻擋原因（訊息開頭 `figma-ui:`） | 處理 |
|---|---|
| `capabilities.server.toolPrefix is not recorded …`（v1.8） | Preflight 還沒記錄這個 run 用哪個 Figma 連線：完成第 1.7 節的選擇與 `whoami` 檢查，寫入 `capabilities.json` |
| `… goes through the Figma connection …, but run … uses …`（v1.8） | 寫入走了另一個 Figma 連線。改用訊息裡指定的工具名稱；**不要**把 `toolPrefix` 改成別的連線來繞過，那個連線的帳號沒檢查過 |
| `missing op header` | 腳本第一行要是 `// figma-ui run=<run-id> op=<id> mode=read\|write` |
| `op header run=… does not match active run` | 標頭的 run-id 要和 `state-store.mjs active` 顯示的一致 |
| `… is not enabled for run …` | 有進行中的 run 時，寫入只能走 `use_figma` |
| `read uses operationId …, which belongs to a write` | 讀取要用獨立的 `rd-XXXX` 編號 |
| `… is declared mode=read but its code can change the canvas (…)`（M4 新增） | 腳本標成唯讀，但裡面有 create、remove、appendChild、屬性賦值之類會改動畫布的寫法。**連暫時建立再刪除也不行**。改成規劃為寫入，或改讀既有節點、主元件本身的資料。這是啟發式檢查，可能誤擋名為 `name`、`x` 的本地物件屬性；需要的話換個屬性名稱 |
| `operations.jsonl has a truncated last line` | journal 最後一行壞了，要先對帳（第 4 節） |
| `brief.output is not confirmed…` | 回 Intake 取得寫入授權 |
| `fileKey … is not the authorized output` | 只能寫入 brief 授權的檔案 |
| `local writer lock … is not held by run …` | 執行 `state-store.mjs activate <run-id> <fileKey>`；鎖被別的 run 持有時**不要搶**，先看那個 run 的 journal 再決定 |
| `unresolved write(s) on this file: …` | 有 dispatched 或 unknown_outcome 的寫入，先對帳（第 4 節） |
| `operation … must exist in the journal with status=planned` | 先用 `operation-journal.mjs plan` 記錄 planned |
| `planned operation … must have mode=write and fileKey=…` | planned 紀錄的 mode 或 fileKey 寫錯了，重新 plan 一筆正確的 |
| `operation … has no basisRefs` | planned 紀錄要引用依據：決策、componentMap 或 pattern |
| `operation-journal plan` 本身拒絕（`build gate: …`） | Build 邊界沒通過：用 `validate-artifacts.mjs … --stage build` 看缺什麼。常見原因是 plan 或 flow 未確認、決策未回答、文案 pending。M4 起，新 run 的第一個寫入可以兼作 nativeWrite 探測：先前 run 已驗證過（`basis: history`）就能規劃；v1.8 起它讀回 `verify` 成功後會自動升級成本 run 的 `verified`，不用手動改 |

run 結束沒有釋放鎖時，hook 會繼續擋下本專案所有沒有 op 標頭的 Figma 呼叫：執行 `state-store.mjs release <run-id>`。

---

## 4. 未知結果對帳

`operation-journal.mjs summary <run-id>` 的 `nextStep` 會告訴你要做什麼：

| nextStep | 意思 | 做法 |
|---|---|---|
| `reconcile` | 有 `dispatched`（例如 CC 中斷）或 `unknown_outcome`（寫入失敗、或回應被截斷） | 照下面的步驟 |
| `verify` | 有 applied 但還沒讀回驗證 | 用獨立讀取確認後執行 `verify` |
| `dispatch_planned`／`none` | 沒有未解決的寫入 | 繼續或收尾；留下沒送出的 planned 要 `cancel` |

**對帳步驟**：

1. **不要重送**同一個寫入，也不要刪除畫布上的任何東西。
2. 從該 operation 的 `preconditions` 取出父節點、既有 child IDs、預期新增的數量與類型、`logicalKey`。
3. 用一個**唯讀**腳本（新的 `rd-` 編號）讀父節點：比對 child IDs 的前後差異，再找帶本 run 的 `runId`、`operationId`、`logicalKey` 所有權標記的節點。
4. 依結果記錄：
   - **只有一個候選，且類型、結構、內容都符合** → `operation-journal.mjs reconcile <run-id> '{"operationId":"op-…","outcome":"applied","evidenceRefs":["rd-…"],"createdNodeIds":[…]}'`，再用另一個讀取做 `verify`。
   - **確定沒有副作用**（父節點沒變、沒有帶標記的節點） → `reconcile … "outcome":"failed_known"`，然後用**新的** operationId 重試。M3 實測：腳本中途丟出 JS 例外時，Figma 還原了整批變更；目前只觀察到一次，屬於假設，所以每次仍要對帳。
   - **多個候選、只建了一部分、有人同時新增，或證據不足** → 保持 unknown，保留畫布現況，詢問使用者。
5. 錯誤回應裡如果有 `safeToRetryWithoutCanvasRead: true`，修正後可以重試；沒有這個欄位就當作未知，先讀畫布。M3 的 3 次真實 JS 例外都**沒有**出現這個欄位。

**guard 擋下、沒有改動任何節點的寫入**（M4 新增）：precondition guard 回傳 conflict 時，腳本不會改動任何東西。讀回確認之後：

- 新的寫入：`operation-journal.mjs verify <run-id> '{"operationId":"op-…","evidenceRefs":["rd-…"],"noChange":true}'`
- 已經 verified 的舊寫入：`operation-journal.mjs confirm-no-change <run-id> '{"operationId":"op-…","evidenceRefs":["rd-…"]}'`

有這個標記，先前的證據就不會因為這個寫入被判為「無法確定」。沒有標記、又沒列出節點的寫入，仍然判為無法確定。

**使用者改了 agent 的節點**（guard 回傳 `user_modified`、`user_added_nodes`、`user_removed_nodes`、`deleted`）：不覆寫、不重建，回報差異並詢問。採納的話，讀回確認後更新 ledger entity 的 fingerprint 基準，相關證據要重讀（見 `references/collaboration.md`）。已知限制：fingerprint 不涵蓋文字截斷設定，只改這類屬性的變更偵測不到。
