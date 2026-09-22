const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '..');
function compile(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React }
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, console: {error(){}, warn(){}}, setTimeout, clearTimeout,
    require: name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.')) return compile(path.relative(root, path.resolve(root, path.dirname(file), name + '.ts')), {}, globals);
      throw new Error('Unexpected dependency: ' + name);
    }, ...globals
  });
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function appHarness() {
  const state = [], refs = [], effects = [], cleanups = [], events = new Map();
  let index = 0, refIndex = 0, mounted = false, authCallback;
  const calls = { profile: 0, sync: [], signOut: 0 };
  const profile = { id:'sy005', uid:'test-uid', name:'Test Employee', role:'employee' };
  const auth = {currentUser:null};
  const data = {settings:{},users:[],syncReady:{users:false}};
  let lookup = async () => profile;
  const react = {
    createElement(type, props, ...children) { return {type,props:props||{},children}; },
    useState(initial) {const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},
    useRef(initial) {const i=refIndex++;return refs[i] || (refs[i]={current:initial});},
    useCallback(fn) {return fn;},
    useEffect(fn) {if(!mounted)effects.push(fn);}
  };
  react.default=react;
  const globals = {
    window:{addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n),location:{reload(){}}},
    document:{addEventListener(){},removeEventListener(){},visibilityState:'visible'},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    // App UI timers are not needed for these asynchronous auth tests.
    setTimeout:()=>1,clearTimeout(){}
  };
  const session = compile('utils/session.ts',{}, {localStorage:globals.localStorage});
  const storage = {
    loadData:()=>data, stopRealtimeSync(){}, clearPrivateCache(){},
    getUserProfileForAuth(){calls.profile++;return lookup();},
    initRealtimeSync(id,role){calls.sync.push([id,role]);}
  };
  const App = compile('App.tsx', {
    react,
    './components/Login':{Login:'Login'}, './components/EmployeeDashboard':{EmployeeDashboard:'Employee'},
    './components/AdminDashboard':{AdminDashboard:'Admin'}, './components/ui/Button':{Button:'Button'},
    './services/storageService':{StorageService:storage}, './services/timeService':{TimeService:{getNetworkTimeOffset:async()=>0}},
    './constants':{DEFAULT_SETTINGS:{},SESSION_KEY:'session'}, 'lucide-react':{},
    './services/firebase':{auth,functions:{}}, 'firebase/functions':{}, './utils/session':session,
    'firebase/auth':{
      onAuthStateChanged(a,fn){authCallback=fn;return ()=>{};},
      async signOut(){calls.signOut++;auth.currentUser=null;authCallback(null);}
    }
  }, globals).default;
  const render = () => { index=0;refIndex=0;return App(); };
  const initial=render();
  for(const effect of effects) {const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
  mounted=true;
  return {initial,render,calls,profile,events,auth,
    lookup:fn=>{lookup=fn;},
    emit(user){auth.currentUser=user;authCallback(user);},
    close(){cleanups.reverse().forEach(fn=>fn());}
  };
}
function nodes(tree) {return !tree||typeof tree!=='object'?[]:[tree,...(tree.children||[]).flat(Infinity).flatMap(nodes)];}
const signedIn = {uid:'test-uid',email:'sy005@shyuan-hrm.com'};

test('saved Firebase session skips login and starts protected listeners only once',async()=>{
  const h=appHarness();
  assert.equal(nodes(h.initial).some(n=>n.type==='Login'),false);
  h.emit(signedIn);await tick();
  assert.equal(h.calls.profile,1);assert.equal(h.calls.sync.length,1);
  assert.equal(nodes(h.render()).some(n=>n.type==='Employee'),true);
  h.close();
});
test('unauthenticated startup displays login only after Firebase resolves',async()=>{
  const h=appHarness();h.emit(null);await tick();
  assert.equal(nodes(h.render()).some(n=>n.type==='Login'),true);
  assert.equal(h.calls.profile,0);h.close();
});
test('network profile failure retains Firebase session; retry recovers without password',async()=>{
  const h=appHarness();h.lookup(async()=>{throw {code:'unavailable'};});
  h.emit(signedIn);await tick();
  assert.equal(h.calls.signOut,0);assert.equal(h.calls.sync.length,0);
  assert.equal(nodes(h.render()).some(n=>n.type==='Login'||n.type==='Employee'),false);
  h.lookup(async()=>h.profile);
  const retry=nodes(h.render()).find(n=>n.type==='Button');retry.props.onClick();await tick();
  assert.equal(nodes(h.render()).some(n=>n.type==='Employee'),true);h.close();
});
test('late profile completion cannot restore an account after logout',async()=>{
  const h=appHarness(), pending=deferred();h.lookup(()=>pending.promise);
  h.emit(signedIn);h.emit(null);pending.resolve(h.profile);await tick();
  assert.equal(h.calls.sync.length,0);
  assert.equal(nodes(h.render()).some(n=>n.type==='Login'),true);h.close();
});
test('archived, missing, duplicate or mismatched profiles still fail closed',async()=>{
  for(const value of [null,{deleted:true},{uid:'different'},'DUPLICATE_USER_PROFILE']){
    const h=appHarness();h.lookup(async()=>{if(typeof value==='string')throw new Error(value);return value===null?null:{...h.profile,...value};});
    h.emit(signedIn);await tick();assert.equal(h.calls.signOut,1);assert.equal(h.calls.sync.length,0);h.close();
  }
});
test('unmounted auth callback cannot start listeners',async()=>{
  const h=appHarness(),pending=deferred();h.lookup(()=>pending.promise);
  h.emit(signedIn);h.close();pending.resolve(h.profile);await tick();assert.equal(h.calls.sync.length,0);
});
test('restricted Safari optional storage cannot break authentication hints',()=>{
  const {sessionHints}=compile('utils/session.ts',{}, {localStorage:{getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}}});
  assert.equal(sessionHints.get('session'),null);
  assert.doesNotThrow(()=>sessionHints.set('session','{}'));
  assert.doesNotThrow(()=>sessionHints.remove('session'));
});
test('profile wait is bounded and ignores a late result',async()=>{
  const {withTimeout}=compile('utils/session.ts');const pending=deferred();
  await assert.rejects(withTimeout(pending.promise,5),/PROFILE_LOAD_TIMEOUT/);
  pending.resolve('too late');await tick();
});
test('time-source compatibility preserves first success and handles every rejection',async()=>{
  const {firstSuccessful}=compile('utils/firstSuccessful.ts');
  assert.equal(await firstSuccessful([Promise.reject(Error('offline')),Promise.resolve(42)]),42);
  await assert.rejects(firstSuccessful([Promise.reject(Error('offline'))]),/offline/);
  await assert.rejects(firstSuccessful([]),/No sources/);
});

function storageHarness() {
  const listeners=[],events=[];
  const firestore={
    collection:(db,name)=>name, doc:(db,name,id)=>`${name}/${id}`,
    query:(ref,...constraints)=>ref, where:()=>null,orderBy:()=>null,limit:()=>null,
    onSnapshot(ref,options,next,error){
      if(typeof options==='function'){error=next;next=options;}
      listeners.push({ref,next,error});return ()=>{};
    },
    getDocs:async()=>{throw {code:'unavailable'};},
    getDoc:()=>{throw Error('Network failures must not trigger a legacy fallback');}
  };
  const storage=compile('services/storageService.ts',{
    '../constants':{STORAGE_KEY:'public',DEFAULT_SETTINGS:{}},'./timeService':{TimeService:{}},
    './firebase':{db:{},auth:{currentUser:signedIn}}, 'firebase/firestore':firestore,
    'firebase/functions':{},'firebase/storage':{},'../functions/src/domain':{safeAttachments:()=>[]}
  },{
    window:{dispatchEvent:event=>events.push(event)},localStorage:{setItem(){}},
    Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}}
  }).StorageService;
  return {storage,listeners,events};
}
test('cached missing employee and transient listener errors do not sign out',()=>{
  const h=storageHarness();h.storage.initRealtimeSync('sy005','employee');
  const own=h.listeners.find(l=>l.ref==='users/sy005');
  own.next({metadata:{fromCache:true},exists:()=>false});
  own.error({code:'unavailable'});
  assert.equal(h.events.filter(e=>e.type==='profile-update').length,0);
  own.next({metadata:{fromCache:false},exists:()=>false});
  assert.equal(h.events.filter(e=>e.type==='profile-update').length,1);
  assert.equal(h.events.find(e=>e.type==='profile-update').detail,null);
});
test('record readiness distinguishes offline cache, server empty and read failure',()=>{
  const h=storageHarness();h.storage.initRealtimeSync('sy005','employee');
  const records=h.listeners.find(l=>l.ref==='records');
  assert.equal(h.storage.loadData().syncReady.records,false);
  records.next({metadata:{fromCache:true},docs:[]});
  assert.equal(h.storage.loadData().syncReady.records,false);
  records.next({metadata:{fromCache:false},docs:[]});
  assert.equal(h.storage.loadData().syncReady.records,true);
  records.error({code:'permission-denied'});
  assert.equal(h.storage.loadData().syncReady.records,false);
  h.storage.clearPrivateCache();
  assert.ok(Object.values(h.storage.loadData().syncReady).every(value=>value===false));
});
test('offline UID lookup is not misclassified as a missing employee',async()=>{
  const h=storageHarness();
  await assert.rejects(h.storage.getUserProfileForAuth(signedIn.uid,signedIn.email),error=>error.code==='unavailable');
});
test('Firebase password-only initialization omits mobile iframe and retains old session stores',async()=>{
  const configs=[];
  const result=compile('services/firebase.ts',{
    'firebase/app':{initializeApp:(config,name)=>({name:name||'main'}),getApps:()=>[{}]},
    'firebase/auth':{
      initializeAuth:(app,config)=>{configs.push({app,config});return {};},
      browserLocalPersistence:'local',indexedDBLocalPersistence:'indexedDB',browserSessionPersistence:'session',inMemoryPersistence:'memory',
      setPersistence:async()=>{}
    },
    'firebase/firestore':{getFirestore:()=>({})},'firebase/storage':{getStorage:()=>({})},
    'firebase/functions':{getFunctions:()=>({})}
  });
  assert.deepEqual(Array.from(configs[0].config.persistence),['local','indexedDB','session']);
  assert.equal(configs[0].config.popupRedirectResolver,undefined);
  assert.equal(configs[1].config.persistence,'memory');
  assert.equal(await result.authPersistenceReady,true);
});
