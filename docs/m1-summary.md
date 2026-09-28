# M1 總結：真實垂直流程

Spec：FIGMA_UI_AGENT_SPEC.md v1.2 · Run ID：`ui-20260928-m1` · 日期：2026-09-28

M1 是可行性證明，不代表 M4 完整驗收，也不代表 agent 已可端到端使用。

## 1. 狀態

| 項目 | 狀態 | 說明 |
|---|---|---|
| implementationStatus | `m1_minimal` | 已實作最小 hooks 強制層、M1 本機紀錄（brief／plan／operations journal／audit 草稿）。`/figma-ui` skill、JSON schemas、validator、完整 journal／lock 工具、M2–M4 其餘項目尚未實作 |
| integrationStatus | `m1_path_verified` | 已在授權測試檔以真實工具完成：讀取 library 元件 → 匯入 → 建立 instance 與小畫面 → 讀回主元件關係、binding、consumer 生效值與 mode → 截圖審查。hooks 對真實工具名稱觸發 |
| run 狀態（ledger.status） | `awaiting_user` | 唯一的 requiredCell 仍有待決設計決策（F-001、F-004），依第 12.1 節不能標 complete |

## 2. 環境與授權

- Claude Code 2.1.283；Figma plugin `figma@synced` 2.2.118；remote MCP server `figma`，工具名 `mcp__figma__<tool>`。
- Figma 帳號為 Full seat（Pro team 與 Organization guest）。第一次授權的帳號為 Starter／View seat，無法讀取測試檔，已換帳號。
- 輸出（可寫）：測試檔 `B0FKsPFvTG11Tt1P7ZXxxn`，只寫新頁「figma-ui sandbox」（dec-000）。
- 元件來源（唯讀）：Aiwow Library `IBq10PHhCxczFX6hBzQvaC`，libraryKey `lk-540d2c0f…03da`，已加入測試檔。

## 3. 建立的節點（全部保留，dec-003）

| 節點 | ID | 建立於 | 所有權標記（sharedPluginData `figma_ui`） |
|---|---|---|---|
| 頁面「figma-ui sandbox」 | `34014:8` | op-0001 | runId、operationId=op-0001、logicalKey=m1.page |
| Section「figma-ui / ui-20260928-m1」 | `34014:9` | op-0002 | logicalKey=m1.section |
| Frame「M1/ButtonRow」 | `34016:68` | op-0003，op-0006 修改 | logicalKey=m1.button-row、agentFingerprint=`fp1:38e19867` |
| Instance「Button/Default」（type=Default，「次要按鈕」） | `34016:69` | op-0003，op-0006 修改文字 | 由 frame 判定 |
| Instance「Button/Active」（type=Active，「主要按鈕」） | `34016:73` | op-0003，op-0006 由 Secondary 換為 Active | 由 frame 判定 |
| 匯入的 remote component set「Button」 | `34016:41` | op-0003（`importComponentSetByKeyAsync`） | 不適用（remote 元件） |

既有頁面 `1:81`、`1:82`、`14442:37607` 與其中節點均未修改。

Frame 版面依 pattern-footer-2btn（既有畫面 25 次，範例 `I28001:30690;1366:1395`）：水平 auto-layout、寬 300、padding 12/16/24/16、gap 8、置中、無背景（fills=[]）、兩顆按鈕 FILL（grow=1）、Default 在左、Active 在右。

## 4. 操作紀錄

| op | mode | 狀態鏈 | 結果 |
|---|---|---|---|
| op-0001 | write | planned → dispatched → applied → verified | 建立頁面；sharedPluginData 寫入與同腳本讀回 |
| op-0002 | write | planned → dispatched → applied → verified | 建立 Section |
| op-0003 | write | planned → dispatched → applied → verified | 匯入 Button set；建立 frame 與 2 個 instance；覆寫文字 |
| op-0006 | write | planned → dispatched → applied → verified | 腳本內先比對 fingerprint `fp1:3b000d57` 相符後，Secondary → Active、更新文字 |
| rd-0001 … rd-0006、probe-01 … probe-09、hooktest-01 | read | — | 唯讀驗證與探測 |

dispatched／applied 由 hooks 自動寫入；planned 與 verified 由本機寫入。op-0004（驗證）與 op-0005（清理）依計畫改以 rd-0003／rd-0005 與 dec-003（保留）處理，未另建寫入操作。

## 5. CAP-05 probe 結論

| 能力 | 結論 | 證據 |
|---|---|---|
| sharedPluginData 寫入／讀回 | verified | op-0001 同腳本讀回；rd-0001、rd-0002、rd-0005 跨呼叫讀回 |
| `resolveForConsumer` | verified | 既有節點（probe-05／06b）與新節點（rd-0003、rd-0005）：`Stroke/Border`=1、`Space/400`=16 |
| 元件 import-by-key | verified | `importComponentSetByKeyAsync(f90477…)` 成功 |
| variable import-by-key | not_verified | 本次依 dec-004 不綁定新 variables |
| 字型列舉／載入 | verified | 8,927 種字型；載入 Inter Bold 後改文字成功 |
| 截圖 | verified | `get_screenshot` 回傳可看圖的影像（ev-002、ev-004） |
| 單次回傳上限 | partial | 已觀察整頁 `get_metadata` 超限（約 88 萬字元）；確切上限未量測 |
| hooks 觸發 | verified（Pre／Post）；PostToolUseFailure not_verified | `.figma-ui/hook-events.jsonl` 記錄 `mcp__figma__use_figma` 的 PreToolUse 與 PostToolUse；真實失敗尚未發生 |

## 6. 驗證結果（rd-0003、rd-0005、rd-0006，截圖 ev-004）

- 主元件：兩個 instance 都連到 Aiwow `Button` set（key `f90477a86f723dc5362f382e1d9686ffc08a93cb`），variant key 分別為 `20af3af6…`（Default）與 `ed7f7980…`（Active），未 detach。
- 繼承 binding：`Stroke/Border` 由 runtime 對新節點解析為 1；collection `Size`（`ddf73292…`）mode `9:7`，inherited，無 explicit mode。
- 文字覆寫：只有 `characters`／`styledTextSegments` 被覆寫，元件未修改。
- 視覺：無裁切、無重疊；中文字無缺字（Inter 無 CJK 字形，由 Figma fallback 字型顯示，與既有畫面相同）。

## 7. Findings 與待決事項

| ID | 嚴重度 | 來源 | 狀態 | 內容 |
|---|---|---|---|---|
| F-001 | minor | introduced | open | 兩顆按鈕寬 131／129，既有範例為 130／130。設定與範例相同；差異來自 4 字標籤（文字寬 56）大於可用內容區（130 − padding 112 = 18），範例是 2 字標籤 |
| F-002 | minor | inherited_baseline | resolved | Secondary 的 icon；改用 Active 後不適用（dec-006） |
| F-003 | minor | introduced | resolved | 標籤與視覺重量不符；改為 Default＋Active（dec-007） |
| F-004 | minor | inherited_baseline | open | 目前發佈版 Active 在文字兩側有 Return icon；既有畫面使用同 key 的舊版（測試檔未接受 library 更新），沒有 icon |

## 8. 未驗證與缺口

- gap-001：`Size`／`Global`／`Colors`／`System Colors` 的來源 library 未識別、未啟用。顏色 token 綁定、mode 切換驗證待補；tokenBinding 分母為 0，記為 N/A。
- G5 可及性（對比）未量測；鍵盤、螢幕閱讀器屬實作層驗證。
- PostToolUseFailure 的真實觸發、variable import-by-key、確切回傳上限。
- 協作情境（T35–T37：使用者同時改動）未在真實畫布測試。
- baseline：Button 無 TEXT property（bl-001）；Button 顏色未綁 variables（bl-002）；Inter 無 CJK 字形（bl-003）。

## 9. 本機檔案

- 已提交：`.claude/settings.json`、`scripts/hooks/*`、`tests/hooks/figma-hooks.test.mjs`（8 項 fixture 測試通過，`node --test "tests/**/*.test.mjs"`）、本文件。
- 未提交（`.gitignore`）：`design-runs/ui-20260928-m1/`（brief、plan、operations.jsonl、audit.json 草稿）、`.figma-ui/`（active-run、lock、hook-events）。本機鎖仍由本 run 持有。
