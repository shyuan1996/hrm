
import React, { useState, useEffect, useRef } from 'react';
import { User, OvertimeRequest, Announcement, UserRole } from '../types';
import { StorageService, AppData } from '../services/storageService';
import { TimeService } from '../services/timeService';
import { Button } from './ui/Button';
import { auth } from '../services/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { 
  LayoutDashboard, CalendarCheck, Settings, 
  CheckCircle, XCircle, Megaphone, Palmtree, Database, 
  Trash2, Clock, Globe, Bold, Italic, Underline, Edit3, UserMinus, Archive, RotateCcw, UserPlus, Palette, UserCog, Calendar as CalendarIcon, Info, Download, FileText, AlertTriangle, Sliders, Calculator, MapPin, Mail
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [activeView, setActiveView] = useState<'overview' | 'leaves' | 'ot' | 'news' | 'holiday' | 'system'>('overview');
  const [showArchived, setShowArchived] = useState(false);
  const [data, setData] = useState<AppData>(StorageService.loadData());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  
  // Overview Date Filter
  const [overviewDate, setOverviewDate] = useState(TimeService.getTaiwanDate(new Date()));

  // Modals & Forms
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  // Loading state for async actions
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Export All Attendance Modal
  const [isExportAttendanceModalOpen, setIsExportAttendanceModalOpen] = useState(false);
  const [attExportStart, setAttExportStart] = useState('');
  const [attExportEnd, setAttExportEnd] = useState('');
  
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: '', dept: '' });
  const [addUserForm, setAddUserForm] = useState({ id: '', pass: '', name: '', dept: '' });
  
  // Settings Modal State
  const [settingsForm, setSettingsForm] = useState({
    onboardDate: '',
    quotaAnnual: 0,
    quotaBirthday: 0,
    quotaComp: 0
  });
  const [seniorityCalc, setSeniorityCalc] = useState('');

  // Edit Overtime Modal
  const [editOtModal, setEditOtModal] = useState<OvertimeRequest | null>(null);
  const [editOtForm, setEditOtForm] = useState({ start: '', end: '', reason: '', hours: 0 });

  // Rejection Modal
  const [rejectModal, setRejectModal] = useState<{ id: number, type: 'leave' | 'ot' } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Permanent Delete Modal
  const [deleteTarget, setDeleteTarget] = useState<{ id: string | number, type: 'user' | 'leave' | 'ot' | 'announcement' | 'holiday' } | null>(null);
  const [mathChallenge, setMathChallenge] = useState({ q: '', a: 0, opts: [] as number[] });

  // Export Date Range (Leave/OT specific)
  const [exportStart, setExportStart] = useState('');
  const [exportEnd, setExportEnd] = useState('');

  // History Filter Dates
  const [leaveHistoryFilterDate, setLeaveHistoryFilterDate] = useState('');
  const [otHistoryFilterDate, setOtHistoryFilterDate] = useState('');

  // Announcements
  const [editAnnId, setEditAnnId] = useState<number | null>(null);
  const [annContent, setAnnContent] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  // Holiday Filter
  const [holidayFilterMonth, setHolidayFilterMonth] = useState<string>('');

  const pendingLeaves = data.leaves.filter(l => l.status === 'pending').length;
  const pendingOTs = data.overtimes.filter(o => o.status === 'pending').length;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    // Subscribe to storage updates locally to avoid parent remounting us
    const handleDataUpdate = () => {
        // CRITICAL: Spread object to force React re-render
        setData({ ...StorageService.loadData() });
    };
    window.addEventListener('storage-update', handleDataUpdate);

    return () => {
        clearInterval(timer);
        window.removeEventListener('storage-update', handleDataUpdate);
    };
  }, []);

  useEffect(() => {
    let timer: any;
    if (deleteTarget) {
      timer = setTimeout(() => {
        setDeleteTarget(null);
        showToast("超時未回答，已取消刪除操作", 'error');
      }, 10000);
    }
    return () => clearTimeout(timer);
  }, [deleteTarget]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const getErrorMessage = (e: any) => {
      if (e.code === 'permission-denied') {
          return '權限不足 (Permission Denied)：請檢查 Firestore Rules 中的 isAdmin() 是否正確指向 users/admin';
      }
      return e.message || '未知錯誤';
  };

  const refreshData = () => setData({ ...StorageService.loadData() });

  const handleAction = async (type: 'leave' | 'ot', id: number, status: 'approved' | 'rejected', reason?: string) => {
    try {
        if (type === 'leave') await StorageService.updateLeaveStatus(id, status, reason);
        else await StorageService.updateOvertimeStatus(id, status, reason);
        refreshData();
        showToast("操作成功", 'success');
        setRejectModal(null);
        setRejectReason('');
    } catch (e: any) {
        showToast("操作失敗: " + getErrorMessage(e), 'error');
    }
  };

  // Trigger Delete Challenge
  const confirmDelete = (id: string | number, type: 'user' | 'leave' | 'ot' | 'announcement' | 'holiday') => {
    const n1 = Math.floor(Math.random() * 9) + 1;
    const n2 = Math.floor(Math.random() * 9) + 1;
    const ans = n1 + n2;
    const opts = [ans, ans + 1, ans - 1].sort(() => Math.random() - 0.5);
    setMathChallenge({ q: `${n1} + ${n2} = ?`, a: ans, opts });
    setDeleteTarget({ id, type });
  };

  const handleDeleteResponse = async (choice: number) => {
    if (choice === mathChallenge.a && deleteTarget) {
      try {
          if (deleteTarget.type === 'user') await StorageService.permanentDeleteUser(deleteTarget.id as string);
          else if (deleteTarget.type === 'leave') await StorageService.deleteLeave(deleteTarget.id as number);
          else if (deleteTarget.type === 'ot') await StorageService.deleteOvertime(deleteTarget.id as number);
          else if (deleteTarget.type === 'announcement') await StorageService.removeAnnouncement(deleteTarget.id as number);
          else if (deleteTarget.type === 'holiday') await StorageService.removeHoliday(deleteTarget.id as number);
          
          refreshData();
          showToast("資料已刪除", 'success');
      } catch (e: any) {
          showToast("刪除失敗: " + getErrorMessage(e), 'error');
      }
    } else {
      showToast("驗證錯誤，取消操作", 'error');
    }
    setDeleteTarget(null);
  };

  const openEditUserModal = (user: User) => {
    setTargetUser(user);
    setEditUserForm({ name: user.name, dept: user.dept });
    setIsEditUserModalOpen(true);
  };

  const openSettingsModal = (user: User) => {
    setTargetUser(user);
    setSettingsForm({
        onboardDate: user.onboard_date || '',
        quotaAnnual: user.quota_annual || 0,
        quotaBirthday: user.quota_birthday || 0,
        quotaComp: user.quota_comp || 0
    });
    calculateSeniority(user.onboard_date || '');
    setIsSettingsModalOpen(true);
  };

  const calculateSeniority = (dateStr: string) => {
    if (!dateStr) {
        setSeniorityCalc('');
        return;
    }
    const start = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    const years = diffDays / 365;

    let suggestedDays = 0;
    if (years >= 0.5 && years < 1) suggestedDays = 3;
    else if (years >= 1 && years < 2) suggestedDays = 7;
    else if (years >= 2 && years < 3) suggestedDays = 10;
    else if (years >= 3 && years < 5) suggestedDays = 14;
    else if (years >= 5 && years < 10) suggestedDays = 15;
    else if (years >= 10) {
        suggestedDays = 15 + Math.floor(years - 10);
        if (suggestedDays > 30) suggestedDays = 30;
    }

    setSeniorityCalc(`年資約 ${years.toFixed(1)} 年，依法規建議特休：${suggestedDays * 8} 小時 (${suggestedDays} 天)`);
  };

  const handleSaveSettings = async () => {
    if (!targetUser) return;
    try {
        await StorageService.updateUser(targetUser.id, {
            onboard_date: settingsForm.onboardDate,
            quota_annual: Number(settingsForm.quotaAnnual),
            quota_birthday: Number(settingsForm.quotaBirthday),
            quota_comp: Number(settingsForm.quotaComp)
        });
        setIsSettingsModalOpen(false);
        refreshData();
        showToast("員工額度設定已更新", 'success');
    } catch (e: any) {
        showToast("設定更新失敗: " + getErrorMessage(e), 'error');
    }
  };

  const handleExportSingleUser = (userId: string) => {
    const userLeaves = data.leaves.filter(l => l.userId === userId);
    if (userLeaves.length === 0) return alert("該員工無請假紀錄");

    let csv = "\uFEFF假別,開始時間,結束時間,時數,狀態,備註\n";
    userLeaves.forEach(l => {
       const statusMap: any = { pending: '審核中', approved: '已核准', rejected: '已拒絕', cancelled: '已取消' };
       const reason = l.reason ? String(l.reason) : '';
       csv += `${l.type},${TimeService.formatDateTime(l.start, true)},${TimeService.formatDateTime(l.end, true)},${l.hours},${statusMap[l.status]},${reason.replace(/,/g, ' ')}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `員工_${userId}_請假紀錄.csv`;
    link.click();
  };

  const handleExportAllAttendance = () => {
    if (!attExportStart || !attExportEnd) return showToast("請選擇匯出日期區間", "error");

    const filteredRecords = data.records.filter(r => r.date >= attExportStart && r.date <= attExportEnd);
    if (filteredRecords.length === 0) return showToast("該區間無打卡紀錄", "error");

    const enhancedRecords = filteredRecords.map(r => {
        const user = data.users.find(u => u.id === r.userId);
        return {
            ...r,
            dept: user ? user.dept : '未知'
        };
    });

    let csv = "\uFEFF打卡日期,員工帳號,員工姓名,部門,打卡時間,類型,距離(M),狀態\n";
    enhancedRecords.forEach(r => {
        const safeDate = TimeService.getTaiwanDate(r.date);
        csv += `${safeDate},${r.userId},${r.userName},${r.dept},${TimeService.formatTimeOnly(r.time, true)},${r.type==='in'?'上班':'下班'},${r.dist.toFixed(0)},${r.status}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `全體打卡紀錄_${attExportStart}_${attExportEnd}.csv`;
    link.click();
    setIsExportAttendanceModalOpen(false);
    showToast("匯出成功", 'success');
  };

  const handleEditUser = async () => {
    if (!targetUser) return;
    if (!editUserForm.name) return alert("姓名不得為空");

    const updates: Partial<User> = { name: editUserForm.name, dept: editUserForm.dept };

    try {
        await StorageService.updateUser(targetUser.id, updates);
        setIsEditUserModalOpen(false);
        setTargetUser(null);
        refreshData();
        showToast("員工資料更新成功", 'success');
    } catch (e: any) {
        showToast("更新失敗: " + getErrorMessage(e), 'error');
    }
  };

  const handleSendResetEmail = async () => {
      if(!targetUser) return;
      let email = targetUser.id;
      if (!email.includes('@')) {
          email = `${email}@shyuan-hrm.com`;
      }
      try {
          await sendPasswordResetEmail(auth, email);
          alert(`密碼重設信件已發送至：${email}\n請員工查收信件並設定新密碼。`);
      } catch (e: any) {
          alert("發送失敗: " + e.message);
      }
  };

  const handleAddUser = async () => {
    if (!addUserForm.id || !addUserForm.pass || !addUserForm.name) return showToast("請填寫必要欄位", 'error');
    const normalizedId = addUserForm.id.toLowerCase();
    
    // Check if ID exists in Firestore (UI check)
    if (data.users.some(u => u.id.toLowerCase() === normalizedId)) {
        showToast("帳號 ID 已存在，請更換", 'error');
        return;
    }

    setIsSubmitting(true);
    try {
        await StorageService.addUser({
          id: addUserForm.id, pass: addUserForm.pass, name: addUserForm.name, dept: addUserForm.dept || '未分配',
          role: UserRole.EMPLOYEE as any, 
          quota_annual: 0, 
          quota_birthday: 0, 
          quota_comp: 0 
        });
        
        setIsAddUserModalOpen(false);
        setAddUserForm({ id: '', pass: '', name: '', dept: '' });
        refreshData();
        showToast("員工新增成功，請設定其休假額度", 'success');
    } catch (error: any) {
        showToast("新增失敗: " + getErrorMessage(error), 'error');
    } finally {
        setIsSubmitting(false);
    }
  };

  const execFormat = (cmd: string, val: string = '') => {
    document.execCommand(cmd, false, val);
    if (editorRef.current) setAnnContent(editorRef.current.innerHTML);
  };

  const startEditAnn = (ann: Announcement) => {
    setEditAnnId(ann.id);
    setAnnContent(ann.content);
    if (editorRef.current) {
        editorRef.current.innerHTML = ann.content;
    }
    setTimeout(() => {
        const titleInput = document.getElementById('annTitle') as HTMLInputElement;
        const catInput = document.getElementById('annCat') as HTMLSelectElement;
        if (titleInput) titleInput.value = ann.title;
        if (catInput) catInput.value = ann.category;
    }, 0);
  };

  const handleAnnSave = async () => {
    const titleInput = document.getElementById('annTitle') as HTMLInputElement;
    const catInput = document.getElementById('annCat') as HTMLSelectElement;
    if (!titleInput.value || !annContent) return alert("請填寫標題與內容");
    
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    try {
        await StorageService.addAnnouncement({
          id: editAnnId || Date.now(), title: titleInput.value, content: annContent,
          category: catInput.value as any, date: dateStr, author: '管理員'
        });
        titleInput.value = '';
        setAnnContent('');
        if (editorRef.current) editorRef.current.innerHTML = '';
        setEditAnnId(null);
        refreshData();
        showToast("公告儲存成功", 'success');
    } catch (e: any) {
        showToast("公告發布失敗: " + getErrorMessage(e), 'error');
    }
  };

  const handleExport = (type: 'leave' | 'ot') => {
    if (!exportStart || !exportEnd) {
        showToast("請選擇匯出日期區間", 'error');
        return;
    }
    const items = type === 'leave' ? data.leaves : data.overtimes;
    
    const filtered = items.filter(i => {
      // 判斷是否重疊：ItemStart <= RangeEnd && ItemEnd >= RangeStart
      if (!i.start || !i.end) return false;
      
      const itemStartDay = i.start.replace('T', ' ').split(' ')[0];
      const itemEndDay = i.end.replace('T', ' ').split(' ')[0];

      return itemStartDay <= exportEnd && itemEndDay >= exportStart;
    });

    if (filtered.length === 0) return showToast("該區間無資料", "error");

    const getStatusText = (s: string) => {
       const map: any = { pending: '審核中', approved: '已核准', rejected: '已拒絕', cancelled: '已取消' };
       return map[s] || s;
    };

    let csv = "\uFEFF申請人帳號,申請人姓名,類型/事由,開始時間,結束時間,時數,狀態,備註/原因\n";
    filtered.forEach((i: any) => {
        const startStr = TimeService.formatDateTime(i.start, true);
        const endStr = TimeService.formatDateTime(i.end, true);
        const reason = i.reason ? String(i.reason) : '';
        const exportType = type === 'leave' ? i.type : '加班';
        csv += `${i.userId},${i.userName},${exportType},${startStr},${endStr},${i.hours},${getStatusText(i.status)},${reason.replace(/,/g, ' ')}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${type === 'leave' ? '請假' : '加班'}資料匯出_${exportStart}_${exportEnd}.csv`;
    link.click();
    showToast("匯出成功", 'success');
  };

  const getEmployeeStatus = (uid: string, targetDateStr: string) => {
    const userRecords = data.records.filter(r => r.userId === uid && TimeService.getTaiwanDate(r.date) === targetDateStr);
    
    // Check for approved leaves on this specific date
    const userLeaves = data.leaves.filter(l => 
        l.userId === uid && 
        l.status === 'approved' && 
        l.start.substring(0, 10) <= targetDateStr && 
        l.end.substring(0, 10) >= targetDateStr
    );
    
    // Check if target date is a holiday or weekend
    const checkDay = new Date(targetDateStr);
    const dayOfWeek = checkDay.getDay();
    const isHoliday = data.holidays.some(h => TimeService.getTaiwanDate(h.date) === targetDateStr) || dayOfWeek === 0 || dayOfWeek === 6;

    const firstIn = userRecords.filter(r => r.type === 'in').sort((a,b) => a.time.localeCompare(b.time))[0];
    const lastOut = userRecords.filter(r => r.type === 'out').sort((a,b) => b.time.localeCompare(a.time))[0];

    const statusTags: { label: string, color: string }[] = [];

    // 1. Leave Status Priority
    if (userLeaves.length > 0) {
        // Use the type of the first leave found
        statusTags.push({ label: userLeaves[0].type, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' });
    }

    // 2. Attendance Status
    if (isHoliday) {
        if (firstIn) {
            statusTags.push({ label: '休假日加班', color: 'text-orange-600 bg-orange-50 border-orange-200' });
        } else if (userLeaves.length === 0) {
            statusTags.push({ label: '休假', color: 'text-green-600 bg-green-50 border-green-200' });
        }
    }

    if (firstIn) {
        const inTimeStr = TimeService.formatTimeOnly(firstIn.time);
        
        if (!isHoliday) {
            if (!userLeaves.some(l => l.type !== '補休')) { // Don't show "Working" if on full day leave, unless it's partial? Simplified logic here.
                 statusTags.push({ label: '已上班', color: 'text-blue-600 bg-blue-50 border-blue-200' });
            }
            if (inTimeStr > '08:30') {
                 // Check if leave covers the morning
                 const morningLeave = userLeaves.some(l => l.start.includes(targetDateStr) && l.start.substring(11, 16) <= '08:30');
                 if (!morningLeave) {
                    statusTags.push({ label: '遲到', color: 'text-red-600 bg-red-50 border-red-200' });
                 }
            }
        }

        if (lastOut) {
            statusTags.push({ label: '已下班', color: 'text-gray-600 bg-gray-100 border-gray-300' });
            const outTimeStr = TimeService.formatTimeOnly(lastOut.time);
            
            if (!isHoliday) {
                if (outTimeStr < '17:30') {
                    // Check if leave covers the afternoon
                    const afternoonLeave = userLeaves.some(l => l.end.includes(targetDateStr) && l.end.substring(11, 16) >= '17:30');
                    if (!afternoonLeave) {
                        statusTags.push({ label: '早退', color: 'text-red-600 bg-red-50 border-red-200' });
                    }
                }
            }
        } else {
            // Only show "Overtime" if it's actually today and past 18:00
            const todayStr = TimeService.getTaiwanDate(new Date());
            if (targetDateStr === todayStr) {
                const nowH = new Date().getHours();
                if (nowH >= 18 && !isHoliday && userLeaves.length === 0) {
                    statusTags.push({ label: '加班中', color: 'text-purple-600 bg-purple-50 border-purple-200' });
                }
            }
        }
    } else {
        if (!isHoliday && userLeaves.length === 0) {
             const todayStr = TimeService.getTaiwanDate(new Date());
             // Only show Absent/Missing if looking at today (and late) or past dates
             if (targetDateStr < todayStr) {
                 statusTags.push({ label: '缺勤/未打卡', color: 'text-red-600 bg-red-50 border-red-200' });
             } else if (targetDateStr === todayStr) {
                 const nowStr = TimeService.getTaiwanTime(new Date());
                 const nowSimple = nowStr.substring(0, 5);
                 if (nowSimple > '08:30') {
                     statusTags.push({ label: '未到班', color: 'text-red-600 bg-red-50 border-red-200' });
                 } else {
                     statusTags.push({ label: '未打卡', color: 'text-gray-400 bg-gray-50 border-gray-200' });
                 }
             }
        }
    }

    // Deduplicate tags
    const uniqueTags = statusTags.filter((tag, index, self) =>
        index === self.findIndex((t) => (
            t.label === tag.label
        ))
    );

    // Prepare Display Data
    const inDisplay = firstIn ? `${TimeService.formatTimeOnly(firstIn.time, true)}` : '--';
    const outDisplay = lastOut ? `${TimeService.formatTimeOnly(lastOut.time, true)}` : '--';
    
    // Coordinates & Distance
    const inLoc = firstIn ? { lat: firstIn.lat, lng: firstIn.lng, dist: firstIn.dist } : null;
    const outLoc = lastOut ? { lat: lastOut.lat, lng: lastOut.lng, dist: lastOut.dist } : null;

    return { 
      tags: uniqueTags, 
      inTime: inDisplay, 
      outTime: outDisplay,
      inLoc,
      outLoc
    };
  };

  const saveOtEdit = async () => {
    if (!editOtModal) return;
    if (!editOtForm.reason) return alert("請填寫修改原因給員工查看");
    
    const s = new Date(editOtForm.start);
    const e = new Date(editOtForm.end);
    const h = parseFloat(((e.getTime() - s.getTime()) / 3600000).toFixed(1));

    try {
        await StorageService.updateOvertime(editOtModal.id, {
          start: editOtForm.start.replace('T', ' '),
          end: editOtForm.end.replace('T', ' '),
          hours: h,
          adminNote: editOtForm.reason
        });
        setEditOtModal(null);
        refreshData();
        showToast("加班資料已修正", 'success');
    } catch (e: any) {
        showToast("修正失敗: " + getErrorMessage(e), 'error');
    }
  };

  const navItems = [
    { id: 'overview', icon: LayoutDashboard, label: '總覽' },
    { id: 'leaves', icon: CalendarCheck, label: '請假', badge: pendingLeaves },
    { id: 'ot', icon: CheckCircle, label: '加班', badge: pendingOTs },
    { id: 'news', icon: Megaphone, label: '公告' },
    { id: 'holiday', icon: Palmtree, label: '假期' },
    { id: 'system', icon: Settings, label: '設定' },
  ];

  const rocYear = currentTime.getFullYear() - 1911;
  const dateStr = `${rocYear} 年 ${String(currentTime.getMonth()+1).padStart(2,'0')} 月 ${String(currentTime.getDate()).padStart(2,'0')} 日`;
  const westernDateStr = currentTime.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden relative">
      {toast && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] w-[92%] md:w-auto md:max-w-xl px-6 py-4 rounded-[28px] shadow-2xl flex items-center justify-center gap-3 font-black text-base md:text-lg border-4 transition-all duration-300 break-words text-center leading-snug ${toast.type === 'success' ? 'bg-green-500 border-green-400 text-white' : 'bg-red-500 border-red-400 text-white'}`}>
           {toast.type === 'success' ? <CheckCircle size={28} className="flex-shrink-0" /> : <AlertTriangle size={28} className="flex-shrink-0" />}
           <span className="flex-1">{toast.message}</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        <aside className="w-80 bg-white border-r hidden md:flex flex-col shadow-xl z-20">
          <div className="p-8 border-b text-black">
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Database className="text-brand-600" size={24}/> 考勤管理
            </h1>
            <div className="mt-6 p-5 bg-brand-50 rounded-[24px] space-y-4 border border-brand-100">
               <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-brand-600 font-black text-base">
                    <Globe size={18} /> 網路校時 <span className="text-[10px] text-gray-400">(timeapi.io)</span>
                  </div>
                  <div className="font-mono text-xl font-black text-gray-800 tracking-tighter">
                    {dateStr}
                  </div>
                  <div className="font-mono text-xs font-black text-gray-400 mt-[-2px]">
                    {westernDateStr}
                  </div>
                  <div className="font-mono text-xl font-black text-brand-700 mt-1">
                    {currentTime.toLocaleDateString('zh-TW', { weekday: 'long' })}
                  </div>
                  <div className="font-mono text-3xl font-black text-brand-800 mt-1">
                    {currentTime.toLocaleTimeString('zh-TW', { hour12: false })}
                  </div>
               </div>
               <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${data.settings.gasUrl ? "bg-green-500" : "bg-red-500"} animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]`}></div>
                  <span className={`text-xl font-black ${data.settings.gasUrl ? "text-green-600" : "text-red-500"}`}>
                    {data.settings.gasUrl ? "雲端已連線" : "雲端未連線"}
                  </span>
               </div>
            </div>
          </div>
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto font-bold">
            {navItems.map((item) => (
              <button key={item.id} onClick={() => setActiveView(item.id as any)} className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl text-sm font-black transition-all ${activeView === item.id ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-100'}`}>
                <div className="flex items-center gap-3">
                  <item.icon size={20}/> {item.label}
                </div>
                {item.badge && item.badge > 0 ? (
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${activeView === item.id ? 'bg-white text-brand-600' : 'bg-red-500 text-white animate-bounce'}`}>
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </aside>

        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-safe flex justify-around items-center h-16 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
           {navItems.map((item) => (
              <button key={item.id} onClick={() => setActiveView(item.id as any)} className={`flex flex-col items-center justify-center w-full h-full relative ${activeView === item.id ? 'text-brand-600' : 'text-gray-400'}`}>
                 <item.icon size={24} className={activeView === item.id ? 'fill-brand-100' : ''}/>
                 <span className="text-[10px] font-bold mt-1">{item.label}</span>
                 {item.badge && item.badge > 0 && (
                    <span className="absolute top-1 right-3 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-black animate-pulse">
                       {item.badge > 9 ? '9+' : item.badge}
                    </span>
                 )}
              </button>
           ))}
        </div>

        <main className="flex-1 overflow-auto p-4 md:p-12 pb-24 text-black font-bold custom-scroll">
          {/* Mobile Header for Time & Cloud Status */}
          <div className="md:hidden w-full mb-6 p-4 bg-brand-50 rounded-[24px] border border-brand-100 flex flex-col gap-2">
             <div className="flex justify-between items-start">
                <div className="flex flex-col">
                   <div className="text-brand-600 font-black text-xs flex items-center gap-1"><Globe size={12}/> 網路校時</div>
                   <div className="font-mono text-lg font-black text-gray-800">{dateStr}</div>
                   <div className="font-mono text-[10px] font-black text-gray-400">{westernDateStr}</div>
                </div>
                <div className="flex flex-col items-end">
                   <div className="font-mono text-2xl font-black text-brand-800">{currentTime.toLocaleTimeString('zh-TW', { hour12: false })}</div>
                   <div className="font-mono text-xs font-black text-brand-700">{currentTime.toLocaleDateString('zh-TW', { weekday: 'long' })}</div>
                </div>
             </div>
             <div className="flex items-center gap-2 mt-1 border-t border-brand-100 pt-2">
                <div className={`w-2 h-2 rounded-full ${data.settings.gasUrl ? "bg-green-500" : "bg-red-500"} animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]`}></div>
                <span className={`text-xs font-black ${data.settings.gasUrl ? "text-green-600" : "text-red-500"}`}>
                  {data.settings.gasUrl ? "雲端已連線" : "雲端未連線"}
                </span>
             </div>
          </div>

          {activeView === 'overview' && (
            <div className="space-y-6 md:space-y-8">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                 <h2 className="text-2xl md:text-3xl font-black text-gray-800">{showArchived ? '已封存員工' : '在職人員總覽'}</h2>
                 <div className="flex flex-wrap gap-2 md:gap-4 w-full md:w-auto items-center">
                     {/* Date Picker for Overview */}
                     <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-2xl border border-gray-200 shadow-sm">
                        <CalendarIcon size={16} className="text-gray-500"/>
                        <input 
                           type="date" 
                           value={overviewDate}
                           onChange={(e) => setOverviewDate(e.target.value)}
                           className="font-black outline-none text-xs md:text-sm bg-transparent text-black"
                           style={{colorScheme:'light'}}
                        />
                     </div>

                     <button onClick={() => setIsExportAttendanceModalOpen(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 md:px-6 py-2.5 rounded-2xl font-black bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all text-sm md:text-base">
                       <FileText size={18}/> <span className="hidden md:inline">匯出打卡紀錄</span><span className="md:hidden">匯出</span>
                     </button>
                     <button onClick={() => setShowArchived(!showArchived)} className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 md:px-6 py-2.5 rounded-2xl font-black transition-all border text-sm md:text-base ${showArchived ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                       {showArchived ? <LayoutDashboard size={18}/> : <Archive size={18}/>}
                       {showArchived ? '在職名冊' : '封存區'}
                     </button>
                     <button onClick={() => setIsAddUserModalOpen(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 md:px-6 py-2.5 rounded-2xl font-black bg-brand-600 text-white shadow-lg hover:bg-brand-700 transition-all text-sm md:text-base">
                       <UserPlus size={18}/> 新增
                     </button>
                 </div>
               </div>
               
               <div className="bg-white rounded-[24px] md:rounded-[40px] shadow-sm border overflow-hidden">
                 <div className="overflow-x-auto">
                   <table className="w-full text-left min-w-[800px]">
                      <thead className="bg-gray-50 text-xs font-black uppercase text-gray-400">
                         <tr><th className="p-4 md:p-6">帳號</th><th className="p-4 md:p-6">姓名</th><th className="p-4 md:p-6">部門</th><th className="p-4 md:p-6">上班打卡</th><th className="p-4 md:p-6">下班打卡</th><th className="p-4 md:p-6">狀態 ({overviewDate})</th><th className="p-4 md:p-6 text-right">操作</th></tr>
                      </thead>
                      <tbody className="divide-y text-black font-bold text-sm">
                         {data.users.filter(u => u.role !== 'admin' && (showArchived ? u.deleted : !u.deleted)).map(u => {
                            // Pass the selected date to get specific status
                            const status = getEmployeeStatus(u.id, overviewDate);
                            // Helper to render Location info
                            const renderLocInfo = (info: {lat: number, lng: number, dist: number} | null) => {
                                if(!info) return null;
                                const allowed = data.settings.allowedRadius;
                                const isFar = info.dist > (allowed + 50); // Specifically highlight if > 50m over
                                return (
                                    <div className="mt-1 space-y-0.5">
                                        <div className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                                            <MapPin size={10} /> {info.lat.toFixed(5)}, {info.lng.toFixed(5)}
                                        </div>
                                        <div className={`text-[10px] font-black ${isFar ? 'text-red-500 animate-pulse flex items-center gap-1' : 'text-gray-400'}`}>
                                            {isFar && <AlertTriangle size={10} />}
                                            距離: {info.dist.toFixed(0)}m
                                        </div>
                                    </div>
                                );
                            };

                            return (
                              <tr key={u.id} className="hover:bg-gray-50">
                                 <td className="p-4 md:p-6 font-mono font-black text-brand-600">{u.id}</td>
                                 <td className="p-4 md:p-6 font-black">{u.name}</td>
                                 <td className="p-4 md:p-6 text-gray-500">{u.dept}</td>
                                 <td className="p-4 md:p-6">
                                    <div className="font-mono text-xs font-black text-gray-800">{status.inTime}</div>
                                    {renderLocInfo(status.inLoc)}
                                 </td>
                                 <td className="p-4 md:p-6">
                                    <div className="font-mono text-xs font-black text-gray-800">{status.outTime}</div>
                                    {renderLocInfo(status.outLoc)}
                                 </td>
                                 <td className={`p-4 md:p-6`}>
                                   <div className="flex flex-wrap gap-2">
                                     {status.tags.length > 0 ? status.tags.map((tag, idx) => (
                                       <span key={idx} className={`px-2 py-0.5 rounded border text-xs font-bold whitespace-nowrap ${tag.color}`}>
                                         {tag.label}
                                       </span>
                                     )) : <span className="text-gray-400">--</span>}
                                   </div>
                                 </td>
                                 <td className="p-4 md:p-6 text-right flex justify-end gap-2">
                                    {!showArchived ? (
                                      <>
                                        <button onClick={() => openSettingsModal(u)} className="text-gray-600 hover:bg-gray-100 p-2 md:px-4 md:py-2 rounded-xl text-xs font-black border border-gray-200 transition-all flex items-center gap-1"><Sliders size={14}/> <span className="hidden md:inline">設定</span></button>
                                        <button onClick={() => openEditUserModal(u)} className="text-brand-600 hover:bg-brand-50 p-2 md:px-4 md:py-2 rounded-xl text-xs font-black border border-brand-100 transition-all flex items-center gap-1"><UserCog size={14}/> <span className="hidden md:inline">編輯</span></button>
                                        <button onClick={async () => { try { await StorageService.archiveUser(u.id); refreshData(); showToast("已將員工移至封存區", 'success'); } catch(e) { showToast("封存失敗", 'error'); } }} className="text-red-500 hover:bg-red-50 p-2 md:px-4 md:py-2 rounded-xl text-xs font-black border border-red-100 flex items-center gap-1 transition-all"><UserMinus size={14}/> <span className="hidden md:inline">封存</span></button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={async () => { try { await StorageService.restoreUser(u.id); refreshData(); showToast("員工已恢復權限", 'success'); } catch(e) { showToast("恢復失敗", 'error'); } }} className="text-green-600 hover:bg-green-50 px-4 py-2 rounded-xl text-xs font-black border border-green-100 flex items-center gap-1 transition-all"><RotateCcw size={14}/> 恢復</button>
                                        <button onClick={() => confirmDelete(u.id, 'user')} className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-black hover:bg-red-700 shadow-lg !text-white transition-all">永久刪除</button>
                                      </>
                                    )}
                                 </td>
                              </tr>
                            );
                         })}
                      </tbody>
                   </table>
                 </div>
               </div>
            </div>
          )}

          {activeView === 'leaves' && (
             <div className="space-y-8 md:space-y-12">
               {/* ... Keep existing Leaves content ... */}
               <div className="flex flex-col md:flex-row justify-between items-start md:items-end bg-white p-6 rounded-[24px] md:rounded-[32px] border gap-4">
                  <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-brand-600"><Clock size={24} className="md:w-7 md:h-7"/> 待審核假單</h3>
                  {/* ... same as before ... */}
                  <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                     <span className="text-xs font-black text-gray-400 w-full md:w-auto">匯出區間</span>
                     <div className="flex gap-2 w-full md:w-auto">
                        <input type="date" value={exportStart} onChange={e=>setExportStart(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1" style={{colorScheme:'light'}} />
                        <span className="text-gray-300 self-center">~</span>
                        <input type="date" value={exportEnd} onChange={e=>setExportEnd(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1" style={{colorScheme:'light'}} />
                     </div>
                     <button onClick={()=>handleExport('leave')} className="w-full md:w-auto bg-gray-100 text-gray-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-gray-200 flex items-center justify-center gap-1"><Download size={14}/> 匯出</button>
                  </div>
               </div>
               
               {/* List of Pending Leaves */}
               {data.leaves.filter(l => l.status === 'pending').length === 0 ? (
                 <div className="p-8 md:p-10 bg-white rounded-3xl text-gray-400 font-bold text-center border">目前無待審核項目</div>
               ) : (
                 <div className="grid gap-4 md:gap-6">
                    {data.leaves.filter(l => l.status === 'pending').map(leave => (
                       <div key={leave.id} className="bg-white p-6 rounded-[24px] md:rounded-3xl shadow-sm border flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                           {/* ... Leave Item ... */}
                          <div className="flex items-start md:items-center gap-4 w-full">
                             <div className="w-10 h-10 md:w-12 md:h-12 bg-brand-100 rounded-full flex items-center justify-center text-brand-600 font-black text-base md:text-lg flex-shrink-0">{leave.userName?.[0] || '?'}</div>
                             <div className="flex-1">
                                <div className="font-black text-base md:text-lg">
                                   <span className="font-mono text-gray-500 mr-2 text-sm md:text-base">{leave.userId}</span>
                                   {leave.userName} 
                                   <span className="ml-2 md:ml-3 bg-brand-600 text-white px-2 py-0.5 md:px-3 md:py-1 rounded-lg text-xs md:text-sm font-black tracking-wide shadow-md transform -skew-x-6 inline-block">{leave.type}</span>
                                </div>
                                <div className="text-xs md:text-sm text-gray-500 font-mono mt-1 md:mt-2 bg-gray-50 px-2 py-0.5 rounded inline-block">
                                   {TimeService.formatDateTime(leave.start)} ~ {TimeService.formatDateTime(leave.end)}
                                </div>
                                <div className="ml-0 md:ml-2 inline-block text-brand-600 font-black text-lg md:text-xl underline decoration-4 decoration-brand-200 underline-offset-4">({leave.hours}hr)</div>
                                <div className="text-xs md:text-sm text-gray-600 mt-2 pl-2 border-l-4 border-brand-200">{leave.reason}</div>
                                <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1"><Info size={12}/> 申請時間: {TimeService.formatDateTime(leave.created_at, true)}</div>
                             </div>
                          </div>
                          <div className="flex gap-2 w-full md:w-auto justify-end">
                             <button onClick={() => handleAction('leave', leave.id, 'approved')} className="flex-1 md:flex-none p-3 bg-green-100 text-green-600 rounded-2xl hover:bg-green-200 transition-all flex justify-center"><CheckCircle/></button>
                             <button onClick={() => setRejectModal({id: leave.id, type: 'leave'})} className="flex-1 md:flex-none p-3 bg-red-100 text-red-600 rounded-2xl hover:bg-red-200 transition-all flex justify-center"><XCircle/></button>
                          </div>
                       </div>
                    ))}
                 </div>
               )}

                {/* History */}
               <div>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-2">
                     <h3 className="text-xl md:text-2xl font-black text-gray-400">歷史審核紀錄</h3>
                     <div className="flex items-center gap-2 w-full md:w-auto">
                        <span className="text-xs font-black text-gray-400 whitespace-nowrap">顯示日期</span>
                        <input type="date" value={leaveHistoryFilterDate} onChange={e=>setLeaveHistoryFilterDate(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1 md:flex-none" style={{colorScheme:'light'}} />
                        <button onClick={()=>setLeaveHistoryFilterDate('')} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"><RotateCcw size={14} className="text-gray-500"/></button>
                     </div>
                  </div>
                  <div className="space-y-4">
                     {data.leaves
                       .filter(l => l.status !== 'pending')
                       .filter(l => {
                          if (!leaveHistoryFilterDate) return true;
                          const filterDate = leaveHistoryFilterDate;
                          const startDate = l.start.substring(0, 10);
                          const endDate = l.end.substring(0, 10);
                          return filterDate >= startDate && filterDate <= endDate;
                       })
                       .sort((a,b)=>b.id-a.id)
                       .map(leave => (
                        <div key={leave.id} className="bg-gray-50 p-6 rounded-[24px] md:rounded-3xl border flex flex-col gap-4 opacity-75 hover:opacity-100 transition-all group">
                           {/* ... Leave History Item ... */}
                           <div className="flex justify-between items-start">
                              <div className="flex items-start md:items-center gap-4">
                                 <span className={`px-2 py-1 md:px-3 rounded-xl text-[10px] md:text-xs font-black whitespace-nowrap ${leave.status === 'approved' ? 'bg-green-100 text-green-700' : leave.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`}>
                                    {leave.status === 'approved' ? '已核准' : leave.status === 'rejected' ? '已拒絕' : '已取消'}
                                 </span>
                                 <div>
                                    <div className="font-bold text-base md:text-lg">
                                       <span className="font-mono text-gray-400 mr-2 text-xs md:text-sm">{leave.userId}</span>
                                       {leave.userName} - <span className="text-brand-600 font-black">{leave.type}</span>
                                       <span className="ml-2 text-gray-800 font-black text-base md:text-lg">({leave.hours}小時)</span>
                                    </div>
                                    <div className="text-xs md:text-sm text-gray-500 mt-1 font-mono">
                                       {TimeService.formatDateTime(leave.start)} ~ {TimeService.formatDateTime(leave.end)}
                                    </div>
                                    <div className="text-xs md:text-sm text-gray-600 mt-1">事由：{leave.reason}</div>
                                    {leave.rejectReason && <div className="text-xs text-red-500 mt-1 font-bold">拒絕原因：{leave.rejectReason}</div>}
                                    <div className="text-[10px] md:text-xs text-gray-400 mt-1">申請時間: {TimeService.formatDateTime(leave.created_at, true)}</div>
                                 </div>
                              </div>
                              <button onClick={() => confirmDelete(leave.id, 'leave')} className="text-gray-300 hover:text-red-500 transition-colors p-2"><Trash2 size={18} className="md:w-5 md:h-5"/></button>
                           </div>
                        </div>
                     ))}
                     {data.leaves.filter(l => l.status !== 'pending' && (!leaveHistoryFilterDate || (leaveHistoryFilterDate >= l.start.substring(0, 10) && leaveHistoryFilterDate <= l.end.substring(0, 10)))).length === 0 && (
                        <div className="text-center text-gray-300 py-4 italic">無符合條件的歷史紀錄</div>
                     )}
                  </div>
               </div>
             </div>
          )}

          {activeView === 'ot' && (
              <div className="space-y-8 md:space-y-12">
               {/* ... Keep existing OT content ... */}
               <div className="flex flex-col md:flex-row justify-between items-start md:items-end bg-white p-6 rounded-[24px] md:rounded-[32px] border gap-4">
                  <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-indigo-600"><Clock size={24} className="md:w-7 md:h-7"/> 待審核加班</h3>
                  {/* ... same as before ... */}
                   <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                     <span className="text-xs font-black text-gray-400 w-full md:w-auto">匯出區間</span>
                     <div className="flex gap-2 w-full md:w-auto">
                        <input type="date" value={exportStart} onChange={e=>setExportStart(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1" style={{colorScheme:'light'}} />
                        <span className="text-gray-300 self-center">~</span>
                        <input type="date" value={exportEnd} onChange={e=>setExportEnd(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1" style={{colorScheme:'light'}} />
                     </div>
                     <button onClick={()=>handleExport('ot')} className="w-full md:w-auto bg-gray-100 text-gray-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-gray-200 flex items-center justify-center gap-1"><Download size={14}/> 匯出</button>
                  </div>
               </div>

               {/* Pending OTs */}
               {data.overtimes.filter(o => o.status === 'pending').length === 0 ? (
                 <div className="p-8 md:p-10 bg-white rounded-3xl text-gray-400 font-bold text-center border">目前無待審核項目</div>
               ) : (
                 <div className="grid gap-4 md:gap-6">
                    {data.overtimes.filter(o => o.status === 'pending').map(ot => (
                       <div key={ot.id} className="bg-white p-6 rounded-[24px] md:rounded-3xl shadow-sm border flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                          {/* ... OT Item ... */}
                          <div className="flex items-start md:items-center gap-4 w-full">
                             <div className="w-10 h-10 md:w-12 md:h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-black text-base md:text-lg flex-shrink-0">{ot.userName?.[0] || '?'}</div>
                             <div className="flex-1">
                                <div className="font-black text-base md:text-lg">
                                   <span className="font-mono text-gray-500 mr-2 text-sm md:text-base">{ot.userId}</span>
                                   {ot.userName} 
                                   <span className="ml-2 text-gray-400 text-xs md:text-sm">申請加班</span>
                                </div>
                                <div className="text-xs md:text-sm text-gray-500 font-mono mt-1 md:mt-2 bg-gray-50 px-2 py-0.5 rounded inline-block">
                                   {TimeService.formatDateTime(ot.start)} ~ {TimeService.formatDateTime(ot.end)}
                                </div>
                                <div className="ml-0 md:ml-2 inline-block text-indigo-600 font-black text-lg md:text-xl underline decoration-4 decoration-indigo-200 underline-offset-4">({ot.hours}hr)</div>
                                <div className="text-xs md:text-sm text-gray-600 mt-2 pl-2 border-l-4 border-indigo-200">{ot.reason}</div>
                                <div className="text-[10px] md:text-xs text-gray-400 mt-2 flex items-center gap-1"><Info size={12}/> 申請時間: {TimeService.formatDateTime(ot.created_at, true)}</div>
                             </div>
                          </div>
                          <div className="flex gap-2 w-full md:w-auto justify-end">
                             <button onClick={() => { setEditOtModal(ot); setEditOtForm({ start: ot.start.replace(' ', 'T'), end: ot.end.replace(' ', 'T'), reason: '', hours: ot.hours }); }} className="flex-1 md:flex-none p-3 bg-gray-100 text-gray-600 rounded-2xl hover:bg-gray-200 transition-all flex justify-center"><Edit3/></button>
                             <button onClick={() => handleAction('ot', ot.id, 'approved')} className="flex-1 md:flex-none p-3 bg-green-100 text-green-600 rounded-2xl hover:bg-green-200 transition-all flex justify-center"><CheckCircle/></button>
                             <button onClick={() => setRejectModal({id: ot.id, type: 'ot'})} className="flex-1 md:flex-none p-3 bg-red-100 text-red-600 rounded-2xl hover:bg-red-200 transition-all flex justify-center"><XCircle/></button>
                          </div>
                       </div>
                    ))}
                 </div>
               )}

               {/* History */}
               <div>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-2">
                     <h3 className="text-xl md:text-2xl font-black text-gray-400">歷史審核紀錄</h3>
                     <div className="flex items-center gap-2 w-full md:w-auto">
                        <span className="text-xs font-black text-gray-400 whitespace-nowrap">顯示日期</span>
                        <input type="date" value={otHistoryFilterDate} onChange={e=>setOtHistoryFilterDate(e.target.value)} className="bg-white text-black p-2 rounded-lg text-xs font-black outline-none border border-gray-200 flex-1 md:flex-none" style={{colorScheme:'light'}} />
                        <button onClick={()=>setOtHistoryFilterDate('')} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"><RotateCcw size={14} className="text-gray-500"/></button>
                     </div>
                  </div>
                  <div className="space-y-4">
                     {data.overtimes
                       .filter(o => o.status !== 'pending')
                       .filter(o => {
                          if (!otHistoryFilterDate) return true;
                          const filterDate = otHistoryFilterDate;
                          const startDate = o.start.substring(0, 10);
                          const endDate = o.end.substring(0, 10);
                          return filterDate >= startDate && filterDate <= endDate;
                       })
                       .sort((a,b)=>b.id-a.id)
                       .map(ot => (
                        <div key={ot.id} className="bg-gray-50 p-6 rounded-[24px] md:rounded-3xl border flex flex-col gap-4 opacity-75 hover:opacity-100 transition-all group">
                           {/* ... OT History Item ... */}
                           <div className="flex justify-between items-start">
                              <div className="flex items-start md:items-center gap-4">
                                 <span className={`px-2 py-1 md:px-3 rounded-xl text-[10px] md:text-xs font-black whitespace-nowrap ${ot.status === 'approved' ? 'bg-green-100 text-green-700' : ot.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`}>
                                    {ot.status === 'approved' ? '已核准' : ot.status === 'rejected' ? '已拒絕' : '已取消'}
                                 </span>
                                 <div>
                                    <div className="font-bold text-base md:text-lg">
                                       <span className="font-mono text-gray-400 mr-2 text-xs md:text-sm">{ot.userId}</span>
                                       {ot.userName} - 加班 <span className="text-indigo-600 font-black text-base md:text-lg">({ot.hours}小時)</span>
                                    </div>
                                    <div className="text-xs md:text-sm text-gray-500 mt-1 font-mono">
                                       {TimeService.formatDateTime(ot.start)} ~ {TimeService.formatDateTime(ot.end)}
                                    </div>
                                    <div className="text-xs md:text-sm text-gray-600 mt-1">事由：{ot.reason}</div>
                                    {ot.rejectReason && <div className="text-xs text-red-500 mt-1 font-bold">拒絕原因：{ot.rejectReason}</div>}
                                    {ot.adminNote && <div className="text-xs text-brand-600 mt-1 font-bold border-l-2 border-brand-300 pl-2">管理員修改備註：{ot.adminNote}</div>}
                                    <div className="text-[10px] md:text-xs text-gray-400 mt-1">申請時間: {TimeService.formatDateTime(ot.created_at, true)}</div>
                                 </div>
                              </div>
                              <button onClick={() => confirmDelete(ot.id, 'ot')} className="text-gray-300 hover:text-red-500 transition-colors p-2"><Trash2 size={18} className="md:w-5 md:h-5"/></button>
                           </div>
                        </div>
                     ))}
                     {data.overtimes.filter(o => o.status !== 'pending' && (!otHistoryFilterDate || (otHistoryFilterDate >= o.start.substring(0, 10) && otHistoryFilterDate <= o.end.substring(0, 10)))).length === 0 && (
                        <div className="text-center text-gray-300 py-4 italic">無符合條件的歷史紀錄</div>
                     )}
                  </div>
               </div>
            </div>
          )}
          
          {/* ... News, Holiday, System sections unchanged ... */}
          {activeView === 'news' && (
            <div className="max-w-4xl space-y-8 md:space-y-12">
               {/* ... (Existing news view content) ... */}
               <div className="bg-white p-6 md:p-12 rounded-[32px] md:rounded-[48px] shadow-sm border">
                  <h3 className="text-xl md:text-2xl font-black mb-6 md:mb-8">{editAnnId ? '編輯公告' : '發布公告'}</h3>
                  <div className="space-y-4 md:space-y-6">
                     <input type="text" className="w-full p-4 md:p-5 bg-white border border-gray-100 rounded-3xl font-black focus:ring-4 focus:ring-brand-100 outline-none transition-all" placeholder="輸入公告大標題" id="annTitle" />
                     <div className="border border-gray-100 rounded-[24px] md:rounded-[32px] overflow-hidden focus-within:ring-4 focus-within:ring-brand-100">
                        <div className="bg-white p-3 md:p-4 border-b flex gap-2 md:gap-3 flex-wrap">
                           <button onClick={()=>execFormat('bold')} className="p-2 md:p-2.5 hover:bg-white rounded-xl border shadow-sm transition-all"><Bold size={16} className="md:w-[18px] md:h-[18px]"/></button>
                           <button onClick={()=>execFormat('italic')} className="p-2 md:p-2.5 hover:bg-white rounded-xl border shadow-sm transition-all"><Italic size={16} className="md:w-[18px] md:h-[18px]"/></button>
                           <button onClick={()=>execFormat('underline')} className="p-2 md:p-2.5 hover:bg-white rounded-xl border shadow-sm transition-all"><Underline size={16} className="md:w-[18px] md:h-[18px]"/></button>
                           <div className="w-[1px] h-6 md:h-8 bg-gray-300 mx-1 md:mx-2 self-center"></div>
                           <select onChange={(e)=>execFormat('fontSize', e.target.value)} className="px-2 md:px-3 py-1 text-xs md:text-sm border rounded-xl bg-white font-black outline-none flex-1 md:flex-none">
                              <option value="3">字體大小</option>
                              {[1,2,3,4,5,6,7].map(v => <option key={v} value={v}>{['極小','小','中','大','特大','超大','極巨'][v-1]}</option>)}
                           </select>
                           <div className="flex items-center gap-2 border rounded-xl px-2 md:px-4 bg-white shadow-sm flex-1 md:flex-none justify-center">
                             <Palette size={16} className="text-gray-400" />
                             <input type="color" onChange={(e)=>execFormat('foreColor', e.target.value)} className="w-6 h-6 md:w-8 md:h-8 p-0 border-0 cursor-pointer rounded-lg overflow-hidden" />
                           </div>
                        </div>
                        <div ref={editorRef} contentEditable className="p-6 md:p-10 min-h-[200px] md:min-h-[250px] outline-none bg-white text-gray-800 text-base md:text-lg leading-relaxed font-bold" onInput={(e) => setAnnContent(e.currentTarget.innerHTML)} />
                     </div>
                     <div className="flex flex-col md:flex-row gap-4">
                        <select className="p-4 md:p-5 border border-gray-100 rounded-3xl flex-1 bg-white font-black outline-none" id="annCat">
                           <option value="general">一般 (藍色主題)</option>
                           <option value="urgent">緊急 (紅色警示)</option>
                           <option value="system">系統 (灰色中立)</option>
                        </select>
                        <Button className="w-full md:w-auto px-14 rounded-3xl shadow-2xl text-lg font-black" onClick={handleAnnSave}>{editAnnId ? '保存更改' : '確認發布'}</Button>
                     </div>
                  </div>
               </div>
               
               <div className="space-y-4 md:space-y-6">
                 {data.announcements.map(ann => {
                    const categoryMap = { general: '一般', urgent: '緊急', system: '系統' };
                    return (
                        <div key={ann.id} className="bg-white p-6 md:p-8 rounded-[24px] md:rounded-[32px] border flex flex-col md:flex-row justify-between items-start group hover:shadow-md transition-all gap-4">
                           <div className="w-full">
                              <div className="flex items-center gap-3 mb-2">
                                 <span className={`px-3 py-1 rounded-full text-[10px] md:text-xs font-black uppercase ${ann.category==='urgent'?'bg-red-100 text-red-600':ann.category==='system'?'bg-gray-100 text-gray-500':'bg-brand-50 text-brand-600'}`}>
                                    {categoryMap[ann.category]}
                                 </span>
                                 <span className="text-gray-400 text-xs md:text-sm font-mono">
                                    {ann.date ? ann.date.split(' ')[0].split('T')[0] : ''}
                                 </span>
                              </div>
                              <h4 className="text-lg md:text-xl font-black text-gray-800 mb-3">{ann.title}</h4>
                              <div className="text-gray-600 prose prose-sm max-w-none font-bold text-sm md:text-base" dangerouslySetInnerHTML={{ __html: ann.content }} />
                           </div>
                           <div className="flex gap-2 self-end md:self-start md:opacity-0 group-hover:opacity-100 transition-all md:ml-4">
                              <button onClick={()=>startEditAnn(ann)} className="p-2 md:p-3 hover:bg-brand-50 text-brand-600 rounded-2xl"><Edit3 size={18}/></button>
                              <button onClick={()=>confirmDelete(ann.id, 'announcement')} className="p-2 md:p-3 hover:bg-red-50 text-red-600 rounded-2xl"><Trash2 size={18}/></button>
                           </div>
                        </div>
                    );
                 })}
               </div>
            </div>
          )}

          {activeView === 'holiday' && (
             <div className="max-w-2xl space-y-8 md:space-y-12">
                {/* ... (Existing holiday view content) ... */}
                <div className="bg-white p-6 md:p-12 rounded-[32px] md:rounded-[48px] shadow-sm border">
                   <h3 className="text-xl md:text-2xl font-black mb-6 md:mb-10 flex items-center gap-3"><Palmtree className="text-brand-500" /> 設定休假日</h3>
                   <form className="space-y-6 md:space-y-8" onSubmit={async (e) => {
                      e.preventDefault();
                      const dateInput = e.currentTarget.elements.namedItem('hdate') as HTMLInputElement;
                      const noteInput = e.currentTarget.elements.namedItem('hnote') as HTMLInputElement;
                      if (!noteInput.value.trim()) return showToast("請填寫假期備註", "error");
                      
                      try {
                          await StorageService.addHoliday({ id: Date.now(), date: dateInput.value, note: noteInput.value });
                          refreshData();
                          showToast("假期已成功加入系統", 'success');
                          dateInput.value = '';
                          noteInput.value = '';
                      } catch (e: any) {
                          showToast("加入假期失敗: " + getErrorMessage(e), 'error');
                      }
                   }}>
                      <div className="space-y-3">
                         <label className="text-sm font-black text-gray-400 ml-2">假期日期</label>
                         <input name="hdate" type="date" className="w-full p-4 md:p-5 bg-white text-black rounded-3xl outline-none font-black tracking-widest text-lg border border-gray-100" style={{colorScheme:'light'}} required />
                      </div>
                      <div className="space-y-3">
                         <label className="text-sm font-black text-gray-400 ml-2">備註 <span className="text-red-500">*</span></label>
                         <input name="hnote" type="text" className="w-full p-4 md:p-5 bg-white border border-gray-100 rounded-3xl font-black outline-none focus:ring-4 focus:ring-brand-50 transition-all" placeholder="例如：春節連假" required />
                      </div>
                      <Button type="submit" className="w-full py-4 md:py-5 rounded-3xl shadow-2xl text-lg font-black">加入假期清單</Button>
                   </form>
                </div>
                
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                     <h4 className="text-lg md:text-xl font-black text-gray-400">假期歷史紀錄</h4>
                     <div className="flex items-center gap-2 bg-white px-3 md:px-4 py-2 rounded-2xl border border-gray-200">
                        <CalendarIcon size={16} className="text-gray-500"/>
                        <input 
                           type="month" 
                           value={holidayFilterMonth}
                           onChange={(e) => setHolidayFilterMonth(e.target.value)}
                           className="font-black outline-none text-xs md:text-sm bg-transparent text-black placeholder-gray-500 w-24 md:w-auto"
                           style={{colorScheme:'light'}}
                        />
                     </div>
                  </div>
                  <div className="space-y-4">
                    {data.holidays
                       .filter(h => !holidayFilterMonth || h.date.startsWith(holidayFilterMonth))
                       .sort((a,b)=>a.date>b.date?1:-1)
                       .map(h => (
                       <div key={h.id} className="bg-white p-6 rounded-[24px] md:rounded-3xl border flex items-center justify-between">
                          <div className="flex items-center gap-4 md:gap-6">
                             <div className="font-mono text-lg md:text-2xl font-black text-gray-800 tracking-wider">
                                {TimeService.getTaiwanDate(h.date)}
                             </div>
                             <div className="font-bold text-gray-600 text-sm md:text-base">{h.note}</div>
                          </div>
                          <button onClick={()=>confirmDelete(h.id, 'holiday')} className="p-2 md:p-3 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
                       </div>
                    ))}
                    {data.holidays.length > 0 && data.holidays.filter(h => !holidayFilterMonth || h.date.startsWith(holidayFilterMonth)).length === 0 && (
                        <div className="text-center text-gray-400 font-bold italic py-8 bg-gray-100 rounded-[32px]">此月份無假期設定</div>
                    )}
                  </div>
                </div>
             </div>
          )}

          {activeView === 'system' && (
             <div className="max-w-2xl bg-white p-6 md:p-12 rounded-[40px] md:rounded-[56px] shadow-2xl border animate-in zoom-in-95 duration-500">
                <h3 className="text-2xl md:text-3xl font-black mb-8 md:mb-12 flex items-center gap-4 text-gray-800"><Settings className="text-brand-600" size={32}/> 核心參數設定</h3>
                <form className="space-y-6 md:space-y-10" onSubmit={async (e) => {
                   e.preventDefault();
                   const formData = new FormData(e.currentTarget);
                   const latRaw = formData.get('lat');
                   const lngRaw = formData.get('lng');
                   const radRaw = formData.get('radius');

                   const companyLat = latRaw ? (parseFloat(latRaw as string) || 0) : 0;
                   const companyLng = lngRaw ? (parseFloat(lngRaw as string) || 0) : 0;
                   const allowedRadius = radRaw ? (parseInt(radRaw as string) || 100) : 100;

                   try {
                       await StorageService.updateSettings({
                          gasUrl: "disabled", 
                          companyLat,
                          companyLng,
                          allowedRadius,
                       });
                       showToast("設定已儲存", 'success');
                   } catch (e: any) {
                       showToast("設定儲存失敗: " + getErrorMessage(e), 'error');
                   }
                }}>
                   {/* Google Sheets API Input REMOVED */}
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                      <div className="space-y-4">
                        <label className="text-base md:text-lg font-black text-gray-800 ml-2">公司座標 (緯度)</label>
                        <input name="lat" defaultValue={data.settings.companyLat} type="number" step="any" className="w-full p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[24px] md:rounded-[32px] font-black focus:border-brand-500 outline-none transition-all" />
                      </div>
                      <div className="space-y-4">
                        <label className="text-base md:text-lg font-black text-gray-800 ml-2">公司座標 (經度)</label>
                        <input name="lng" defaultValue={data.settings.companyLng} type="number" step="any" className="w-full p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[24px] md:rounded-[32px] font-black focus:border-brand-500 outline-none transition-all" />
                      </div>
                   </div>
                   <div className="space-y-4">
                      <label className="text-base md:text-lg font-black text-gray-800 ml-2">打卡判定半徑 (M)</label>
                      <input name="radius" defaultValue={data.settings.allowedRadius} type="number" className="w-full p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[24px] md:rounded-[32px] font-black focus:border-brand-500 outline-none transition-all" />
                   </div>
                   <Button type="submit" className="w-full py-5 md:py-6 rounded-[32px] text-lg md:text-xl font-black shadow-2xl bg-brand-600 hover:bg-brand-700">儲存所有設定</Button>
                </form>
             </div>
          )}
        </main>
      </div>
      
      {/* ... (Modal sections remain largely unchanged except approved leave list below) ... */}
      
      {/* Employee Settings Modal */}
      {isSettingsModalOpen && targetUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           {/* ... existing settings modal ... */}
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-10 w-full max-w-lg shadow-2xl font-bold flex flex-col max-h-[85vh]">
              {/* ... same content ... */}
              <div className="mb-4 md:mb-6 flex-shrink-0">
                 <h3 className="text-xl md:text-2xl font-black flex items-center gap-2 text-gray-800"><Sliders className="text-brand-500"/> 員工設定</h3>
                 <div className="text-gray-500 mt-1 ml-1">{targetUser.name} ({targetUser.id})</div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scroll space-y-4 md:space-y-6 pr-2">
                 <div className="space-y-2">
                    <label className="text-xs text-gray-400 ml-1 font-black">到職日期</label>
                    <input 
                      type="date" 
                      value={settingsForm.onboardDate} 
                      onChange={(e) => {
                          setSettingsForm({...settingsForm, onboardDate: e.target.value});
                          calculateSeniority(e.target.value);
                      }}
                      className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-500 transition-all" 
                      style={{colorScheme:'light'}}
                    />
                    {seniorityCalc && <div className="text-xs text-brand-600 font-black px-2 flex items-center gap-1"><Calculator size={12}/> {seniorityCalc}</div>}
                 </div>

                 <div className="p-4 md:p-6 bg-gray-50 rounded-[24px] md:rounded-[32px] border border-gray-100 space-y-4">
                    <h4 className="text-xs md:text-sm font-black text-gray-500 flex items-center gap-2"><Clock size={16}/> 假別額度設定 (小時)</h4>
                    <div className="grid grid-cols-2 gap-3 md:gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] text-gray-400 ml-1">特休假</label>
                            <input type="number" value={settingsForm.quotaAnnual} onChange={e=>setSettingsForm({...settingsForm, quotaAnnual: Number(e.target.value)})} className="w-full p-3 bg-white border rounded-xl font-black outline-none text-center" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-gray-400 ml-1">生日假</label>
                            <input type="number" value={settingsForm.quotaBirthday} onChange={e=>setSettingsForm({...settingsForm, quotaBirthday: Number(e.target.value)})} className="w-full p-3 bg-white border rounded-xl font-black outline-none text-center" />
                        </div>
                        <div className="space-y-1 col-span-2">
                            <label className="text-[10px] text-gray-400 ml-1">補休假 (加班轉入)</label>
                            <input type="number" value={settingsForm.quotaComp} onChange={e=>setSettingsForm({...settingsForm, quotaComp: Number(e.target.value)})} className="w-full p-3 bg-white border rounded-xl font-black outline-none text-center" />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-3 pt-2">
                    <div className="flex justify-between items-center px-1">
                        <h4 className="text-xs md:text-sm font-black text-gray-500">已核准之請假紀錄 (最近5筆)</h4>
                        <button onClick={() => handleExportSingleUser(targetUser.id)} className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-200 transition-all font-black flex items-center gap-1"><Download size={12}/> 匯出</button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                        {['特休', '補休', '生日假'].map(type => {
                            const used = data.leaves
                                .filter(l => l.userId === targetUser.id && l.type === type && l.status === 'approved')
                                .reduce((acc, curr) => acc + curr.hours, 0);
                            return (
                                <div key={type} className="bg-white border rounded-xl p-2 text-center shadow-sm">
                                    <div className="text-[10px] text-gray-400">{type}已用</div>
                                    <div className="text-sm font-black text-brand-600">{used}hr</div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="bg-gray-50 border rounded-2xl p-2 h-40 md:h-60 overflow-y-auto custom-scroll text-xs space-y-1">
                        <div className="grid grid-cols-4 gap-2 px-2 py-1 border-b text-gray-400 font-black text-[10px] mb-1">
                           <div>假別</div>
                           <div className="col-span-2">時間</div>
                           <div className="text-right">時數</div>
                        </div>
                        {data.leaves.filter(l => l.userId === targetUser.id && l.status === 'approved').length === 0 ? (
                            <div className="text-center text-gray-400 py-10 italic">無相關請假紀錄</div>
                        ) : (
                            data.leaves
                            .filter(l => l.userId === targetUser.id && l.status === 'approved')
                            .sort((a,b) => b.id - a.id)
                            .slice(0, 5) // Limit to top 5
                            .map(l => (
                                <div key={l.id} className="grid grid-cols-4 gap-2 items-center p-2 bg-white rounded-lg border border-gray-100 hover:shadow-sm">
                                    <div>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${l.type==='特休'?'bg-blue-100 text-blue-700':l.type==='補休'?'bg-purple-100 text-purple-700':l.type==='生日假'?'bg-pink-100 text-pink-700':'bg-gray-100 text-gray-600'}`}>{l.type}</span>
                                    </div>
                                    <div className="col-span-2 font-mono text-gray-500 text-[9px] flex flex-col leading-tight">
                                        <span>{TimeService.formatDateTime(l.start)}</span>
                                        <span className="text-gray-300 mx-1">~</span>
                                        <span>{TimeService.formatDateTime(l.end)}</span>
                                    </div>
                                    <div className="font-black text-gray-800 text-right">{l.hours}hr</div>
                                </div>
                            ))
                        )}
                    </div>
                 </div>
              </div>

              <div className="flex gap-4 mt-6 pt-4 border-t border-gray-100 flex-shrink-0">
                 <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setIsSettingsModalOpen(false)}>取消</Button>
                 <Button className="flex-1 rounded-2xl bg-brand-600 font-black text-white" onClick={handleSaveSettings}>儲存設定</Button>
              </div>
           </div>
        </div>
      )}

      {/* Edit User Modal (Updated) */}
      {isEditUserModalOpen && targetUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 w-full max-w-md shadow-2xl font-bold">
              <h3 className="text-xl md:text-2xl font-black mb-6 md:mb-8 flex items-center gap-2"><UserCog className="text-brand-500"/> 編輯員工資料</h3>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">姓名</label>
                    <input type="text" value={editUserForm.name} onChange={e=>setEditUserForm({...editUserForm, name: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">部門</label>
                    <input type="text" value={editUserForm.dept} onChange={e=>setEditUserForm({...editUserForm, dept: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" />
                 </div>

                 {/* Password Reset Section */}
                 <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100 mt-2">
                    <div className="flex items-start gap-2 text-yellow-700 text-xs font-black mb-3">
                       <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                       <span>安全提示：管理員無法直接修改員工密碼，請使用下方按鈕發送重設信件。</span>
                    </div>
                    <Button type="button" onClick={handleSendResetEmail} className="w-full bg-white border-2 border-yellow-200 text-yellow-700 hover:bg-yellow-100 rounded-xl py-3 text-sm flex items-center justify-center gap-2">
                       <Mail size={16}/> 發送密碼重設信件
                    </Button>
                    <div className="mt-3 text-[10px] text-yellow-600/80 font-bold border-t border-yellow-200 pt-2 leading-relaxed">
                        <span className="bg-yellow-200 text-yellow-800 px-1 rounded mr-1">TIPS</span>
                        若員工使用虛擬信箱無法收信，請至列表將其「封存」並「永久刪除」後，重新「新增」同名帳號即可重設密碼。（打卡紀錄會保留，但需重設年資額度）
                    </div>
                 </div>

                 <div className="flex gap-4 pt-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setIsEditUserModalOpen(false)}>取消</Button>
                    <Button className="flex-1 rounded-2xl bg-brand-600 font-black text-white" onClick={handleEditUser}>儲存變更</Button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Add User Modal (Unchanged) */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 w-full max-w-md shadow-2xl font-bold">
              <h3 className="text-xl md:text-2xl font-black mb-6 md:mb-8 flex items-center gap-2"><UserPlus className="text-brand-500"/> 新增員工帳號</h3>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">帳號 (ID)</label>
                    <input type="text" value={addUserForm.id} onChange={e=>setAddUserForm({...addUserForm, id: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" placeholder="例如: john" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">預設密碼</label>
                    <input type="text" value={addUserForm.pass} onChange={e=>setAddUserForm({...addUserForm, pass: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" placeholder="至少6位數" />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs text-gray-400 ml-2">姓名</label>
                        <input type="text" value={addUserForm.name} onChange={e=>setAddUserForm({...addUserForm, name: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs text-gray-400 ml-2">部門</label>
                        <input type="text" value={addUserForm.dept} onChange={e=>setAddUserForm({...addUserForm, dept: e.target.value})} className="w-full p-4 bg-white border border-gray-100 rounded-2xl outline-none font-black" />
                    </div>
                 </div>
                 <div className="flex gap-4 pt-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setIsAddUserModalOpen(false)}>取消</Button>
                    <Button className="flex-1 rounded-2xl bg-brand-600 font-black text-white" onClick={handleAddUser} disabled={isSubmitting} isLoading={isSubmitting}>建立帳號</Button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Edit Overtime Modal */}
      {editOtModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 w-full max-w-md shadow-2xl font-bold">
              <h3 className="text-xl md:text-2xl font-black mb-6 md:mb-8 flex items-center gap-2"><Edit3 className="text-brand-500"/> 修改加班申請</h3>
              <div className="space-y-4">
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">開始時間</label>
                    <input type="datetime-local" value={editOtForm.start} onChange={e=>setEditOtForm({...editOtForm, start: e.target.value})} className="w-full p-4 bg-white text-black border border-gray-100 rounded-2xl outline-none font-black" style={{colorScheme:'light'}} />
                 </div>
                 <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-2">結束時間</label>
                    <input type="datetime-local" value={editOtForm.end} onChange={e=>setEditOtForm({...editOtForm, end: e.target.value})} className="w-full p-4 bg-white text-black border border-gray-100 rounded-2xl outline-none font-black" style={{colorScheme:'light'}} />
                 </div>
                 <div className="space-y-1">
                    <label className="text-xs text-red-500 ml-2">修改原因 (必填，員工可見)</label>
                    <textarea value={editOtForm.reason} onChange={e=>setEditOtForm({...editOtForm, reason: e.target.value})} className="w-full p-4 bg-red-50 border border-red-100 rounded-2xl outline-none min-h-[100px] font-black" placeholder="請說明修改原因..." />
                 </div>
                 <div className="flex gap-4 pt-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setEditOtModal(null)}>取消</Button>
                    <Button className="flex-1 rounded-2xl bg-brand-600 font-black text-white" onClick={saveOtEdit}>確認修改</Button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 w-full max-w-md shadow-2xl font-bold border-4 border-red-500">
              <h3 className="text-xl md:text-2xl font-black mb-6 text-red-600">拒絕{rejectModal.type==='leave'?'請假':'加班'}申請</h3>
              <div className="space-y-6">
                 <textarea placeholder="請輸入拒絕原因..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)} className="w-full p-4 bg-red-50 border border-red-100 rounded-2xl outline-none min-h-[120px] font-black" />
                 <div className="flex gap-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setRejectModal(null)}>取消</Button>
                    <Button className="flex-1 rounded-2xl bg-red-600 font-black text-white" onClick={()=>handleAction(rejectModal.type, rejectModal.id, 'rejected', rejectReason)}>確認拒絕</Button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Export Attendance Modal */}
      {isExportAttendanceModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-10 w-full max-w-md shadow-2xl font-bold">
              <h3 className="text-xl md:text-2xl font-black mb-6 flex items-center gap-2"><FileText className="text-brand-500"/> 匯出全體打卡紀錄</h3>
              <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-1">起始日期</label>
                    <input type="date" value={attExportStart} onChange={e=>setAttExportStart(e.target.value)} className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-500 transition-all" style={{colorScheme:'light'}} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 ml-1">結束日期</label>
                    <input type="date" value={attExportEnd} onChange={e=>setAttExportEnd(e.target.value)} className="w-full p-4 bg-white text-black border-2 border-gray-100 rounded-2xl font-black outline-none focus:border-brand-500 transition-all" style={{colorScheme:'light'}} />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <Button variant="secondary" className="flex-1 rounded-2xl" onClick={()=>setIsExportAttendanceModalOpen(false)}>取消</Button>
                    <Button className="flex-1 rounded-2xl bg-indigo-600 font-black text-white" onClick={handleExportAllAttendance}>確認匯出</Button>
                  </div>
              </div>
           </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[300] flex items-center justify-center p-4 md:p-6 text-black">
           <div className="bg-white rounded-[32px] md:rounded-[48px] p-8 md:p-12 w-full max-w-md shadow-2xl border-4 border-red-600 animate-in bounce-in duration-500">
              <div className="text-center mb-6 md:mb-10">
                <h3 className="text-2xl md:text-3xl font-black mb-2 tracking-tight text-red-600">危險操作確認</h3>
                <div className="text-sm font-black text-gray-500">您正在永久刪除資料，此操作無法復原！</div>
                <div className="text-xs font-black text-red-600 animate-pulse bg-red-50 py-1 rounded-full mt-4">剩餘回答時間：10 秒</div>
              </div>
              <div className="bg-gray-100 p-6 md:p-8 rounded-[24px] md:rounded-[32px] text-center mb-6 md:mb-10">
                <div className="text-4xl md:text-5xl font-black font-mono tracking-widest">{mathChallenge.q}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-10">
                {mathChallenge.opts.map((opt, idx) => (
                  <button key={idx} onClick={() => handleDeleteResponse(opt)} className="p-4 md:p-6 bg-white border-2 border-gray-100 rounded-[20px] md:rounded-[24px] text-2xl md:text-3xl font-black text-red-600 hover:bg-red-600 hover:text-white transition-all shadow-md">{opt}</button>
                ))}
              </div>
              <button className="w-full py-3 md:py-4 text-gray-400 font-black hover:text-gray-600 transition-colors" onClick={()=>setDeleteTarget(null)}>取消刪除</button>
           </div>
        </div>
      )}
    </div>
  );
};
