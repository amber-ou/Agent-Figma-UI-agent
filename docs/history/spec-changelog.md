# 規格變更紀錄（v1.1–v1.8）

從 `FIGMA_UI_AGENT_SPEC.md` 移出：v1.1–v1.6 於 v1.7 移出，v1.7 於 v1.8 移出，v1.8 於 v1.9 移出。內容保留原文，章節編號、檔案路徑與「本版」等用語指當時的版本；歷史文件已移到 `docs/history/` 與 `docs/research/`。最新一版的變更紀錄在主規格第 20.3 節。

## v1.8 變更紀錄

依 v1.7 的真實 run（`docs/history/v1.7-summary.md`，run `ui-20261002-001`）與使用者 2026-10-03 的決定修訂。v1.1–v1.7 的變更紀錄在 `docs/history/spec-changelog.md`。

- 第 7.4 節：DEC-08 的 `skippedBy`：使用者明確略過算已解決，agent 標記的略過仍待答（INVARIANT-28）；DEC-09 範圍與授權類的列也記 `confirmation`；DEC-11 動態行為不問，handoff 列為「未定義，交由實作決定」。
- 第 7.2 節：ASK-08 提問、回報、交接一律用繁體中文。
- 第 4.7 節（新增）：skill 使用規則，分成必用、有條件、只當參考、排除四類。
- 第 4.2.2 節（新增）：Figma plugin 版本檢查；本機仍是 2.2.118（synced），官方最新 2.2.126。
- 第 4.2.3 節（新增）：固定使用同一個 Figma 連線，hook 阻擋走其他連線的寫入（INVARIANT-27）；本機目前只有一個 Figma 連線。
- 第 12.1、15 節：G7 依 `skippedBy` 判定；handoff 第 12 項。
- 第 20 節：v1.7 run 中需要手動補救的自動化問題；`plan.decisions.confirmation`、`skippedBy`、`capabilities.server.toolPrefix`／`pluginVersion`。
- 第 13.2 節：T72–T81；第 17 節：v1.7 完成、v1.8 列、待辦更新。
- 保留不變：所有寫入保護、品質門檻、產品政策機制；run artifacts 的 schemaVersion `1.2`（只新增選填欄位與 enum 值）。

## v1.7 變更紀錄

依 M4 結果（`docs/history/m4-summary.md`）與使用者 2026-10-02 的決定修訂。v1.1–v1.6 的變更紀錄移到 `docs/history/spec-changelog.md`。

- 第 4.6 節（新增）：記憶與規則分四層：通用規則、產品政策、每次需求的記憶、本機狀態。隔離規則；不寫 Claude Code 的自動記憶；INVARIANT-26。
- 第 7.5 節（新增）：產品政策 POL-01–06。政策檔進 git、網址另存本機；自動套用；寫入只經使用者回答或確認；Handoff 列出政策建議。Aiwow 的對比政策為不適用。INVARIANT-24、25。
- 第 7.1 節：REQ-05 產品由需求指明，沒寫就詢問；REQ-06 library 由使用者提供，找不到就詢問。
- 第 7.2、7.4 節：DEC-09 預填清單（取代 ASK-07「每輪 1–3 題」的上限）；DEC-10 產品政策題優先、每個產品只問一次；designDecisions 的 `source` 新增 `product_policy`。
- 第 9.5、12.1 節：產品政策可讓 G5 的對比項不適用，其他可及性項照常。
- 第 4.5、12.1、20 節：記錄 M4 已實作的修正：唯讀腳本靜態檢查與其限制、第一次寫入兼作 nativeWrite 探測、無改動 write 的 `noChange` 標記。
- 第 10.3、11.2、14 節：M4 發現：元件內部字型要比對；fp1 不涵蓋截斷設定；工具耗時缺口與重開後 session unknown。
- 第 13.2 節：T61–T71；第 15 節：handoff 第 11 項；第 17 節：M4 部分完成、v1.7 列、M4 之後的待辦。
- 第 4.1 節：結構改成和 repo 一致；`decisions.md` 未實作，決策只存在 plan.json。
- 文件整理：歷史紀錄移到 `docs/history/`，研究提案移到 `docs/research/`，刪除已被取代的 `docs/adjustment-plan.md`；`CC_BUILD_PROMPT.md` 只放目前這一版的指令。
- 保留不變：所有寫入保護、既有品質門檻、run artifacts 的 schemaVersion `1.2`（只新增選填欄位與 enum 值）。

## v1.6 變更紀錄

依使用者接受的「UI Agent 流程精簡」任務書（階段 A，A01–A07）修訂；實作紀錄見 `docs/history/workflow-simplification-record.md`：

- 第 7.2 節：ASK-06 減少重問（new／continue／resume，`run-context.mjs`）、ASK-07 每輪 1–3 題、先找候選。
- 第 8.2 節：按需 flow 判斷（`plan.flow`）、已確認文案（`screens[].copy`）；第 8.3 節：composition 批次、一次讀回確認多個 write。
- 第 6.6 節：參考畫面不固定張數，基準不足或衝突才擴大。
- 第 5.1 節：CAP-06 環境診斷按需執行，與本 run 權限確認分開。
- 第 12.1 節：證據以 cellKey 對應、證據版本與失效、完成判定讀 journal、判定摘要（inputDigest）。
- 第 14 節：最低量測；第 15 節：handoff 由 artifacts 產生、主文精簡；第 16.3 節：Design QA 接入契約（階段 B，未就緒）。
- 第 20 節：階段式驗證；plan／audit／ledger 新選填欄位；INVARIANT-20–23。schemaVersion 維持 `1.2`；M1 fixture 補上 `flow: unchanged`。
- 保留不變：所有寫入保護（hooks、鎖、所有權標記、fingerprint guard、unknown_outcome 對帳、獨立讀回驗證）與既有品質門檻。

## v1.5 變更紀錄

依 M3 真實整合測試（`docs/history/m3-summary.md`，run `ui-20260929-001`）修訂：

- CAP-05：更正回傳上限為 **20,480 個 UTF-8 位元組**（v1.4 誤寫為字元）；補中文實測與分批建議。
- 第 4.5 節：PostToolUseFailure 的實測 stdin 欄位（`error` 字串、`is_interrupt`，沒有 `tool_response`）。
- 第 10.4 節：節點屬性存取會丟例外，須依 `node.type` 分流；INVARIANT-19。
- 第 11.2 節：T35–T37 真實畫布驗證結果；腳本失敗後整批還原記為假設。
- 第 11.5 節：`safeToRetryWithoutCanvasRead` 在 3 次真實 JS 例外中都未出現。
- 第 17 節：M3 完成，M4 待辦。

## v1.4 變更紀錄

依 M2 量測與第一次真實任務（`docs/history/m2-summary.md`、`docs/history/m3-first-run-summary.md`）修訂：

- 第 2.3 節：新增使用者接受（`userAcceptance`），與完成判定分開；INVARIANT-17。
- 第 7.4 節：DEC-07 授權採用建議、DEC-08 決策狀態（pending／answered／skipped）；INVARIANT-18。
- 第 7.1 節：REQ-04 品牌與產品名稱由使用者確認。
- 第 6.2 節：從既有 instance 取得主元件以避開版本差異；來源未識別元件經核准可重用。
- 第 9.5 節：Plan 階段可及性預檢；參考畫面不合格不能當作合格理由。
- 第 10.1、12.2 節：paint／text styles 視為 DS token，計入 tokenBinding。
- 第 10.3 節：本機未安裝字型的處理。
- CAP-05：`use_figma` 回傳上限與靜默截斷的處理（當時寫成「20,480 字元」，v1.5 更正為 UTF-8 位元組）。
- 第 13.2 節新增 T47–T51；第 17 節記錄第一次真實任務與 M3 待辦。
- schemaVersion 維持 `1.2`；`designDecisions[].status`、`delegation` 與 `ledger.userAcceptance` 為新增的選填欄位，由 M3 實作 schema 與 validator。

## v1.3 變更紀錄

依 2026-09-28 使用者本機 M0–M1 實測（`docs/history/m1-summary.md`、研究紀錄第 10 節）修訂：

- 新增第 4.2.1 節帳號與 seat 診斷；更正 plugin 名稱為實測值。
- 第 4.5 節：放行不得輸出 `allow`；read 不得重用 write operationId；dispatched 記錄 mode／fileKey；run 結束須釋放鎖；補 Windows 實測結果。新增 INVARIANT-14～16。
- CAP-05 填入 M1 結果；第 11.2 節所有權標記改為已驗證。
- 第 6.1 節：元件 library 與 variables library 分開核准；啟用狀態以兩種讀法一致為準。
- 第 6.2 節：library 版本差異的處理。
- 第 6.6 節：pattern 重現照抄實際做法、限制需實驗確認、未驗證推論須標示假設。
- 第 8.1 節：頁面清單與讀取範圍的實測限制、`search_design_system` 一次一個 query。
- 第 10.3 節：CJK fallback、無 TEXT property 的文字覆寫、FILL 不保證等寬。
- 第 13.2 節新增 T43–T46。
- 第 17 節：M1 標記完成，列出 M1 後待辦與測試指令。
- schemaVersion 維持 `1.2`：本版沒有改變資料契約結構，inventory pattern 的 `constraints` 為新增的選填欄位。
- 第 11.5 節 `safeToRetryWithoutCanvasRead` 已於 PR #2 依官方 figma-use skill Rule 14 恢復，v1.3 沿用。

## v1.2 變更紀錄

使用者於 2026-09-28 確認：本機 Claude Code 執行、可能與 agent 同時編輯、提供 M1 測試檔與唯讀 library、設計決策一律詢問，並同意全部 v1.2 審查建議。v1.2 變更：

- 新增第 7.4 節「設計決策一律詢問」與 `plan.designDecisions`、operation `basisRefs`、INVARIANT-11。
- 新增第 6.6 節版面 pattern 盤點與 `inventory.schema.json`（獨立 schema）。
- 新增第 4.5 節 hooks 強制層：寫入授權、鎖、未知結果阻擋與 journal 由 PreToolUse／PostToolUse／PostToolUseFailure 自動處理。
- 新增第 11.2 節人機協作：run Section 隔離、sharedPluginData 所有權標記、同一腳本內 precondition guard、使用者改動不覆寫；原 11.2–11.6 順延為 11.3–11.7。
- 本機鎖簡化；heartbeat、PID 重用檢查、跨主機 registry 延後至 P1。
- runtime API 細節改以官方 Figma plugin skills 為準；`figma-runtime.md` 改為 `runtime-probes.md`。
- Fingerprint 明訂在 Figma 端計算。
- 截圖證據預設為工具參照＋審查摘要，本機 PNG 為選配；補充截圖用途說明。
- run status 只存 ledger；audit 只存 completionEvaluation；12.1 第 3 條併入 G7。
- `approvalPolicy` enum 明訂；移除未查證的 `safeToRetryWithoutCanvasRead` 欄位名。
- 移除 skill `templates/`，範例統一由 `tests/fixtures/` 提供；`design-plan.json` 改名 `plan.json`。
- 測試新增 T35–T42，並分 P0／P1；基準任務 P0 各執行 1 次。
- 新增第 17.1 節 M1 測試目標與 CAP-05 必測 probes。

目前尚無 1.1 artifacts；若日後出現，依下方 1.0 的同樣原則唯讀備份、驗證後遷移（補 designDecisions、basisRefs、mode、patterns，移除 audit.status），不得只改版本字串。

## v1.1 變更紀錄與遷移

使用者於 2026-09-28 同意全部審查建議。v1.1：統一完成判定並移除分數門檻；基線／新增／回歸分開；runtime consumer 解析優先；補無回傳 ID 與 stale lock 恢復；任務分流；手動 new／continue／resume；來源／輸出分離；提前核心 DS 規格；先做真實垂直流程；同步研究與建置指令。

若未來遇到 1.0 artifacts：先唯讀備份與驗證，再將 mode 拆為 workflow／taskType、target 轉 output、來源另填 sources、補 requiredModes／baseline／gate evidence。不能自動替使用者決定缺失的範圍或核准 library。未完成遷移的 run 不寫入；schema 與 ledger 的升級不能靠改版本字串冒充。
