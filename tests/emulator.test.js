const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadClient } = require('./client-helpers.cjs');
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8085' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && process.env.GCLOUD_PROJECT === 'demo-haze-gray-orders';

test('Spark browser SDK and Auth/Firestore rules', { skip: !enabled, timeout: 120000 }, async (t) => {
  const { initializeApp, deleteApp } = require('firebase/app');
  const authSdk = require('firebase/auth'), sdk = require('firebase/firestore');
  const project = 'demo-haze-gray-orders', base = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents`;
  function value(v) { if (v === null) return { nullValue: null }; if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } }; if (typeof v === 'object') return { mapValue: { fields: fields(v) } }; if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }; if (typeof v === 'boolean') return { booleanValue: v }; return { stringValue: v }; }
  const fields = (o) => Object.fromEntries(Object.entries(o).map(([k,v]) => [k,value(v)]));
  async function seed(p, data) { const r = await fetch(base+p, { method:'PATCH', headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({fields:fields(data)}) }); assert.equal(r.status,200,await r.text()); }
  const actors = [];
  try {
    const compiled = await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}:securityRules`, { method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:{files:[{name:'firestore.rules',content:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}]}}) });
    assert.equal(compiled.status,200,await compiled.text());
    for (const role of ['owner','admin','field_rep','viewer','inactive','unknown','missing','signedout']) {
      const app = initializeApp({projectId:project,apiKey:'demo-key',appId:'demo-app'}, role+'-'+Date.now());
      const auth = authSdk.getAuth(app); authSdk.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
      const db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db,'127.0.0.1',8085);
      let uid = 'signedout';
      if (role !== 'signedout') uid = (await authSdk.createUserWithEmailAndPassword(auth,`${role}-${Date.now()}@example.test`,'test-password-only')).user.uid;
      const profile = {displayName:role,email:role+'@example.test',territory:'Test',role:role==='inactive'?'field_rep':role,active:role!=='inactive'};
      if (!['signedout','missing'].includes(role)) await seed('/users/'+uid,profile);
      actors.push({role,app,auth,db,uid,profile,client:loadClient({...sdk,auth,db})});
    }
    const actor = (role) => actors.find(a=>a.role===role), owner=actor('owner'), admin=actor('admin'), rep=actor('field_rep');
    const allowed=[owner,admin,rep];
    const cigar = {id:'test',name:'Test Cigar',sizes:Array.from({length:100},(_,i)=>({key:'s'+i,vitola:'Robusto',dims:'50 x 5',pricing:{box10:65,msrp:13}}))};
    await seed('/cigars/test',cigar);
    const make = (a,n=1) => a.client.buildSavedOrder({orderRetailer:' Test Shop ',orderEmail:'',orderNotes:'',orderItems:Array.from({length:n},(_,i)=>({lineKey:`test__s${i}__box10`,cigarId:'test',cigarName:'Test Cigar',sizeKey:'s'+i,vitola:'Robusto',dims:'50 x 5',packKey:'box10',packLabel:'10ct Box',qty:2,unitPrice:65,retailUnitValue:130}))},{uid:a.uid},a.profile);
    const reference = (a) => sdk.doc(sdk.collection(a.db,'orders'));
    const write = (a,payload,ref=reference(a)) => sdk.setDoc(ref,{...payload,savedAt:sdk.serverTimestamp()});
    const denied = (promise) => assert.rejects(promise,e=>e.code==='permission-denied');
    const savedRefs = new Map();
    await t.test('Owner/Admin/Field Rep create; all other identities denied', async()=>{
      for (const a of allowed) { const ref=reference(a);await write(a,make(a),ref);savedRefs.set(a.role,ref.id); }
      for(const a of actors.filter(a=>!allowed.includes(a))) await denied(write(a,{...make(owner),creatorUid:a.uid,creatorDisplayName:a.profile.displayName}));
    });
    await t.test('identity, timestamp, schema, status, shape and limits enforced',async()=>{
      for(const mutate of [o=>o.creatorUid=owner.uid,o=>o.creatorDisplayName='spoof',o=>o.schemaVersion=2,o=>o.status='paid',o=>o.lineItems=[],o=>o.lineItems=Array(101).fill(o.lineItems[0]),o=>o.extra=true,o=>delete o.notes,o=>o.notes='x'.repeat(10001),o=>o.totals.wholesaleTotal=-1,o=>o.totals.lineCount=99,o=>o.totals.marginPct=NaN]){const p=make(rep);mutate(p);await denied(write(rep,p));}
      await denied(sdk.setDoc(reference(rep),{...make(rep),savedAt:sdk.Timestamp.fromMillis(0)}));
    });
    await t.test('100 realistic lines succeed without expression-limit failure',async()=>{
      const ref=reference(rep);await write(rep,make(rep,100),ref);const s=(await sdk.getDocFromServer(ref)).data();assert.equal(s.lineItems.length,100);assert.equal(s.totals.wholesaleTotal,13000);assert(s.savedAt.toDate());
    });
    await t.test('all updates/deletes denied, including Owner/Admin',async()=>{
      for(const a of allowed){const ref=sdk.doc(a.db,'orders',savedRefs.get('field_rep'));await denied(sdk.updateDoc(ref,{notes:'changed'}));await denied(sdk.deleteDoc(ref));}
    });
    await t.test('read/query visibility matches roles; catalog remains public',async()=>{
      for(const a of [owner,admin])for(const id of savedRefs.values())assert((await sdk.getDocFromServer(sdk.doc(a.db,'orders',id))).exists());
      await denied(sdk.getDocFromServer(sdk.doc(rep.db,'orders',savedRefs.get('owner'))));
      for(const a of actors.filter(a=>!allowed.includes(a)))await denied(sdk.getDocFromServer(sdk.doc(a.db,'orders',savedRefs.get('field_rep'))));
      for(const a of [owner,admin])assert((await sdk.getDocsFromServer(sdk.query(sdk.collection(a.db,'orders'),sdk.orderBy('savedAt','desc')))).size>=3);
      await denied(sdk.getDocsFromServer(sdk.query(sdk.collection(rep.db,'orders'),sdk.orderBy('savedAt','desc'))));
      const own=await sdk.getDocsFromServer(sdk.query(sdk.collection(rep.db,'orders'),sdk.where('creatorUid','==',rep.uid),sdk.orderBy('savedAt','desc')));assert(own.docs.every(d=>d.data().creatorUid===rep.uid));
      assert((await sdk.getDocFromServer(sdk.doc(actor('signedout').db,'cigars','test'))).exists());
    });
    await t.test('actual client helper: concurrent retry, immutable snapshot, catalog changes, foreign ID',async()=>{
      const pending={id:reference(rep).id,uid:rep.uid,payload:make(rep,100)};
      await Promise.all(Array.from({length:5},()=>rep.client.savePendingOrder(pending,rep.uid,()=>true,[cigar],rep.client.PACK_OPTIONS)));
      const ref=sdk.doc(rep.db,'orders',pending.id), before=(await sdk.getDocFromServer(ref)).data();
      pending.payload.notes='altered retry';await rep.client.savePendingOrder(pending,rep.uid,()=>true,[],rep.client.PACK_OPTIONS);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data(),before);
      await assert.rejects(owner.client.savePendingOrder({...pending,uid:owner.uid},owner.uid,()=>true,[cigar],owner.client.PACK_OPTIONS),/another account/);
      const own=await sdk.getDocsFromServer(sdk.query(sdk.collection(rep.db,'orders'),sdk.where('creatorUid','==',rep.uid)));assert.equal(own.docs.filter(d=>d.id===pending.id).length,1);
      await assert.rejects(rep.client.savePendingOrder({...pending,id:reference(rep).id},rep.uid,()=>true,[],rep.client.PACK_OPTIONS),/no longer available/);
      await assert.rejects(rep.client.savePendingOrder(pending,rep.uid,()=>false,[cigar],rep.client.PACK_OPTIONS),/not authorized/);
    });
    await t.test('intentional security boundary: clients can submit unverified line prices',async()=>{
      const p=make(rep);p.lineItems[0].unitPrice=0.01; // Rules deliberately do not validate every line or catalog prices.
      const ref=reference(rep);await write(rep,p,ref);assert.equal((await sdk.getDocFromServer(ref)).data().lineItems[0].unitPrice,0.01);
    });
    await t.test('profile revocation and sign-out deny fresh reads and writes',async()=>{
      await seed('/users/'+rep.uid,{...rep.profile,active:false});await denied(write(rep,make(rep)));await denied(sdk.getDocFromServer(sdk.doc(rep.db,'orders',savedRefs.get('field_rep'))));
      await authSdk.signOut(owner.auth);await denied(write(owner,make(owner)));await denied(sdk.getDocFromServer(sdk.doc(owner.db,'orders',savedRefs.get('owner'))));
    });
  } finally { for(const a of actors){await sdk.terminate(a.db);await deleteApp(a.app);} }
});
