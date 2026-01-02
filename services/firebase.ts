
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyChRSqy8ubnhGQgGAA0bfe-gFOLWTJxmMk",
  authDomain: "shyuan-hrm.firebaseapp.com",
  projectId: "shyuan-hrm",
  storageBucket: "shyuan-hrm.firebasestorage.app",
  messagingSenderId: "464681558258",
  appId: "1:464681558258:web:cce2809a1297c9452ff06b",
  measurementId: "G-FP4LV68J9Z"
};

// 1. 主要 App (當前登入者使用)
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 2. 次要 App (專門用來讓管理員建立新員工帳號)
// 這是因為 Firebase Client SDK 只要一呼叫 createUserWithEmailAndPassword 就會自動把當前使用者登出並登入新帳號
// 使用第二個 App 實例可以避免把管理員登出
const SECONDARY_APP_NAME = "secondaryApp";
let secondaryApp;

if (getApps().length > 1) {
  secondaryApp = getApp(SECONDARY_APP_NAME);
} else {
  secondaryApp = initializeApp(firebaseConfig, SECONDARY_APP_NAME);
}

const secondaryAuth = getAuth(secondaryApp);

/**
 * 專門給管理員使用的「建立員工帳號」功能
 * 支援「純帳號」模式 (自動補上 @domain)
 */
export const createAuthUser = async (username: string, password: string) => {
    // 自動補全 Email 格式，實現「純帳號」登入體驗
    let email = username.trim();
    if (!email.includes('@')) {
        email = `${email}@shyuan-hrm.com`;
    }

    try {
        // 使用次要 Auth 實例建立帳號
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        // 建立完立刻登出次要實例，確保安全
        await signOut(secondaryAuth);
        return userCredential.user;
    } catch (error: any) {
        console.error("Create User Error:", error);
        if (error.code === 'auth/email-already-in-use') {
            throw new Error("此帳號 ID 已被使用");
        }
        if (error.code === 'auth/weak-password') {
            throw new Error("密碼強度不足 (至少6位)");
        }
        throw new Error(error.message || "建立帳號失敗");
    }
};
