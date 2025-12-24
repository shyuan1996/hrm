
import React, { useState, useEffect } from 'react';
import { User, Announcement } from '../types';
import { StorageService } from '../services/storageService';
import { Button } from './ui/Button';
import { Building2, AlertTriangle, Megaphone, CloudDownload, RefreshCw } from 'lucide-react';
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

  useEffect(() => {
    // Attempt to sync from cloud immediately on load
    const syncData = async () => {
        setIsSyncing(true);
        try {
            const cloudData = await StorageService.fetchCloudData();
            if (cloudData) {
                setAnnouncements(cloudData.announcements);
                setSyncStatus('success');
            } else {
                // If no cloud data, load local
                setAnnouncements(StorageService.loadData().announcements);
                
                // Check if we have a valid URL in settings OR defaults
                const currentSettings = StorageService.loadData().settings;
                const hasUrl = currentSettings?.gasUrl || DEFAULT_SETTINGS.gasUrl;
                
                setSyncStatus(hasUrl ? 'error' : 'idle');
            }
        } catch (e) {
            console.error(e);
            setSyncStatus('error');
            setAnnouncements(StorageService.loadData().announcements);
        } finally {
            setIsSyncing(false);
        }
    };

    syncData();

    const savedUser = localStorage.getItem('remembered_user');
    const savedPass = localStorage.getItem('remembered_pass');
    if (savedUser && savedPass) {
      setUsername(savedUser);
      setPassword(atob(savedPass));
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
            localStorage.setItem('remembered_user', username.trim());
            localStorage.setItem('remembered_pass', btoa(password));
          } else {
            localStorage.removeItem('remembered_user');
            localStorage.removeItem('remembered_pass');
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
    <div className="min-h-full flex items-center justify-center p-4 bg-gray-100 font-bold overflow-y-auto">
      <div className="w-full max-w-6xl bg-white rounded-[32px] md:rounded-[48px] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-gray-100 min-h-[auto] md:min-h-[600px] my-4 md:my-0">
        <div className="w-full md:w-[40%] p-8 md:p-14 flex flex-col justify-center bg-white order-1 relative">
          
          {/* Cloud Sync Status Indicator */}
          <div className="absolute top-6 right-6 flex items-center gap-2">
             {isSyncing ? (
                 <div className="flex items-center gap-1 text-brand-600 text-xs animate-pulse">
                    <RefreshCw size={14} className="animate-spin" /> 同步雲端資料中...
                 </div>
             ) : syncStatus === 'success' ? (
                 <div className="flex items-center gap-1 text-green-600 text-xs" title="已連接雲端">
                    <CloudDownload size={14} /> 資料已更新
                 </div>
             ) : syncStatus === 'error' ? (
                 <div className="flex items-center gap-1 text-red-400 text-xs" title="無法連接雲端，使用本地暫存">
                    <AlertTriangle size={14} /> 離線模式
                 </div>
             ) : null}
          </div>

          <div className="flex flex-col items-center mb-8 md:mb-10">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-brand-600 rounded-3xl flex items-center justify-center mb-4 shadow-xl shadow-brand-200">
              <Building2 className="text-white w-8 h-8 md:w-10 md:h-10" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800 tracking-tight text-center">考勤管理系統</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
            <input type="text" required value={username} onChange={e=>setUsername(e.target.value)} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" placeholder="帳號" />
            <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-brand-500 font-black transition-all" placeholder="密碼" />
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 font-black">
              <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} className="rounded text-brand-600" />
              記住帳號密碼
            </label>
            {error && <div className="text-red-500 text-sm bg-red-50 p-4 rounded-xl font-black flex items-center gap-2"><AlertTriangle size={16}/> {error}</div>}
            <Button type="submit" isLoading={isLoading} disabled={isSyncing} className="w-full py-5 rounded-2xl text-lg font-black shadow-xl disabled:bg-gray-400">
                {isSyncing ? '系統同步中...' : '登入系統'}
            </Button>
          </form>
        </div>

        <div className="w-full md:w-[60%] bg-brand-50 p-8 md:p-14 flex flex-col border-t md:border-t-0 md:border-l border-brand-100 order-2 h-[400px] md:h-auto">
          <h3 className="text-xl md:text-2xl font-black text-gray-800 mb-6 md:mb-8 flex items-center gap-2 sticky top-0 bg-brand-50 z-10 py-2">
            <Megaphone className="text-brand-600" size={24} /> 企業最新公告
          </h3>
          <div className="flex-1 overflow-y-auto space-y-4 md:space-y-5 pr-2 custom-scroll">
            {announcements.length === 0 && <p className="text-gray-400 font-bold italic text-center py-20">目前無最新公告</p>}
            {announcements.map(ann => (
              <div key={ann.id} className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm transition-all hover:shadow-md break-words">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${ann.category === 'urgent' ? 'bg-red-100 text-red-600' : ann.category === 'system' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}>
                    {ann.category === 'urgent' ? '緊急' : ann.category === 'system' ? '系統' : '一般'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-black font-mono">
                    {/* Show Only Date */}
                    {ann.date.split(' ')[0].split('T')[0]}
                  </span>
                </div>
                <h4 className="font-black text-gray-800 text-lg mb-4">{ann.title}</h4>
                <div className="text-sm text-gray-500 prose prose-sm max-w-none font-bold leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: ann.content }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
