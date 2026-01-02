
import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // 修改密碼相關狀態：包含舊密碼(old)、新密碼(new1)、確認密碼(new2)
  const [isSelfPwdModalOpen, setIsSelfPwdModalOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new1: '', new2: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // modal accessibility: focus first input
  const oldPwdRef = useRef<HTMLInputElement | null>(null);

  const safeLoadData = useCallback(() => {
    try {
      const data = StorageService.loadData();
      // Defensive checks: ensure structure exists, otherwise fallback
      const safeSettings = data && data.settings ? data.settings : DEFAULT_SETTINGS;
      const safeUsers = data && Array.isArray(data.users) ? data.users : [];
      return { settings: safeSettings, users: safeUsers };
    } catch (e) {
      console.error('StorageService.loadData failed', e);
      return { settings: DEFAULT_SETTINGS, users: [] as any[] };
    }
  }, []);

  useEffect(() => {
    // 1. Initial Load from Cache (with defensive checks)
    const cachedData = safeLoadData();
    setAppSettings(cachedData.settings);

    // 2. Listen for updates from StorageService to update App-level settings
    const handleStorageUpdate = () => {
      const freshData = safeLoadData();
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
        showNotification('網路時間校正失敗，為確保數據正確，請檢查網路連線', 'error');
      }
    }).catch(err => {
      console.error('TimeService.getNetworkTimeOffset error', err);
      setIsTimeSynced(false);
      showNotification('網路時間校正失敗，為確保數據正確，請檢查網路連線', 'error');
    });

    // 4. Session & Auth State Listener
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      const savedSessionRaw = localStorage.getItem(SESSION_KEY);
      let parsed: { id?: string; role?: string } | null = null;

      if (savedSessionRaw) {
        try {
          parsed = JSON.parse(savedSessionRaw);
        } catch (e) {
          console.warn('Invalid SESSION_KEY JSON, clearing it', e);
          localStorage.removeItem(SESSION_KEY);
          parsed = null;
        }
      }

      if (firebaseUser && parsed && parsed.id) {
        // 用戶已登入且有 Session
        const freshData = safeLoadData();
        const user = freshData.users.find(u => u.id === parsed!.id);
        if (user && !user.deleted) {
          setCurrentUser(user);
          // initRealtimeSync may exist; call it
          try {
            StorageService.initRealtimeSync(user.id, user.role);
          } catch (e) {
            console.error('initRealtimeSync failed', e);
          }
        } else {
          // session user not found or deleted -> clear session
          localStorage.removeItem(SESSION_KEY);
          setCurrentUser(null);
        }
      } else if (!firebaseUser) {
        // Firebase 已登出，強制清除本地狀態
        // Ensure realtime sync is stopped if available
        try {
          if (typeof (StorageService as any).stopRealtimeSync === 'function') {
            (StorageService as any).stopRealtimeSync();
          }
        } catch (e) {
          console.warn('stopRealtimeSync failed or not available', e);
        }
        setCurrentUser(null);
        localStorage.removeItem(SESSION_KEY);
      } else {
        // firebaseUser exists but no valid parsed session -> clear local session and rely on firebase state
        localStorage.removeItem(SESSION_KEY);
        setCurrentUser(null);
      }
    });

    return () => {
      window.removeEventListener('storage-update', handleStorageUpdate);
      try {
        if (typeof (StorageService as any).stopRealtimeSync === 'function') {
          (StorageService as any).stopRealtimeSync();
        }
      } catch (e) {
        // ignore
      }
      unsubscribeAuth();
    };
  }, [safeLoadData]);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleUpdateSelfPwd = async () => {
    if (isProcessing) return; // 防重入
    // 0. 基礎欄位檢查 (是否為空)
    if (!pwdForm.old || !pwdForm.new1 || !pwdForm.new2) {
      showNotification('所有欄位皆為必填', 'error');
      return;
    }

    // 安全檢查：鎖定當前使用者，避免非同步期間狀態改變
    const user = auth.currentUser;
    if (!user || !user.email) {
      showNotification('驗證狀態失效，請重新登入', 'error');
      return;
    }

    setIsProcessing(true);

    try {
      // 1. 優先判斷舊密碼是否正確 (透過 Firebase 重新驗證)
      const credential = EmailAuthProvider.credential(user.email, pwdForm.old);
      try {
        await reauthenticateWithCredential(user, credential);
      } catch (e: any) {
        console.error('Re-auth failed', e);
        if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
          throw { code: 'WRONG_OLD_PASSWORD' };
        } else if (e.code === 'auth/too-many-requests') {
          throw { code: 'TOO_MANY_ATTEMPTS' };
        } else {
          throw e;
        }
      }

      // 2. 判斷新密碼長度 (至少6位)
      if (pwdForm.new1.length < 6) {
        throw { code: 'WEAK_PASSWORD' };
      }

      // 3. 判斷兩次新密碼是否一致
      if (pwdForm.new1 !== pwdForm.new2) {
        throw { code: 'PASSWORD_MISMATCH' };
      }

      // 4. 執行密碼更新
      await updatePassword(user, pwdForm.new1);

      // 5. 更新 Firestore 狀態 (標記密碼已保護)
      if (currentUser) {
        try {
          await StorageService.updateUser(currentUser.id, { pass: 'PROTECTED' });
        } catch (e) {
          console.warn('updateUser failed', e);
        }
      }

      // 6. 成功提示 (注意：不需要清除記住的帳號)
      setIsSelfPwdModalOpen(false);
      setPwdForm({ old: '', new1: '', new2: '' });
      showNotification('密碼修改成功！即將自動登出...', 'success');

      // 延遲執行登出，讓使用者能看到上方的成功提示
      setTimeout(async () => {
          try {
            await signOut(auth);
          } catch (e) {
            console.error('signOut after password change failed', e);
          } finally {
            try {
              if (typeof (StorageService as any).stopRealtimeSync === 'function') {
                (StorageService as any).stopRealtimeSync();
              }
            } catch (e) {
              // ignore
            }
            localStorage.removeItem(SESSION_KEY);
            setCurrentUser(null);
          }
      }, 2000);

    } catch (error: any) {
      setIsProcessing(false);
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as any).code;
        if (code === 'WRONG_OLD_PASSWORD') {
          showNotification('「舊密碼」輸入錯誤，請重新確認', 'error');
        } else if (code === 'WEAK_PASSWORD') {
          showNotification('新密碼長度不足，請至少輸入 6 位字元', 'error');
        } else if (code === 'PASSWORD_MISMATCH') {
          showNotification('兩次新密碼輸入不一致', 'error');
        } else if (code === 'TOO_MANY_ATTEMPTS') {
          showNotification('嘗試次數過多，帳戶暫時鎖定，請稍後再試', 'error');
        } else {
          showNotification('修改失敗: ' + (error.message || '未知錯誤'), 'error');
        }
      } else if (error && error.code === 'auth/requires-recent-login') {
        showNotification('系統安全機制啟動：請先登出後立即重新登入，再進行密碼修改', 'error');
        await handleLogout();
      } else {
        showNotification('修改失敗: ' + (error?.message || '未知錯誤'), 'error');
      }
    }
  };

  // Called when Login component succeeds
  const handleLoginSuccess = (u: User) => {
    setCurrentUser(u);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id, role: u.role }));
    // Start listening to this user's data
    try {
      StorageService.initRealtimeSync(u.id, u.role);
    } catch (e) {
      console.error('initRealtimeSync failed on login', e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      try {
        if (typeof (StorageService as any).stopRealtimeSync === 'function') {
          (StorageService as any).stopRealtimeSync();
        }
      } catch (e) {
        console.warn('stopRealtimeSync failed or not available', e);
      }
      localStorage.removeItem(SESSION_KEY);
      setCurrentUser(null);
    }
  };

  // modal accessibility: focus management and Esc key to close
  useEffect(() => {
    if (isSelfPwdModalOpen) {
      // focus first input
      setTimeout(() => {
        oldPwdRef.current?.focus();
      }, 0);

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsSelfPwdModalOpen(false);
          setPwdForm({ old: '', new1: '', new2: '' });
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isSelfPwdModalOpen]);

  if (!appSettings) return null;

  return (
    <div className="font-sans text-gray-900 antialiased h-screen flex flex-col bg-gray-50 relative">
      {/* Global Center Header Notification */}
      {notification && (
        <div
          className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce font-black text-sm md:text-base border-2 transition-all duration-300 ${notification.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}
          role="status"
          aria-live="polite"
        >
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
            <button onClick={() => { setIsSelfPwdModalOpen(true); setPwdForm({ old: '', new1: '', new2: '' }); }} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all">
              <Key size={16} /> <span className="hidden md:inline">更改密碼</span>
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all">
              <LogOut size={16} /> <span className="hidden md:inline">安全登出</span><span className="md:hidden">登出</span>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 text-black" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
          <div className="bg-white rounded-[32px] p-8 md:p-10 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 id="change-password-title" className="text-xl md:text-2xl font-bold mb-6 md:mb-8 text-center text-gray-800">修改您的登入密碼</h3>
            <div className="space-y-5">
              {/* 1. 舊密碼輸入框 (新增) */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500 ml-1 font-black uppercase tracking-wide">目前使用的舊密碼</label>
                <div className="relative">
                  <input
                    ref={oldPwdRef}
                    type="password"
                    placeholder="請輸入舊密碼以驗證身分"
                    value={pwdForm.old}
                    onChange={e => setPwdForm({ ...pwdForm, old: e.target.value })}
                    className="w-full p-4 pl-5 border-2 border-gray-200 rounded-2xl bg-gray-50 text-black focus:ring-4 focus:ring-brand-100 focus:border-brand-500 outline-none transition-all font-bold placeholder-gray-400"
                    aria-label="目前使用的舊密碼"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                    <Key size={18} />
                  </div>
                </div>
              </div>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
                <div className="relative flex justify-center"><span className="bg-white px-2 text-xs text-gray-400 font-bold">驗證通過後修改為</span></div>
              </div>

              {/* 2. 新密碼輸入框 */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500 ml-1 font-black uppercase tracking-wide">設定新密碼 (至少6位)</label>
                <input
                  type="password"
                  placeholder="請輸入新密碼"
                  value={pwdForm.new1}
                  onChange={e => setPwdForm({ ...pwdForm, new1: e.target.value })}
                  className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none font-bold placeholder-gray-400 focus:border-brand-500 transition-all"
                  aria-label="設定新密碼"
                />
              </div>

              {/* 3. 確認密碼輸入框 */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500 ml-1 font-black uppercase tracking-wide">再次確認新密碼</label>
                <input
                  type="password"
                  placeholder="請再次輸入新密碼"
                  value={pwdForm.new2}
                  onChange={e => setPwdForm({ ...pwdForm, new2: e.target.value })}
                  className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none font-bold placeholder-gray-400 focus:border-brand-500 transition-all"
                  aria-label="再次確認新密碼"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="secondary" className="flex-1 rounded-2xl py-3.5 font-black border-2 border-gray-100 hover:bg-gray-50" onClick={() => { setIsSelfPwdModalOpen(false); setPwdForm({ old: '', new1: '', new2: '' }); }}>取消</Button>
                <Button className="flex-1 rounded-2xl py-3.5 font-black shadow-lg bg-brand-600 hover:bg-brand-700 text-white" onClick={handleUpdateSelfPwd} disabled={isProcessing} isLoading={isProcessing}>確認修改</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
