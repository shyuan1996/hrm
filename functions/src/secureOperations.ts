import { createHash, randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall, CallableRequest } from 'firebase-functions/v2/https';
import { interval, leaveHours, LEAVE_TYPES, parseTaipei, quotaTransition, safeAttachments, taipeiParts, validHours, distanceMeters } from './domain';
import { calculateOTWithDeduction } from './overtime';

if (!getApps().length) initializeApp();
const db = getFirestore();
const auth = getAuth();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const adminIds = ['admin', 'syhr', 'service'];
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new HttpsError('invalid-argument', '欄位格式不正確');
  return value;
}
function documentId(value: unknown): string {
  const id = text(value, 200);
  if (!id || id.includes('/') || id === '.' || id === '..') throw new HttpsError('invalid-argument', '文件識別碼不正確，請重新整理');
  return id;
}
async function context(request: CallableRequest) {
  if (!request.auth) throw new HttpsError('unauthenticated', '請先登入');
  const uid = request.auth.uid;
  const account = await auth.getUser(uid);
  if (account.disabled) throw new HttpsError('permission-denied', '帳號已停用');
  if (Number(request.auth.token.auth_time) * 1000 < Date.parse(account.tokensValidAfterTime || '1970-01-01')) throw new HttpsError('unauthenticated','登入已失效，請重新登入');
  const profiles = await db.collection('users').where('uid', '==', uid).limit(2).get();
  if (profiles.size !== 1) throw new HttpsError('permission-denied', '員工資料不存在或對應不唯一，請聯絡管理員');
  const snap = profiles.docs[0], profile = snap.data();
  if (profile.deleted === true) throw new HttpsError('permission-denied', '帳號已封存');
  return {uid, profile, ref:snap.ref, id:snap.id, admin:adminIds.includes(snap.id) && profile.role === 'admin'};
}
function checkActive(profile: any, uid: string) {
  if (!profile || profile.uid !== uid || profile.deleted === true || profile.mustChangePassword === true) throw new HttpsError('permission-denied', '帳號已停用或須先變更密碼');
}
async function audit(tx: Transaction, ctx: any, action: string, target: string) {
  tx.create(db.collection('security_logs').doc(), {uid:ctx.uid, action, details:target, timestamp:FieldValue.serverTimestamp(), userAgent:'cloud-function'});
}
async function holidays() { return (await db.collection('holidays').get()).docs.map(d => String(d.data().date).slice(0,10)); }
function recordOrder(r: any): string {
  if (r.source !== 'admin' && r.createdAt?.toMillis) { const p = taipeiParts(r.createdAt.toMillis()); return p.date + ' ' + p.time; }
  return r.date + ' ' + r.time;
}
function requestData(input: any, ctx: any) {
  const start = text(input.start, 16), end = text(input.end, 16); interval(start, end);
  const reason = text(input.reason).trim(); if (!reason) throw new HttpsError('invalid-argument', '請填寫事由');
  return {id:Date.now(), userId:ctx.id, uid:ctx.uid, userName:ctx.profile.name, start, end, reason, status:'pending', created_at:new Date().toLocaleString('zh-TW', {timeZone:'Asia/Taipei'}), createdAt:FieldValue.serverTimestamp()};
}
async function validateFiles(input: unknown, ctx: any) {
  const attachments = safeAttachments(input, ctx.uid, ctx.id);
  const bucket = getStorage().bucket();
  for (const a of attachments) {
    const url = new URL(a.url);
    if (url.pathname.split('/b/')[1]?.split('/o/')[0] !== bucket.name) throw new HttpsError('invalid-argument', '附件不屬於本系統');
    const [metadata] = await bucket.file(a.path).getMetadata();
    if (Number(metadata.size) > 5 * 1024 * 1024 || !/^(image\/|application\/pdf$)/.test(metadata.contentType || '')) throw new HttpsError('invalid-argument', '附件大小或類型不正確');
  }
  return attachments;
}

// A single authenticated endpoint keeps the existing UI workflow. No fallback
// to insecure direct writes is allowed when a deployment is missing.
export const secureAttendance = onCall({region:'asia-east1',maxInstances:5,timeoutSeconds:60}, async request => {
  // Keep server receipt time stable across database retries; contention must
  // not silently turn an on-time request into a later punch.
  const receivedAt=Date.now();
  try {
    const ctx = await context(request), input = request.data || {}, action = text(input.action, 40);
    checkActive(ctx.profile, ctx.uid);
    if(action==='archiveEmployee'||action==='restoreEmployee') {
      if(!ctx.admin)throw new HttpsError('permission-denied','只有管理員可以執行此操作');
      const ref=db.collection('users').doc(documentId(input.userId));
      const snap=await ref.get(), employee=snap.data();
      if(!employee || employee.role!=='employee' || !employee.uid)throw new HttpsError('failed-precondition','只能封存或恢復員工帳號');
      if(action==='archiveEmployee') {
        await ref.update({deleted:true}); // deny data access before disabling Auth
        await auth.updateUser(employee.uid,{disabled:true});
        await auth.revokeRefreshTokens(employee.uid);
      } else {
        await auth.updateUser(employee.uid,{disabled:false});
        await ref.update({deleted:false});
      }
      return {ok:true};
    }
    if (['punch','manualPunch'].includes(action)) {
      const manual = action === 'manualPunch';
      if (manual && !ctx.admin) throw new HttpsError('permission-denied', '只有管理員可以補卡');
      const targetId = manual ? documentId(input.userId) : ctx.id;
      const type = input.type;
      if (!['in','out'].includes(type)) throw new HttpsError('invalid-argument', '打卡類型不正確');
      const key = documentId(input.requestId), outRef = db.collection('records').doc(hash(ctx.uid + ':' + key));
      const intent = hash(JSON.stringify([action, targetId, type, manual ? input.date : '', manual ? input.time : '']));
      return await db.runTransaction(async tx => {
        const caller = await tx.get(ctx.ref); checkActive(caller.data(), ctx.uid);
        const targetRef = db.collection('users').doc(targetId), targetSnap = await tx.get(targetRef), target = targetSnap.data();
        if (!target || target.deleted === true || !target.uid || (manual && target.role !== 'employee')) throw new HttpsError('failed-precondition', '員工資料無效');
        const previous = await tx.get(outRef);
        if (previous.exists) { if (previous.data()?.intent !== intent) throw new HttpsError('already-exists', '請求識別碼重複'); return {id:previous.id, record:previous.data(), replay:true}; }
        const now = receivedAt, p = taipeiParts(now);
        const date = manual ? text(input.date,10) : p.date, time = manual ? text(input.time,8) : p.time;
        const effective = parseTaipei(date + ' ' + time);
        if (manual && effective > now + 60000) throw new HttpsError('invalid-argument', '不能補未來時間的打卡');
        const settingSnap = await tx.get(db.doc('system/settings'));
        let lat = 0, lng = 0, dist = 0;
        if (!manual) {
          lat = input.lat; lng = input.lng;
          if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('定位資料不正確');
          dist = distanceMeters(lat, lng, settingSnap.data());
          // Preserve the existing policy: out-of-range clock-in is blocked;
          // clock-out is accepted but explicitly marked as location abnormal.
          if (type === 'in' && dist > Number(settingSnap.data()?.allowedRadius)) throw new HttpsError('failed-precondition', '目前不在允許打卡範圍內');
        }
        const stateRef = db.collection('attendance_state').doc(hash(targetId + ':' + date));
        await tx.get(stateRef); // serialize simultaneous employee/admin punches
        const records = await tx.get(db.collection('records').where('userId','==',targetId).where('date','==',date));
        const ordered = records.docs.map(d => d.data()).sort((a,b) => recordOrder(a).localeCompare(recordOrder(b)));
        const last = ordered[ordered.length - 1];
        if (!manual && (last?.type === type || (!last && type !== 'in'))) throw new HttpsError('failed-precondition', '打卡狀態已更新，請確認最新紀錄後再操作');
        if (manual && ordered.some(r => r.type === type && recordOrder(r).slice(0,16) === (date + ' ' + time).slice(0,16))) throw new HttpsError('already-exists','該分鐘已有相同打卡紀錄');
        const record = {id:now, userId:targetId, uid:target.uid, userName:target.name, date, time, type, lat, lng, dist, status:!manual && dist > Number(settingSnap.data()?.allowedRadius)?'地點異常':'正常', source:manual?'admin':'employee', ...(manual ? {createdByUid:ctx.uid, createdByName:ctx.profile.name} : {}), createdAt:FieldValue.serverTimestamp(), effectiveAt:Timestamp.fromMillis(effective), intent};
        tx.create(outRef, record); tx.set(stateRef, {updatedAt:FieldValue.serverTimestamp()});
        if (manual) await audit(tx,ctx,'ADMIN_MANUAL_ATTENDANCE',`${targetId} ${date} ${time} ${type}`);
        return {id:outRef.id, record:{...record, createdAt:new Date(now).toISOString(), effectiveAt:new Date(effective).toISOString()}};
      });
    }
    if (action === 'submitLeave' || action === 'submitOvertime') {
      const common = requestData(input,ctx), holidayDates = await holidays();
      const isLeave = action === 'submitLeave';
      const type = isLeave ? text(input.type,50) : '';
      if (isLeave && !LEAVE_TYPES.includes(type)) throw new Error('假別不正確');
      const attachments = isLeave ? await validateFiles(input.attachments,ctx) : [];
      const requestId = documentId(input.requestId), requestRef = db.collection(isLeave?'leaves':'overtimes').doc(hash(ctx.uid + ':' + requestId));
      const intent = hash(JSON.stringify([action, common.start, common.end, common.reason, type, attachments]));
      return await db.runTransaction(async tx => {
        const current = await tx.get(ctx.ref); checkActive(current.data(),ctx.uid);
        const existing = await tx.get(requestRef);
        if (existing.exists) { if(existing.data()?.intent !== intent) throw new HttpsError('already-exists','請求識別碼重複'); return {id:existing.id}; }
        let hours: number;
        if (isLeave) hours = leaveHours(common.start, common.end, holidayDates);
        else {
          const others = await tx.get(db.collection('overtimes').where('userId','==',ctx.id));
          // Keep existing overlap policy for this security patch. Changing
          // allocation across adjacent/cancelled requests is a separate change.
          const overlaps = others.docs.map(d=>d.data()).filter(o=>!['rejected','cancelled'].includes(o.status) && o.start < common.end && o.end > common.start);
          hours = calculateOTWithDeduction(new Date(parseTaipei(common.start)),new Date(parseTaipei(common.end)),overlaps as any,holidayDates);
          tx.update(ctx.ref,{requestRevision:FieldValue.increment(1)});
        }
        validHours(hours);
        tx.create(requestRef,{...common,hours,intent,calculationVersion:1,...(isLeave?{type,attachments}:{})});
        return {id:requestRef.id,hours};
      });
    }
    if (action === 'leaveAction') {
      const ref = db.collection('leaves').doc(documentId(input.id)), operation = text(input.operation,30);
      if (!['approve','reject','cancel','delete','edit','removeAttachment'].includes(operation)) throw new Error('不支援此操作');
      if (operation !== 'cancel' && !ctx.admin) throw new HttpsError('permission-denied','只有管理員可以執行此操作');
      const holidayDates = await holidays();
      return await db.runTransaction(async tx => {
        const caller = await tx.get(ctx.ref); checkActive(caller.data(),ctx.uid);
        const snap = await tx.get(ref); if(!snap.exists) { if(operation==='delete' && ctx.admin) return {ok:true}; throw new Error('假單不存在'); }
        const previous = snap.data()!;
        if (!ctx.admin && (previous.uid !== ctx.uid || previous.userId !== ctx.id)) throw new HttpsError('permission-denied','只能取消本人的申請');
        if (operation==='cancel' && previous.status==='cancelled') return {ok:true};
        if (operation==='approve' && previous.status==='approved') return {ok:true};
        if (operation==='reject' && previous.status==='rejected') return {ok:true};
        if (['approve','reject'].includes(operation) && previous.status!=='pending') throw new Error('申請狀態已變更，請重新整理');
        if (!ctx.admin && previous.status!=='pending') throw new HttpsError('permission-denied','僅能取消審核中的申請');
        const userRef = db.collection('users').doc(documentId(previous.userId)), employee = await tx.get(userRef);
        if(!employee.exists) throw new Error('員工資料不存在，請先核對');
        const next: any = {...previous};
        if(operation==='approve') {
          next.hours = previous.hoursOverride === true ? validHours(previous.hours) : validHours(leaveHours(previous.start,previous.end,holidayDates));
          if(!LEAVE_TYPES.includes(previous.type)) throw new Error('假別不正確');
          next.status='approved';
        }
        if(operation==='reject') {next.status='rejected';next.rejectReason=text(input.reason ?? '');}
        if(operation==='cancel') next.status='cancelled';
        if(operation==='edit') {
          if(!['pending','approved'].includes(previous.status)) throw new Error('只有待審或已核准的假單可以修改');
          next.type=text(input.type,50); if(!LEAVE_TYPES.includes(next.type)) throw new Error('假別不正確');
          next.hours=validHours(input.hours); next.hoursOverride=true;
          if(next.type===previous.type && next.hours===previous.hours) return {ok:true};
          next.changeHistory=[...(previous.changeHistory||[]),{date:taipeiParts(Date.now()).date+' '+taipeiParts(Date.now()).time,adminName:ctx.profile.name,oldType:previous.type,newType:next.type,oldHours:previous.hours,newHours:next.hours}];
        }
        if(operation==='removeAttachment') {
          const attachments=safeAttachments(previous.attachments,employee.data()?.uid,userRef.id);
          const path=text(input.path,1024);
          if(!attachments.some(a=>a.path===path)) throw new Error('附件不屬於此假單');
          next.attachments=attachments.filter(a=>a.path!==path);
          // Remove the reference atomically first. Physical cleanup is best
          // effort afterward and never uses arbitrary client-supplied paths.
          tx.update(ref,{attachments:next.attachments});
          await audit(tx,ctx,'ADMIN_REMOVE_ATTACHMENT',ref.id);
          return {ok:true,cleanup:[path]};
        }
        const quota = quotaTransition(employee.data(),previous,operation==='delete'?null:next,taipeiParts(Date.now()).date);
        if(Object.keys(quota.updates).length) tx.update(userRef,quota.updates);
        next.usedBuckets=quota.usedBuckets;
        if(operation==='delete') tx.delete(ref); else tx.set(ref,next);
        await audit(tx,ctx,'LEAVE_'+operation.toUpperCase(),ref.id);
        let cleanup: string[]=[];
        if(operation==='delete') {
          // Corrupt old metadata must never cause deletion outside the owner.
          try { cleanup=safeAttachments(previous.attachments,employee.data()?.uid,userRef.id).map(a=>a.path); } catch { cleanup=[]; }
        }
        return {ok:true,cleanup};
      }).then(async result=>{
        for(const path of result.cleanup || []) {try {await getStorage().bucket().file(path).delete({ignoreNotFound:true});} catch {console.warn('Attachment cleanup pending for leave',ref.id);}}
        return {ok:true};
      });
    }
    if (action === 'overtimeAction') {
      const ref=db.collection('overtimes').doc(documentId(input.id)), operation=text(input.operation,30);
      if(!['approve','reject','cancel','delete','edit'].includes(operation)) throw new Error('不支援此操作');
      if(operation!=='cancel' && !ctx.admin) throw new HttpsError('permission-denied','只有管理員可以執行此操作');
      const holidayDates=await holidays();
      return await db.runTransaction(async tx=>{
        const caller=await tx.get(ctx.ref);checkActive(caller.data(),ctx.uid);
        const snap=await tx.get(ref);if(!snap.exists){if(operation==='delete'&&ctx.admin)return {ok:true};throw new Error('加班單不存在');}
        const previous=snap.data()!;
        if(!ctx.admin&&(previous.uid!==ctx.uid||previous.userId!==ctx.id))throw new HttpsError('permission-denied','只能取消自己的申請');
        const status=operation==='approve'?'approved':operation==='reject'?'rejected':operation==='cancel'?'cancelled':previous.status;
        if(['approve','reject','cancel'].includes(operation)&&previous.status===status)return {ok:true};
        if((!ctx.admin||['approve','reject'].includes(operation))&&previous.status!=='pending')throw new Error('申請狀態已變更');
        const next: any={...previous,status};
        if(operation==='edit'||operation==='approve'){
          const changes=operation==='edit'?(input.updates||{}):{};
          next.start=changes.start??previous.start;next.end=changes.end??previous.end;
          const [s,e]=interval(next.start,next.end);
          const others=await tx.get(db.collection('overtimes').where('userId','==',previous.userId));
          const overlaps=others.docs.filter(d=>d.id!==ref.id).map(d=>d.data()).filter(o=>!['rejected','cancelled'].includes(o.status)&&o.start<next.end&&o.end>next.start);
          next.hours=operation==='approve' && previous.calculationVersion===1
            ? validHours(previous.hours)
            : validHours(calculateOTWithDeduction(new Date(s),new Date(e),(operation==='approve'?overlaps.filter(o=>o.id<previous.id):overlaps) as any,holidayDates));
          next.calculationVersion=1;
          if(changes.adminNote!==undefined)next.adminNote=text(changes.adminNote);
          if(changes.reason!==undefined)next.reason=text(changes.reason);
        }
        if(operation==='reject')next.rejectReason=text(input.reason??'');
        // Shared employee lock also serializes submission/approval on two tabs.
        const employeeRef=db.collection('users').doc(documentId(previous.userId));
        const employee=await tx.get(employeeRef);if(!employee.exists)throw new Error('員工資料不存在');
        tx.update(employeeRef,{requestRevision:FieldValue.increment(1)});
        if(operation==='delete')tx.delete(ref);else tx.set(ref,next);
        await audit(tx,ctx,'OVERTIME_'+operation.toUpperCase(),ref.id);return {ok:true};
      });
    }
    throw new HttpsError('invalid-argument','不支援此操作');
  } catch(error) {
    if(error instanceof HttpsError)throw error;
    // Do not expose credentials, SDK internals or raw uploaded content.
    if(error instanceof Error && !('code' in error))throw new HttpsError('failed-precondition',error.message);
    throw new HttpsError('internal','資料操作未完成，請重新整理確認紀錄後再試');
  }
});

// Cross-service password operations are serialized by a short-lived lock.
// The same lock must be used by both reset and completion paths.
export async function acquirePasswordLock(ref: FirebaseFirestore.DocumentReference) {
  const operation=randomUUID();
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists||snap.data()?.deleted===true)throw new HttpsError('permission-denied','帳號不存在或已停用');
    if(snap.data()?.passwordOperationUntil?.toMillis()>Date.now())throw new HttpsError('aborted','密碼正在變更中，請稍後再試');
    tx.update(ref,{passwordOperation:operation,passwordOperationUntil:Timestamp.fromMillis(Date.now()+120000)});
  });return operation;
}
export async function releasePasswordLock(ref: FirebaseFirestore.DocumentReference, operation: string, updates: any={}) {
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.data()?.passwordOperation!==operation)throw new HttpsError('aborted','密碼操作已更新，請重新登入');tx.update(ref,{...updates,passwordOperation:FieldValue.delete(),passwordOperationUntil:FieldValue.delete()});});
}
export const completePasswordChange=onCall({region:'asia-east1',maxInstances:5,timeoutSeconds:60},async request=>{
  const ctx=await context(request), input=request.data||{};
  const oldPassword=text(input.oldPassword,4096),newPassword=text(input.newPassword,4096);
  if(newPassword.length<6||oldPassword===newPassword)throw new HttpsError('invalid-argument','新密碼至少六位且不能與舊密碼相同');
  const operation=await acquirePasswordLock(ctx.ref);
  try {
    const account=await auth.getUser(ctx.uid);
    // This is the public Firebase Web API key, not an Admin/service credential.
    const authEmulator=process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if(authEmulator && !/^(127\.0\.0\.1|localhost):\d+$/.test(authEmulator))throw new HttpsError('internal','測試驗證服務設定不正確');
    const verificationUrl=authEmulator
      ? `http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`
      : 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyChRSqy8ubnhGQgGAA0bfe-gFOLWTJxmMk';
    const response=await fetch(verificationUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:oldPassword,returnSecureToken:true}),signal:AbortSignal.timeout(10000)});
    const verified=await response.json() as {localId?:string};
    if(!response.ok||verified.localId!==ctx.uid)throw new HttpsError('permission-denied','舊密碼不正確或嘗試過於頻繁');
    await auth.updateUser(ctx.uid,{password:newPassword});
    await auth.revokeRefreshTokens(ctx.uid);
    const changed=await auth.getUser(ctx.uid);
    if(!changed.tokensValidAfterTime)throw new HttpsError('internal','驗證服務尚未確認密碼變更');
    await releasePasswordLock(ctx.ref,operation,{mustChangePassword:false,passwordChangedAt:FieldValue.serverTimestamp(),tokenValidAfterSeconds:Math.floor(Date.parse(changed.tokensValidAfterTime)/1000)});
    return {ok:true};
  } catch(error) {
    // Never clear a forced-change marker after a partial Auth failure.
    await releasePasswordLock(ctx.ref,operation).catch(()=>{});
    if(error instanceof HttpsError)throw error;
    throw new HttpsError('internal','密碼變更未完整完成，請使用新密碼或原密碼重新登入確認，必要時請管理員重設');
  }
});
