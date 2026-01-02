
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, AttendanceRecord, AppSettings, Holiday } from '../types';
import { StorageService } from '../services/storageService';
import { TimeService } from '../services/timeService';
import { getDistanceFromLatLonInM } from '../utils/geo';
import { Button } from './ui/Button';
import { MapPin, Calendar, BadgeCheck, Zap, Clock, Search, XCircle, RotateCcw, CheckCircle, AlertTriangle, Loader2, Filter, Trash2, Image as ImageIcon } from 'lucide-react';
import { LEAVE_TYPES } from '../constants';

interface EmployeeDashboardProps {
  user: User;
  settings: AppSettings;
  timeOffset: number;
  isTimeSynced: boolean;
}

const RecordItem: React.FC<{ r: AttendanceRecord }> = ({ r }) => {
  const dateStr = TimeService.getTaiwanDate(r.date);
  const displayTime = TimeService.formatTimeOnly(r.time, true);

  return (
    <div className="p-4 bg-white border-2 rounded-[24px] shadow-sm transition-all hover:shadow-md flex items-center justify-between">
      <div className="flex flex-col min-w-[90px]">
         <div className={`text-sm font-black text-gray-500`}>{dateStr}</div>
         <div className="flex items-center gap-2">
           <div className={`text-xs font-black ${r.type === 'in' ? 'text-brand-600' : 'text-red-600'}`}>{r.type === 'in' ? '上班' : '下班'}打卡</div>
         </div>
      </div>
      
      <div className="flex-1 text-center flex flex-col items-center justify-center">
          <div className="text-xl font-mono font-black text-gray-800 tracking-tight">{displayTime}</div>
      </div>

      <div className="flex flex-col items-end gap-1 min-w-[50px]">
          <div className={`px-1.5 py-0.5 rounded-full text-[10px] font-black text-white text-center w-auto min-w-[35px] ${r.type === 'in' ? 'bg-green-600' : 'bg-red-600'}`}>
            成功
          </div>
          {r.status.includes('異常') && <span className="text-[9px] bg-red-100 text-red-600 px-1 rounded font-bold text-center w-auto min-w-[35px]">地點異常</span>}
      </div>
    </div>
  );
};

export const EmployeeDashboard: React.FC<EmployeeDashboardProps> = ({ user, settings, timeOffset, isTimeSynced }) => {
  const [now, setNow] = useState(TimeService.getCorrectedNow(timeOffset));
  const [distance, setDistance] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string>('');
  
  // Use state to hold data instead of relying on prop updates to avoid flicker
  const [localData, setLocalData] = useState(StorageService.loadData());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  
  const [isVerifying, setIsVerifying] = useState(false);
  
  // Mobile View State
  const [mobileView, setMobileView] = useState<'punch' | 'apply'>('punch');

  // Custom Notification
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Modals
  const [showPunchHistory, setShowPunchHistory] = useState(false);
  const [showLeaveHistory, setShowLeaveHistory] = useState(false);
  const [showOTHistory, setShowOTHistory] = useState(false);
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);
  
  // Challenges
  const [punchMathChallenge, setPunchMathChallenge] = useState<{q:string, a:number, opts:number[]} | null>(null);
  const [cancelLeaveChallenge, setCancelLeaveChallenge] = useState<{id: number, q:string, a:number, opts:number[], type: 'leave' | 'ot'} | null>(null);

  // Filters
  const [punchFilterStart, setPunchFilterStart] = useState('');
  const [punchFilterEnd, setPunchFilterEnd] = useState('');
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

  const watchIdRef = useRef<number | null>(null);

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

  // Optimized Geolocation with Fallback Strategy
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("瀏覽器不支援定位");
      return;
    }

    const startWatching = (enableHighAccuracy: boolean) => {
      if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
      }

      const successHandler = (pos: GeolocationPosition) => {
        setGpsError('');
        if (settings.companyLat && settings.companyLng) {
          setDistance(getDistanceFromLatLonInM(pos.coords.latitude, pos.coords.longitude, settings.companyLat, settings.companyLng));
        } else {
           setDistance(0);
        }
      };

      const errorHandler = (err: GeolocationPositionError) => {
         console.warn(`Location error (HighAccuracy: ${enableHighAccuracy}):`, err);
         if (enableHighAccuracy) {
             console.log("Attempting fallback to low accuracy mode...");
             startWatching(false); 
         } else {
             setGpsError("無法獲取位置資訊 (請檢查系統權限)");
             setDistance(null);
         }
      };

      watchIdRef.current = navigator.geolocation.watchPosition(
        successHandler,
        errorHandler,
        { 
            enableHighAccuracy: enableHighAccuracy, 
            timeout: enableHighAccuracy ? 15000 : 30000, 
            maximumAge: 10000 
        }
      );
    };

    startWatching(true);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [settings]);

  // Data Sync and Time
  useEffect(() => {
    const timer = setInterval(() => setNow(TimeService.getCorrectedNow(timeOffset)), 1000);
    
    const updateLocalData = () => {
        const newData = StorageService.loadData();
        // CRITICAL FIX: Spread object to force React to detect change even if reference is same
        setLocalData({ ...newData }); 
    };

    // Initial load
    updateLocalData();

    // Listen for updates
    window.addEventListener('storage-update', updateLocalData);

    return () => {
        clearInterval(timer);
        window.removeEventListener('storage-update', updateLocalData);
    };
  }, [timeOffset, user.id]);

  // Derive state from localData whenever it changes
  useEffect(() => {
      const userRecords = localData.records.filter(r => r.userId === user.id).sort((a, b) => b.id - a.id);
      setRecords(userRecords);
      setHolidays(localData.holidays);
  }, [localData, user.id]);

  useEffect(() => {
    let timer: any;
    if (punchMathChallenge) {
      timer = setTimeout(() => {
        setPunchMathChallenge(null);
        setIsVerifying(false);
        setNotification({ type: 'error', message: '回答超時，打卡動作已取消' });
      }, 10000); // 10 seconds
    }
    return () => clearTimeout(timer);
  }, [punchMathChallenge]);

  const todayStr = TimeService.getTaiwanDate(now);
  const currentTimeStr = TimeService.getTaiwanTime(now);
  
  const lastRecord = records.length > 0 ? records[0] : null;
  const currentPunchType = lastRecord?.type === 'in' ? 'out' : 'in';
  
  const isLocationReady = distance !== null;
  const inRange = isLocationReady && distance! <= settings.allowedRadius;

  const initiatePunch = () => {
    if (!isTimeSynced) {
        setNotification({ type: 'error', message: "無法連接網路時間伺服器，禁止打卡，請檢查網路連線。" });
        return;
    }
    if (Math.abs(timeOffset) > 60000) {
       setNotification({ type: 'error', message: "時間錯誤：系統偵測到您的裝置時間與標準時間誤差過大 (>1分鐘)，請校準裝置時間後再進行打卡。" });
       return;
    }
    if (!isLocationReady) {
      setNotification({ type: 'error', message: "定位中或無法定位，請確認已開啟 GPS" });
      return;
    }
    if (currentPunchType === 'in') {
        if (settings.companyLat && !inRange) {
           setNotification({ type: 'error', message: `距離公司過遠 (${distance?.toFixed(0)}m)，無法上班打卡` });
           return;
        }
    }

    setIsVerifying(true);
    setTimeout(() => {
        const n1 = Math.floor(Math.random() * 9) + 1;
        const n2 = Math.floor(Math.random() * 9) + 1;
        const ans = n1 + n2;
        const opts = [ans, ans + 1, ans - 1].sort(() => Math.random() - 0.5);
        setPunchMathChallenge({ q: `${n1} + ${n2} = ?`, a: ans, opts });
    }, 500); 
  };

  const executePunch = (choice: number) => {
    if (choice !== punchMathChallenge?.a) {
      setPunchMathChallenge(null);
      setIsVerifying(false);
      setNotification({ type: 'error', message: "驗證錯誤，打卡動作取消" });
      return;
    }
    setPunchMathChallenge(null);
    // isVerifying remains true

    let isCheckDone = false;
    const checkTimeout = setTimeout(() => {
        if (!isCheckDone) {
            isCheckDone = true;
            setIsVerifying(false);
            setNotification({ type: 'error', message: "核對超時 (超過20秒)，驗證失敗請重新驗證" });
        }
    }, 20000);

    const completePunch = (lat: number, lng: number) => {
        if (isCheckDone) return;
        isCheckDone = true;
        clearTimeout(checkTimeout);
        
        finishPunch('正常', lat, lng);
    };

    // Get fresh position with High Accuracy
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            completePunch(pos.coords.latitude, pos.coords.longitude);
        }, (err) => {
             console.warn("High accuracy geolocation failed", err);
             // If high accuracy fails, try standard but verify last known valid location
             if (distance !== null && settings.companyLat && settings.companyLng) {
                 completePunch(0, 0); 
             } else {
                 completePunch(0, 0);
             }
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); // maximumAge: 0 forces fresh reading
    } else {
        completePunch(0, 0);
    }
  };

  const finishPunch = async (status: string, lat: number, lng: number) => {
    let finalStatus = status;
    
    // Server-side check simulation: Re-verify distance with fresh coords
    if (settings.companyLat) {
        if (lat === 0 && lng === 0) {
             setNotification({ type: 'error', message: "無法獲取精確位置，請稍後再試" });
             setIsVerifying(false);
             return;
        }

        const freshDistance = getDistanceFromLatLonInM(lat, lng, settings.companyLat, settings.companyLng);
        setDistance(freshDistance); 

        if (currentPunchType === 'in' && freshDistance > settings.allowedRadius) {
             setNotification({ type: 'error', message: `即時定位距離過遠 (${freshDistance.toFixed(0)}m)，打卡失敗` });
             setIsVerifying(false);
             return;
        }

        if (currentPunchType === 'out' && freshDistance > settings.allowedRadius) {
            finalStatus = '地點異常';
        }
    }

    const newRecord: AttendanceRecord = {
      id: Date.now(),
      userId: user.id,
      uid: user.uid, // Security: Critical for Firestore Rules
      userName: user.name,
      date: todayStr,
      time: currentTimeStr,
      type: currentPunchType,
      status: finalStatus,
      lat: lat, 
      lng: lng, 
      dist: settings.companyLat ? getDistanceFromLatLonInM(lat, lng, settings.companyLat, settings.companyLng) : 0
    };

    try {
        await StorageService.addRecord(newRecord);
        
        if (finalStatus === '地點異常') {
            setNotification({ type: 'success', message: `下班打卡成功 (注意：您在打卡範圍外)` });
        } else {
            setNotification({ type: 'success', message: `${currentPunchType === 'in' ? '上班' : '下班'}打卡成功！` });
        }
    } catch (e) {
        console.error("Punch Error:", e);
        setNotification({ type: 'error', message: "打卡失敗：無法寫入資料庫，請檢查網路連線或權限" });
    }
    
    setIsVerifying(false);
  };

  const allLeaves = localData.leaves.filter(l => l.userId === user.id).sort((a,b) => b.id - a.id);
  const recentLeave = allLeaves.length > 0 ? allLeaves[0] : null;
  
  const allOvertime = localData.overtimes.filter(o => o.userId === user.id).sort((a,b) => b.id - a.id);
  const recentOT = allOvertime.length > 0 ? allOvertime[0] : null;

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
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] w-[92%] md:w-auto md:max-w-xl px-6 py-4 rounded-[28px] shadow-2xl flex items-center justify-center gap-3 font-black text-base md:text-lg border-4 transition-all duration-300 break-words text-center leading-snug ${notification.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}>
           {notification.type === 'success' ? <CheckCircle size={28} className="flex-shrink-0" /> : <AlertTriangle size={28} className="flex-shrink-0" />}
           <span className="flex-1">{notification.message}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-4 md:p-8 gap-4 md:gap-8 items-stretch relative mb-16 md:mb-0">
        
        {/* Punch Section (Left) */}
        <div className={`w-full md:w-1/2 flex-col h-full flex-shrink-0 ${mobileView === 'punch' ? 'flex' : 'hidden md:flex'}`}>
            <div className="flex-1 bg-white rounded-[32px] md:rounded-[40px] shadow-sm border p-6 md:p-12 flex flex-col items-center justify-start space-y-6 md:space-y-8 overflow-y-auto custom-scroll relative h-full">
              <div className="text-center w-full pb-4 md:pb-6 border-b border-gray-100">
                 <div className="text-brand-600 font-black text-lg md:text-2xl mb-1 md:mb-2">{TimeService.toROCDateString(now)}</div>
                 <div className="text-5xl md:text-7xl font-mono font-black tracking-tighter text-gray-800">
                   {currentTimeStr}
                 </div>
              </div>

              <div className="flex flex-col items-center w-full max-w-sm">
                <Button 
                  variant="tech-circle" 
                  onClick={initiatePunch}
                  disabled={!isTimeSynced || !isLocationReady || isVerifying}
                  className={`w-48 h-48 md:w-64 md:h-64 rounded-full border-[8px] md:border-[12px] shadow-2xl transition-all duration-500 mb-6 md:mb-8 aspect-square ${(!isTimeSynced || !isLocationReady || isVerifying) ? 'from-gray-400 to-gray-500 grayscale opacity-80 cursor-not-allowed' : currentPunchType === 'in' ? 'from-brand-500 to-brand-700 border-brand-100' : 'from-red-500 to-red-700 border-red-100'}`}
                >
                  {!isTimeSynced ? (
                     <div className="flex flex-col items-center">
                       <Loader2 size={40} className="animate-spin text-white mb-2" />
                       <span className="text-xl md:text-2xl font-black text-white">連線中...</span>
                     </div>
                  ) : !isLocationReady ? (
                     <div className="flex flex-col items-center">
                       <Loader2 size={40} className="animate-spin text-white mb-2" />
                       <span className="text-xl md:text-2xl font-black text-white">定位中...</span>
                     </div>
                  ) : isVerifying ? (
                     <div className="flex flex-col items-center">
                       <Loader2 size={40} className="animate-spin text-white mb-2" />
                       <span className="text-xl md:text-2xl font-black text-white">資料核對中...</span>
                     </div>
                  ) : (
                     <>
                        <Zap size={48} className="text-white fill-white animate-pulse mb-2 md:mb-4 md:w-16 md:h-16" />
                        <span className="text-3xl md:text-5xl font-black tracking-widest text-white">
                            {currentPunchType === 'in' ? '上班' : '下班'}
                        </span>
                     </>
                  )}
                </Button>
                
                <div className={`w-full py-3 md:py-4 px-4 md:px-6 rounded-2xl font-black flex items-center justify-center gap-2 md:gap-3 shadow-md transition-all text-sm md:text-xl ${
                    gpsError ? 'bg-red-100 text-red-600' :
                    (!isTimeSynced) ? 'bg-orange-100 text-orange-600' :
                    !isLocationReady ? 'bg-gray-100 text-gray-400' : 
                    settings.companyLat ? (inRange ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 
                    'bg-gray-100 text-gray-400'
                }`}>
                   <MapPin size={20} className={`md:w-6 md:h-6 ${(!isTimeSynced || (!isLocationReady && !gpsError)) ? 'animate-bounce' : ''}`} />
                   {gpsError ? (
                     <span>{gpsError}</span>
                   ) : !isTimeSynced ? (
                     <span className="animate-pulse">正在校正系統時間...</span>
                   ) : !isLocationReady ? (
                     <span className="animate-pulse">正在獲取位置...</span>
                   ) : settings.companyLat ? (
                     <span>距離：{distance?.toFixed(1) || '--'} m ({inRange ? '範圍內' : '範圍外'})</span>
                   ) : (
                     <span>管理員尚未設定座標 (不限距離)</span>
                   )}
                </div>
              </div>

              <div className="w-full max-w-xl p-4 md:p-6 bg-gray-50 rounded-[24px] md:rounded-[32px] border border-gray-100">
                <div className="flex justify-between items-center mb-3 md:mb-5">
                  <h4 className="text-xs md:text-sm font-black text-gray-400 uppercase tracking-widest">最近打卡紀錄 (近2筆)</h4>
                  <button type="button" onClick={() => setShowPunchHistory(true)} className="text-xs font-black text-brand-600 hover:underline relative z-10 cursor-pointer p-1">查看更多紀錄</button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:gap-3">
                  {records.slice(0, 2).map((r) => (
                    <RecordItem key={r.id} r={r} />
                  ))}
                  {records.length === 0 && <div className="p-6 md:p-10 text-center text-gray-300 italic">尚無打卡紀錄</div>}
                </div>
              </div>

              {/* Reminder Text */}
              <div className="mt-auto w-full text-center pb-2">
                 <p className="text-red-500 font-black text-sm md:text-base animate-pulse">※ 請確認有打卡紀錄後再離開公司</p>
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
                             <input type="date" value={leaveForm.startDate} className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-300 transition-all [color-scheme:light]" onChange={e => setLeaveForm({...leaveForm, startDate: e.target.value})} />
                           </div>
                           <div className="space-y-2">
                             <label className="text-xs font-black text-gray-400">結束日期</label>
                             <input type="date" value={leaveForm.endDate} className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-300 transition-all [color-scheme:light]" onChange={e => setLeaveForm({...leaveForm, endDate: e.target.value})} />
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
                           id: Date.now(), 
                           userId: user.id, 
                           uid: user.uid, // Security
                           userName: user.name, 
                           type: leaveForm.type,
                           start: `${leaveForm.startDate} ${leaveForm.startTime}`, 
                           end: `${leaveForm.endDate} ${leaveForm.endTime}`,
                           hours: calculatedHours, 
                           reason: leaveForm.reason, 
                           status: 'pending', 
                           created_at: new Date().toLocaleString()
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
                       <button type="button" onClick={() => setShowLeaveHistory(true)} className="text-xs font-black text-brand-600 hover:underline relative z-10 cursor-pointer p-1">歷史紀錄查詢</button>
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
                               {TimeService.formatDateTime(recentLeave.start)} ~ {TimeService.formatDateTime(recentLeave.end)}
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
                                <Clock size={12}/> 申請於：{TimeService.formatDateTime(recentLeave.created_at, true)}
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
                               <input type="date" className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-indigo-300 transition-all [color-scheme:light]" onChange={e=>setOtForm({...otForm, startDate: e.target.value})} value={otForm.startDate} required />
                             </div>
                             <div className="space-y-2">
                               <label className="text-xs font-black text-gray-400">結束日期</label>
                               <input type="date" className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-indigo-300 transition-all [color-scheme:light]" onChange={e=>setOtForm({...otForm, endDate: e.target.value})} value={otForm.endDate} required />
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
                               id: Date.now(), 
                               userId: user.id, 
                               uid: user.uid, // Security
                               userName: user.name,
                               start: `${otForm.startDate} ${otForm.startTime}`, 
                               end: `${otForm.endDate} ${otForm.endTime}`, 
                               hours: calculatedOTHours, 
                               reason: otForm.reason,
                               status: 'pending', 
                               created_at: new Date().toLocaleString()
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
                       <button type="button" onClick={() => setShowOTHistory(true)} className="text-xs font-black text-indigo-600 hover:underline relative z-10 cursor-pointer p-1">歷史紀錄查詢</button>
                     </div>
                     {recentOT ? (
                       <div className="flex flex-col gap-4">
                         <div className="flex justify-between items-start">
                           <div className="space-y-2 flex-1">
                             <div className="text-lg md:text-xl font-black text-indigo-600 underline underline-offset-4 decoration-2">
                                {recentOT.hours} 小時
                             </div>
                             <div className="text-xs md:text-sm text-gray-500 font-mono bg-gray-50 px-3 py-1 rounded-lg inline-block">
                               {TimeService.formatDateTime(recentOT.start)} ~ {TimeService.formatDateTime(recentOT.end)}
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
                                <Clock size={12}/> 申請於：{TimeService.formatDateTime(recentOT.created_at, true)}
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

      {/* Mobile Navigation */}
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

      {/* Modals - Unchanged logic, omitted for brevity as they don't affect record creation structure ... */}
      
      {/* 1. Punch Math Challenge Modal (Restored) */}
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
              <button className="w-full py-3 md:py-4 text-gray-400 font-black hover:text-gray-600 transition-colors" onClick={()=>{setPunchMathChallenge(null); setIsVerifying(false);}}>取消本次打卡</button>
           </div>
        </div>
      )}

      {/* 2. Cancel Leave/OT Challenge Modal */}
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
                  <button key={idx} onClick={() => executeCancelRequest(opt)} className="p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[20px] md:rounded-[24px] text-2xl md:text-3xl font-black text-red-600 hover:bg-red-600 hover:text-white transition-all shadow-md">{opt}</button>
                ))}
              </div>
              <button className="w-full py-3 md:py-4 text-gray-400 font-black hover:text-gray-600 transition-colors" onClick={()=>setCancelLeaveChallenge(null)}>保留申請</button>
           </div>
        </div>
      )}

      {/* 3. Punch History Modal */}
      {showPunchHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-10 w-full max-w-md shadow-2xl font-bold flex flex-col max-h-[85vh]">
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-gray-800"><Clock className="text-brand-500"/> 打卡歷史紀錄</h3>
                 <button onClick={() => setShowPunchHistory(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><XCircle size={20}/></button>
              </div>

              {/* Filters for Punch History */}
              <div className="mb-4 bg-gray-50 p-4 rounded-2xl space-y-3">
                 <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Filter size={12}/> 篩選條件 (可查三個月內)</div>
                 <div className="flex gap-2">
                    <input type="date" value={punchFilterStart} onChange={e=>setPunchFilterStart(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="開始" />
                    <span className="self-center text-gray-300">~</span>
                    <input type="date" value={punchFilterEnd} onChange={e=>setPunchFilterEnd(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="結束" />
                 </div>
                 <div className="flex justify-end">
                     <button onClick={()=>{setPunchFilterStart(''); setPunchFilterEnd('');}} className="text-xs bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-lg text-gray-600 flex items-center gap-1"><RotateCcw size={10}/> 清除篩選</button>
                 </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll space-y-3">
                 {records
                    .filter(r => {
                       if (punchFilterStart && r.date < punchFilterStart) return false;
                       if (punchFilterEnd && r.date > punchFilterEnd) return false;
                       return true;
                    })
                    .map(r => (
                    <div key={r.id} className="p-4 bg-gray-50 border rounded-2xl flex items-center justify-between">
                       <div>
                          <div className="text-xs font-black text-gray-400">{TimeService.getTaiwanDate(r.date)}</div>
                          <div className={`text-sm font-black ${r.type==='in'?'text-brand-600':'text-red-600'}`}>{r.type==='in'?'上班':'下班'}</div>
                       </div>
                       <div className="flex-1 text-center">
                          <div className="text-xl font-mono font-black text-gray-800">{TimeService.formatTimeOnly(r.time, true)}</div>
                       </div>
                       <div className="flex flex-col items-end gap-1 min-w-[60px]">
                          <div className={`px-2 py-0.5 rounded text-[10px] text-white text-center w-full font-black ${r.type === 'in' ? 'bg-green-600' : 'bg-red-600'}`}>
                            成功
                          </div>
                          {r.status.includes('異常') && <span className="text-[9px] text-red-500 font-bold">地點異常</span>}
                       </div>
                    </div>
                 ))}
                 {records.filter(r => {
                       if (punchFilterStart && r.date < punchFilterStart) return false;
                       if (punchFilterEnd && r.date > punchFilterEnd) return false;
                       return true;
                 }).length === 0 && <div className="text-center text-gray-400 py-10">無歷史紀錄</div>}
              </div>
           </div>
        </div>
      )}

      {/* 4. Leave History Modal (Unchanged logic) */}
      {showLeaveHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-10 w-full max-w-lg shadow-2xl font-bold flex flex-col max-h-[85vh]">
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-gray-800"><Calendar className="text-brand-500"/> 請假歷史紀錄</h3>
                 <button onClick={() => setShowLeaveHistory(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><XCircle size={20}/></button>
              </div>

              {/* Filters */}
              <div className="mb-4 bg-gray-50 p-4 rounded-2xl space-y-3">
                 <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Filter size={12}/> 篩選條件</div>
                 <div className="flex gap-2">
                    <input type="date" value={historyFilterStart} onChange={e=>setHistoryFilterStart(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="開始" />
                    <span className="self-center text-gray-300">~</span>
                    <input type="date" value={historyFilterEnd} onChange={e=>setHistoryFilterEnd(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="結束" />
                 </div>
                 <div className="flex gap-2">
                    <select 
                      value={historyFilterType} 
                      onChange={(e) => setHistoryFilterType(e.target.value)}
                      className="w-full p-2 rounded-lg text-xs border outline-none font-black bg-white"
                    >
                      <option value="all">全部假別</option>
                      {LEAVE_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button onClick={()=>{setHistoryFilterStart(''); setHistoryFilterEnd(''); setHistoryFilterType('all');}} className="text-xs bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-lg text-gray-600 flex items-center gap-1 whitespace-nowrap"><RotateCcw size={10}/> 清除</button>
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll space-y-3">
                 {allLeaves
                    .filter(l => {
                        if (historyFilterType !== 'all' && l.type !== historyFilterType) return false;
                        if (historyFilterStart && l.start < historyFilterStart) return false;
                        if (historyFilterEnd && l.start > historyFilterEnd) return false;
                        return true;
                    })
                    .sort((a, b) => b.id - a.id)
                    .map(l => (
                    <div key={l.id} className="p-4 bg-white border border-gray-100 rounded-2xl space-y-2 hover:shadow-md transition-all">
                       <div className="flex justify-between items-start">
                          <div>
                             <span className={`px-2 py-0.5 rounded text-[10px] ${getLeaveStatusStyle(l.status)}`}>{getLeaveStatusText(l.status)}</span>
                             <div className="text-lg font-black text-brand-600 mt-1">{l.type} <span className="text-black text-sm">({l.hours}hr)</span></div>
                          </div>
                          {l.status === 'pending' && (
                             <button onClick={() => initiateCancelRequest(l.id, 'leave')} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={16}/></button>
                          )}
                       </div>
                       <div className="text-xs text-gray-500 font-mono bg-gray-50 p-2 rounded">
                          {TimeService.formatDateTime(l.start)} ~ <br/>{TimeService.formatDateTime(l.end)}
                       </div>
                       {l.reason && <div className="text-xs text-gray-600 pl-2 border-l-2 border-gray-200">備註：{l.reason}</div>}
                       {l.rejectReason && <div className="text-xs text-red-500 pl-2 border-l-2 border-red-200">拒絕原因：{l.rejectReason}</div>}
                       <div className="text-[10px] text-gray-400 text-right pt-2 border-t border-gray-50 mt-2">
                          申請時間：{TimeService.formatDateTime(l.created_at, true)}
                       </div>
                    </div>
                 ))}
                 {allLeaves.length === 0 && <div className="text-center text-gray-400 py-10">無請假紀錄</div>}
              </div>
           </div>
        </div>
      )}

      {/* 5. Overtime History Modal (Unchanged logic) */}
      {showOTHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-10 w-full max-w-lg shadow-2xl font-bold flex flex-col max-h-[85vh]">
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-gray-800"><BadgeCheck className="text-indigo-500"/> 加班歷史紀錄</h3>
                 <button onClick={() => setShowOTHistory(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><XCircle size={20}/></button>
              </div>

              {/* Filters */}
              <div className="mb-4 bg-gray-50 p-4 rounded-2xl space-y-3">
                 <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Filter size={12}/> 篩選條件</div>
                 <div className="flex gap-2">
                    <input type="date" value={otFilterStart} onChange={e=>setOtFilterStart(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="開始" />
                    <span className="self-center text-gray-300">~</span>
                    <input type="date" value={otFilterEnd} onChange={e=>setOtFilterEnd(e.target.value)} className="w-full p-2 rounded-lg text-xs border border-gray-200 outline-none font-black bg-white text-black [color-scheme:light]" placeholder="結束" />
                    <button onClick={()=>{setOtFilterStart(''); setOtFilterEnd('');}} className="text-xs bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-lg text-gray-600 flex items-center gap-1 whitespace-nowrap"><RotateCcw size={10}/> 清除</button>
                 </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scroll space-y-3">
                 {allOvertime
                    .filter(o => {
                        if (otFilterStart && o.start < otFilterStart) return false;
                        if (otFilterEnd && o.start > otFilterEnd) return false;
                        return true;
                    })
                    .sort((a, b) => b.id - a.id)
                    .map(o => (
                    <div key={o.id} className="p-4 bg-white border border-gray-100 rounded-2xl space-y-2 hover:shadow-md transition-all">
                       <div className="flex justify-between items-start">
                          <div>
                             <span className={`px-2 py-0.5 rounded text-[10px] ${getLeaveStatusStyle(o.status)}`}>{getLeaveStatusText(o.status)}</span>
                             <div className="text-lg font-black text-indigo-600 mt-1">加班 <span className="text-black text-sm">({o.hours}hr)</span></div>
                          </div>
                          {o.status === 'pending' && (
                             <button onClick={() => initiateCancelRequest(o.id, 'ot')} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={16}/></button>
                          )}
                       </div>
                       <div className="text-xs text-gray-500 font-mono bg-gray-50 p-2 rounded">
                          {TimeService.formatDateTime(o.start)} ~ <br/>{TimeService.formatDateTime(o.end)}
                       </div>
                       {o.reason && <div className="text-xs text-gray-600 pl-2 border-l-2 border-gray-200">備註：{o.reason}</div>}
                       {o.rejectReason && <div className="text-xs text-red-500 pl-2 border-l-2 border-red-200">拒絕原因：{o.rejectReason}</div>}
                       {o.adminNote && <div className="text-xs text-brand-600 pl-2 border-l-2 border-brand-200">管理員備註：{o.adminNote}</div>}
                       <div className="text-[10px] text-gray-400 text-right pt-2 border-t border-gray-50 mt-2">
                          申請時間：{TimeService.formatDateTime(o.created_at, true)}
                       </div>
                    </div>
                 ))}
                 {allOvertime.length === 0 && <div className="text-center text-gray-400 py-10">無加班紀錄</div>}
              </div>
           </div>
        </div>
      )}

      {/* Photo Viewer Modal */}
      {viewPhotoUrl && (
        <div className="fixed inset-0 bg-black/90 z-[3000] flex items-center justify-center p-4 cursor-pointer" onClick={() => setViewPhotoUrl(null)}>
           <div className="relative max-w-full max-h-full">
              <img src={viewPhotoUrl} alt="Proof" className="rounded-2xl shadow-2xl max-w-[90vw] max-h-[80vh] border-4 border-white" />
              <div className="absolute top-2 right-2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-all">
                 <XCircle size={24} />
              </div>
           </div>
        </div>
      )}

    </div>
  );
};
