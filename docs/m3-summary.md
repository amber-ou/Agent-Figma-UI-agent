# M3 總結：v1.4 規則與真實整合

Spec：FIGMA_UI_AGENT_SPEC.md v1.4 · schemaVersion 1.2 · 日期：2026-09-29 · 分支：`feat/m3`

M3 分兩部分：

- **第一部分**：離線實作 v1.4 規則，已在 commit b98036d 完成。
- **第二部分**：在 sandbox 頁做真實整合測試，run 為 `ui-20260929-001`。

## 1. 狀態

| 項目 | 狀態 | 說明 |
|---|---|---|
| implementationStatus | `m3_complete` | v1.4 的 schema／validator 規則、skill 更新、`quality-metrics.mjs`、PowerShell 注意事項（第一部分）；PostToolUseFailure 欄位值記錄；fingerprint snippet 的 TEXT 子節點修正；共 78 項測試 |
| integrationStatus | `m3_integration_verified` | 以下 4 項在 Figma 實測過：中文回傳上限、PostToolUseFailure、寫入失敗後的 unknown_outcome 對帳，以及協作情境 T35–T37 |
| run `ui-20260929-001` 的完成判定 | `awaiting_user` | 待決事項 q-002：使用者對 T35–T37 差異的處理決定。鎖已釋放 |

## 2. 交付檔案

**第一部分（b98036d）**

| 檔案 | 內容 |
|---|---|
| `schemas/plan｜ledger｜inventory｜audit｜common.schema.json` | `designDecisions[].status`／`delegation`、`accessibilityPrecheck`、`ledger.userAcceptance`、`inventory.fonts`、`audit.metrics.propertyBindings`、`finding.gate` |
| `scripts/validate-artifacts.mjs` | skipped 決策不得當 write 的 basisRefs；INVARIANT-17／18；G5 finding 不可例外；缺字型要列為 baseline；對比重新計算 |
| `scripts/evaluate-completion.mjs` | pending／skipped 的決策 → `awaiting_user`；`--accept-test-run` 只記 userAcceptance |
| `scripts/quality-metrics.mjs` | tokenBinding（variables 與 styles 分開，raw 值計入分母）、WCAG 對比、字型檢查 |
| `scripts/operation-journal.mjs` | basisRefs 解析對應新的決策 status |
| `.claude/skills/figma-ui/SKILL.md`、`references/*` | DEC-07／08、可及性預檢、字型、REQ-04、從既有 instance 取主元件、styles 計入 tokenBinding、handoff 將完成判定與使用者接受分開列 |
| `docs/setup.md` | PowerShell 執行原則的處理方式（`npm.cmd install`／`Set-ExecutionPolicy`） |
| `tests/contracts/v14-rules.test.mjs` | T47–T51 與每條 validator 規則的反例 |

**第二部分（本次）**

| 檔案 | 內容 |
|---|---|
| `scripts/hooks/post-figma-call.mjs` | PostToolUseFailure 事件多記 `isInterrupt`、`errorType`、`errorHead`（`error` 的前 500 字） |
| `.claude/skills/figma-ui/snippets/fingerprint.js` | 依 `type` 分流子節點：TEXT 取 `characters`、容器呼叫 `findAllWithCriteria`、葉節點回傳 `[]`。M1 的 fp1 值不變 |
| `.claude/skills/figma-ui/references/runtime-probes.md` | 新增 M3 實測列：位元組上限、PostToolUseFailure、safeToRetry、腳本中途 throw、屬性存取會丟例外、T35–T37 |
| `.claude/skills/figma-ui/SKILL.md` | 回傳上限改為以 UTF-8 位元組表述 |
| `tests/hooks/figma-hooks.test.mjs` | 失敗事件的欄位值記錄（字串、物件、成功事件不變） |
| `tests/contracts/snippets.test.mjs` | fingerprint 處理會丟例外的 TEXT／葉子節點 |
| `docs/m3-summary.md` | 本文件 |

## 3. 測試

```
node --test "tests/**/*.test.mjs"
# tests 78 · pass 78 · fail 0
```

第一部分結束時是 76 項，第二部分新增 2 項。

## 4. 真實整合結果（run `ui-20260929-001`，sandbox 頁 `34014:8`）

### 4.1 中文回傳上限（第 8 項，唯讀）

| op | 回傳內容 | UTF-8 大小 | 結果 |
|---|---|---|---|
| rd-0001 | 10,000 個「中」 | 30,000 B | 截斷，截斷處有 `�` |
| rd-0002 | 位置編碼，21,000 字 | 約 60 KB | 截斷在 `<07100>` 區塊，截斷處有 `�` |
| rd-0003 | 6,815 字＋`|END` | 20,449 B | **完整** |
| rd-0004 | 6,830 字＋`|END` | 20,494 B | **截斷**，截斷處有 `�` |

**結論**：上限是 **20,480 個 UTF-8 位元組**，不是字元數。rd-0003 和 rd-0004 都遠少於 2 萬字，差別只在位元組數跨過 20,480。截斷會切在多位元組字元中間。純中文一次大約只能回傳 6,826 字。讀取分批的建議量已改為「約 15,000 位元組」。

### 4.2 PostToolUseFailure（第 7 項）

- **觸發方式**：rd-0005 在 op 標頭之後直接 `throw`，不碰畫布。
- **stdin 欄位**：`session_id`、`transcript_path`、`cwd`、`scratchpad_dir`、`prompt_id`、`permission_mode`、`effort`、`hook_event_name`、`tool_name`、`tool_input`、`tool_use_id`、**`error`**、**`is_interrupt`**、`duration_ms`、`mcp_server`。**沒有 `tool_response`。**
- **欄位值**：`errorType=string`、`isInterrupt=false`。`error` 的內容是錯誤訊息、stack 和 `Figma Debug UUID`。
- **`safeToRetryWithoutCanvasRead`**：沒有出現。rd-0005、op-0001 和 ui-20260928-001 的 rd-0017，共 3 次 JS 例外都沒有。其他錯誤類型（逾時、權限）尚未觀察。
- **journal 狀態**：讀取失敗記 `failed_known`；寫入失敗（op-0001）記 `unknown_outcome`，行為正確。

### 4.3 寫入失敗與對帳（非預期，但驗證了 §11.4）

- op-0001 建立 Section 和 collab/A 之後，fingerprint snippet 在 TEXT 子節點上讀取 `findAllWithCriteria` 時丟出 `no such property`，腳本中止。
- hook 記錄為 `unknown_outcome`，之後的寫入被擋下，直到對帳完成。
- 唯讀對帳（rd-0006）結果：頁面 children 沒有變化，也沒有帶 op-0001 標記的節點，改記 `failed_known`。
- **觀察到變更被整批還原（hypothesis，只有 1 次）**，因此仍然每次都要對帳。
- 修正 snippet 並補測試後，用新的 operationId（op-0002）重試，成功並驗證。

### 4.4 協作情境 T35–T37

- **fixture**：op-0002 建立 Section `34041:85`（1130, 0），裡面有 collab/A `34041:86` 和 collab/B `34041:88`；rd-0007 回讀驗證。
- **使用者手動操作**：把 collab/A 的文字改成「collab/A：我改過了」、在 Section 內新增 `Rectangle 1`（`34042:79`）、刪除 collab/B。

| 測試 | op | guard 結果 | agent 行為 |
|---|---|---|---|
| T35 | op-0003 修改 collab/A | `user_modified`（fp1:da723bb7 → fp1:3f16b596，寬 165 → 139） | 沒有修改 |
| T36 | op-0004 在 Section 新增 collab/C | `user_added_nodes`（`34042:79`，沒有標記），並列出 `missingChildren: 34041:88` | 沒有建立 collab/C |
| T37 | op-0005 修改 collab/B | `deleted` | 沒有重建 |

rd-0008 和截圖 ev-002 確認：畫布上只有使用者的改動，帶本 run 標記的節點只剩 collab/A。差異已記為 q-002，等使用者決定（`awaiting_user`）。

## 5. 未完成與待決

1. **q-002**（run ui-20260929-001）：是否採納 collab/A 的改動、`Rectangle 1` 是否納入範圍、collab/B 是否維持刪除。
2. **ui-20260928-001** 的待決事項 q-101～q-103（對比、成功圖示、Status Bar 字型），仍在 `awaiting_user`。
3. **`safeToRetryWithoutCanvasRead`**：只測過 JS 例外。逾時、權限、rate limit 等錯誤下是否會出現，尚未觀察。
4. **「失敗腳本全部還原」**：只觀察到 1 次，屬於 hypothesis；流程仍要求對帳。
5. **Spec 文字**：`FIGMA_UI_AGENT_SPEC.md` §8 的 M2 量測段、§17 表格和 CAP-05 仍寫「20,480 字元」。建議改成「20,480 個 UTF-8 位元組」。Spec 由使用者維護，本次沒有修改。
6. **T36／T37 的偵測順序**：guard 在同時有新增和刪除時只回報 `user_added_nodes`，並另外列出 `missingChildren`。行為正確，但 `kind` 只有一個值；需要時可考慮改成多值（P1）。
