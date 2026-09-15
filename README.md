# Smart Attendance System

React、TypeScript、Vite 與 Firebase 建置的員工出勤、請假及加班管理系統。

**2026-09-15 安全更新：請先閱讀 [部署與相容性說明](SECURITY-UPGRADE-2026-09-15.md)。本版新增後端功能，不能只更新前端，也不要先單獨發布 Rules。**

## Run Locally

需求：Node.js。

1. Install dependencies:
   `npm ci`
2. Run the app:
   `npm run dev`
3. Production build:
   `npm run build`

Firebase 專案設定目前位於 `services/firebase.ts`。Firestore 存取規則位於 `firestore.rules`；正式部署前必須同步驗證並部署規則。
