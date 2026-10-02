# M2 總結：工作流程與契約

Spec：FIGMA_UI_AGENT_SPEC.md v1.3 · schemaVersion 1.2 · 日期：2026-09-28 · 分支：`feat/m2-skill`

M2 把 M1 已證實的路徑整理成 skill、資料契約、validator 與本機工具。M2 **沒有**新的 Figma 寫入；唯一的真實 Figma 呼叫是唯讀量測回傳上限。

## 1. 狀態

| 項目 | 狀態 | 說明 |
|---|---|---|
| implementationStatus | `m2_complete` | `/figma-ui` skill（new／continue／resume、7 個 references、4 個 snippets）、7 份 JSON Schema＋共用定義、validator（語法與跨檔分開）、`evaluate-completion` 接上 validator、state-store／operation-journal／preflight／verify-installation／variable-trace、M1 去識別化 fixtures、60 項 fixture 測試 |
| integrationStatus | `m1_path_verified` + 回傳上限已量測 | skill 本身尚未以真實 `/figma-ui` 任務跑過（M3／M4）。本次真實呼叫只有 2 個唯讀 `use_figma`（回傳上限） |

## 2. 交付檔案

| 檔案 | 用途 | Spec |
|---|---|---|
| `.claude/skills/figma-ui/SKILL.md` | 手動呼叫、主會話；入口判斷、階段出口、寫入規則、必問情況、讀取規則、收尾 | §4.1、§4.3、§7、§8 |
| `.claude/skills/figma-ui/references/*.md` | discovery、design-decisions、design-quality、collaboration、runtime-probes、recovery、handoff | §6、§7.4、§9–§12、§11、§15 |
| `.claude/skills/figma-ui/snippets/*.js` | op-header、fingerprint（M1 演算法）、mark-owned、precondition-guard | §4.5、§11.2–§11.4 |
| `schemas/*.schema.json` | common、brief、plan、inventory、capabilities、ledger、operation、audit（Draft 2020-12） | §20 |
| `scripts/validate-artifacts.mjs` | schema 檢查與跨檔語意檢查（分開實作） | §20 |
| `scripts/evaluate-completion.mjs` | `evaluateRun`：先驗證，再做 §12.1 判定；有契約錯誤一律不能完成 | §12.1 |
| `scripts/state-store.mjs` | 原子寫入、run 建立（全新 intake brief）、run id 解析、引數解析、O_EXCL 鎖、釋放鎖並移除 active-run | §4.5、§7.1、§11.1、§11.7 |
| `scripts/operation-journal.mjs` | planned（schema＋basisRefs 檢查）、verified、cancel、reconcile、resume 摘要 | §11.3–§11.5、DEC-06 |
| `scripts/preflight.mjs` | whoami 診斷（seat、plan、恢復步驟，不存 email）、capabilities 建立 | §4.2.1、CAP-01–03 |
| `scripts/verify-installation.mjs` | CLI 版本、MCP、plugin、hooks、skill、依賴 | §4.2 |
| `scripts/variable-trace.mjs` | 手動 alias trace（各 collection 自己的 mode、cycle、深度），runtime 結果優先 | §6.3 |
| `scripts/hooks/post-figma-call.mjs`（修改） | 寫入回應被截斷 → `unknown_outcome` | §4.5、§11.5 |
| `scripts/hooks/lib.mjs`（修改） | journal 合併時 timestamps 深合併 | §11.3 |
| `tests/fixtures/m1-run/` | M1 真實 run 去識別化並補齊為完整契約（fileKey、library key、元件／變數 key、品牌名已替換） | §20 |
| `package.json`、`package-lock.json`、`.npmrc` | Ajv 8.20.0、ajv-formats 3.0.1（固定版本） | — |
| `CLAUDE.md`、`docs/setup.md`、`docs/history/m2-summary.md` | 入口說明、安裝與使用、本文件 | §17 |

## 3. 量測：`use_figma` 回傳上限（CAP-05）

在 sandbox 頁（`34014:8`）以唯讀腳本量測，無寫入：

- 回傳 1,000,000 字元 → 被截斷，結尾附加 `// truncated to 20kb`，**不回報錯誤**。
- 位置編碼字串（每 10 字元一段）→ 最後完整區塊為第 20,470–20,479 字元，上限 **20,480 字元（20 KiB）**。
- 以 ASCII 量測；中文等多位元組字元以字元或位元組計，**未量測**。

處理：寫入腳本只回傳 IDs／狀態／fingerprint；讀取分批（每批約 15,000 字元內）；看到截斷標記就視為資料不完整；post hook 把被截斷的寫入回應記為 `unknown_outcome`。已寫入 `references/runtime-probes.md` 與 SKILL.md。

## 4. 測試

指令：`node --test "tests/**/*.test.mjs"`（或 `npm test`）。結果：**60 pass，0 fail**。全部為 `executionLayer=offline_fixture`。

| Spec 測試 | 優先級 | 結果 | 測試檔 |
|---|---|---|---|
| T43 View／Dev seat、讀取被拒 → blocked＋恢復步驟 | P0 | pass | `contracts/workflow` |
| T44 hook 放行不輸出決定 | P0 | pass | `hooks/figma-hooks` |
| T45 variables library 未核准／未識別 → gap，不得綁定 | P0 | pass | `contracts/cross-file`、`contracts/schemas` |
| T46 元件版本差異須記 baseline 並列給使用者 | P0 | pass | `contracts/cross-file`、`contracts/schemas` |
| T33 new／continue／resume 解析、run id 多義時詢問 | P0 | pass（解析與解析結果；skill 對話行為未實測） | `contracts/workflow` |
| T21 新 run 不沿用上次設定 | P0 | pass（資料層） | `contracts/workflow` |
| T31 只寫授權 output | P0 | pass（validator＋hook） | `contracts/cross-file`、`hooks` |
| T32 缺 gate、懸空 evidenceRef、過期證據 | P0 | pass | `contracts/cross-file`、`contracts/evaluate-completion` |
| T38／T41 未回答決策或無依據的 write | P0 | pass | `contracts/cross-file`、`recovery/operation-journal` |
| T29 audit 不得寫入（INVARIANT-08） | P0 | pass（validator 層） | `contracts/cross-file` |
| T25／T26 跨 collection mode、cycle、trace 不可見 | P0 | pass（手動 tracer；runtime 部分 M1 已驗證） | `contracts/variable-trace` |
| T16 journal 最後一行截斷 | P0 | pass | `recovery/operation-journal`、`hooks` |
| T27 create 生效但 ID 未回傳（journal 流程） | P0 | pass（對帳紀錄流程；畫布端對帳未實測） | `recovery/operation-journal` |
| T35 使用者改了 agent 節點 → guard conflict | P0 | pass（fake nodes） | `contracts/snippets` |
| T39／T40 hook 阻擋、unknown_outcome 阻擋後續寫入 | P0 | pass | `hooks/figma-hooks` |
| T19 第二個 writer 被本機鎖擋下 | P1 | pass | `contracts/workflow`、`hooks` |
| T28 不自動接手他人的鎖 | P1 | pass（子集） | `contracts/workflow` |
| T34 高分不能完成 | P1 | pass | `contracts/evaluate-completion` |
| T36／T37 使用者新增／刪除節點 | P1 | pass（fake nodes） | `contracts/snippets` |
| 快照：fingerprint 重現 M1 三個值 | — | pass | `contracts/snippets` |

**尚未涵蓋（需要真實整合或 M3／M4）：**T02、T03、T04、T05、T06、T07、T08、T10、T11、T13、T15、T22、T23、T24 的真實行為；T35–T37 的真實畫布實測；PostToolUseFailure 的真實觸發；variable import-by-key；T01、T09、T12、T14、T17、T18、T20、T30、T42（P1）。

## 5. 已知限制

- op 標頭的 `mode` 是自我聲明：標成 read 卻寫入的腳本無法完全攔截（§4.5）。
- 本機鎖不能限制 Figma 內的其他使用者；precondition guard 縮短衝突窗口，但不是原子交易。
- `validate-artifacts` 能檢查「有沒有依據」，不能證明腳本內容符合依據；後者靠 Validate 階段的讀回與截圖。
- gap-001（variables 來源 library）仍未識別：需要顏色 token 的驗證標 `not_verified`。
- skill 從未以真實 `/figma-ui` 任務執行；新 skill 可能要重啟 Claude Code 才會出現在 `/` 選單。
- 回傳上限的多位元組字元行為未量測。

## 6. 下一次 `/figma-ui` 的開場範例

```text
我先整理你提供的內容，請確認或補充：
- 任務：延伸（新增畫面）｜產品／平台：尚未提供
- 參考檔案：<你貼的連結>（node-id 指向的是頁面「v1.1.2」，不是單一 frame）
- 元件 library：尚未確認｜variables library：尚未確認（這兩個可能不是同一個）
- 輸出位置：尚未確認

請回答：
1. 產品與平台是什麼？要交付哪些畫面和狀態？
2. 元件用哪個 library？顏色、間距等 variables 來自哪個 library？也可以讓我先盤點參考檔，再列給你確認。
3. 成果放在哪個檔案、哪一頁？建議開一個獨立頁面或 Section，不動既有內容。要做新稿還是直接改原稿？
```

設計決策問題範例（格式依 DEC-04）：

```text
【設計決策 dec-004】成員列表頁／頁首背景
DS 沒有頁首背景的規範，兩個參考畫面也不一致（A 用純色 surface/default，B 用品牌色漸層）。
選項：
1. 純色 surface/default：與 A 一致，視覺較安靜，主要 action 更突出
2. 沿用 B 的品牌漸層：品牌感較強，但需確認 B 的漸層是否為正式規範
3. 純色 surface/brand-subtle：介於兩者之間，已有對應 variable
建議：1（僅供參考，請你決定）
```
