
import React, { useState, useEffect } from 'react';
import { User, Announcement } from '../types';
import { StorageService } from '../services/storageService';
import { Button } from './ui/Button';
import { Building2, AlertTriangle, Megaphone, CloudDownload, RefreshCw, XCircle } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../constants';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);

  // Obfuscation helpers to hide credentials in storage (not high security, but hides from casual view)
  const KEY_USER = '_app_usr';
  const KEY_PASS = '_app_psw';
  
  const obfuscate = (str: string) => {
      try {
          // Simple XOR with a fixed key + Base64
          const key = 123;
          return btoa(str.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join(''));
      } catch { return ''; }
  };

  const deobfuscate = (str: string) => {
      try {
          const key = 123;
          return atob(str).split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join('');
      } catch { return ''; }
  };

  useEffect(() => {
    // Attempt to sync from cloud immediately on load
    const syncData = async () => {
        setIsSyncing(true);
        try {
            const cloudData = await StorageService.fetchCloudData();
            if (cloudData) {
                setAnnouncements(cloudData.announcements);
                if (cloudData.announcements.length > 0) setShowAnnouncementModal(true);
                setSyncStatus('success');
            } else {
                // If no cloud data, load local
                const localData = StorageService.loadData();
                setAnnouncements(localData.announcements);
                if (localData.announcements.length > 0) setShowAnnouncementModal(true);
                
                // Check if we have a valid URL in settings OR defaults
                const currentSettings = localData.settings;
                const hasUrl = currentSettings?.gasUrl || DEFAULT_SETTINGS.gasUrl;
                
                setSyncStatus(hasUrl ? 'error' : 'idle');
            }
        } catch (e) {
            console.error(e);
            setSyncStatus('error');
            const localAnn = StorageService.loadData().announcements;
            setAnnouncements(localAnn);
            if (localAnn.length > 0) setShowAnnouncementModal(true);
        } finally {
            setIsSyncing(false);
        }
    };

    syncData();

    const savedUser = localStorage.getItem(KEY_USER);
    const savedPass = localStorage.getItem(KEY_PASS);
    if (savedUser && savedPass) {
      setUsername(deobfuscate(savedUser));
      setPassword(deobfuscate(savedPass));
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    setTimeout(() => {
      // Re-load data to ensure we use the latest from memory/storage
      const data = StorageService.loadData();
      
      // Normalize input: trim whitespace and lowercase
      const normalizedInput = username.trim().toLowerCase();
      
      // Fix: Ensure comparison handles both string and number types from backend
      // Google Sheets often returns numeric IDs/Passwords as numbers, causing strict equality checks to fail
      const user = data.users.find(u => 
        u.id && String(u.id).trim().toLowerCase() === normalizedInput && String(u.pass) === password
      );
      
      if (user) {
        if (user.deleted) {
          setError('此帳號已被封存，無法登入系統');
        } else {
          if (rememberMe) {
            localStorage.setItem(KEY_USER, obfuscate(username.trim()));
            localStorage.setItem(KEY_PASS, obfuscate(password));
          } else {
            localStorage.removeItem(KEY_USER);
            localStorage.removeItem(KEY_PASS);
          }
          onLogin(user);
        }
      } else {
        setError('帳號或密碼錯誤');
      }
      setIsLoading(false);
    }, 500);
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gray-100 font-bold overflow-y-auto relative">
      
      {/* Login Card */}
      <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-gray-100 relative p-8 md:p-12">
        
        {/* Cloud Sync Status Indicator */}
        <div className="absolute top-6 right-6 flex items-center gap-2">
            {isSyncing ? (
                <div className="flex items-center gap-1 text-brand-600 text-xs animate-pulse">
                  <RefreshCw size={14} className="animate-spin" />
                </div>
            ) : syncStatus === 'success' ? (
                <div className="flex items-center gap-1 text-green-600 text-xs" title="已連接雲端">
                  <CloudDownload size={14} />
                </div>
            ) : syncStatus === 'error' ? (
                <div className="flex items-center gap-1 text-red-400 text-xs" title="無法連接雲端，使用本地暫存">
                  <AlertTriangle size={14} />
                </div>
            ) : null}
        </div>

        <div className="flex flex-col items-center mb-8 md:mb-10">
          <div className="w-20 h-20 bg-brand-600 rounded-3xl flex items-center justify-center mb-4 shadow-xl shadow-brand-200">
            <Building2 className="text-white w-10 h-10" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 tracking-tight text-center">考勤管理系統</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
          <input type="text" required value={username} onChange={e=>setUsername(e.target.value)} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" placeholder="帳號" />
          <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" placeholder="密碼" />
          <div className="flex justify-between items-center">
             <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 font-black">
                <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} className="rounded text-brand-600" />
                記住帳號密碼
             </label>
             {announcements.length > 0 && (
                <button type="button" onClick={() => setShowAnnouncementModal(true)} className="text-xs font-black text-brand-600 hover:underline flex items-center gap-1">
                   <Megaphone size={12} /> 查看最新公告
                </button>
             )}
          </div>
          
          {error && <div className="text-red-500 text-sm bg-red-50 p-4 rounded-xl font-black flex items-center gap-2"><AlertTriangle size={16}/> {error}</div>}
          <Button type="submit" isLoading={isLoading} disabled={isSyncing || showAnnouncementModal} className="w-full py-5 rounded-2xl text-lg font-black shadow-xl disabled:bg-gray-400">
              {isSyncing ? '系統同步中...' : showAnnouncementModal ? '請先閱讀公告' : '登入系統'}
          </Button>
        </form>
      </div>

      {/* Announcement Modal Overlay */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-[32px] md:rounded-[48px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="p-6 md:p-8 border-b bg-brand-50 flex justify-between items-center shrink-0">
                  <h3 className="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2">
                    <Megaphone className="text-brand-600" size={24} /> 企業最新公告
                  </h3>
                  {/* Close button is hidden, user must scroll/read or click bottom button */}
              </div>
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scroll">
                 {announcements.map(ann => (
                  <div key={ann.id} className="bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm break-words">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${ann.category === 'urgent' ? 'bg-red-100 text-red-600' : ann.category === 'system' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}>
                        {ann.category === 'urgent' ? '緊急' : ann.category === 'system' ? '系統' : '一般'}
                      </span>
                      <span className="text-[10px] text-gray-400 font-black font-mono">
                        {ann.date.split(' ')[0].split('T')[0]}
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
