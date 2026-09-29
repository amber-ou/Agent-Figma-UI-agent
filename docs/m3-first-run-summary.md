# 第一次真實任務總結：名片分享成功

Spec：FIGMA_UI_AGENT_SPEC.md v1.4 · Run ID：`ui-20260928-001` · 日期：2026-09-28

本文件依本機 agent 在該 run 結束時的回報與 handoff 整理。run 紀錄（`design-runs/`）依 `.gitignore` 不提交。

## 1. 結果

| 項目 | 結果 |
|---|---|
| 任務 | 參考 v1.1.2 頁的既有畫面，延伸一張「名片分享成功」手機畫面，放在測試檔「figma-ui sandbox」頁的新 Section `figma-ui / ui-20260928-001` |
| 流程 | Intake → Preflight → Discover → Plan → Build → Validate → Handoff 全部走完 |
| 寫入 | 5 個 write operation，全部以另外的 read operation 讀回驗證；沒有 dispatched／unknown_outcome；鎖已釋放 |
| 完成判定（`evaluate-completion`） | `awaiting_user`（rule 12.1@1.2） |
| 使用者決定 | 不做收尾調整，接受為**測試成功**（v1.4 第 2.3 節的 userAcceptance）。這不等於 `complete` |

## 2. 流程中表現符合規格的地方

- **新 run 不沿用舊設定**：沒有檔案 URL 時回頭詢問，沒有套用 M1 run 的檔案設定（INVARIANT-01）。
- **Preflight**：`whoami` 確認兩個 plan 都是 Full seat；工具與 hooks 正常。
- **Library 盤點**：`get_libraries` 與 runtime `teamLibrary` 兩種讀法一致；元件 library 與 variables 來源分開回報。
- **參考畫面**：挑出 4 張相關畫面（163 個 instance），都有截圖並實際看過。
- **元件重用**：Toast、Button、icon 來自 Aiwow Library；Status Bar、Top bar/Web page 等來源未識別的元件，經使用者核准後從既有 instance 取得主元件重用，版本與參考畫面一致，沒有 detach、沒有重畫。
- **Plan**：畫面結構與數值都是從 01-04、04-11 量測得來；raw 值（漸層）主動標為未綁定，沒有假裝有 token。
- **設計決策**：5 題都以選項詢問；使用者授權採用建議後，沒有建議的題目（dec-105）略過不做，列在最後。
- **Validate**：最後一次修改後重新截圖；發現參考畫面的 Status Bar 沒有瀏海，自行修正為一致。
- **不越權**：對比不足、字型替換都列出來問，沒有自行修改。

## 3. 未通過或待決的項目（接受為測試成功時仍開啟）

| 項目 | 內容 | 規格處理（v1.4） |
|---|---|---|
| G5 文字對比 | 說明文字 style 對白底 3.34:1，低於 4.5:1；參考畫面 01-04 用同一個 style，也有同樣問題 | 第 9.5 節：Plan 階段可及性預檢；參考畫面不合格不能當作合格理由 |
| dec-105 成功圖示 | 沒有建議，依授權規則略過 | 第 7.4 節 DEC-07／DEC-08 |
| Status Bar 字型 | 主元件的 SF Pro Text 本機未安裝，以替代字型顯示 | 第 10.3 節：未安裝字型不擅自替換，記 baseline |
| Button 結構差異 | 同一主元件，新 instance 文字兩側各一個 Return icon，04-11 的舊 instance 只有一個；原因推測為舊 instance 保留舊結構，未驗證 | 第 6.2 節：列出差異，不用 override 模仿 |
| gap-001 | Size、Typography 等 collection 的來源 library 未識別；color variables 與 mode 切換未驗證 | 仍開啟 |
| 交接 | 按鈕目的頁、Toast 顯示時間未定；鍵盤與螢幕閱讀器屬實作層 | handoff 已列出 |

## 4. 設計決策紀錄（使用者授權本 run 採用建議）

| ID | 內容 | 結果 |
|---|---|---|
| dec-101 | 主體版面與背景 | 01-04 的漸層＋白卡，拿掉底部 logo（漸層為 raw 值，記為例外） |
| dec-102 | Toast 圖示 | Aiwow icon set 中 Purpose=Toast 的 check |
| dec-103 | 文案 | 採用提案；名稱以 Aiwow 為主（Top bar「Aiwow 名片」、Toast「名片分享成功」、按鈕「返回我的名片」） |
| dec-104 | 動作按鈕 | 只有一個主按鈕 |
| dec-105 | 成功圖示 | 沒有建議，略過 |

## 5. 對規格與 skill 的改進（已寫入 v1.4）

1. 使用者接受與完成判定分開（`ledger.userAcceptance`）。
2. 授權採用建議的規則與決策狀態（DEC-07、DEC-08）。
3. Plan 階段可及性預檢。
4. paint／text styles 視為 DS token，計入 tokenBinding。
5. 從既有 instance 取得主元件，避開版本差異。
6. 本機未安裝字型的處理。
7. 品牌與產品名稱由使用者確認（REQ-04）。
8. `use_figma` 回傳上限 20,480 字元與靜默截斷（M2 量測）。

skill、schema 與 validator 的對應修改列在 `CC_BUILD_PROMPT.md` 的「M3 建置指令」。
