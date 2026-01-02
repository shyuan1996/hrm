
import React, { useState, useEffect, useRef } from 'react';
import { User, Announcement } from '../types';
import { StorageService } from '../services/storageService';
import { auth, db } from '../services/firebase';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button } from './ui/Button';
import { Building2, AlertTriangle, Megaphone, CloudDownload, Eye, EyeOff } from 'lucide-react';
import { REMEMBER_USER_KEY } from '../constants';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // 預設不勾選記住我，若勾選則使用 browserLocalPersistence (關閉視窗仍保留登入狀態)
  // 若不勾選則使用 browserSessionPersistence (關閉視窗即登出)
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const [announcements, setAnnouncements] = useState<Announcement[]>(() => StorageService.loadData().announcements);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  
  const hasAutoShown = useRef(false);

  useEffect(() => {
    // 1. Load Data
    const updateHandler = () => {
        setAnnouncements(StorageService.loadData().announcements);
    };
    window.addEventListener('storage-update', updateHandler);
    StorageService.initRealtimeSync();

    // 2. Check for remembered username ONLY (Let browser handle password)
    // 我們只幫使用者填入帳號，密碼由瀏覽器的 Autofill 安全處理
    const savedUsername = localStorage.getItem(REMEMBER_USER_KEY);
    if (savedUsername) {
        setUsername(savedUsername);
        setRememberMe(true);
    }

    return () => window.removeEventListener('storage-update', updateHandler);
  }, []);

  useEffect(() => {
    if (announcements.length > 0 && !hasAutoShown.current) {
        setShowAnnouncementModal(true);
        hasAutoShown.current = true;
    }
  }, [announcements]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    let email = username.trim();
    if (!email.includes('@')) {
        email = `${email}@shyuan-hrm.com`;
    }

    const originalId = username.includes('@') ? username.split('@')[0] : username;

    try {
        // 資安修正：根據「記住我」設定 Firebase Persistence
        // 這決定了「關閉瀏覽器後，下次進來是否還要登入」
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

        // 1. Firebase Auth Login
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;

        if (!firebaseUser) throw new Error("驗證失敗");

        const userDocRef = doc(db, 'users', originalId);
        
        // 2. 嘗試「認領」或更新 UID
        if (originalId === 'admin') {
             try {
                 await setDoc(userDocRef, {
                     id: 'admin',
                     uid: firebaseUser.uid,
                     role: 'admin',
                     name: '系統管理員',
                     dept: '管理部',
                     pass: 'PROTECTED'
                 }, { merge: true });
             } catch (e) {
                 console.warn("Admin auto-claim failed", e);
             }
        } else {
             try {
                 // 一般員工嘗試寫入自己的 UID
                 await setDoc(userDocRef, { uid: firebaseUser.uid }, { merge: true });
             } catch (e) {
                 console.warn("User auto-claim failed", e);
             }
        }

        // 3. 取得使用者資料
        let userDocSnap;
        let userProfile: User | null = null;

        try {
            userDocSnap = await getDoc(userDocRef);
        } catch (docErr: any) {
            if (docErr.code === 'permission-denied') {
                if (originalId === 'admin') {
                    throw new Error("ADMIN_PERMISSION_DENIED");
                }
                throw new Error("PERMISSION_DENIED_USER");
            } else {
                throw docErr;
            }
        }

        if (userDocSnap && userDocSnap.exists()) {
            userProfile = userDocSnap.data() as User;
        } else {
             // 新員工首次登入，自動建立檔案
             userProfile = {
                 id: originalId,
                 uid: firebaseUser.uid,
                 pass: '*****',
                 name: firebaseUser.displayName || originalId,
                 role: 'employee',
                 dept: 'General',
                 quota_annual: 0, quota_birthday: 0, quota_comp: 0
             } as User;
             
             try {
                await setDoc(userDocRef, userProfile);
             } catch (e: any) {
                 if (e.code === 'permission-denied') throw new Error("PERMISSION_DENIED_CREATE");
                 throw e;
             }
        }

        if (userProfile?.deleted && originalId !== 'admin') {
            setError('此帳號已被封存');
            setIsLoading(false);
            return;
        }

        // Feature: Remember Username Only
        // 我們只負責記住帳號，密碼的記憶交給瀏覽器 (Browser Native Password Manager)
        if (rememberMe) {
            localStorage.setItem(REMEMBER_USER_KEY, username);
        } else {
            localStorage.removeItem(REMEMBER_USER_KEY);
        }

        onLogin(userProfile!);

    } catch (err: any) {
        console.error("Login Error:", err);
        const errCode = err.code;
        const errMessage = err.message;

        if (errCode === 'auth/invalid-credential' || errCode === 'auth/wrong-password' || errCode === 'auth/user-not-found') {
            setError('帳號或密碼錯誤');
        } else if (errCode === 'auth/too-many-requests') {
            setError('嘗試次數過多，請稍後再試');
        } else if (errMessage === 'ADMIN_PERMISSION_DENIED') {
            setError('權限錯誤：無法讀取管理員資料。請確認 Firestore Rules 中 isAdmin() 已正確設定為讀取 users/admin。');
        } else if (errCode === 'permission-denied' || errMessage === 'PERMISSION_DENIED_USER') {
            setError('權限不足：無法讀取使用者資料。請聯繫管理員確認資料庫規則。');
        } else if (errMessage === 'PERMISSION_DENIED_CREATE') {
            setError('無法建立帳號資料：請聯繫管理員手動建立您的員工檔案。');
        } else {
            setError('登入失敗: ' + (errMessage || '未知錯誤'));
        }
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gray-100 font-bold overflow-y-auto relative">
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-gray-100 relative p-8 md:p-12">
        <div className="absolute top-6 right-6 flex items-center gap-2">
            <div className="flex items-center gap-1 text-green-600 text-xs">
              <CloudDownload size={14} />
            </div>
        </div>

        <div className="flex flex-col items-center mb-8 md:mb-10">
          <div className="w-20 h-20 bg-brand-600 rounded-3xl flex items-center justify-center mb-4 shadow-xl shadow-brand-200">
            <Building2 className="text-white w-10 h-10" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 tracking-tight text-center">考勤管理系統</h1>
          <p className="text-xs text-gray-400 mt-2 font-mono">Powered by Google Firebase</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
          <input 
            type="text" 
            name="username"
            autoComplete="username" 
            required 
            value={username} 
            onChange={e=>setUsername(e.target.value)} 
            className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" 
            placeholder="帳號" 
          />
          
          <div className="relative">
             <input 
               type={showPassword ? "text" : "password"} 
               name="password"
               autoComplete="current-password"
               required 
               value={password} 
               onChange={e=>setPassword(e.target.value)} 
               className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" 
               placeholder="密碼" 
             />
             <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
             </button>
          </div>

          <div className="flex justify-between items-center">
             <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 font-black">
                <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} className="rounded text-brand-600" />
                記住我 (保持登入)
             </label>
             {announcements.length > 0 && (
                <button type="button" onClick={() => setShowAnnouncementModal(true)} className="text-xs font-black text-brand-600 hover:underline flex items-center gap-1">
                   <Megaphone size={12} /> 查看公告
                </button>
             )}
          </div>
          
          {error && <div className="text-red-500 text-sm bg-red-50 p-4 rounded-xl font-black flex items-center gap-2 leading-tight break-words"><AlertTriangle size={16} className="flex-shrink-0"/> <span>{error}</span></div>}
          <Button type="submit" isLoading={isLoading} disabled={showAnnouncementModal} className="w-full py-5 rounded-2xl text-lg font-black shadow-xl disabled:bg-gray-400">
              {showAnnouncementModal ? '請先閱讀公告' : '登入系統'}
          </Button>
        </form>
      </div>

      {showAnnouncementModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-[32px] md:rounded-[48px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="p-6 md:p-8 border-b bg-brand-50 flex justify-between items-center shrink-0">
                  <h3 className="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2">
                    <Megaphone className="text-brand-600" size={24} /> 企業最新公告
                  </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scroll">
                 {announcements.map(ann => (
                  <div key={ann.id} className="bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm break-words">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${ann.category === 'urgent' ? 'bg-red-100 text-red-600' : ann.category === 'system' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}>
                        {ann.category === 'urgent' ? '緊急' : ann.category === 'system' ? '系統' : '一般'}
                      </span>
                      <span className="text-gray-400 font-black font-mono text-[10px]">
                        {ann.date ? ann.date.split(' ')[0].split('T')[0] : ''}
                      </span>
                    </div>
                    <h4 className="font-black text-gray-800 text-lg mb-4">{ann.title}</h4>
                    <div className="text-sm text-gray-500 prose prose-sm max-w-none font-bold leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: ann.content }} />
                  </div>
                 ))}
              </div>
              <div className="p-6 md:p-8 border-t bg-gray-50 shrink-0 flex justify-center">
                 <Button onClick={() => setShowAnnouncementModal(false)} className="w-full md:w-auto px-12 py-4 rounded-2xl text-lg font-black shadow-lg">
                    我已閱讀並了解
                 </Button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
