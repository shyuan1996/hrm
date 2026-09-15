import type { AttendanceRecord, LeaveRequest, User, Holiday } from '../types';
import { TimeService } from '../services/timeService';
import { parseTaipei, workSegments } from '../functions/src/domain';
import { analyzeAttendanceCompleteness, getAttendanceCompletenessLabel } from './attendanceStatus';

// Shared by the administrator overview and export. A partial-day leave must
// not hide unrelated missing punches/late arrival. Lunch is 12:00-13:00.
export function dailyAttendance(user: User, date: string, records: AttendanceRecord[], leaves: LeaveRequest[], holidays: Holiday[], radius: number, now: Date) {
  const punches = records.filter(r=>r.userId===user.id && TimeService.getAttendanceDate(r)===date)
    .sort((a,b)=>TimeService.getAttendanceTime(a).localeCompare(TimeService.getAttendanceTime(b)));
  const firstIn=punches.find(r=>r.type==='in'), lastOut=[...punches].reverse().find(r=>r.type==='out');
  const holiday=holidays.find(h=>h.date.slice(0,10)===date);
  const normal=workSegments(date,holidays.map(h=>h.date.slice(0,10)));
  const completeness=analyzeAttendanceCompleteness(punches);
  const events:{at:number,label:string}[]=[];
  const nowDay=TimeService.getTaiwanDate(now), nowMs=now.getTime();
  let work=[...normal];
  const ms=(r:AttendanceRecord)=>parseTaipei(date+' '+TimeService.getAttendanceTime(r));
  const atStart=parseTaipei(date+' 08:30');
  if(user.onboard_date && date<user.onboard_date) return {punches,firstIn,lastOut,labels:['尚未到職']};
  if(!normal.length) {
    if(!punches.length) events.push({at:atStart,label:holiday?`國定假日(${holiday.note})`:'例假日'});
    else {events.push({at:atStart,label:holiday?'假日出勤':'週末加班'});if(completeness!=='complete') events.push({at:atStart,label:getAttendanceCompletenessLabel(completeness)});}
  } else {
    const approved=leaves.filter(l=>l.userId===user.id && l.status==='approved' && l.start.slice(0,10)<=date && l.end.slice(0,10)>=date);
    for(const leave of approved) {
      let s:number,e:number;
      try {s=parseTaipei(leave.start);e=parseTaipei(leave.end);if(e<=s)throw new Error();} catch {events.push({at:atStart,label:'請假資料異常，待核對'});continue;}
      let covered=0;
      for(const [a,b] of normal)covered+=Math.max(0,Math.min(b,e)-Math.max(a,s));
      if(covered>0)events.push({at:Math.max(s,normal[0][0]),label:`請假(${leave.type} ${Number((covered/3600000).toFixed(2))}hr)`});
      work=work.flatMap(([a,b]):[number,number][]=>{
        if(e<=a||s>=b)return [[a,b]];
        const result:[number,number][]=[];
        if(s>a)result.push([a,s]);if(e<b)result.push([e,b]);return result;
      });
    }
    const expectedIn=work[0]?.[0],expectedOut=work[work.length-1]?.[1];
    const threshold=expectedIn===atStart?expectedIn+120000:expectedIn;
    if(!punches.length && work.length)events.push({at:expectedIn,label:date>nowDay?'尚未到日期':nowMs>threshold?'曠職/未打卡':'尚未打卡'});
    if(punches.length) {
      if(work.length && firstIn && ms(firstIn)>threshold)events.push({at:ms(firstIn),label:'遲到'});
      if(work.length && firstIn && lastOut && ms(lastOut)<expectedOut)events.push({at:ms(lastOut),label:'早退'});
      if(completeness==='missing-out' && date===nowDay && work.length && nowMs<expectedOut)events.push({at:firstIn?ms(firstIn):atStart,label:'已上班'});
      else if(completeness!=='complete')events.push({at:completeness==='missing-out'?(expectedOut||atStart):atStart,label:getAttendanceCompletenessLabel(completeness)});
      if(firstIn && TimeService.getAttendanceTime(firstIn)<='08:00:00')events.push({at:ms(firstIn),label:'提早打卡'});
      if(firstIn && lastOut && TimeService.getAttendanceTime(lastOut)>='18:00:00')events.push({at:ms(lastOut),label:'晚退'});
      if(completeness==='complete' && !events.some(e=>['遲到','早退'].includes(e.label)))events.push({at:firstIn?ms(firstIn):atStart,label:'正常'});
    }
  }
  for(const r of punches) if(r.source!=='admin' && (String(r.status).includes('異常') || (Number.isFinite(radius)&&radius>0 && r.dist>radius)))events.push({at:ms(r),label:r.type==='in'?'上班地點異常':'下班地點異常'});
  if(events.some(e=>e.label.includes('異常'))) {
    const normalIndex=events.findIndex(e=>e.label==='正常');
    if(normalIndex>=0)events.splice(normalIndex,1);
  }
  return {punches,firstIn,lastOut,labels:events.sort((a,b)=>a.at-b.at).map(e=>e.label)};
}
