# M1 總結：真實垂直流程

Spec：FIGMA_UI_AGENT_SPEC.md v1.2 · Run ID：`ui-20260928-m1` · 日期：2026-09-28

M1 是可行性證明，不代表 M4 完整驗收，也不代表 agent 已可端到端使用。

## 1. 狀態

| 項目 | 狀態 | 說明 |
|---|---|---|
| implementationStatus | `m1_minimal` | 已實作：最小 hooks 強制層、最小 §12.1 完成判定（`scripts/evaluate-completion.mjs`）、M1 本機紀錄（brief／plan／inventory／operations journal／audit／ledger）。尚未實作：`/figma-ui` skill、JSON schemas、schema validator、journal／lock 工具腳本、M2–M4 其餘項目 |
| integrationStatus | `m1_path_verified` | 已在授權測試檔以真實工具完成：讀取 library 元件 → 匯入 → 建立 instance 與小畫面 → 讀回主元件關係、binding、consumer 生效值與 mode → 截圖審查 → 依 fingerprint 局部修改兩次。hooks 對真實工具名稱觸發 |
| run 狀態（ledger.status） | `complete_with_exceptions` | 由 `evaluate-completion.mjs` 計算（見第 8 節）。G1–G7 pass、coverage 1/1；例外 ex-001（F-001 寬度 131／129，dec-010） |
| 本機鎖 | 已釋放 | `.figma-ui/locks/B0FKsPFvTG11Tt1P7ZXxxn.json` 與 `.figma-ui/active-run.json` 已移除（owner token 比對相符後才刪除）；ledger 記錄 `lock.released=true` |

## 2. 環境與授權

- Claude Code 2.1.283；Figma plugin `figma@synced` 2.2.118；remote MCP server `figma`，工具名 `mcp__figma__<tool>`。
- Figma 帳號為 Full seat（Pro team 與 Organization guest）。第一次授權的帳號為 Starter／View seat，無法讀取測試檔，已換帳號。
- 輸出（可寫）：測試檔 `B0FKsPFvTG11Tt1P7ZXxxn`，只寫新頁「figma-ui sandbox」（dec-000）。
- 元件來源（唯讀）：Aiwow Library `IBq10PHhCxczFX6hBzQvaC`，libraryKey `lk-540d2c0f…03da`，已加入測試檔。

## 3. 建立的節點（全部保留，dec-003）

| 節點 | ID | 建立／修改 | 所有權標記（sharedPluginData `figma_ui`） |
|---|---|---|---|
| 頁面「figma-ui sandbox」 | `34014:8` | op-0001 | runId、operationId=op-0001、logicalKey=m1.page |
| Section「figma-ui / ui-20260928-m1」 | `34014:9` | op-0002；op-0003 調整尺寸 | logicalKey=m1.section |
| Frame「M1/ButtonRow」 | `34016:68` | op-0003；op-0006、op-0007 修改 | logicalKey=m1.button-row、agentFingerprint=`fp1:d9899c64`（op-0007 後） |
| Instance「Button/Default」（type=Default，「取消」） | `34016:69` | op-0003；op-0006、op-0007 改文字 | 由 frame 判定 |
| Instance「Button/Active」（type=Active，「確認」） | `34016:73` | op-0003；op-0006 由 Secondary 換為 Active；op-0007 改文字 | 由 frame 判定 |
| 匯入的 remote component set「Button」 | `34016:41` | op-0003（`importComponentSetByKeyAsync`） | 不適用（remote 元件） |

既有頁面 `1:81`、`1:82`、`14442:37607` 與其中節點均未修改；未在測試檔接受 library 更新；未 detach、未修改元件。

Frame 版面依 pattern-footer-2btn（既有畫面 25 次，範例 `I28001:30690;1366:1395`）：水平 auto-layout、寬 300、padding 12/16/24/16、gap 8、置中、無背景（fills=[]）、兩顆按鈕 FILL（grow=1）、Default 在左、Active 在右。

## 4. 操作紀錄

| op | mode | 狀態鏈 | 結果 |
|---|---|---|---|
| op-0001 | write | planned → dispatched → applied → verified | 建立頁面；sharedPluginData 寫入與同腳本讀回 |
| op-0002 | write | planned → dispatched → applied → verified | 建立 Section |
| op-0003 | write | planned → dispatched → applied → verified | 匯入 Button set；建立 frame 與 2 個 instance（Default、Secondary）；覆寫文字 |
| op-0006 | write | planned → dispatched → applied → verified | 先比對 fingerprint `fp1:3b000d57` 相符；Secondary → Active；文字改為「次要按鈕」／「主要按鈕」 |
| op-0007 | write | planned → dispatched → applied → verified | 先比對 fingerprint `fp1:38e19867` 相符；文字改為「取消」／「確認」 |
| rd-0001 … rd-0007、probe-01 … probe-09、hooktest-01 | read | — | 唯讀驗證與探測 |

dispatched／applied 由 hooks 自動寫入；planned 與 verified 由本機寫入。原計畫的 op-0004（驗證）以 rd-0003 起的唯讀驗證取代；op-0005（清理）依 dec-003 保留節點，未執行。

## 5. CAP-05 probe 結論

| 能力 | 結論 | 證據 |
|---|---|---|
| sharedPluginData 寫入／讀回 | verified | op-0001 同腳本讀回；rd-0001、rd-0002、rd-0005、rd-0007 跨呼叫讀回 |
| `resolveForConsumer` | verified | 既有節點（probe-05／06b）與新節點（rd-0003、rd-0005）：`Stroke/Border`=1、`Space/400`=16 |
| 元件 import-by-key | verified | `importComponentSetByKeyAsync(f90477…)` 成功；`swapComponent` 換 variant 成功 |
| variable import-by-key | not_verified | 依 dec-004 不綁定新 variables |
| 字型列舉／載入 | verified | 8,927 種字型；載入 Inter Bold 後改文字成功 |
| 截圖 | verified | `get_screenshot` 回傳可看圖的影像（ev-002、ev-004、ev-006） |
| 單次回傳上限 | partial | 已觀察整頁 `get_metadata` 超限（約 88 萬字元）；確切上限未量測 |
| hooks 觸發 | verified（Pre／Post）；PostToolUseFailure not_verified | `.figma-ui/hook-events.jsonl` 記錄 `mcp__figma__use_figma` 的 PreToolUse 與 PostToolUse；真實失敗尚未發生 |

## 6. 最終驗證（rd-0007、截圖 ev-006、對比 ev-007）

- 主元件：兩個 instance 都連到 Aiwow `Button` set（key `f90477a86f723dc5362f382e1d9686ffc08a93cb`），variant key 分別為 `20af3af6…`（Default）與 `ed7f7980…`（Active），未 detach。
- 繼承 binding：`Stroke/Border` 由 runtime 對新節點解析為 1；collection `Size`（`ddf73292…`）mode `9:7`，inherited，無 explicit mode。
- 文字覆寫：只有 `characters`／`styledTextSegments` 被覆寫，元件未修改。
- 視覺：「取消」（灰框）在左、「確認」（藍底白字，兩側 Return icon）在右；無裁切、無重疊；中文字無缺字（Inter 無 CJK 字形，由 Figma fallback 字型顯示，與既有畫面相同）。
- 設計層可及性：文字對比 #747474／#FFFFFF 為 4.67:1、#FFFFFF／#2263EB 為 5.18:1（14px Bold 屬一般文字，門檻 4.5:1）；點擊區 131×45、129×45 ≥ 24×24。鍵盤與螢幕閱讀器屬實作層驗證。

## 7. Findings、baseline 與 pattern 限制

| ID | 嚴重度 | 來源 | 狀態 | 內容 |
|---|---|---|---|---|
| F-001 | minor | introduced | accepted（dec-010，例外 ex-001） | 兩顆按鈕寬 131／129，既有範例為 130／130。改為 2 字標籤（dec-008）後仍相同，**標籤長度已排除**。與範例唯一剩下的版面差異是目前發佈版 Active 的兩個 16px Return icon 與 8px 間距（見 bl-004），推測為主因，未以實驗證明 |
| F-002 | minor | inherited_baseline | resolved | Secondary 的 icon；改用 Active 後不適用（dec-006） |
| F-003 | minor | introduced | resolved | 標籤與視覺重量不符；改為 Default＋Active（dec-007） |
| F-004 | minor | inherited_baseline | resolved | 依 dec-009 改記為 baseline 觀察 bl-004 |

Baseline 觀察（不修改來源元件）：

- bl-001：Button 沒有 TEXT property，文字以覆寫內層文字處理。
- bl-002：Button 顏色未綁 variables（只有 `Stroke/Border`、`Space/400` 有綁定）。
- bl-003：Inter 無 CJK 字形，中文由 Figma fallback 字型顯示，與既有畫面相同。
- bl-004：Library 版本差異。既有畫面使用舊版 Aiwow Button type=Active（無 icon、底色 #11A1E9）；目前發佈版有兩個 Return icon、底色 #2263EB；測試檔未接受 library 更新（dec-009：只記錄）。
- bl-005：Default 邊框 #E5E5E5 對白底 1.26:1；屬文字按鈕，WCAG 1.4.11 不要求可見邊界；元件層級，未修改。

Pattern 限制（inventory `pattern-footer-2btn.constraints[pc-001]`，狀態 `observed_not_confirmed`）：

- 使用者要求記錄「P1 雙按鈕排法的文字上限約 2 個中文字（按鈕內可用寬度 18）」。
- 實測：既有範例（舊版 Active，無 icon）2 字標籤（文字寬 28）為 130／130；M1（目前版 Active，有 icon）2 字（28）與 4 字（56）都是 131／129。名目可用寬度 130 − 112 = 18，2 個字就已超過，因此「18」無法解釋這個上限。
- 結論：**沒有得到可確認的字數上限**；M1 中標籤長度不影響結果，目前版 Active 的 icon 較可能是影響因素。

## 8. 完成判定（`node scripts/evaluate-completion.mjs design-runs/ui-20260928-m1 --write`）

```json
{
  "ruleVersion": "12.1@1.2-m1min",
  "eligible": true,
  "result": "complete_with_exceptions",
  "coverage": { "applicable": 1, "verified": 1 },
  "reasons": []
}
```

第一次計算（dec-010 回答前）結果為 `awaiting_user`，原因為 G7 fail（dec-010 待答）。dec-010 回答後重新計算，得到上方結果。

已接受例外（`audit.acceptedExceptions`）：

| ID | Finding | decisionRef | 硬性門檻 | 內容 |
|---|---|---|---|---|
| ex-001 | F-001 | dec-010 | 否 | `34016:68` 兩顆按鈕寬 131／129（既有範例 130／130）；推測由 dec-009 保留的目前版 Active icon 造成 |

| Gate | 結果 | 依據 |
|---|---|---|
| G1 範圍 | pass | 只建立／修改新頁與自有節點；無 detach、無元件修改、無 library 更新 |
| G2 覆蓋 | pass | 唯一 cell 在最後一次修改（op-0007）後有結構與截圖證據 |
| G3 結構 | pass | instance 與主元件關係、繼承 binding 有效 |
| G4 視覺 | pass | 無裁切、重疊、缺字；F-001 為 minor |
| G5 設計可及性 | pass | 文字對比與點擊區（設計層）；實作層未驗證 |
| G6 可追溯 | pass | node IDs、ledger、audit、最後截圖一致 |
| G7 阻礙 | pass | 無待答問題或設計決策（dec-010 已回答）；無 dispatched／unknown_outcome 操作 |

`evaluate-completion.mjs` 是 M1 的最小實作（5 項 fixture 測試），尚未包含 JSON Schema 驗證與第 20 節全部跨檔案檢查；M2 會補齊。

## 9. 未驗證與缺口

- gap-001：`Size`／`Global`／`Colors`／`System Colors` 的來源 library 未識別、未啟用。顏色 token 綁定、mode 切換驗證待補；tokenBinding 分母為 0，記為 N/A。
- F-001 的原因（icon）未以實驗證明；已依 dec-010 接受為例外 ex-001。
- PostToolUseFailure 的真實觸發、variable import-by-key、確切回傳上限。
- 協作情境（T35–T37：使用者同時改動）未在真實畫布測試。
- 鍵盤、螢幕閱讀器等實作層可及性。

## 10. 本機檔案

- 已提交：`.claude/settings.json`、`scripts/hooks/*`、`scripts/evaluate-completion.mjs`、`tests/hooks/figma-hooks.test.mjs`、`tests/contracts/evaluate-completion.test.mjs`（共 13 項 fixture 測試通過，`node --test "tests/**/*.test.mjs"`）、本文件。
- 未提交（`.gitignore`）：`design-runs/ui-20260928-m1/`（brief、plan、inventory、operations.jsonl、audit、ledger）、`.figma-ui/hook-events.jsonl`。
