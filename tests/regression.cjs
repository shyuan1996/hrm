const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('../node_modules/typescript');
const cache=new Map();
function load(file) {
  file=path.resolve(__dirname,'..',file);
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,require:p=>p.startsWith('.')?load(path.relative(path.resolve(__dirname,'..'),path.resolve(path.dirname(file),p+'.ts'))):require(p),Date,Number,String,Math,Set,Map,URL,console,setTimeout,clearTimeout,performance,fetch},{filename:file});
  return module.exports;
}
const domain=load('functions/src/domain.ts');
const ot=load('functions/src/overtime.ts').calculateOTWithDeduction;
const browserOt=load('utils/otCalculator.ts').calculateOTWithDeduction;
const overtime=(start,end,existing=[],holidays=[])=>ot(new Date(start.replace(' ','T')+'+08:00'),new Date(end.replace(' ','T')+'+08:00'),existing,holidays);

test('overtime keeps the first four hours and excludes regular weekday work',()=>{
  assert.equal(overtime('2026-09-17 04:30','2026-09-17 08:30'),4);
  assert.equal(overtime('2026-09-17 04:30','2026-09-17 09:00'),4);
  assert.equal(overtime('2026-09-17 06:00','2026-09-17 09:00'),2.5);
  assert.equal(overtime('2026-09-17 04:00','2026-09-17 08:30'),4);
  assert.equal(overtime('2026-09-17 08:30','2026-09-17 17:30'),0);
});
test('overtime rest occupies only the next thirty minutes, then work resumes',()=>{
  for(const [end,hours] of [['12:00',4],['12:15',4],['12:30',4],['13:00',4.5],['16:00',7.5],['16:30',8],['16:45',8],['17:00',8],['17:30',8.5]]) {
    assert.equal(overtime('2026-09-19 08:00',`2026-09-19 ${end}`),hours,end);
    assert.equal(overtime('2026-09-17 08:00',`2026-09-17 ${end}`,[],['2026-09-17']),hours,'holiday '+end);
  }
});
test('overtime break continues over midnight rather than charging a new block',()=>{
  assert.equal(overtime('2026-09-18 20:00','2026-09-19 00:00'),4);
  assert.equal(overtime('2026-09-18 20:00','2026-09-19 00:30'),4);
  assert.equal(overtime('2026-09-18 20:00','2026-09-19 01:00'),4.5);
});
test('an actual gap at the rest boundary is not deducted again',()=>{
  const previous=[{start:'2026-09-19 08:00',end:'2026-09-19 12:00',hours:4}];
  assert.equal(overtime('2026-09-19 12:30','2026-09-19 16:30',previous),4);
  assert.equal(overtime('2026-09-19 12:30','2026-09-19 17:00',previous),4);
  assert.equal(overtime('2026-09-19 12:15','2026-09-19 13:00',previous),0.5);
  assert.equal(overtime('2026-09-19 12:00','2026-09-19 12:30',previous),0);
  assert.equal(overtime('2026-09-19 08:00','2026-09-19 12:00',previous),0);
});
test('browser preview exports the same overtime calculator as the backend',()=>{
  assert.equal(browserOt,ot);
});
const {TimeService}=load('services/timeService.ts');
const {dailyAttendance}=load('utils/dailyAttendance.ts');
const {csvCell}=load('utils/csv.ts');
const user={id:'sy001',name:'Synthetic',role:'employee',onboard_date:'2020-01-01'};
const punch=(type,time,date='2026-09-03')=>({id:1,userId:'sy001',type,time,date,status:'正常',lat:1,lng:1,dist:0});
const leave=(start,end)=>({id:'leave1',userId:'sy001',status:'approved',type:'事假',start,end,hours:16});
const report=(records,leaves=[],date='2026-09-03')=>dailyAttendance(user,date,records,leaves,[],40,new Date('2026-09-15T12:00:00+08:00')).labels;
test('strict Taiwan dates reject impossible calendar/time values',()=>{
  for(const x of ['2026-02-30 08:30','2026-09-03 99:99','2026-09-03 24:00','not a date'])assert.throws(()=>domain.parseTaipei(x));
  assert.equal(new Date(domain.parseTaipei('2026-09-03 08:30')).toISOString(),'2026-09-03T00:30:00.000Z');
});
test('leave uses 12:00–13:00 lunch and clips all days',()=>{
  assert.equal(domain.leaveHours('2026-09-03 08:30','2026-09-03 17:30'),8);
  assert.equal(domain.leaveHours('2026-09-01 15:30','2026-09-03 09:30'),11);
  assert.equal(domain.leaveHours('2026-09-03 12:00','2026-09-03 13:00'),0);
});
test('browser display and calculator do not depend on device timezone',()=>{
  const prev=process.env.TZ;
  for(const zone of ['UTC','America/Los_Angeles','Asia/Taipei']) {
    process.env.TZ=zone;
    assert.equal(TimeService.formatTimeOnly('2026-09-03 08:30',true),'08:30:00');
    assert.equal(TimeService.calculateLeaveHours('2026-09-03 08:30','2026-09-03 17:30',[]),8);
    assert.equal(ot(new Date('2026-09-03T06:00:00+08:00'),new Date('2026-09-03T09:00:00+08:00'),[]),2.5);
  }
  if(prev===undefined)delete process.env.TZ;else process.env.TZ=prev;
});
test('quota insufficient must not mutate input',()=>{
  const p={quota_annual:4};assert.throws(()=>domain.quotaTransition(p,null,{status:'approved',type:'特休',hours:8},'2026-09-03'));
  assert.equal(p.quota_annual,4);
});
test('quota refund/edit is netted once',()=>{
  const r=domain.quotaTransition({quota_annual:8},{status:'approved',type:'特休',hours:8},{status:'approved',type:'特休',hours:4},'2026-09-03');
  assert.equal(r.updates.quota_annual,12);
});
test('bucket-backed approval does not add legacy balance',()=>{
  const p={quota_annual:100,quotas:[{id:'b',type:'特休',originalHours:8,remainingHours:8,addedDate:'2026-01-01',expireDate:'2026-12-31'}]};
  const result=domain.quotaTransition(p,null,{status:'approved',type:'特休',hours:8},'2026-09-03');
  assert.equal(result.updates.quotas[0].remainingHours,0);
  assert.throws(()=>domain.quotaTransition(p,null,{status:'approved',type:'特休',hours:16},'2026-09-03'));
});
test('missing/partial legacy allocation fails safely instead of inventing a refund',()=>{
  assert.throws(()=>domain.quotaTransition({quota_annual:0,quotas:[{id:'b',type:'特休'}]},{status:'approved',type:'特休',hours:8},null,'2026-09-03'));
});
test('attachment schema and owner are validated',()=>{
  const valid={name:'a.jpg',path:'leave_attachments/u/a.jpg',url:'https://firebasestorage.googleapis.com/v0/b/demo/o/leave_attachments%2Fu%2Fa.jpg?alt=media'};
  assert.equal(domain.safeAttachments([valid],'u','sy001').length,1);
  for(const a of [[null],[{...valid,path:'leave_attachments/v/a.jpg'}],[{...valid,url:'javascript:alert(1)'}],[valid,valid]])assert.throws(()=>domain.safeAttachments(a,'u','sy001'));
});
test('company settings unavailable never bypass geofence',()=>{
  assert.throws(()=>domain.distanceMeters(24,120,{companyLat:0,companyLng:0,allowedRadius:40}));
  assert.equal(domain.distanceMeters(24,120,{companyLat:24,companyLng:120,allowedRadius:40}),0);
});
test('CSV quotes quotes/commas/newlines and neutralizes formulas',()=>{
  assert.equal(csvCell('a,"b\nc'),'"a,""b\nc"');
  for(const v of ['=1+1',' +SUM(A1)','\t@X','-1+2'])assert.ok(csvCell(v).startsWith('"\''));
});
test('both missing punches are consistently absent',()=>{
  assert.ok(report([]).includes('曠職/未打卡'));
  assert.ok(report([],[],'2026-09-04').includes('曠職/未打卡'));
});
test('partial leave does not hide unrelated lateness',()=>{
  assert.ok(report([punch('in','10:00:00'),punch('out','17:30:00')],[leave('2026-09-03 16:30','2026-09-03 17:30')]).includes('遲到'));
});
test('middle day of cross-day leave is not absent and only shows daily hours',()=>{
  const labels=report([],[leave('2026-09-01 15:30','2026-09-03 09:30')],'2026-09-02');
  assert.ok(labels.includes('請假(事假 8hr)'));assert.ok(!labels.includes('曠職/未打卡'));
});
test('OUT before IN is retained as missing IN',()=>{
  assert.ok(report([punch('out','08:30:00'),punch('in','09:00:00'),punch('out','17:30:00')]).includes('缺上班卡'));
});
test('late comparison is seconds-consistent',()=>{
  assert.ok(report([punch('in','08:32:01'),punch('out','17:30:00')]).includes('遲到'));
  assert.ok(!report([punch('in','08:32:00'),punch('out','17:30:00')]).includes('遲到'));
});
test('trusted timestamp controls both date and chronological order',()=>{
  const r={...punch('in','08:23:00'),effectiveAt:'2026-09-03T00:25:00Z'};
  assert.equal(TimeService.getAttendanceTime(r),'08:25:00');
  const midnight={...punch('out','23:59:00','2026-09-02'),createdAt:'2026-09-02T16:01:00Z'};
  assert.equal(TimeService.getAttendanceDate(midnight),'2026-09-03');
});
test('admin backfill preserves effective time rather than upload time',()=>{
  const r={...punch('in','08:30:00'),source:'admin',createdAt:'2026-09-15T00:00:00Z'};
  assert.equal(TimeService.getAttendanceDate(r),'2026-09-03');assert.equal(TimeService.getAttendanceTime(r),'08:30:00');
});
test('normal complete day is normal',()=>assert.deepEqual(Array.from(report([punch('in','08:30:00'),punch('out','17:30:00')])),['正常']));
