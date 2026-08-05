# Smart Attendance System

React、TypeScript、Vite 與 Firebase 建置的員工出勤、請假及加班管理系統。

## Run Locally

需求：Node.js。

1. Install dependencies:
   `npm ci`
2. Run the app:
   `npm run dev`
3. Production build:
   `npm run build`

Firebase 專案設定目前位於 `services/firebase.ts`。Firestore 存取規則位於 `firestore.rules`；正式部署前必須同步驗證並部署規則。
