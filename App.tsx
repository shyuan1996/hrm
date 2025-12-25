
import React, { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { User, AppSettings } from './types';
import { StorageService } from './services/storageService';
import { TimeService } from './services/timeService';
import { SESSION_KEY } from './constants';
import { Key, LogOut, CheckCircle, UserCircle, AlertTriangle } from 'lucide-react';
import { Button } from './components/ui/Button';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // [OPTIMIZATION] Initialize synchronously from local storage.
  // This ensures the UI renders instantly without a loading blink.
  const [appSettings, setAppSettings] = useState<AppSettings>(() => StorageService.loadData().settings);
  
  const [timeOffset, setTimeOffset] = useState(0);
  const [isTimeSynced, setIsTimeSynced] = useState(false);
  const [isSelfPwdModalOpen, setIsSelfPwdModalOpen] = useState(false);
  const [newSelfPwd, setNewSelfPwd] = useState({ p1: '', p2: '' });
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const performTimeSync = async () => {
    if (!isTimeSynced) setIsTimeSynced(false);
    
    const offset = await TimeService.getNetworkTimeOffset();
    if (offset !== null) {
      setTimeOffset(offset);
      setIsTimeSynced(true);
      console.log("Time synced successfully.");
    } else {
      console.warn("時間校正失敗，請檢查網路連線");
      setTimeout(async () => {
         const retryOffset = await TimeService.getNetworkTimeOffset();
         if (retryOffset !== null) {
            setTimeOffset(retryOffset);
            setIsTimeSynced(true);
         }
      }, 3000);
    }
  };

  useEffect(() => {
    const init = async () => {
      // 1. Initial State is already set via useState lazy initializer (Instant UI)

      // 2. Perform Cloud Sync in Background (Stale-While-Revalidate)
      // fetchCloudData is idempotent and likely already started by the module import.
      // We just await the result here.
      const cloudData = await StorageService.fetchCloudData();
      if (cloudData) {
          setAppSettings(cloudData.settings);
      }
      
      // 3. Time Sync
      performTimeSync();
      
      // 4. Session Check
      const savedSession = localStorage.getItem(SESSION_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        // Use data from memory which might be fresher if cloud sync finished
        const currentData = StorageService.loadData();
        const user = currentData.users.find(u => u.id === parsed.id);
        if (user && !user.deleted) setCurrentUser(user);
      }
    };
    init();

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            console.log("App visible, re-syncing time...");
            performTimeSync();
            // Optional: Re-fetch cloud data on visibility change
            StorageService.fetchCloudData().then(d => { if(d) setAppSettings(d.settings); });
        }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleUpdateSelfPwd = () => {
    if (!newSelfPwd.p1 || newSelfPwd.p1 !== newSelfPwd.p2) {
      showNotification("密碼輸入不一致或不得為空", 'error');
      return;
    }
    if (!currentUser) return;
    StorageService.updateUser(currentUser.id, { pass: newSelfPwd.p1 });
    setIsSelfPwdModalOpen(false);
    setNewSelfPwd({ p1: '', p2: '' });
    showNotification("您的密碼已成功修改！", 'success');
  };

  const handleLogin = (u: User) => {
    const data = StorageService.loadData();
    setAppSettings(data.settings);
    performTimeSync();
    setCurrentUser(u);
    localStorage.setItem(SESSION_KEY, JSON.stringify({id: u.id, role: u.role}));
  };

  if (!appSettings) return null;

  return (
    <div className="font-sans text-gray-900 antialiased h-screen flex flex-col bg-gray-50 relative">
      {/* Global Center Header Notification */}
      {notification && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] w-[92%] md:w-auto md:max-w-xl px-6 py-4 rounded-[28px] shadow-2xl flex items-center justify-center gap-3 font-black text-base md:text-lg border-4 transition-all duration-300 break-words text-center leading-snug ${notification.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}>
           {notification.type === 'success' ? <CheckCircle size={28} className="flex-shrink-0" /> : <AlertTriangle size={28} className="flex-shrink-0" />}
           <span className="flex-1">{notification.message}</span>
        </div>
      )}

      {currentUser && (
         <header className="bg-white border-b px-4 md:px-8 py-3 flex justify-between items-center z-50 shadow-sm flex-shrink-0 relative">
            <div className="flex items-center gap-3 min-w-0">
               <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  {currentUser.name[0]}
               </div>
               <div className="flex flex-col justify-center min-w-0">
                 <div className="text-sm font-black text-gray-800 leading-tight truncate">{currentUser.name}</div>
                 <div className="text-[10px] text-gray-500 font-bold uppercase flex items-center gap-1 mt-0.5 truncate">
                    <UserCircle size={12} className="flex-shrink-0" /> {currentUser.id}
                 </div>
               </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setIsSelfPwdModalOpen(true)} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all">
                <Key size={16}/> <span className="hidden md:inline">更改密碼</span>
              </button>
              <button onClick={() => { setCurrentUser(null); localStorage.removeItem(SESSION_KEY); }} className="flex items-center gap-1 md:gap-2 px-3 py-2 text-[10px] md:text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-all">
                <LogOut size={16}/> <span className="hidden md:inline">安全登出</span><span className="md:hidden">登出</span>
              </button>
            </div>
         </header>
      )}

      <div className="flex-1 overflow-hidden relative">
        {!currentUser ? (
          <Login onLogin={(u) => { setCurrentUser(u); localStorage.setItem(SESSION_KEY, JSON.stringify({id: u.id, role: u.role})); }} />
        ) : currentUser.role === 'admin' ? (
          <AdminDashboard />
        ) : (
          <EmployeeDashboard user={currentUser} settings={appSettings} timeOffset={timeOffset} isTimeSynced={isTimeSynced} />
        )}
      </div>

      {isSelfPwdModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 text-black">
           <div className="bg-white rounded-[32px] p-8 md:p-10 w-full max-w-md shadow-2xl">
              <h3 className="text-xl md:text-2xl font-bold mb-6 md:mb-8">修改您的登入密碼</h3>
              <div className="space-y-4 md:space-y-6">
                 <input type="password" placeholder="輸入新密碼" value={newSelfPwd.p1} onChange={e=>setNewSelfPwd({...newSelfPwd, p1: e.target.value})} className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none" />
                 <input type="password" placeholder="再次輸入新密碼" value={newSelfPwd.p2} onChange={e=>setNewSelfPwd({...newSelfPwd, p2: e.target.value})} className="w-full p-4 border border-gray-200 rounded-2xl bg-white text-black focus:ring-4 focus:ring-brand-100 outline-none" />
                 <div className="flex gap-4 pt-2">
                    <Button variant="secondary" className="flex-1 rounded-2xl font-black" onClick={()=>setIsSelfPwdModalOpen(false)}>取消</Button>
                    <Button className="flex-1 rounded-2xl font-black" onClick={handleUpdateSelfPwd}>確定修改</Button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
