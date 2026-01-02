
import React, { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { User, AppSettings } from './types';
import { StorageService } from './services/storageService';
import { TimeService } from './services/timeService';
import { SESSION_KEY, DEFAULT_SETTINGS } from './constants';
import { Key, LogOut, CheckCircle, UserCircle, AlertTriangle } from 'lucide-react';
import { Button } from './components/ui/Button';
import { auth } from './services/firebase';
import { signOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [timeOffset, setTimeOffset] = useState(0);
  const [isTimeSynced, setIsTimeSynced] = useState(false); // New state to track time sync status
  
  // 修改密碼相關狀態：改為包含舊密碼、新密碼、確認密碼
  const [isSelfPwdModalOpen, setIsSelfPwdModalOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new1: '', new2: '' });
  
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); // 防止重複點擊

  useEffect(() => {
    // 1. Initial Load from Cache
    const cachedData = StorageService.loadData();
    setAppSettings(cachedData.settings);

    // 2. Listen for updates from StorageService to update App-level settings
    const handleStorageUpdate = () => {
        const freshData = StorageService.loadData();
        setAppSettings(freshData.settings);
    };
    window.addEventListener('storage-update', handleStorageUpdate);

    // 3. Time Sync
    TimeService.getNetworkTimeOffset().then(offset => {
        if (offset !== null) {
            setTimeOffset(offset);
            setIsTimeSynced(true);
        } else {
            setIsTimeSynced(false);
            showNotification("網路時間校正失敗，為確保數據正確，請檢查網路連線", "error");
        }
    });

    // 4. Session & Auth State Listener
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
        const savedSession = localStorage.getItem(SESSION_KEY);
        
        if (firebaseUser && savedSession) {
            // 用戶已登入且有 Session
            const freshData = StorageService.loadData();
            const parsed = JSON.parse(savedSession);
            const user = freshData.users.find(u => u.id === parsed.id);
            if (user && !user.deleted) {
                setCurrentUser(user);
                StorageService.initRealtimeSync(user.id, user.role);
            }
        } else if (!firebaseUser) {
            // Firebase 已登出，強制清除本地狀態
            setCurrentUser(null);
            localStorage.removeItem(SESSION_KEY);
        }
    });

    return () => {
        window.removeEventListener('storage-update', handleStorageUpdate);
        unsubscribeAuth();
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleUpdateSelfPwd = async () => {
    // 0. 基礎欄位檢查
    if (!pwdForm.old || !pwdForm.new1 || !pwdForm.new2) {
      showNotification("所有欄位皆為必填", 'error');
      return;
    }

    if (!auth.currentUser || !auth.currentUser.email) {
        showNotification("驗證狀態失效，請重新登入", 'error');
        return;
    }

    setIsProcessing(true);

    try {
        // 1. 優先判斷舊密碼是否正確 (透過重新驗證)
        const credential = EmailAuthProvider.credential(auth.currentUser.email, pwdForm.old);
        try {
            await reauthenticateWithCredential(auth.currentUser, credential);
        } catch (e: any) {
            console.error("Re-auth failed", e);
            if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
                throw new Error("WRONG_OLD_PASSWORD");
            } else if (e.code === 'auth/too-many-requests') {
                throw new Error("TOO_MANY_ATTEMPTS");
            } else {
                throw e;
            }
        }

        // 2. 判斷新密碼長度 (至少6位)
        if (pwdForm.new1.length < 6) {
             throw new Error("WEAK_PASSWORD");
        }

        // 3. 判斷兩次新密碼是否一致
        if (pwdForm.new1 !== pwdForm.new2) {
             throw new Error("PASSWORD_MISMATCH");
        }
        
        // 4. 執行密碼更新
        await updatePassword(auth.currentUser, pwdForm.new1);
        
        // 5. 更新 Firestore 狀態 (標記密碼已保護)
        if (currentUser) {
            await StorageService.updateUser(currentUser.id, { pass: 'PROTECTED' });
        }

        // 6. 清除記住我
        localStorage.removeItem('sas_remember_user_v1');

        setIsSelfPwdModalOpen(false);
        setPwdForm({ old: '', new1: '', new2: '' });
        
        // 7. 成功提示並強制登出重整
        alert("密碼修改成功！\n\n系統將自動登出，請使用「新密碼」重新登入。");
        
        await signOut(auth);
        localStorage.removeItem(SESSION_KEY);
        window.location.reload();

    } catch (error: any) {
        setIsProcessing(false);
        if (error.message === "WRONG_OLD_PASSWORD") {
            showNotification("「舊密碼」輸入錯誤，請重新確認", 'error');
        } else if (error.message === "WEAK_PASSWORD") {
            showNotification("新密碼長度不足，請至少輸入 6 位字元", 'error');
        } else if (error.message === "PASSWORD_MISMATCH") {
            showNotification("兩次新密碼輸入不一致", 'error');
        } else if (error.message === "TOO_MANY_ATTEMPTS") {
            showNotification("嘗試次數過多，帳戶暫時鎖定，請稍後再試", 'error');
        } else if (error.code === 'auth/requires-recent-login') {
            alert("系統安全機制啟動：\n請先執行「登出」後立即重新登入，再進行密碼修改。");
            await handleLogout();
        } else {
            showNotification("修改失敗: " + (error.message || "未知錯誤"), 'error');
        }
    }
  };

  // Called when Login component succeeds
  const handleLoginSuccess = (u: User) => {
      setCurrentUser(u);
      localStorage.setItem(SESSION_KEY, JSON.stringify({id: u.id, role: u.role}));
      // Start listening to this user's data
      StorageService.initRealtimeSync(u.id, u.role);
  };

  const handleLogout = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout failed", error);
    } finally {
        localStorage.removeItem(SESSION_KEY);
        setCurrentUser(null); 
    }
  };

  if (!appSettings) return null;

  return (
    <div className="font-sans text-gray-900 antialiased h-screen flex flex-col bg-gray-50 relative">
      {/* Global Center Header Notification */}
      {notification && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce font-black text-sm md:text-base border-2 transition-all duration-300 ${notification.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}>
           {notification.type === 'success' ? <CheckCircle size={20} className="flex-shrink-0" /> : <AlertTriangle size={20} className="flex-shrink-0" />}
           <span className="whitespace-nowrap">{notification.message}</span>
        </div>
      )}

      {currentUser && (
         <header className="bg-white border-b px-4 md:px-8 py-3 flex justify-between items-center z-50 shadow-sm flex-shrink-0 relative">
            <div className="flex items-center gap-3 min-w-0">
               <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  {currentUser.name ? currentUser.name[0] : <UserCircle size={24} />}
               </div>
               <div className="flex flex-col justify-center min-w-0">
                 <div className="text-sm font-black text-gray-800 leading-tight truncate">{currentUser.name || currentUser.id}</div>
                 <div className="text-[10px] text-gray-500 font-bold uppercase flex items-center gap-1 mt-0.5 truncate">
                    <UserCircle size={12} className="flex-shrink-0" /> {currentUser.id}
                 </div>
               </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setIsSelfPwdModalOpen(true)} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all">
                <Key size={16}/> <span className="hidden md:inline">更改密碼</span>
              </button>
              <button onClick={handleLogout} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all">
                <LogOut size={16}/> <span className="hidden md:inline">安全登出</span><span className="md:hidden">登出</span>
              </button>
            </div>
         </header>
      )}

      <div className="flex-1 overflow-hidden relative">
        {!currentUser ? (
          <Login onLogin={handleLoginSuccess} />
        ) : currentUser.role === 'admin' ? (
          <AdminDashboard />
        ) : (
          <EmployeeDashboard user={currentUser} settings={appSettings} timeOffset={timeOffset} isTimeSynced={isTimeSynced} />
        )}
      </div>

      {isSelfPwdModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 text-black">
           <div className="bg-white rounded-[32px] p-8 md:p-10 w-full max-w-md shadow-2xl">
              <h3 className="text-xl md:text-2xl font-bold mb-6 md:mb-8 text-center">修改您的登入密碼</h3>
              <div className="space-y-4 md:space-y-6">
                 
                 {/* 1. 舊密碼輸入框 */}
                 <div className="space-y-1">
                    <label className="text-xs text-gray-500 ml-1 font-black">目前使用的舊密碼</label>
                    <input type="password" placeholder="請輸入舊密碼" value={pwdForm.old} onChange={e=>setPwdForm({...pwdForm, old: e.target.value})} className="w-full p-4 border-2 border-gray-200 rounded-2xl bg-gray-50 text-black focus:ring-4 focus:ring-brand-100 focus:border-brand-500 outline-none transition-all font-bold" />
                 </div>

                 <hr className="border-gray-100" />

                 {/* 2. 新密碼輸入框 */}
                 <div className="space-y-1">
                    <label className="text-xs text-gray-500 ml-1 font-black">設定新密碼 (至少6位)</label>
                    <input type="password" placeholder="請輸入新密碼" value={pwdForm.new1} onChange={e=>setPwdForm({...pwdForm, new1: e.target.value})} className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none font-bold" />
                 </div>
                 
                 {/* 3. 確認密碼輸入框 */}
                 <div className="space-y-1">
                    <label className="text-xs text-gray-500 ml-1 font-black">再次確認新密碼</label>
                    <input type="password" placeholder="請再次輸入新密碼" value={pwdForm.new2} onChange={e=>setPwdForm({...pwdForm, new2: e.target.value})} className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none font-bold" />
                 </div>

                 <div className="flex gap-4 pt-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl font-black" onClick={() => { setIsSelfPwdModalOpen(false); setPwdForm({old:'', new1:'', new2:''}); }}>取消</Button>
                    <Button className="flex-1 rounded-2xl font-black shadow-lg" onClick={handleUpdateSelfPwd} disabled={isProcessing} isLoading={isProcessing}>確認修改</Button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
