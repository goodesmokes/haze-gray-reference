const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadClient } = require('./client-helpers.cjs');
const { importNativeModule } = require('./test-support.cjs');
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8085' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && process.env.GCLOUD_PROJECT === 'demo-haze-gray-orders';

test('Spark browser SDK and Auth/Firestore rules', { skip: !enabled, timeout: 120000 }, async (t) => {
  const { createOrderService } = await importNativeModule('js/services/order-service.mjs');
  const { createRetailerService } = await importNativeModule('js/services/retailer-service.mjs');
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
      const client = loadClient({...sdk,auth,db});
      client.savePendingOrder = createOrderService({ db, auth, api: sdk }).savePendingOrder;
      Object.assign(client, createRetailerService({ db, auth, api: sdk }));
      actors.push({role,app,auth,db,uid,profile,client});
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
    await t.test('retailers: shared reads, creation, status restrictions and immutable audit fields',async()=>{
      const form = { ...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])), name:'Shared Shop '+Date.now(), active:true };
      const makeRetailer = (a) => ({ ...a.client.validateRetailer(form),...a.client.retailerTerritoryFields(a.profile.territory),schemaVersion:1,creatorUid:a.uid,creatorDisplayName:a.profile.displayName,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp() });
      const refs=[];
      for(const a of allowed){const ref=sdk.doc(sdk.collection(a.db,'retailers'));await sdk.setDoc(ref,makeRetailer(a));refs.push(ref.id);}
      const id=refs[0], repRef=sdk.doc(rep.db,'retailers',id), ownerRef=sdk.doc(owner.db,'retailers',id), adminRef=sdk.doc(admin.db,'retailers',id);
      assert((await sdk.getDocFromServer(repRef)).exists());
      assert((await sdk.getDocsFromServer(sdk.query(sdk.collection(rep.db,'retailers'),sdk.where('active','==',true)))).size>=3);
      await denied(sdk.getDocsFromServer(sdk.collection(rep.db,'retailers')));
      for(const a of actors.filter(a=>!allowed.includes(a))){await denied(sdk.setDoc(sdk.doc(sdk.collection(a.db,'retailers')),makeRetailer(a)));await denied(sdk.getDocFromServer(sdk.doc(a.db,'retailers',id)));}
      await denied(sdk.setDoc(sdk.doc(sdk.collection(rep.db,'retailers')),{...makeRetailer(rep),creatorUid:owner.uid}));
      await denied(sdk.setDoc(sdk.doc(sdk.collection(rep.db,'retailers')),{...makeRetailer(rep),createdAt:sdk.Timestamp.fromMillis(0)}));
      await denied(sdk.setDoc(sdk.doc(sdk.collection(rep.db,'retailers')),{...makeRetailer(rep),active:false}));
      await sdk.updateDoc(repRef,{phone:'+1 (555) 123-4567',updatedAt:sdk.serverTimestamp()});
      await denied(sdk.updateDoc(repRef,{active:false,updatedAt:sdk.serverTimestamp()}));
      for(const a of allowed){const ref=sdk.doc(a.db,'retailers',id);await denied(sdk.deleteDoc(ref));for(const patch of [{creatorUid:rep.uid},{creatorDisplayName:'Different'},{createdAt:sdk.Timestamp.fromMillis(0)},{schemaVersion:2}])await denied(sdk.updateDoc(ref,{...patch,updatedAt:sdk.serverTimestamp()}));}
      await sdk.updateDoc(ownerRef,{active:false,updatedAt:sdk.serverTimestamp()});
      assert((await sdk.getDocFromServer(adminRef)).exists());await denied(sdk.getDocFromServer(repRef));await denied(sdk.updateDoc(repRef,{active:true,updatedAt:sdk.serverTimestamp()}));
      await sdk.updateDoc(adminRef,{active:true,updatedAt:sdk.serverTimestamp()});assert((await sdk.getDocFromServer(repRef)).exists());
      for(const patch of [{name:''},{phone:123},{notes:'x'.repeat(5001)},{extra:'not allowed'},{updatedAt:sdk.Timestamp.fromMillis(0)}])await denied(sdk.updateDoc(ownerRef,{updatedAt:sdk.serverTimestamp(),...patch}));
      await assert.rejects(rep.client.saveRetailerProfile(null,form,rep.uid,()=>true),e=>!!e.retailerId);
      const unique={...form,name:'Client-created '+Date.now()};
      const created=await rep.client.saveRetailerProfile(null,unique,rep.uid,()=>true);
      await rep.client.saveRetailerProfile(created,{...unique,city:'Port City'},rep.uid,()=>true);
      assert.equal((await sdk.getDocFromServer(sdk.doc(rep.db,'retailers',created))).data().city,'Port City');
      await assert.rejects(rep.client.saveRetailerProfile(created,{...unique,active:false},rep.uid,()=>true),/status/);
      await assert.rejects(rep.client.saveRetailerProfile(null,unique,rep.uid,()=>false),/authorized/);
    });
    await t.test('linked and manual saved orders retain snapshots and order read restrictions',async()=>{
      const payload={...make(rep),retailerId:'linked-retailer'}, pending={id:reference(rep).id,uid:rep.uid,payload};
      await rep.client.savePendingOrder(pending,rep.uid,()=>true,[cigar],rep.client.PACK_OPTIONS);
      const saved=(await sdk.getDocFromServer(sdk.doc(rep.db,'orders',pending.id))).data();
      assert.equal(saved.retailerId,'linked-retailer');assert.equal(saved.retailerName,payload.retailerName);
      for(const retailerId of ['',null,123,'x'.repeat(129),'a/b'])await denied(write(rep,{...make(rep),retailerId}));
      await write(rep,make(rep));
      const ownerOrder=reference(owner);await write(owner,{...make(owner),retailerId:'linked-retailer'},ownerOrder);
      await denied(sdk.getDocFromServer(sdk.doc(rep.db,'orders',ownerOrder.id)));
    });
    await t.test('assignment rules: legacy compatibility, shared access, manager assignment and immutable rep assignments',async()=>{
      const form={...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])),name:'Assignment legacy '+Date.now(),active:true};
      const data={...owner.client.validateRetailer(form),schemaVersion:1,creatorUid:owner.uid,creatorDisplayName:owner.profile.displayName,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()};
      const ref=sdk.doc(sdk.collection(owner.db,'retailers'));await sdk.setDoc(ref,data);
      const repRef=sdk.doc(rep.db,'retailers',ref.id),adminRef=sdk.doc(admin.db,'retailers',ref.id);
      assert.deepEqual(rep.client.retailerAssignments((await sdk.getDocFromServer(repRef)).data()),[]);
      await sdk.updateDoc(repRef,{city:'Shared City',updatedAt:sdk.serverTimestamp()});
      assert(!Object.hasOwn((await sdk.getDocFromServer(ref)).data(),'assignedRepUids'));
      await denied(sdk.updateDoc(repRef,{assignedRepUids:[],updatedAt:sdk.serverTimestamp()}));
      for(const managerRef of [ref,adminRef]){
        await sdk.updateDoc(managerRef,{assignedRepUids:[rep.uid,'rep-b'],updatedAt:sdk.serverTimestamp()});
        await sdk.updateDoc(managerRef,{assignedRepUids:['rep-b'],updatedAt:sdk.serverTimestamp()});
        await sdk.updateDoc(managerRef,{assignedRepUids:[],updatedAt:sdk.serverTimestamp()});
      }
      await sdk.updateDoc(ref,{assignedRepUids:['rep-b'],updatedAt:sdk.serverTimestamp()});
      assert((await sdk.getDocFromServer(repRef)).exists()); // Not assigned to this rep: still shared.
      await sdk.updateDoc(repRef,{phone:'555',assignedRepUids:['rep-b'],updatedAt:sdk.serverTimestamp()});
      for(const assignedRepUids of [[],[rep.uid],['rep-b',rep.uid],['spoof'],sdk.deleteField()])await denied(sdk.updateDoc(repRef,{assignedRepUids,updatedAt:sdk.serverTimestamp()}));
      await denied(sdk.getDocFromServer(sdk.doc(actor('viewer').db,'retailers',ref.id)));
      for(const managerRef of [ref,adminRef])await denied(sdk.deleteDoc(managerRef));
      await denied(sdk.getDocFromServer(sdk.doc(rep.db,'users',owner.uid)));
      await denied(sdk.getDocsFromServer(sdk.collection(rep.db,'users')));
      assert((await sdk.getDocFromServer(sdk.doc(rep.db,'users',rep.uid))).exists());
      assert((await sdk.getDocsFromServer(sdk.collection(admin.db,'users'))).size>0);
    });
    await t.test('assignment rules validate all ten UID slots, exact fields, duplicates and create restrictions',async()=>{
      const form={...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])),name:'Assignment bounds '+Date.now(),active:true};
      const create=(a,assignedRepUids)=>sdk.setDoc(sdk.doc(sdk.collection(a.db,'retailers')),{...a.client.validateRetailer(form),...a.client.retailerTerritoryFields(a.profile.territory),schemaVersion:1,creatorUid:a.uid,creatorDisplayName:a.profile.displayName,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),assignedRepUids});
      for(const a of [owner,admin])for(const assigned of [[],[rep.uid],[rep.uid,'rep-b']])await create(a,assigned);
      await create(rep,[]);await denied(create(rep,[rep.uid]));await denied(create(rep,['rep-b']));
      for(const a of actors.filter(a=>!allowed.includes(a)))await denied(create(a,[]));
      const ten=Array.from({length:10},(_,i)=>'rep-'+i);await create(owner,ten);
      const maximumRef=sdk.doc(sdk.collection(owner.db,'retailers'));
      await sdk.setDoc(maximumRef,{...owner.client.validateRetailer(form),schemaVersion:1,creatorUid:owner.uid,creatorDisplayName:owner.profile.displayName,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),assignedRepUids:[]});
      await sdk.updateDoc(maximumRef,{assignedRepUids:ten,updatedAt:sdk.serverTimestamp()});
      await sdk.updateDoc(sdk.doc(admin.db,'retailers',maximumRef.id),{assignedRepUids:[...ten].reverse(),updatedAt:sdk.serverTimestamp()});
      await sdk.updateDoc(sdk.doc(rep.db,'retailers',maximumRef.id),{city:'Shared maximum',updatedAt:sdk.serverTimestamp()});
      assert.equal((await sdk.getDocFromServer(maximumRef)).data().assignedRepUids.length,10);
      for(const invalid of [null,'uid',{},[''],['a/b'],['x'.repeat(129)],['a','a'],[...ten,'eleventh']])await denied(create(owner,invalid));
      for(let i=0;i<10;i++){const invalid=[...ten];invalid[i]=42;await denied(create(owner,invalid));}
    });
    await t.test('territory permissions, legacy compatibility and ten-assignment updates',async()=>{
      const form={...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])),name:'Territory '+Date.now(),active:true};
      const id=await owner.client.saveRetailerProfile(null,form,owner.uid,()=>true);
      const ref=sdk.doc(owner.db,'retailers',id), repRef=sdk.doc(rep.db,'retailers',id);
      const update=(a,patch)=>sdk.updateDoc(sdk.doc(a.db,'retailers',id),{...patch,updatedAt:sdk.serverTimestamp()});
      const ten=Array.from({length:10},(_,i)=>'boundary-'+i);
      await update(owner,{assignedRepUids:ten});
      for(const manager of [owner,admin])for(const territory of [' Eastern   Oklahoma ','West','x'.repeat(500),'']){
        await update(manager,manager.client.retailerTerritoryFields(territory));
        await update(rep,{city:'Allowed contact edit'});
        assert.equal((await sdk.getDocFromServer(ref)).data().assignedRepUids.length,10);
      }
      for(const patch of [{territory:'West',territoryNormalized:'west'},{territoryNormalized:sdk.deleteField()},{territory:sdk.deleteField()},{assignedRepUids:[]},{active:false}])await denied(update(rep,patch));
      for(const patch of [{territory:42},{territory:'x'.repeat(501)},{territory:'East',territoryNormalized:'wrong'},{territoryNormalized:42},{assignedRepUids:[...ten,'eleventh']}])await denied(update(owner,patch));
      await update(owner,{territory:sdk.deleteField(),territoryNormalized:sdk.deleteField()});
      await update(rep,{city:'Legacy remains editable'});
      assert(!Object.hasOwn((await sdk.getDocFromServer(ref)).data(),'territory'));
      await denied(update(rep,{territory:'',territoryNormalized:''}));
      await assert.rejects(rep.client.saveRetailerProfile(id,{...form,territory:'West'},rep.uid,()=>true),/authorized/);
      const original=rep.profile;
      try {
        for(const home of [' Eastern   Oklahoma ','']){
          await seed('/users/'+rep.uid,{...original,territory:home});
          const created=await rep.client.saveRetailerProfile(null,{...form,name:form.name+' rep '+home},rep.uid,()=>true);
          const stored=(await sdk.getDocFromServer(sdk.doc(rep.db,'retailers',created))).data();
          assert.equal(stored.territory,home.trim());assert.equal(stored.territoryNormalized,rep.client.normalizeTerritory(home));
          const raw={...rep.client.validateRetailer(form),schemaVersion:1,creatorUid:rep.uid,creatorDisplayName:original.displayName,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),territory:'Spoof',territoryNormalized:'spoof'};
          await denied(sdk.setDoc(sdk.doc(sdk.collection(rep.db,'retailers')),raw));
          await assert.rejects(rep.client.saveRetailerProfile(null,{...form,name:form.name+' spoof '+home,territory:'Spoof'},rep.uid,()=>true),/profile/);
        }
      } finally {await seed('/users/'+rep.uid,original);}
      assert.equal((await sdk.getDocFromServer(repRef)).data().city,'Legacy remains editable');
    });
    await t.test('assignment client saves recheck profiles, preserve stale reps, reject conflicts and keep contact edits separate',async()=>{
      const repB='assignment-rep-b-'+Date.now();
      const profileB={displayName:'Rep B',email:'b@example.test',territory:'Test',role:'field_rep',active:true};await seed('/users/'+repB,profileB);
      const form={...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])),name:'Assignment client '+Date.now(),active:true};
      const id=await owner.client.saveRetailerProfile(null,{...form,assignedRepUids:[rep.uid,repB]},owner.uid,()=>true);
      const ref=sdk.doc(owner.db,'retailers',id);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,[rep.uid,repB]);
      await admin.client.saveRetailerAssignments(id,[repB],[rep.uid,repB],admin.uid,()=>true);
      await seed('/users/'+repB,{...profileB,active:false});
      await owner.client.saveRetailerAssignments(id,[repB,rep.uid],[repB],owner.uid,()=>true);
      await rep.client.saveRetailerProfile(id,{...form,city:'Contact edit'},rep.uid,()=>true);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,[repB,rep.uid]);
      await assert.rejects(rep.client.saveRetailerAssignments(id,[],[repB,rep.uid],rep.uid,()=>true),/not authorized/);
      await assert.rejects(rep.client.saveRetailerProfile(id,{...form,assignedRepUids:[]},rep.uid,()=>true),/Assigned Users/);
      await assert.rejects(owner.client.saveRetailerAssignments(id,[],[],owner.uid,()=>true),/Assignments changed/);
      await owner.client.saveRetailerAssignments(id,[],[repB,rep.uid],owner.uid,()=>true);
      await assert.rejects(owner.client.saveRetailerAssignments(id,[repB],[],owner.uid,()=>true),/active Owner, Admin, or Field Rep/);
      await seed('/users/'+repB,{...profileB,role:'viewer'});
      await assert.rejects(admin.client.saveRetailerAssignments(id,[repB],[],admin.uid,()=>true),/active Owner, Admin, or Field Rep/);
      await assert.rejects(admin.client.saveRetailerAssignments(id,['nonexistent-user'],[],admin.uid,()=>true),/active Owner, Admin, or Field Rep/);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,[]);
      const tenProfiles=Array.from({length:10},(_,i)=>'assignment-ten-'+Date.now()+'-'+i);
      for(const uid of tenProfiles)await seed('/users/'+uid,{...profileB,displayName:'Boundary Rep'});
      await admin.client.saveRetailerAssignments(id,tenProfiles,[],admin.uid,()=>true);
      await owner.client.saveRetailerAssignments(id,[],tenProfiles,owner.uid,()=>true);
      const repId=await rep.client.saveRetailerProfile(null,{...form,name:form.name+' Rep'},rep.uid,()=>true);
      assert.deepEqual((await sdk.getDocFromServer(sdk.doc(rep.db,'retailers',repId))).data().assignedRepUids,[]);
      await assert.rejects(rep.client.saveRetailerProfile(null,{...form,name:form.name+' Spoof',assignedRepUids:[rep.uid]},rep.uid,()=>true),/not authorized/);
      const adminId=await admin.client.saveRetailerProfile(null,{...form,name:form.name+' Admin',assignedRepUids:[rep.uid]},admin.uid,()=>true);
      assert.deepEqual((await sdk.getDocFromServer(sdk.doc(admin.db,'retailers',adminId))).data().assignedRepUids,[rep.uid]);
    });
    await t.test('mixed-role assignments support managers, enforce rep restrictions and retain stale users',async()=>{
      const form={...Object.fromEntries(Object.keys(rep.client.RETAILER_FIELDS).map(key=>[key,''])),name:'Mixed roles '+Date.now(),active:true};
      const mixed=[owner.uid,admin.uid,rep.uid];
      const id=await owner.client.saveRetailerProfile(null,{...form,assignedRepUids:mixed},owner.uid,()=>true);
      const ref=sdk.doc(owner.db,'retailers',id), repRef=sdk.doc(rep.db,'retailers',id);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,mixed);
      for(const next of [[],[rep.uid],[owner.uid],sdk.deleteField()])await denied(sdk.updateDoc(repRef,{assignedRepUids:next,updatedAt:sdk.serverTimestamp()}));
      await rep.client.saveRetailerProfile(id,{...form,city:'Shared mixed account'},rep.uid,()=>true);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,mixed);
      await admin.client.saveRetailerAssignments(id,[owner.uid,rep.uid],mixed,admin.uid,()=>true);
      await owner.client.saveRetailerAssignments(id,[],[owner.uid,rep.uid],owner.uid,()=>true);
      await admin.client.saveRetailerAssignments(id,mixed,[],admin.uid,()=>true);
      const createdByAdmin=await admin.client.saveRetailerProfile(null,{...form,name:form.name+' Admin',assignedRepUids:mixed},admin.uid,()=>true);
      assert.deepEqual((await sdk.getDocFromServer(sdk.doc(admin.db,'retailers',createdByAdmin))).data().assignedRepUids,mixed);
      for(const uid of [actor('viewer').uid,actor('inactive').uid,'absent-assignee'])await assert.rejects(owner.client.saveRetailerAssignments(id,[...mixed,uid],mixed,owner.uid,()=>true),/active Owner, Admin, or Field Rep/);
      const stale=['owner','admin','field_rep'].map(role=>'mixed-stale-'+role+'-'+Date.now());
      for(let i=0;i<stale.length;i++)await seed('/users/'+stale[i],{...rep.profile,role:['owner','admin','field_rep'][i]});
      await owner.client.saveRetailerAssignments(id,stale,mixed,owner.uid,()=>true);
      for(let i=0;i<2;i++)await seed('/users/'+stale[i],{...rep.profile,role:['owner','admin'][i],active:false});
      await seed('/users/'+stale[2],{...rep.profile,role:'viewer'});
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,stale);
      await admin.client.saveRetailerAssignments(id,[...stale,rep.uid],stale,admin.uid,()=>true);
      await admin.client.saveRetailerAssignments(id,[],[...stale,rep.uid],admin.uid,()=>true);
      for(const uid of stale)await assert.rejects(owner.client.saveRetailerAssignments(id,[uid],[],owner.uid,()=>true),/active Owner, Admin, or Field Rep/);
      assert.deepEqual((await sdk.getDocFromServer(ref)).data().assignedRepUids,[]);
      await denied(sdk.getDocFromServer(sdk.doc(rep.db,'users',admin.uid)));
    });
    await t.test('profile revocation and sign-out deny fresh reads and writes',async()=>{
      await seed('/users/'+rep.uid,{...rep.profile,active:false});await denied(write(rep,make(rep)));await denied(sdk.getDocFromServer(sdk.doc(rep.db,'orders',savedRefs.get('field_rep'))));
      await authSdk.signOut(owner.auth);await denied(write(owner,make(owner)));await denied(sdk.getDocFromServer(sdk.doc(owner.db,'orders',savedRefs.get('owner'))));
    });
  } finally { for(const a of actors){await sdk.terminate(a.db);await deleteApp(a.app);} }
});
