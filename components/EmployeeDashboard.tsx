
import React, { useState, useEffect, useMemo } from 'react';
import { User, AttendanceRecord, AppSettings, Holiday } from '../types';
import { StorageService } from '../services/storageService';
import { TimeService } from '../services/timeService';
import { getDistanceFromLatLonInM } from '../utils/geo';
import { Button } from './ui/Button';
import { MapPin, Calendar, BadgeCheck, Zap, Clock, Search, XCircle, RotateCcw, CheckCircle, AlertTriangle } from 'lucide-react';
import { LEAVE_TYPES } from '../constants';

interface EmployeeDashboardProps {
  user: User;
  settings: AppSettings;
  timeOffset: number;
}

const RecordItem: React.FC<{ r: AttendanceRecord }> = ({ r }) => (
  <div className="p-4 bg-white border-2 rounded-[24px] shadow-sm transition-all hover:shadow-md flex items-center justify-between">
    <div className="flex flex-col">
       <div className={`text-sm font-black ${r.type === 'in' ? 'text-brand-600' : 'text-red-600'}`}>{r.date}</div>
       <div className="text-xs text-gray-400 font-black">{r.type === 'in' ? '上班' : '下班'}打卡</div>
    </div>
    <div className="text-xl font-mono font-black text-gray-800 tracking-tight">{r.time}</div>
    <div className={`px-3 py-1 rounded-full text-[10px] font-black text-white ${r.type === 'in' ? 'bg-green-600' : 'bg-red-600'}`}>
      成功
    </div>
  </div>
);

export const EmployeeDashboard: React.FC<EmployeeDashboardProps> = ({ user, settings, timeOffset }) => {
  const [now, setNow] = useState(TimeService.getCorrectedNow(timeOffset));
  const [distance, setDistance] = useState<number | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  
  // Mobile View State: 'punch' (Left Col) or 'apply' (Right Col)
  const [mobileView, setMobileView] = useState<'punch' | 'apply'>('punch');

  // Custom Notification
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Modals
  const [showPunchHistory, setShowPunchHistory] = useState(false);
  const [showLeaveHistory, setShowLeaveHistory] = useState(false);
  const [showOTHistory, setShowOTHistory] = useState(false);
  
  // Challenges
  const [punchMathChallenge, setPunchMathChallenge] = useState<{q:string, a:number, opts:number[]} | null>(null);
  const [cancelLeaveChallenge, setCancelLeaveChallenge] = useState<{id: number, q:string, a:number, opts:number[], type: 'leave' | 'ot'} | null>(null);

  // Filters
  const [historyFilterStart, setHistoryFilterStart] = useState('');
  const [historyFilterEnd, setHistoryFilterEnd] = useState('');
  const [historyFilterType, setHistoryFilterType] = useState('all');

  const [otFilterStart, setOtFilterStart] = useState('');
  const [otFilterEnd, setOtFilterEnd] = useState('');

  // Form
  const [activeTab, setActiveTab] = useState<'leave' | 'ot'>('leave');
  const [leaveForm, setLeaveForm] = useState({
    type: LEAVE_TYPES[0],
    startDate: '',
    endDate: '',
    startTime: '08:30',
    endTime: '17:30',
    reason: ''
  });

  // Overtime Form
  const [otForm, setOtForm] = useState({
    startDate: '',
    startTime: '18:00',
    endDate: '',
    endTime: '20:00',
    reason: ''
  });

  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const timeOptions = useMemo(() => {
    const opts = [];
    for (let h = 8; h <= 12; h++) {
      if (h === 8) opts.push('08:30');
      else if (h < 12) { opts.push(`${String(h).padStart(2, '0')}:00`); opts.push(`${String(h).padStart(2, '0')}:30`); }
      else opts.push('12:00');
    }
    for (let h = 13; h <= 17; h++) {
      opts.push(`${String(h).padStart(2, '0')}:00`);
      opts.push(`${String(h).padStart(2, '0')}:30`);
    }
    return opts;
  }, []);

  const otTimeOptions = useMemo(() => {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      opts.push(`${String(h).padStart(2, '0')}:00`);
      opts.push(`${String(h).padStart(2, '0')}:30`);
    }
    return opts;
  }, []);

  useEffect(() => {
    const updateLoc = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          if (settings.companyLat && settings.companyLng) {
            setDistance(getDistanceFromLatLonInM(pos.coords.latitude, pos.coords.longitude, settings.companyLat, settings.companyLng));
          }
        }, (err) => console.warn("Location error:", err));
      }
    };
    updateLoc();
    const timer = setInterval(updateLoc, 10000); 
    return () => clearInterval(timer);
  }, [settings]);

  useEffect(() => {
    const timer = setInterval(() => setNow(TimeService.getCorrectedNow(timeOffset)), 1000);
    const data = StorageService.loadData();
    setRecords(data.records.filter(r => r.userId === user.id));
    setHolidays(data.holidays);
    return () => clearInterval(timer);
  }, [timeOffset, user.id]);

  useEffect(() => {
    let timer: any;
    if (punchMathChallenge) {
      timer = setTimeout(() => {
        setPunchMathChallenge(null);
        setNotification({ type: 'error', message: '回答超時，打卡動作已取消' });
      }, 10000);
    }
    return () => clearTimeout(timer);
  }, [punchMathChallenge]);

  const todayStr = now.toISOString().split('T')[0];
  const lastRecordToday = records.find(r => r.date === todayStr);
  const currentPunchType = lastRecordToday?.type === 'in' ? 'out' : 'in';
  const inRange = distance !== null && distance <= settings.allowedRadius;

  const initiatePunch = () => {
    if (settings.companyLat && !inRange) {
      setNotification({ type: 'error', message: `距離過遠無法打卡 (目前距離：${distance?.toFixed(0)}m)` });
      return;
    }
    const n1 = Math.floor(Math.random() * 9) + 1;
    const n2 = Math.floor(Math.random() * 9) + 1;
    const ans = n1 + n2;
    const opts = [ans, ans + 1, ans - 1].sort(() => Math.random() - 0.5);
    setPunchMathChallenge({ q: `${n1} + ${n2} = ?`, a: ans, opts });
  };

  const executePunch = (choice: number) => {
    if (choice !== punchMathChallenge?.a) {
      setPunchMathChallenge(null);
      setNotification({ type: 'error', message: "驗證錯誤，打卡動作取消" });
      return;
    }
    setPunchMathChallenge(null);
    StorageService.addRecord({
      id: Date.now(),
      userId: user.id,
      userName: user.name,
      date: todayStr,
      time: now.toTimeString().split(' ')[0],
      type: currentPunchType,
      status: '正常',
      lat: 0, lng: 0, dist: distance || 0
    });
    setRecords(StorageService.loadData().records.filter(r => r.userId === user.id));
    setNotification({ type: 'success', message: `${currentPunchType === 'in' ? '上班' : '下班'}打卡成功！` });
  };

  const allLeaves = StorageService.loadData().leaves.filter(l => l.userId === user.id);
  const recentLeave = allLeaves[0];
  
  const allOvertime = StorageService.loadData().overtimes.filter(o => o.userId === user.id);
  const recentOT = allOvertime[0];

  const quotaStats = useMemo(() => {
    const calculateUsed = (type: string) => 
        allLeaves
        .filter(l => l.type === type && (l.status === 'approved' || l.status === 'pending'))
        .reduce((acc, curr) => acc + curr.hours, 0);

    const usedAnnual = calculateUsed('特休');
    const usedBirthday = calculateUsed('生日假');
    const usedComp = calculateUsed('補休');

    return {
        annual: { total: user.quota_annual || 0, used: usedAnnual, remaining: (user.quota_annual || 0) - usedAnnual },
        birthday: { total: user.quota_birthday || 0, used: usedBirthday, remaining: (user.quota_birthday || 0) - usedBirthday },
        comp: { total: user.quota_comp || 0, used: usedComp, remaining: (user.quota_comp || 0) - usedComp },
    };
  }, [allLeaves, user]);

  const calculatedHours = useMemo(() => {
    const s = `${leaveForm.startDate} ${leaveForm.startTime}`;
    const e = `${leaveForm.endDate} ${leaveForm.endTime}`;
    return TimeService.calculateLeaveHours(s, e, holidays);
  }, [leaveForm, holidays]);

  const quotaCheck = useMemo(() => {
      let limit = Infinity;
      let label = '';
      if (leaveForm.type === '特休') { limit = quotaStats.annual.remaining; label = '特休'; }
      if (leaveForm.type === '生日假') { limit = quotaStats.birthday.remaining; label = '生日假'; }
      if (leaveForm.type === '補休') { limit = quotaStats.comp.remaining; label = '補休'; }

      if (limit !== Infinity && calculatedHours > limit) {
          return { valid: false, msg: `${label}額度不足 (剩餘: ${limit}hr)` };
      }
      return { valid: true, msg: '' };
  }, [leaveForm.type, calculatedHours, quotaStats]);

  const isLeaveDateValid = useMemo(() => {
    if (!leaveForm.startDate || !leaveForm.endDate) return true;
    const start = new Date(`${leaveForm.startDate}T${leaveForm.startTime}`);
    const end = new Date(`${leaveForm.endDate}T${leaveForm.endTime}`);
    return end >= start;
  }, [leaveForm]);

  const isOtDateValid = useMemo(() => {
    if (!otForm.startDate || !otForm.endDate) return true;
    const start = new Date(`${otForm.startDate}T${otForm.startTime}`);
    const end = new Date(`${otForm.endDate}T${otForm.endTime}`);
    return end >= start;
  }, [otForm]);

  const calculatedOTHours = useMemo(() => {
    if (!otForm.startDate || !otForm.endDate) return 0;
    const s = new Date(`${otForm.startDate}T${otForm.startTime}`);
    const e = new Date(`${otForm.endDate}T${otForm.endTime}`);
    const diffMs = e.getTime() - s.getTime();
    if (diffMs <= 0) return 0;
    return parseFloat((diffMs / (1000 * 60 * 60)).toFixed(1));
  }, [otForm]);

  const initiateCancelRequest = (id: number, type: 'leave' | 'ot') => {
    const n1 = Math.floor(Math.random() * 9) + 1;
    const n2 = Math.floor(Math.random() * 9) + 1;
    const ans = n1 + n2;
    const opts = [ans, ans + 1, ans - 1].sort(() => Math.random() - 0.5);
    setCancelLeaveChallenge({ id, q: `${n1} + ${n2} = ?`, a: ans, opts, type });
  };

  const executeCancelRequest = (choice: number) => {
    if (!cancelLeaveChallenge) return;
    if (choice !== cancelLeaveChallenge.a) {
       setCancelLeaveChallenge(null);
       setNotification({ type: 'error', message: "驗證錯誤，取消操作已終止" });
       return;
    }
    if (cancelLeaveChallenge.type === 'leave') StorageService.cancelLeave(cancelLeaveChallenge.id);
    else StorageService.cancelOvertime(cancelLeaveChallenge.id);

    setCancelLeaveChallenge(null);
    setNotification({ type: 'success', message: "申請已成功取消" });
  };

  const getLeaveStatusStyle = (status: string) => {
    switch(status) {
      case 'approved': return 'bg-green-100 text-green-700';
      case 'rejected': return 'bg-red-100 text-red-700';
      case 'cancelled': return 'bg-gray-200 text-gray-500';
      case 'pending':
      default: return 'bg-[#FDF5E6] text-[#6F4E37] border border-[#D2B48C]';
    }
  };

  const getLeaveStatusText = (status: string) => {
    switch(status) {
      case 'approved': return '審核通過';
      case 'rejected': return '審核不通過';
      case 'cancelled': return '已取消';
      case 'pending':
      default: return '審核中';
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden text-black font-bold relative">
      
      {/* Global Notification */}
      {notification && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce font-black text-sm md:text-base border-2 transition-all duration-300 ${notification.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}>
           {notification.type === 'success' ? <CheckCircle size={20} className="flex-shrink-0" /> : <AlertTriangle size={20} className="flex-shrink-0" />}
           <span className="truncate">{notification.message}</span>
        </div>
      )}

      {/* Main Content Area - Split View on Desktop, Switched View on Mobile */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-4 md:p-8 gap-4 md:gap-8 items-stretch relative mb-16 md:mb-0">
        
        {/* Punch Section (Left) */}
        <div className={`w-full md:w-1/2 flex-col h-full flex-shrink-0 ${mobileView === 'punch' ? 'flex' : 'hidden md:flex'}`}>
            <div className="flex-1 bg-white rounded-[32px] md:rounded-[40px] shadow-sm border p-6 md:p-12 flex flex-col items-center justify-start space-y-6 md:space-y-8 overflow-y-auto custom-scroll relative h-full">
              <div className="text-center w-full pb-4 md:pb-6 border-b border-gray-100">
                 <div className="text-brand-600 font-black text-lg md:text-2xl mb-1 md:mb-2">{TimeService.toROCDateString(now)}</div>
                 <div className="text-5xl md:text-7xl font-mono font-black tracking-tighter text-gray-800">
                   {now.toLocaleTimeString('zh-TW', { hour12: false })}
                 </div>
              </div>

              <div className="flex flex-col items-center w-full max-w-sm">
                <Button 
                  variant="tech-circle" 
                  onClick={initiatePunch} 
                  className={`w-48 h-48 md:w-64 md:h-64 rounded-full border-[8px] md:border-[12px] shadow-2xl transition-all duration-500 mb-6 md:mb-8 aspect-square ${currentPunchType === 'in' ? 'from-brand-500 to-brand-700 border-brand-100' : 'from-red-500 to-red-700 border-red-100'}`}
                >
                  <Zap size={48} className="text-white fill-white animate-pulse mb-2 md:mb-4 md:w-16 md:h-16" />
                  <span className="text-3xl md:text-5xl font-black tracking-widest text-white">
                    {currentPunchType === 'in' ? '上班' : '下班'}
                  </span>
                </Button>
                
                <div className={`w-full py-3 md:py-4 px-4 md:px-6 rounded-2xl font-black flex items-center justify-center gap-2 md:gap-3 shadow-md transition-all text-sm md:text-xl ${settings.companyLat ? (inRange ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-gray-100 text-gray-400'}`}>
                   <MapPin size={20} className="md:w-6 md:h-6" />
                   {settings.companyLat ? (
                     <span>距離：{distance?.toFixed(1) || '--'} m ({inRange ? '範圍內' : '範圍外'})</span>
                   ) : (
                     <span className="animate-pulse">管理員尚未設定座標</span>
                   )}
                </div>
              </div>

              <div className="w-full max-w-xl p-4 md:p-6 bg-gray-50 rounded-[24px] md:rounded-[32px] border border-gray-100 mt-auto">
                <div className="flex justify-between items-center mb-3 md:mb-5">
                  <h4 className="text-xs md:text-sm font-black text-gray-400 uppercase tracking-widest">最近打卡紀錄 (近2筆)</h4>
                  <button onClick={() => setShowPunchHistory(true)} className="text-xs font-black text-brand-600 hover:underline">查看更多紀錄</button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:gap-3">
                  {records.slice(0, 2).map((r) => (
                    <RecordItem key={r.id} r={r} />
                  ))}
                  {records.length === 0 && <div className="p-6 md:p-10 text-center text-gray-300 italic">尚無打卡紀錄</div>}
                </div>
              </div>
            </div>
        </div>

        {/* Apply Section (Right) */}
        <div className={`w-full md:w-1/2 flex-col h-full overflow-hidden ${mobileView === 'apply' ? 'flex' : 'hidden md:flex'}`}>
          <div className="bg-white rounded-[32px] md:rounded-[40px] shadow-sm border flex flex-col h-full overflow-hidden">
             <div className="flex p-2 md:p-3 border-b border-gray-100 bg-gray-50/50">
                <button onClick={() => setActiveTab('leave')} className={`flex-1 py-3 md:py-4 rounded-[20px] md:rounded-[28px] font-black transition-all flex items-center justify-center gap-2 text-sm md:text-base ${activeTab === 'leave' ? 'bg-brand-600 text-white shadow-xl' : 'text-gray-400 hover:bg-gray-100'}`}>
                  <Calendar size={18} className="md:w-5 md:h-5" /> 請假申請
                </button>
                <button onClick={() => setActiveTab('ot')} className={`flex-1 py-3 md:py-4 rounded-[20px] md:rounded-[28px] font-black transition-all flex items-center justify-center gap-2 text-sm md:text-base ${activeTab === 'ot' ? 'bg-indigo-600 text-white shadow-xl' : 'text-gray-400 hover:bg-gray-100'}`}>
                  <BadgeCheck size={18} className="md:w-5 md:h-5" /> 加班申請
                </button>
             </div>

             <div className="flex-1 overflow-y-auto custom-scroll p-6 md:p-8 pb-8">
               {activeTab === 'leave' ? (
                 <div className="space-y-6 md:space-y-8">
                   <div className="bg-gray-50/50 p-6 md:p-8 rounded-[28px] md:rounded-[36px] border border-gray-100">
                     <h3 className="font-black text-xl md:text-2xl mb-4 md:mb-6 flex items-center gap-3 text-brand-800">填寫假單</h3>
                     
                     {/* Quota Dashboard */}
                     <div className="mb-6 grid grid-cols-3 gap-2 md:gap-3">
                        <div className="bg-white p-2 md:p-4 rounded-xl md:rounded-2xl border-2 border-blue-100 shadow-sm flex flex-col items-center text-center">
                            <div className="text-[10px] md:text-xs font-black text-gray-400 mb-1">特休假</div>
                            <div className="text-sm md:text-xl font-black text-blue-600">{quotaStats.annual.remaining} <span className="text-[10px] md:text-xs text-gray-400">/ {quotaStats.annual.total} hr</span></div>
                        </div>
                        <div className="bg-white p-2 md:p-4 rounded-xl md:rounded-2xl border-2 border-pink-100 shadow-sm flex flex-col items-center text-center">
                            <div className="text-[10px] md:text-xs font-black text-gray-400 mb-1">生日假</div>
                            <div className="text-sm md:text-xl font-black text-pink-500">{quotaStats.birthday.remaining} <span className="text-[10px] md:text-xs text-gray-400">/ {quotaStats.birthday.total} hr</span></div>
                        </div>
                        <div className="bg-white p-2 md:p-4 rounded-xl md:rounded-2xl border-2 border-purple-100 shadow-sm flex flex-col items-center text-center">
                            <div className="text-[10px] md:text-xs font-black text-gray-400 mb-1">補休假</div>
                            <div className="text-sm md:text-xl font-black text-purple-600">{quotaStats.comp.remaining} <span className="text-[10px] md:text-xs text-gray-400">/ {quotaStats.comp.total} hr</span></div>
                        </div>
                     </div>

                     <div className="space-y-4 md:space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">開始日期</label>
                             <input type="date" value={leaveForm.startDate} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-300 transition-all" onChange={e => setLeaveForm({...leaveForm, startDate: e.target.value})} />
                           </div>
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">結束日期</label>
                             <input type="date" value={leaveForm.endDate} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-300 transition-all" onChange={e => setLeaveForm({...leaveForm, endDate: e.target.value})} />
                           </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">開始時間</label>
                             <select className="w-full p-4 bg-white border border-gray-100 rounded-2xl font-black outline-none transition-all" value={leaveForm.startTime} onChange={e => setLeaveForm({...leaveForm, startTime: e.target.value})}>
                               {timeOptions.map(t => <option key={t}>{t}</option>)}
                             </select>
                           </div>
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">結束時間</label>
                             <select className="w-full p-4 bg-white border border-gray-100 rounded-2xl font-black outline-none transition-all" value={leaveForm.endTime} onChange={e => setLeaveForm({...leaveForm, endTime: e.target.value})}>
                               {timeOptions.map(t => <option key={t}>{t}</option>)}
                             </select>
                           </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-black text-gray-400">假別</label>
                          <select className="w-full p-4 bg-white border border-gray-100 rounded-2xl font-black outline-none transition-all" value={leaveForm.type} onChange={e => setLeaveForm({...leaveForm, type: e.target.value})}>
                           {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
                         </select>
                       </div>
                       <div className="space-y-2">
                         <label className="text-xs font-black text-gray-400">事由 (必填)</label>
                         <textarea className="w-full p-4 bg-white border border-gray-100 rounded-2xl min-h-[80px] font-black outline-none transition-all" value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})} placeholder="請說明請假事由..." />
                       </div>

                       {!isLeaveDateValid ? (
                         <div className="p-4 md:p-6 bg-red-50 rounded-[24px] md:rounded-[32px] border-2 border-red-100 space-y-3 flex items-center justify-center gap-3 text-red-600 font-black animate-pulse text-sm md:text-base">
                            <AlertTriangle />
                            結束時間不能早於開始時間
                         </div>
                       ) : !quotaCheck.valid ? (
                         <div className="p-4 md:p-6 bg-red-50 rounded-[24px] md:rounded-[32px] border-2 border-red-100 space-y-3 flex items-center justify-center gap-3 text-red-600 font-black animate-pulse text-sm md:text-base">
                            <AlertTriangle />
                            {quotaCheck.msg} (申請: {calculatedHours}hr)
                         </div>
                       ) : (
                         <div className="p-4 md:p-6 bg-brand-50 rounded-[24px] md:rounded-[32px] border-2 border-brand-100 space-y-2 md:space-y-3">
                            <div className="flex justify-between items-center text-xs font-black">
                               <span className="text-gray-400">假別</span>
                               <span className="text-brand-800 text-base md:text-lg">{leaveForm.type || '未選擇'}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-black">
                               <span className="text-gray-400">時數</span>
                               <span className="text-brand-700 text-sm md:text-base underline underline-offset-4 decoration-2">{calculatedHours.toFixed(1)} 小時</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-black">
                               <span className="text-gray-400">期間</span>
                               <span className="text-gray-600 font-mono text-[10px] md:text-[12px]">{leaveForm.startDate || '----'} ~ {leaveForm.endDate || '----'}</span>
                            </div>
                         </div>
                       )}

                       <Button 
                         className={`w-full py-4 md:py-5 rounded-[24px] md:rounded-[32px] text-lg md:text-xl font-black shadow-2xl ${(!isLeaveDateValid || !quotaCheck.valid) ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' : ''}`}
                         disabled={!isLeaveDateValid || !quotaCheck.valid}
                         onClick={() => {
                         if (!leaveForm.startDate || !leaveForm.endDate) {
                           setNotification({ type: 'error', message: "請填寫完整請假日期" });
                           return;
                         }
                         if (!leaveForm.reason.trim()) {
                           setNotification({ type: 'error', message: "請填寫請假事由" });
                           return;
                         }
                         StorageService.addLeave({
                           id: Date.now(), userId: user.id, userName: user.name, type: leaveForm.type,
                           start: `${leaveForm.startDate} ${leaveForm.startTime}`, end: `${leaveForm.endDate} ${leaveForm.endTime}`,
                           hours: calculatedHours, reason: leaveForm.reason, status: 'pending', created_at: new Date().toLocaleString()
                         });
                         setLeaveForm({ type: LEAVE_TYPES[0], startDate: '', endDate: '', startTime: '08:30', endTime: '17:30', reason: '' });
                         setNotification({ type: 'success', message: "已成功送出申請！" });
                       }}>
                         {isLeaveDateValid ? (quotaCheck.valid ? '送出申請' : '額度不足') : '日期選擇錯誤'}
                       </Button>
                     </div>
                   </div>

                   <div className="p-6 md:p-8 bg-white border-2 border-gray-100 rounded-[28px] md:rounded-[36px] space-y-4 md:space-y-6">
                     <div className="flex justify-between items-center border-b pb-4">
                       <h4 className="text-xs md:text-sm font-black text-gray-400 uppercase">最新一筆請假預覽</h4>
                       <button onClick={() => setShowLeaveHistory(true)} className="text-xs font-black text-brand-600 hover:underline">歷史紀錄查詢</button>
                     </div>
                     {recentLeave ? (
                       <div className="flex flex-col gap-4">
                         <div className="flex justify-between items-start">
                           <div className="space-y-2 flex-1">
                             <div className="flex items-center gap-3">
                                <div className="text-xl md:text-2xl font-black text-gray-800">{recentLeave.type}</div>
                                <div className="text-lg md:text-xl font-black text-brand-600 underline underline-offset-4 decoration-2">{recentLeave.hours} 小時</div>
                             </div>
                             <div className="text-xs md:text-sm text-gray-500 font-mono bg-gray-50 px-3 py-1 rounded-lg inline-block">
                               {recentLeave.start} ~ {recentLeave.end}
                             </div>
                             <div className="text-xs md:text-sm text-gray-600 border-l-4 border-gray-100 pl-4 py-1 italic">
                               事由：{recentLeave.reason || '無備註'}
                             </div>
                             {recentLeave.status === 'rejected' && recentLeave.rejectReason && (
                               <div className="text-xs md:text-sm text-red-500 font-bold border-l-4 border-red-200 pl-4 py-1">
                                 審核不通過原因：{recentLeave.rejectReason}
                               </div>
                             )}
                             <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1">
                                <Clock size={12}/> 申請於：{recentLeave.created_at}
                             </div>
                             {recentLeave.status === 'pending' && (
                               <button onClick={() => initiateCancelRequest(recentLeave.id, 'leave')} className="text-xs text-red-500 font-black flex items-center gap-1 hover:underline mt-2">
                                  <XCircle size={14}/> 取消申請
                               </button>
                             )}
                           </div>
                           <span className={`px-3 py-1 md:px-5 md:py-2 rounded-full text-[10px] md:text-xs font-black shadow-sm ${getLeaveStatusStyle(recentLeave.status)}`}>
                             {getLeaveStatusText(recentLeave.status)}
                           </span>
                         </div>
                       </div>
                     ) : <div className="text-center py-6 text-gray-400 font-black italic">尚無請假紀錄</div>}
                   </div>
                 </div>
               ) : (
                 <div className="space-y-6 md:space-y-8">
                    <div className="bg-gray-50/50 p-6 md:p-8 rounded-[28px] md:rounded-[36px] border border-gray-100">
                       <h3 className="font-black text-xl md:text-2xl mb-4 md:mb-6 flex items-center gap-3 text-indigo-800">填寫加班單</h3>
                       <div className="space-y-4 md:space-y-6">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <div className="space-y-2">
                               <label className="text-xs font-black text-gray-400">開始日期</label>
                               <input type="date" className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-indigo-300 transition-all" onChange={e=>setOtForm({...otForm, startDate: e.target.value})} value={otForm.startDate} required />
                             </div>
                             <div className="space-y-2">
                               <label className="text-xs font-black text-gray-400">結束日期</label>
                               <input type="date" className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-indigo-300 transition-all" onChange={e=>setOtForm({...otForm, endDate: e.target.value})} value={otForm.endDate} required />
                             </div>
                           </div>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <div className="space-y-2">
                               <label className="text-xs font-black text-gray-400">開始時間</label>
                               <select className="w-full p-4 bg-white border border-gray-100 rounded-2xl font-black outline-none transition-all" onChange={e=>setOtForm({...otForm, startTime: e.target.value})} value={otForm.startTime}>
                                  {otTimeOptions.map(t => <option key={t}>{t}</option>)}
                               </select>
                             </div>
                             <div className="space-y-2">
                               <label className="text-xs font-black text-gray-400">結束時間</label>
                               <select className="w-full p-4 bg-white border border-gray-100 rounded-2xl font-black outline-none transition-all" onChange={e=>setOtForm({...otForm, endTime: e.target.value})} value={otForm.endTime}>
                                  {otTimeOptions.map(t => <option key={t}>{t}</option>)}
                               </select>
                             </div>
                           </div>
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">加班事由 (必填)</label>
                             <textarea className="w-full p-4 bg-white border border-gray-100 rounded-2xl min-h-[80px] font-black outline-none transition-all" placeholder="請詳細說明加班工作內容..." onChange={e=>setOtForm({...otForm, reason: e.target.value})} value={otForm.reason} required />
                           </div>

                           {!isOtDateValid ? (
                             <div className="p-4 md:p-6 bg-red-50 rounded-[24px] md:rounded-[32px] border-2 border-red-100 space-y-3 flex items-center justify-center gap-3 text-red-600 font-black animate-pulse text-sm md:text-base">
                                <AlertTriangle />
                                結束時間不能早於開始時間
                             </div>
                           ) : (
                             <div className="p-4 md:p-6 bg-indigo-50 rounded-[24px] md:rounded-[32px] border-2 border-indigo-100 space-y-2 md:space-y-3">
                               <div className="flex justify-between items-center text-xs font-black">
                                   <span className="text-gray-400">總時數</span>
                                   <span className="text-indigo-700 text-sm md:text-base underline underline-offset-4 decoration-2">{calculatedOTHours.toFixed(1)} 小時</span>
                               </div>
                               <div className="flex justify-between items-center text-xs font-black">
                                   <span className="text-gray-400">期間</span>
                                   <span className="text-gray-600 font-mono text-[10px] md:text-[12px]">
                                     {otForm.startDate || '----'} {otForm.startTime} ~ {otForm.endDate || '----'} {otForm.endTime}
                                   </span>
                               </div>
                             </div>
                           )}

                           <Button 
                             type="submit" 
                             className={`w-full py-4 md:py-5 rounded-[24px] md:rounded-[32px] text-lg md:text-xl font-black shadow-2xl bg-indigo-600 hover:bg-indigo-700 transition-all text-white ${!isOtDateValid ? 'bg-gray-300 cursor-not-allowed shadow-none hover:bg-gray-300' : ''}`}
                             disabled={!isOtDateValid}
                             onClick={() => {
                             if(!otForm.startDate || !otForm.endDate) {
                               setNotification({ type: 'error', message: "請填寫完整加班日期" });
                               return;
                             }
                             if(!otForm.reason.trim()) {
                               setNotification({ type: 'error', message: "請填寫加班事由" });
                               return;
                             }
                             StorageService.addOvertime({
                               id: Date.now(), userId: user.id, userName: user.name,
                               start: `${otForm.startDate} ${otForm.startTime}`, end: `${otForm.endDate} ${otForm.endTime}`, hours: calculatedOTHours, reason: otForm.reason,
                               status: 'pending', created_at: new Date().toLocaleString()
                             });
                             setOtForm({startDate: '', startTime: '18:00', endDate: '', endTime: '20:00', reason: ''});
                             setNotification({ type: 'success', message: "加班申請已提交！" });
                           }}>
                             {isOtDateValid ? '送出加班審核申請' : '日期選擇錯誤'}
                           </Button>
                       </div>
                    </div>

                    {/* 加班預覽 */}
                    <div className="p-6 md:p-8 bg-white border-2 border-gray-100 rounded-[28px] md:rounded-[36px] space-y-4 md:space-y-6">
                     <div className="flex justify-between items-center border-b pb-4">
                       <h4 className="text-xs md:text-sm font-black text-gray-400 uppercase">最新一筆加班預覽</h4>
                       <button onClick={() => setShowOTHistory(true)} className="text-xs font-black text-indigo-600 hover:underline">歷史紀錄查詢</button>
                     </div>
                     {recentOT ? (
                       <div className="flex flex-col gap-4">
                         <div className="flex justify-between items-start">
                           <div className="space-y-2 flex-1">
                             <div className="text-lg md:text-xl font-black text-indigo-600 underline underline-offset-4 decoration-2">
                                {recentOT.hours} 小時
                             </div>
                             <div className="text-xs md:text-sm text-gray-500 font-mono bg-gray-50 px-3 py-1 rounded-lg inline-block">
                               {recentOT.start} ~ {recentOT.end}
                             </div>
                             <div className="text-xs md:text-sm text-gray-600 border-l-4 border-indigo-100 pl-4 py-1 italic">
                               事由：{recentOT.reason}
                             </div>
                             {recentOT.status === 'rejected' && recentOT.rejectReason && (
                               <div className="text-xs md:text-sm text-red-500 font-bold border-l-4 border-red-200 pl-4 py-1">
                                 審核不通過原因：{recentOT.rejectReason}
                               </div>
                             )}
                             {recentOT.adminNote && (
                               <div className="text-xs md:text-sm text-brand-600 font-bold border-l-4 border-brand-200 pl-4 py-1">
                                 管理員修改備註：{recentOT.adminNote}
                               </div>
                             )}
                             <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1">
                                <Clock size={12}/> 申請於：{recentOT.created_at}
                             </div>
                             {recentOT.status === 'pending' && (
                               <button onClick={() => initiateCancelRequest(recentOT.id, 'ot')} className="text-xs text-red-500 font-black flex items-center gap-1 hover:underline mt-2">
                                  <XCircle size={14}/> 取消申請
                               </button>
                             )}
                           </div>
                           <span className={`px-3 py-1 md:px-5 md:py-2 rounded-full text-[10px] md:text-xs font-black shadow-sm ${getLeaveStatusStyle(recentOT.status)}`}>
                             {getLeaveStatusText(recentOT.status)}
                           </span>
                         </div>
                       </div>
                     ) : <div className="text-center py-6 text-gray-400 font-black italic">尚無加班紀錄</div>}
                   </div>
                 </div>
               )}
             </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation for Mode Switching */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-safe flex justify-around items-center h-16 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
         <button onClick={() => setMobileView('punch')} className={`flex flex-col items-center justify-center w-full h-full relative transition-all ${mobileView === 'punch' ? 'text-brand-600' : 'text-gray-400'}`}>
            <Zap size={24} className={mobileView === 'punch' ? 'fill-brand-100' : ''}/>
            <span className="text-[10px] font-bold mt-1">打卡作業</span>
         </button>
         <button onClick={() => setMobileView('apply')} className={`flex flex-col items-center justify-center w-full h-full relative transition-all ${mobileView === 'apply' ? 'text-brand-600' : 'text-gray-400'}`}>
            <Calendar size={24} className={mobileView === 'apply' ? 'fill-brand-100' : ''}/>
            <span className="text-[10px] font-bold mt-1">表單申請</span>
         </button>
      </div>

      {/* 打卡驗證彈窗 */}
      {punchMathChallenge && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[1050] flex items-center justify-center p-4 md:p-6 text-black">
           <div className="bg-white rounded-[32px] md:rounded-[48px] p-8 md:p-12 w-full max-w-md shadow-2xl border-4 border-brand-500 animate-in bounce-in duration-500">
              <div className="text-center mb-6 md:mb-10">
                <h3 className="text-2xl md:text-3xl font-black mb-2 tracking-tight">打卡安全驗證</h3>
                <div className="text-xs font-black text-brand-600 animate-pulse bg-brand-50 py-1 rounded-full">剩餘回答時間：10 秒</div>
              </div>
              <div className="bg-gray-100 p-6 md:p-8 rounded-[24px] md:rounded-[32px] text-center mb-6 md:mb-10">
                <div className="text-4xl md:text-5xl font-black font-mono tracking-widest">{punchMathChallenge.q}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-10">
                {punchMathChallenge.opts.map((opt, idx) => (
                  <button key={idx} onClick={() => executePunch(opt)} className="p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[20px] md:rounded-[24px] text-2xl md:text-3xl font-black text-brand-600 hover:bg-brand-600 hover:text-white transition-all shadow-md">{opt}</button>
                ))}
              </div>
              <button className="w-full py-3 md:py-4 text-gray-400 font-black hover:text-gray-600 transition-colors" onClick={()=>setPunchMathChallenge(null)}>取消本次打卡</button>
           </div>
        </div>
      )}

      {/* 取消請假驗證彈窗 */}
      {cancelLeaveChallenge && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[1100] flex items-center justify-center p-4 md:p-6 text-black">
           <div className="bg-white rounded-[32px] md:rounded-[48px] p-8 md:p-12 w-full max-w-md shadow-2xl border-4 border-red-400 animate-in bounce-in duration-500">
              <div className="text-center mb-6 md:mb-10">
                <h3 className="text-xl md:text-2xl font-black mb-2 tracking-tight text-red-600">確認取消{cancelLeaveChallenge.type === 'leave' ? '請假' : '加班'}申請?</h3>
                <div className="text-xs md:text-sm font-black text-gray-500">請回答下方問題以確認取消</div>
              </div>
              <div className="bg-gray-100 p-6 md:p-8 rounded-[24px] md:rounded-[32px] text-center mb-6 md:mb-10">
                <div className="text-4xl md:text-5xl font-black font-mono tracking-widest">{cancelLeaveChallenge.q}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-10">
                {cancelLeaveChallenge.opts.map((opt, idx) => (
                  <button key={idx} onClick={() => executeCancelRequest(opt)} className="p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[20px] md:rounded-[24px] text-2xl md:text-3xl font-black text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-md">{opt}</button>
                ))}
              </div>
              <button className="w-full py-3 md:py-4 text-gray-400 font-black hover:text-gray-600 transition-colors" onClick={()=>setCancelLeaveChallenge(null)}>保留申請</button>
           </div>
        </div>
      )}

      {/* 歷史紀錄區間篩選 */}
      {showPunchHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[1050] flex items-center justify-center p-4 md:p-6 text-black">
          <div className="bg-white rounded-[32px] md:rounded-[48px] w-full max-w-2xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 md:p-8 border-b flex justify-between items-center bg-brand-50 text-brand-800">
              <h3 className="text-xl md:text-2xl font-black">打卡歷史紀錄查詢</h3>
              <button onClick={() => setShowPunchHistory(false)} className="hover:rotate-90 transition-all duration-300"><XCircle size={28} className="md:w-8 md:h-8"/></button>
            </div>
            <div className="p-6 border-b bg-gray-50 flex flex-col gap-4">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 ml-2">起始日期</label>
                    <input type="date" value={historyFilterStart} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setHistoryFilterStart(e.target.value)}/>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 ml-2">結束日期</label>
                    <input type="date" value={historyFilterEnd} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setHistoryFilterEnd(e.target.value)}/>
                 </div>
               </div>
               <div className="flex gap-4">
                 <button className="flex-1 py-4 bg-brand-600 text-white rounded-[20px] font-black flex items-center justify-center gap-2 shadow-xl hover:bg-brand-700 transition-all"><Search size={20}/> 執行篩選</button>
                 <button onClick={()=>{setHistoryFilterStart(''); setHistoryFilterEnd('');}} className="px-6 md:px-8 py-4 bg-gray-200 text-gray-600 rounded-[20px] font-black flex items-center gap-2 hover:bg-gray-300 transition-all"><RotateCcw size={20}/> 重置</button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4 md:space-y-6 bg-gray-50/20">
               {records.filter(r => {
                 if (!historyFilterStart && !historyFilterEnd) return true;
                 return (!historyFilterStart || r.date >= historyFilterStart) && (!historyFilterEnd || r.date <= historyFilterEnd);
               }).map(r => <RecordItem key={r.id} r={r} />)}
            </div>
          </div>
        </div>
      )}

      {/* 請假歷史紀錄篩選 */}
      {showLeaveHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[1050] flex items-center justify-center p-4 md:p-6 text-black">
          <div className="bg-white rounded-[32px] md:rounded-[48px] w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 md:p-8 border-b flex justify-between items-center bg-indigo-50 text-indigo-800">
              <h3 className="text-xl md:text-2xl font-black">個人請假申請紀錄</h3>
              <button onClick={() => setShowLeaveHistory(false)} className="hover:rotate-90 transition-all duration-300"><XCircle size={28} className="md:w-8 md:h-8"/></button>
            </div>
            <div className="p-6 border-b bg-gray-50 flex flex-col gap-4">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 ml-2">假別篩選</label>
                    <select className="w-full p-4 bg-white border border-gray-200 rounded-2xl outline-none font-black" value={historyFilterType} onChange={e=>setHistoryFilterType(e.target.value)}>
                        <option value="all">所有假別</option>
                        {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 ml-2">起始日期</label>
                    <input type="date" value={historyFilterStart} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setHistoryFilterStart(e.target.value)}/>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 ml-2">結束日期</label>
                    <input type="date" value={historyFilterEnd} className="w-full p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setHistoryFilterEnd(e.target.value)}/>
                  </div>
               </div>
               <div className="flex gap-4">
                 <button className="flex-1 py-4 bg-indigo-600 text-white rounded-[20px] font-black flex items-center justify-center gap-2 shadow-xl hover:bg-indigo-700 transition-all"><Search size={20}/> 執行篩選</button>
                 <button onClick={()=>{setHistoryFilterStart(''); setHistoryFilterEnd(''); setHistoryFilterType('all');}} className="px-6 md:px-8 py-4 bg-gray-200 text-gray-600 rounded-[20px] font-black flex items-center gap-2 hover:bg-gray-300 transition-all"><RotateCcw size={20}/> 重置</button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4 md:space-y-6 bg-gray-50/20">
               {allLeaves.filter(l => {
                 const leaveDate = l.start.split(' ')[0];
                 const dateMatch = (!historyFilterStart || leaveDate >= historyFilterStart) && (!historyFilterEnd || leaveDate <= historyFilterEnd);
                 const typeMatch = historyFilterType === 'all' || l.type === historyFilterType;
                 return dateMatch && typeMatch;
               }).map(l => (
                 <div key={l.id} className="p-6 md:p-8 bg-white rounded-[32px] md:rounded-[40px] border-2 flex flex-col gap-4 shadow-sm relative overflow-hidden transition-all hover:border-indigo-100">
                    <div className="flex justify-between items-start">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-3">
                           <div className="font-black text-xl md:text-2xl text-gray-800">{l.type}</div>
                           <div className="text-lg md:text-xl font-black text-indigo-600 underline underline-offset-4 decoration-2">{l.hours} 小時</div>
                        </div>
                        <div className="text-xs md:text-sm text-gray-400 font-mono bg-gray-50 px-3 md:px-4 py-1 md:py-2 rounded-xl inline-block">
                          {l.start} ~ {l.end}
                        </div>
                        <div className="text-xs md:text-sm text-gray-600 border-l-4 border-indigo-100 pl-4 py-1">事由：{l.reason || '無備註'}</div>
                        {l.status === 'rejected' && l.rejectReason && (
                           <div className="text-xs md:text-sm text-red-500 font-bold border-l-4 border-red-200 pl-4 py-1">
                             審核不通過原因：{l.rejectReason}
                           </div>
                        )}
                        <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1">
                           <Clock size={12}/> 申請於：{l.created_at}
                        </div>
                        {l.status === 'pending' && (
                          <button onClick={() => initiateCancelRequest(l.id, 'leave')} className="text-xs text-red-500 font-black flex items-center gap-1 hover:underline mt-2">
                             <XCircle size={14}/> 取消此申請
                          </button>
                        )}
                      </div>
                      <span className={`px-3 py-1 md:px-5 md:py-2 rounded-full text-[10px] md:text-xs font-black shadow-sm ${getLeaveStatusStyle(l.status)}`}>
                        {getLeaveStatusText(l.status)}
                      </span>
                    </div>
                 </div>
               ))}
               {allLeaves.length === 0 && <div className="p-20 text-center text-gray-400 italic font-black">目前無請假紀錄</div>}
            </div>
          </div>
        </div>
      )}

      {/* 加班歷史紀錄篩選 */}
      {showOTHistory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[1050] flex items-center justify-center p-4 md:p-6 text-black">
          <div className="bg-white rounded-[32px] md:rounded-[48px] w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 md:p-8 border-b flex justify-between items-center bg-indigo-50 text-indigo-800">
              <h3 className="text-xl md:text-2xl font-black">個人加班申請紀錄</h3>
              <button onClick={() => setShowOTHistory(false)} className="hover:rotate-90 transition-all duration-300"><XCircle size={28} className="md:w-8 md:h-8"/></button>
            </div>
            <div className="p-6 border-b bg-gray-50 flex flex-col gap-4">
               <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 ml-2">加班日期區間</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="date" value={otFilterStart} className="p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setOtFilterStart(e.target.value)}/>
                    <input type="date" value={otFilterEnd} className="p-4 bg-black text-white border-2 border-gray-100 rounded-2xl outline-none shadow-lg font-black" onChange={e => setOtFilterEnd(e.target.value)}/>
                  </div>
               </div>
               <div className="flex gap-4">
                 <button className="flex-1 py-4 bg-indigo-600 text-white rounded-[20px] font-black flex items-center justify-center gap-2 shadow-xl hover:bg-indigo-700 transition-all"><Search size={20}/> 執行篩選</button>
                 <button onClick={()=>{setOtFilterStart(''); setOtFilterEnd('');}} className="px-6 md:px-8 py-4 bg-gray-200 text-gray-600 rounded-[20px] font-black flex items-center gap-2 hover:bg-gray-300 transition-all"><RotateCcw size={20}/> 重置</button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4 md:space-y-6 bg-gray-50/20">
               {allOvertime.filter(o => {
                 const otDate = o.start.split(' ')[0];
                 if (!otFilterStart && !otFilterEnd) return true;
                 return (!otFilterStart || otDate >= otFilterStart) && (!otFilterEnd || otDate <= otFilterEnd);
               }).map(o => (
                 <div key={o.id} className="p-6 md:p-8 bg-white rounded-[32px] md:rounded-[40px] border-2 flex flex-col gap-4 shadow-sm relative overflow-hidden transition-all hover:border-indigo-100">
                    <div className="flex justify-between items-start">
                      <div className="space-y-3 flex-1">
                        <div className="text-lg md:text-xl font-black text-indigo-600 underline underline-offset-4 decoration-2">
                           {o.hours} 小時
                        </div>
                        <div className="text-xs md:text-sm text-gray-400 font-mono bg-gray-50 px-3 md:px-4 py-1 md:py-2 rounded-xl inline-block">
                          {o.start} ~ {o.end}
                        </div>
                        <div className="text-xs md:text-sm text-gray-600 border-l-4 border-indigo-100 pl-4 py-1">事由：{o.reason}</div>
                        {o.status === 'rejected' && o.rejectReason && (
                           <div className="text-xs md:text-sm text-red-500 font-bold border-l-4 border-red-200 pl-4 py-1">
                             審核不通過原因：{o.rejectReason}
                           </div>
                        )}
                        {o.adminNote && (
                           <div className="text-xs md:text-sm text-brand-600 font-bold border-l-4 border-brand-200 pl-4 py-1">
                             管理員修改備註：{o.adminNote}
                           </div>
                        )}
                        <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1">
                           <Clock size={12}/> 申請於：{o.created_at}
                        </div>
                        {o.status === 'pending' && (
                          <button onClick={() => initiateCancelRequest(o.id, 'ot')} className="text-xs text-red-500 font-black flex items-center gap-1 hover:underline mt-2">
                             <XCircle size={14}/> 取消此申請
                          </button>
                        )}
                      </div>
                      <span className={`px-3 py-1 md:px-5 md:py-2 rounded-full text-[10px] md:text-xs font-black shadow-sm ${getLeaveStatusStyle(o.status)}`}>
                        {getLeaveStatusText(o.status)}
                      </span>
                    </div>
                 </div>
               ))}
               {allOvertime.length === 0 && <div className="p-20 text-center text-gray-400 italic font-black">目前無加班紀錄</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
