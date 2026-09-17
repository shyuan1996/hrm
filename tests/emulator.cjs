const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const tr=createRequire(path.resolve(__dirname,'../.verification/package.json'));
const ar=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=tr('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc}=tr('firebase/firestore');
const {ref,uploadBytes,getBytes}=tr('firebase/storage');
const {initializeApp}=ar('firebase-admin/app');
const {getFirestore,Timestamp}=ar('firebase-admin/firestore');
const {getAuth}=ar('firebase-admin/auth');
const projectId='demo-hrm-secure-test';
// Hard safety boundary: this suite must NEVER fall back to production.
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST']) {
  if(!/^127\.0\.0\.1:\d+$/.test(process.env[name]||''))throw new Error('Local emulator required: '+name);
}
initializeApp({projectId,storageBucket:projectId+'.appspot.com'});
const db=getFirestore(),auth=getAuth();
const handlers=require('../functions/lib/index.js');
const call=(who,action,data={})=>handlers.secureAttendance.run({auth:{uid:who,token:{email:who+'@shyuan-hrm.com',auth_time:Math.floor(Date.now()/1000)}},data:{action,...data}});
const profile=(id,extra={})=>({id,uid:id,name:'Synthetic '+id,role:'employee',quota_annual:16,quota_comp:0,quota_birthday:0,...extra});
test('isolated Firestore/Storage Rules and server workflow regression',async t=>{
  const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8188,rules:fs.readFileSync(path.resolve(__dirname,'../firestore.rules'),'utf8')},storage:{host:'127.0.0.1',port:9298,rules:fs.readFileSync(path.resolve(__dirname,'../storage.rules'),'utf8')}});
  try {
    await env.clearFirestore();
    for(const id of ['admin','sy001','sy002','archived','forced','orphan']){
      await auth.createUser({uid:id,email:id+'@shyuan-hrm.com',password:'Synthetic-Test-Only-234!'}).catch(e=>{if(e.code!=='auth/uid-already-exists')throw e;});
      if(id!=='orphan')await db.doc('users/'+id).set(profile(id,id==='admin'?{role:'admin'}:id==='archived'?{deleted:true}:id==='forced'?{mustChangePassword:true}:{}));
    }
    await db.doc('system/settings').set({companyLat:24,companyLng:120,allowedRadius:40});
    await auth.createUser({uid:'uid-third',email:'sy003@shyuan-hrm.com',password:'Synthetic-Test-Only-234!'});
    await db.doc('users/sy003').set(profile('sy003',{uid:'uid-third'}));
    await db.doc('records/owned').set({userId:'sy001',uid:'sy001',date:'2026-09-03',time:'08:30:00',type:'in',id:1});
    const client=id=>env.authenticatedContext(id,{email:id+'@shyuan-hrm.com',auth_time:Math.floor(Date.now()/1000)});
    const employee=client('sy001'),admin=client('admin');
    await t.test('employee reads own record but not another employee',async()=>{
      await assertSucceeds(getDoc(doc(employee.firestore(),'records/owned')));
      await assertFails(getDoc(doc(client('sy002').firestore(),'records/owned')));
    });
    await t.test('unauthenticated cannot read protected records',async()=>assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'records/owned'))));
    await t.test('direct client punch / approve / forced-marker clearing denied',async()=>{
      await assertFails(setDoc(doc(employee.firestore(),'records/forged'),{uid:'sy001',userId:'sy001',status:'正常'}));
      await assertFails(setDoc(doc(admin.firestore(),'leaves/forged'),{status:'approved'}));
      await assertFails(updateDoc(doc(client('forced').firestore(),'users/forced'),{mustChangePassword:false}));
    });
    await t.test('profile still readable for forced password UI',async()=>assertSucceeds(getDoc(doc(client('forced').firestore(),'users/forced'))));
    await t.test('archived account cannot use server operations',async()=>assert.rejects(call('archived','punch',{requestId:'archived-test',type:'in',lat:24,lng:120})));
    await t.test('active owner can upload/read legacy and UID attachments',async()=>{
      for(const folder of ['sy001']) {
        const r=ref(employee.storage(),`leave_attachments/${folder}/test.jpg`);
        await assertSucceeds(uploadBytes(r,new Uint8Array([1,2,3]),{contentType:'image/jpeg',customMetadata:{userId:'sy001'}}));
        await assertSucceeds(getBytes(r));
        await assertSucceeds(getBytes(ref(admin.storage(),`leave_attachments/${folder}/test.jpg`)));
      }
    });
    await t.test('orphan, forced and archived identities cannot upload',async()=>{
      for(const id of ['orphan','forced','archived'])await assertFails(uploadBytes(ref(client(id).storage(),`leave_attachments/${id}/test.jpg`),new Uint8Array([1]),{contentType:'image/jpeg'}));
    });
    await t.test('another employee cannot read/overwrite attachment',async()=>{
      await assertFails(getBytes(ref(client('sy002').storage(),'leave_attachments/sy001/test.jpg')));
      await assertFails(uploadBytes(ref(employee.storage(),'leave_attachments/sy001/test.jpg'),new Uint8Array([1]),{contentType:'image/jpeg'}));
    });
    await t.test('UID different from profile ID supports new and legacy paths',async()=>{
      const owner=env.authenticatedContext('uid-third',{email:'sy003@shyuan-hrm.com',auth_time:Math.floor(Date.now()/1000)});
      for(const folder of ['uid-third','sy003']) {
        const r=ref(owner.storage(),`leave_attachments/${folder}/old.jpg`);
        await assertSucceeds(uploadBytes(r,new Uint8Array([1]),{contentType:'image/jpeg'}));
        await assertSucceeds(getBytes(r));
        await assertSucceeds(getBytes(ref(admin.storage(),`leave_attachments/${folder}/old.jpg`)));
      }
    });
    await t.test('server ignores forged time/distance and atomically rejects duplicate IN',async()=>{
      const args={type:'in',lat:24,lng:120,date:'1999-01-01',time:'99:99:99',dist:0};
      const outcomes=await Promise.allSettled([call('sy001','punch',{...args,requestId:'p1'}),call('sy001','punch',{...args,requestId:'p2'})]);
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
      const result=outcomes.find(r=>r.status==='fulfilled').value;
      assert.notEqual(result.record.date,'1999-01-01');assert.notEqual(result.record.time,'99:99:99');
    });
    await t.test('same request replay creates no additional record',async()=>{
      const before=(await db.collection('records').get()).size;
      let key;
      for(const k of ['p1','p2']){try{await call('sy001','punch',{requestId:k,type:'in',lat:24,lng:120});key=k;break;}catch{}}
      assert.ok(key);assert.equal((await db.collection('records').get()).size,before);
    });
    await t.test('out-of-range OUT retained with abnormal location label',async()=>{
      const result=await call('sy001','punch',{requestId:'p-out',type:'out',lat:25,lng:121});
      assert.equal(result.record.status,'地點異常');assert.ok(result.record.dist>40);
    });
    await t.test('out-of-range IN rejected',async()=>assert.rejects(call('sy001','punch',{requestId:'p-far',type:'in',lat:25,lng:121})));
    await t.test('admin backfill preserves chosen time and employee cannot backfill',async()=>{
      const p={requestId:'manual-test',userId:'sy002',date:'2026-09-03',time:'08:30:00',type:'in'};
      await assert.rejects(call('sy001','manualPunch',p));
      const result=await call('admin','manualPunch',p);assert.equal(result.record.time,'08:30:00');assert.equal(result.record.source,'admin');
    });
    let leaveId,secondId;
    const base={type:'特休',start:'2026-09-03 08:30',end:'2026-09-03 17:30',hours:0.5,reason:'Synthetic regression',attachments:[]};
    await t.test('server recalculates submitted leave and rejects malformed attachments',async()=>{
      const result=await call('sy001','submitLeave',{...base,requestId:'leave1'});leaveId=result.id;assert.equal(result.hours,8);
      await assert.rejects(call('sy001','submitLeave',{...base,requestId:'bad-attachment',attachments:[null]}));
      secondId=(await call('sy001','submitLeave',{...base,requestId:'leave2'})).id;
    });
    await t.test('concurrent different approvals deduct both quotas',async()=>{
      await Promise.all([call('admin','leaveAction',{id:leaveId,operation:'approve'}),call('admin','leaveAction',{id:secondId,operation:'approve'})]);
      assert.equal((await db.doc('users/sy001').get()).data().quota_annual,0);
    });
    await t.test('repeated approval is idempotent',async()=>{
      await call('admin','leaveAction',{id:leaveId,operation:'approve'});
      assert.equal((await db.doc('users/sy001').get()).data().quota_annual,0);
    });
    await t.test('insufficient quota leaves request pending and quota unchanged',async()=>{
      const id=(await call('sy001','submitLeave',{...base,requestId:'leave3'})).id;
      await assert.rejects(call('admin','leaveAction',{id,operation:'approve'}));
      assert.equal((await db.doc('leaves/'+id).get()).data().status,'pending');
      assert.equal((await db.doc('users/sy001').get()).data().quota_annual,0);
    });
    await t.test('colliding legacy numeric IDs do not fan out approval',async()=>{
      const data={...base,id:777,userId:'sy002',uid:'sy002',userName:'Synthetic sy002',status:'pending'};
      await db.doc('leaves/collision-a').set(data);await db.doc('leaves/collision-b').set(data);
      await call('admin','leaveAction',{id:'collision-a',operation:'approve'});
      assert.equal((await db.doc('leaves/collision-a').get()).data().status,'approved');
      assert.equal((await db.doc('leaves/collision-b').get()).data().status,'pending');
    });
    await t.test('employee cancel pending works and cannot cancel another person',async()=>{
      const id=(await call('sy001','submitLeave',{...base,requestId:'leave4'})).id;
      await assert.rejects(call('sy002','leaveAction',{id,operation:'cancel'}));
      await call('sy001','leaveAction',{id,operation:'cancel'});
      assert.equal((await db.doc('leaves/'+id).get()).data().status,'cancelled');
      await assert.rejects(call('sy001','leaveAction',{id:leaveId,operation:'cancel'}));
    });
    await t.test('admin cancel approved refunds once; repeat does not double refund',async()=>{
      await call('admin','leaveAction',{id:leaveId,operation:'cancel'});
      await call('admin','leaveAction',{id:leaveId,operation:'cancel'});
      assert.equal((await db.doc('users/sy001').get()).data().quota_annual,8);
    });
    await t.test('new overtime preview-equivalent server calculation and employee cancel',async()=>{
      const result=await call('sy002','submitOvertime',{requestId:'ot1',start:'2026-09-03 06:00',end:'2026-09-03 09:00',hours:99,reason:'Synthetic regression'});
      assert.equal(result.hours,2.5);
      await call('sy002','overtimeAction',{id:result.id,operation:'cancel'});
      assert.equal((await db.doc('overtimes/'+result.id).get()).data().status,'cancelled');
    });
    await t.test('four-hour overtime stays four through server submission and approval',async()=>{
      const result=await call('sy002','submitOvertime',{requestId:'ot-four-hour',start:'2026-09-17 04:30',end:'2026-09-17 08:30',hours:3.5,reason:'Synthetic four-hour boundary'});
      assert.equal(result.hours,4);
      assert.equal((await db.doc('overtimes/'+result.id).get()).data().hours,4);
      await call('admin','overtimeAction',{id:result.id,operation:'approve'});
      assert.equal((await db.doc('overtimes/'+result.id).get()).data().hours,4);
      await call('admin','overtimeAction',{id:result.id,operation:'approve'});
      assert.equal((await db.doc('overtimes/'+result.id).get()).data().hours,4);
    });
    await t.test('next thirty minutes are rest and previous authoritative hours are not migrated',async()=>{
      const result=await call('sy002','submitOvertime',{requestId:'ot-forward-rest',start:'2026-09-19 08:00',end:'2026-09-19 12:15',hours:3.5,reason:'Synthetic partial rest'});
      assert.equal(result.hours,4);
      await call('admin','overtimeAction',{id:result.id,operation:'edit',updates:{end:'2026-09-19 13:00'}});
      assert.equal((await db.doc('overtimes/'+result.id).get()).data().hours,4.5);
      await db.doc('overtimes/legacy-four-hours').set({id:123,userId:'sy002',uid:'sy002',start:'2026-09-16 04:30',end:'2026-09-16 08:30',hours:3.5,status:'pending',calculationVersion:1});
      await call('admin','overtimeAction',{id:'legacy-four-hours',operation:'approve'});
      assert.equal((await db.doc('overtimes/legacy-four-hours').get()).data().hours,3.5);
    });
    await t.test('permanent delete and audit tampering denied',async()=>{
      await assertFails(deleteDoc(doc(admin.firestore(),'users/sy001')));
      await db.doc('security_logs/test').set({action:'TEST'});
      await assertFails(deleteDoc(doc(admin.firestore(),'security_logs/test')));
    });
    await t.test('archive blocks data immediately and disables Auth; restore recovers',async()=>{
      await call('admin','archiveEmployee',{userId:'sy002'});
      assert.equal((await auth.getUser('sy002')).disabled,true);
      await assertFails(getBytes(ref(client('sy002').storage(),'leave_attachments/sy001/test.jpg')));
      await call('admin','restoreEmployee',{userId:'sy002'});
      assert.equal((await auth.getUser('sy002')).disabled,false);
    });
    await t.test('forged legacy attachment UID cannot authorize deleting another employee file',async()=>{
      await db.doc('leaves/corrupt-attachment').set({id:991,userId:'sy001',uid:'uid-third',type:'事假',hours:1,status:'pending',attachments:[{name:'old.jpg',path:'leave_attachments/uid-third/old.jpg',url:'https://firebasestorage.googleapis.com/v0/b/demo-hrm-secure-test.appspot.com/o/leave_attachments%2Fuid-third%2Fold.jpg?alt=media'}]});
      await assert.rejects(call('admin','leaveAction',{id:'corrupt-attachment',operation:'removeAttachment',path:'leave_attachments/uid-third/old.jpg'}));
      await assertSucceeds(getBytes(ref(admin.storage(),'leave_attachments/uid-third/old.jpg')));
    });
    await t.test('forced password change rejects same/wrong password and only clears marker after Auth update',async()=>{
      const request=(oldPassword,newPassword)=>({auth:{uid:'forced',token:{email:'forced@shyuan-hrm.com',auth_time:Math.floor(Date.now()/1000)}},data:{oldPassword,newPassword}});
      await assert.rejects(handlers.completePasswordChange.run(request('Synthetic-Test-Only-234!','Synthetic-Test-Only-234!')));
      await assert.rejects(handlers.completePasswordChange.run(request('wrong-password','New-Synthetic-Password-456!')));
      assert.equal((await db.doc('users/forced').get()).data().mustChangePassword,true);
      await handlers.completePasswordChange.run(request('Synthetic-Test-Only-234!','New-Synthetic-Password-456!'));
      assert.equal((await db.doc('users/forced').get()).data().mustChangePassword,false);
    });
  } finally {await env.cleanup();}
});
