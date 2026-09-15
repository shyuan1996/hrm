# 2026-09-15 安全修正版：部署前必讀

這份說明取代舊版「只更新 GitHub 即可」的部署方式。本版需要前端、Cloud Functions、Firestore Rules、Storage Rules 配套更新。不要先單獨發布新版 Rules。

## 保持的員工使用方式

- 保留登入、自動登入、打卡、數學確認、請假／加班申請、取消、附件及原本頁面布局。
- 上班超出範圍阻擋；下班超出範圍仍可記錄，但由後端標示「地點異常」。
- 管理員補卡保留，員工仍看一般打卡，管理員可見操作來源。
- 午休依確認統一為 12:00–13:00。
- 安全例外：封存帳號被停用；額度不足不會核准；舊資料扣抵明細不完整時要求人工核對；永久刪除員工暫停，改用封存以保留歷史關聯。

## 本次改動

- F01/F08：封存與有效員工狀態套用於資料／附件權限；封存同時停用 Auth，恢復時重新啟用。
- F02：只有後端驗證舊密碼、更新 Auth 成功後才能解除強制改密碼；重設與完成變更共用鎖，防止互相覆蓋。
- F03：畫面載入實際 Firestore 文件 ID，修改／取消／刪除指定文件；舊數字 ID 若匹配多筆，拒絕操作而不是批次修改。
- F04/F05/F09：請假核准、取消、修改、刪除與額度調整在交易中完成；相同核准／取消可重試而不重扣／重還；送出時後端重算時數。管理員明確調整假別／時數仍允許並記錄。員工剩餘額度即時更新。
- F06：驗證附件格式、擁有者、路徑及下載網址；新申請也核對實際 Storage 檔案。移除附件由後端依假單查核目標。舊格式損壞不再使頁面直接崩潰。
- F07/F17：伺服器產生正常打卡日期／時間／距離與狀態；交易避免同時送出重複上下班卡；補卡使用獨立有效時間。匯出兼查舊 date 與 createdAt，不批次改寫歷史資料。

  打卡採後端收到請求的時間，交易重試不會改掉這個時間；不採信手機自行填入的時間。網路傳輸／冷啟動仍可能影響請求抵達後端的時刻，保留原有管理員補卡作為異常處理。
- F12/F13/F14：總覽與匯出共用判斷；跨日請假依當天工作區間切分，不把未載入紀錄當作缺卡。总覽按選定日期讀取，等待／失敗時不判定曠職。
- F21：CSV 欄位引號／換行處理及公式防護。
- 配套：台灣日期解析共用、附件部分上傳失敗清理、管理員改額度時拒絕覆蓋其他人的最新調整。

注意：若歷史假單已被管理員手動改過時數，本版會保留明確的後端修改標記；沒有標記的舊待審假單在核准時會依起訖時間重算。遇到歷史特殊調整，請先使用管理員的更改假別／時數功能核對，不要直接批次核准。

## 尚未納入本批

- 加班拆單、取消重疊單後的全面重算（F10/F11）；本批保留既有分配政策並在後端驗證新單計算。
- 未來額度生效日政策及新舊額度轉換（F22/F23）；沿用核准當天判斷到期的政策，不自動相加或搬移舊額度。
- 員工帳號建立中途失敗補償、年資建議公式、全面資料遷移與大型效能重構。
- 舊版公開對話中的密碼是否仍有效，需由管理員確認並視需要更換。沒有測試任何真實密碼或替正式帳號重設密碼。
- 位置仍由手機提供，不能保證識破 GPS 偽造。持有既有附件下載權杖連結者的存取問題，亦不是本次全面改造的範圍。

## 安全上線順序

1. 保留目前 Vercel 版本與 Firebase 已發布的規則副本，確認可回復。先在測試環境或預覽版驗收，不對正式員工資料執行批次重算。
2. **先部署 Functions** 到 `shyuan-hrm`、`asia-east1`。本次有三支：`resetEmployeePassword`（更新）、`secureAttendance`（新增）、`completePasswordChange`（新增）。舊的密碼重設功能正常，不代表另外兩支已部署。
3. 確認 Functions 部署成功後，再將 `github-upload-ready` 內檔案更新至 GitHub，讓 Vercel 建置／發布。不要刪除既有遠端檔案以外的內容；若 GitHub 還有 `components/App.tsx` 或歷史對話檔，須另行核對移除。
4. 安排非打卡尖峰時段，確認新版前端可用，再發布本資料夾的 **Firestore Rules 及 Storage Rules**。規則最後收緊前，舊的直接写入路徑尚未完全封閉，這段過渡期要盡量短。
5. 請使用者重新整理一次舊分頁，再確認能自動登入。旧分頁尚未更新就遇到新規則，可能顯示權限不足；不要為消除錯誤改回全面開放讀寫。
6. 以測試員工驗證打卡、下班、請假附件、取消請假／加班；以管理員驗證核准扣假、補卡及報表。

Functions 指令（在有 firebase.json 的專案根目錄執行；本文件不代表已代為執行部署）：

```powershell
npm --prefix functions ci
npm --prefix functions run build
firebase deploy --only functions --project shyuan-hrm
```

前端上線並確認後，規則可在 Firebase Console 各自貼上發布，也可以用：

```powershell
firebase deploy --only firestore:rules,storage --project shyuan-hrm
```

Firebase Console 的 Rules 是已部署的權限；只將 `.rules` 檔上傳 GitHub，不會自動更新 Firebase。

### 執行環境期限提醒

本批保留現有 Node 20 設定，並使用 Node 20.20.2 驗證，避免同時更換執行環境。依 Google 官方時程，Node 20 已進入棄用階段，目前仍允許重新部署，但將於 **2026-10-30** 停止支援新建／更新部署；請在此日期前另行安排升級至受支援版本並重新驗證。這不是本批已完成的升級項目。參考：[Cloud Run functions 執行環境支援時程](https://docs.cloud.google.com/functions/docs/runtime-support)。

## 資料庫與成本

不需要手動新增欄位、不需要刪除原集合、不需要重建帳號。後端在打卡時自行建立 `attendance_state` 協調同時操作；新紀錄含 `effectiveAt` 等欄位，舊資料保留相容讀取。不要刪除 `users` 以重設密碼。

既有員工必須有正確的 `users/<帳號>.uid` 對應 Auth；本版不會自動把缺資料的登入者註冊為新員工。若新 Function 日誌顯示 IAM 權限錯誤，應核對執行服務帳號必要權限，不要將所有人設成 Owner 或放寬資料庫規則。正式專案的服務帳號與 App Check 設定仍須部署時確認。

這次未開啟付費防護產品，也沒有變更帳單設定。但 Functions 呼叫與 Firestore 讀寫仍依原 Firebase 方案計費／免費額度計算，不能保證永遠零費用。Functions 保持最多 5 個实例，不設定常駐最低實例。

## 本機驗證方式

```powershell
npm run typecheck
npm test
npm run build
npm --prefix functions run build
```

隔離整合測試為 `tests/emulator.cjs`；只允許 127.0.0.1 模擬器與 `demo-hrm-secure-test`。它不會退回連線正式資料庫。模擬器工具與 Java 暫存在 `.verification`，不需上傳 GitHub。正式手機、Vercel 與正式部署版本仍須依上面的驗收清單確認。

重新安裝隔離測試工具（另需 Java 21，或將本機 Java 21 的 bin 加入目前終端 PATH）：

```powershell
npm install --prefix .verification --ignore-scripts firebase-tools@15.30.1 @firebase/rules-unit-testing@5.0.2
npm --prefix functions run build
node .verification/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore,storage --project demo-hrm-secure-test --config firebase.test.json "node --test tests/emulator.cjs"
```

實作依據：[Firestore 交易](https://firebase.google.com/docs/firestore/manage-data/transactions)、[Storage 規則跨服務驗證](https://firebase.google.com/docs/reference/security/storage)。
