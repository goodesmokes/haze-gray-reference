const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadClient}=require('./client-helpers.cjs');
const {importNativeModule,readApplicationModule,readRepositoryFile}=require('./test-support.cjs');
let createRetailerService;
test.before(async()=>{({createRetailerService}=await importNativeModule('js/services/retailer-service.mjs'));});
const client=loadClient();
const source=readApplicationModule();
const directorySource=readRepositoryFile('js/components/retailer-directory.mjs');
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const directoryAst=parser.parse(directorySource,{sourceType:'module'});
const nodes={};traverse(ast,{FunctionDeclaration(p){nodes[p.node.id.name]=p.node;}});
const directoryNodes={};traverse(directoryAst,{FunctionDeclaration(p){directoryNodes[p.node.id.name]=p.node;},VariableDeclarator(p){if(p.getFunctionParent()?.node.id?.name==='RetailerDirectory')directoryNodes[p.node.id.name]=p.node.init;}});
const text=name=>{const node=directoryNodes[name]||nodes[name],value=directoryNodes[name]?directorySource:source;return value.slice(node.start,node.end);};

test('assignment lists support legacy, shared ownership, removals and bounded UID strings',()=>{
 assert.deepEqual(client.retailerAssignments({}),[]);
 const list=['rep-a','rep-b'];assert.deepEqual(client.validateRepAssignments(list),list);
 assert.notEqual(client.validateRepAssignments(list),list);
 assert.deepEqual(client.validateRepAssignments([]),[]);
 assert.equal(client.validateRepAssignments(Array.from({length:10},(_,i)=>'rep-'+i)).length,10);
 for(const value of [null,'uid',{},[3],[''],['a/b'],['x'.repeat(129)],['a','a'],Array.from({length:11},(_,i)=>'r'+i)])assert.throws(()=>client.validateRepAssignments(value));
});

test('assignment names/status are manager-only; reps receive anonymous labels',()=>{
 const profiles=[{uid:'a',displayName:'Alice',role:'field_rep',active:true},{uid:'b',displayName:'Bob',role:'field_rep',active:false},{uid:'c',displayName:'Carol',role:'admin',active:true}];
 assert.equal(client.assignedRepLabel('a','a',true,profiles),'Alice — Field Rep (Active)');
 assert.match(client.assignedRepLabel('b','a',true,profiles),/Bob.*Inactive Field Rep/);
 assert.match(client.assignedRepLabel('c','a',true,profiles),/Carol.*Admin \(Active\)/);
 assert.equal(client.assignedRepLabel('missing','a',true,profiles),'Unavailable user');
 assert.equal(client.assignedRepLabel('a','a',false,profiles),'You');
 assert.equal(client.assignedRepLabel('b','a',false,profiles),'Other assigned user');
 assert.equal(client.assignmentSummary({},'a',false,profiles),'Unassigned');
 assert.equal(client.assignmentSummary({assignedRepUids:['a','b']},'a',false,profiles),'Assigned (2): You, Other assigned user');
 assert.equal(client.assignmentSummary({assignedRepUids:['a','b','c']},'a',true,profiles,true),'Assigned (3): Alice — Field Rep (Active) +2');
 assert.match(client.assignmentSummary({assignedRepUids:['a','b','c']},'a',true,profiles),/Carol/);
 assert.deepEqual(profiles.filter(client.isAssignableRetailerUser).map(p=>p.uid),['a','c']);
});

test('My/All/Assigned/Unassigned/rep filters preserve the shared dataset and search',()=>{
 const records=[{id:'legacy',name:'Legacy'},{id:'empty',assignedRepUids:[]},{id:'mine',assignedRepUids:['a','b'],city:'Esteli',state:'OK'},{id:'other',assignedRepUids:['b']}];
 const ids=filter=>client.filterRetailerAssignments(records,filter,'a').map(r=>r.id);
 assert.deepEqual(ids('mine'),['mine']);assert.deepEqual(ids('all'),records.map(r=>r.id));
 assert.deepEqual(ids('assigned'),['mine','other']);assert.deepEqual(ids('unassigned'),['legacy','empty']);
 assert.deepEqual(ids('rep:b'),['mine','other']);assert.equal(records.length,4);
 assert(client.retailerSearch(client.filterRetailerAssignments(records,'mine','a')[0],' esteli, ok '));
 const defaultFilter=Function('assignmentFilter','permissions','hasMine','return '+text('activeFilter'));
 assert.equal(defaultFilter('',{canFilterOwnRetailers:true},true),'mine');
 assert.equal(defaultFilter('',{canFilterOwnRetailers:true},false),'all');
 assert.equal(defaultFilter('all',{canFilterOwnRetailers:true},true),'all');
 assert.equal(defaultFilter('',{canFilterOwnRetailers:false},true),'all');
 const showEmptyState=Function('activeFilter','hasMine','return '+text('showMyRetailersEmptyState'));
 assert(showEmptyState('mine',false));
 for(const filter of ['all','assigned','unassigned','rep:b'])assert(!showEmptyState(filter,false),filter);
 assert(!showEmptyState('mine',true));
 for(const role of ['owner','admin','field_rep']){
  const permissions=client.getProfilePermissions({role,active:true});
  assert.equal(defaultFilter('',permissions,true),role==='field_rep'?'mine':'all');
  assert.equal(defaultFilter('mine',permissions,true),'mine');
  const records=[{id:'mine',assignedRepUids:[role]},{id:'other',assignedRepUids:['another']}];
  assert.deepEqual(client.filterRetailerAssignments(records,'mine',role).map(r=>r.id),['mine']);
 }
 assert.match(text('RetailerDirectory'),/permissions\.canFilterOwnRetailers && h\("option", \{ value: "mine" \}, "My Retailers"\)/);
 assert.match(text('RetailerDirectory'),/permissions\.canAssignRetailers && h\(React\.Fragment/);
 assert.match(text('RetailerDirectory'),/showMyRetailersEmptyState && h\("p", null, "No retailers are currently assigned to you\./);
 assert.match(text('RetailerDirectory'),/No retailers are currently assigned to you/);
 for(const role of ['owner','admin'])assert(client.getProfilePermissions({role,active:true}).canAssignRetailers);
 assert(client.getProfilePermissions({role:'field_rep',active:true}).canFilterOwnRetailers);
 for(const role of ['field_rep','viewer','unknown'])assert(!client.getProfilePermissions({role,active:true}).canAssignRetailers);
 for(const role of ['owner','admin'])assert(client.getProfilePermissions({role,active:true}).canFilterOwnRetailers);
 assert(!client.getProfilePermissions({role:'viewer',active:true}).canFilterOwnRetailers);
 assert(!client.getProfilePermissions({role:'owner',active:false}).canAssignRetailers);
});

test('profile listener never starts for Field Reps and clears across accounts, role loss and failures',()=>{
 let state,cleanup,callback,failure,subscriptions=0,stops=0;
 const auth={currentUser:{uid:'owner'}};
 const subscriptionApi={collection:()=>({}),onSnapshot:(_ref,next,error)=>{subscriptions++;callback=next;failure=error;return ()=>stops++;}};
 const env={auth,subscribeAssignmentProfiles:createRetailerService({db:{},auth,api:subscriptionApi}).subscribeAssignmentProfiles,
 useState:initial=>typeof initial==='number'?[0,()=>{}]:[state===undefined?initial:state,value=>state=value],
 useEffect:effect=>{cleanup=effect();}};
 const ui=loadClient(env);
 assert.deepEqual(ui.useAssignmentProfiles({uid:'owner'},false).profiles,[]);assert.equal(subscriptions,0);cleanup();
 ui.useAssignmentProfiles({uid:'owner'},true);callback({docs:[{id:'a',data:()=>({displayName:'Alice',role:'field_rep',active:true})}]});assert.equal(state.profiles.length,1);
 const old=callback;cleanup();auth.currentUser={uid:'admin'};
 assert.deepEqual(ui.useAssignmentProfiles({uid:'admin'},true).profiles,[]);
 old({docs:[{id:'secret',data:()=>({displayName:'old'})}]});assert.deepEqual(state.profiles,[]);
 callback({docs:[{id:'b',data:()=>({displayName:'Bob'})}]});assert.equal(state.profiles[0].uid,'b');
 failure(new Error('permission denied'));assert.deepEqual(state.profiles,[]);assert.match(state.error,/Could not load assignment profiles/);
 cleanup();auth.currentUser={uid:'rep'};assert.deepEqual(ui.useAssignmentProfiles({uid:'rep'},false).profiles,[]);assert.equal(subscriptions,2);
 cleanup();auth.currentUser=null;assert.deepEqual(ui.useAssignmentProfiles(null,false).profiles,[]);assert.equal(stops,2);
 assert.match(text('HazeGrayReference'),/useAssignmentProfiles\(user, showRetailers && permissions.canAssignRetailers\)/);
 assert.match(text('RetailerDirectory'),/editingAssignments && selected && permissions.canAssignRetailers/);
});

test('save handler requires manager role, checks newly assigned active reps and preserves stale UIDs',async()=>{
 let role='owner',active=true,current=['stale'],writes=[],reads=[];
 const profiles={a:{role:'field_rep',active:true},b:{role:'field_rep',active:true},stale:{role:'viewer',active:true},inactive:{role:'field_rep',active:false}};
 const auth={currentUser:{uid:'manager'}};
 const transaction={get:async ref=>{reads.push(ref);const data=ref==='users/manager'?{role,active}:ref==='retailers/r'?{assignedRepUids:current,name:'Keep business fields'}:profiles[ref.slice(6)];return {exists:()=>!!data,data:()=>data};},update:(ref,data)=>writes.push({ref,data})};
 const ui=createRetailerService({db:{},auth,api:{doc:(_db,col,id)=>col+'/'+id,runTransaction:async(_db,fn)=>fn(transaction),serverTimestamp:()=> 'server-time'}});
 for(const managerRole of ['owner','admin']){
  role=managerRole;writes=[];reads=[];await ui.saveRetailerAssignments('r',['stale','a','b'],['stale'],'manager',()=>true);
  assert.equal(writes.length,1);assert.deepEqual(writes[0].data,{assignedRepUids:['stale','a','b'],updatedAt:'server-time'});assert(!reads.includes('users/stale'));
 }
 for(const next of [['a'],[]]){writes=[];await ui.saveRetailerAssignments('r',next,['stale'],'manager',()=>true);assert.deepEqual(writes[0].data.assignedRepUids,next);}
 for(const next of [['inactive'],['missing']]){writes=[];await assert.rejects(ui.saveRetailerAssignments('r',next,['stale'],'manager',()=>true),/active Owner, Admin, or Field Rep/);assert.equal(writes.length,0);}
 current=[];await assert.rejects(ui.saveRetailerAssignments('r',['stale'],[],'manager',()=>true),/active Owner, Admin, or Field Rep/);
 await assert.rejects(ui.saveRetailerAssignments('r',['a'],['stale'],'manager',()=>true),/Assignments changed/);
 for(const deniedRole of ['field_rep','viewer','unknown']){role=deniedRole;writes=[];await assert.rejects(ui.saveRetailerAssignments('r',['a'],[],'manager',()=>true),/not authorized/);assert.equal(writes.length,0);}
 role='owner';active=false;await assert.rejects(ui.saveRetailerAssignments('r',[],[],'manager',()=>true),/not authorized/);
 active=true;await assert.rejects(ui.saveRetailerAssignments('r',[],[],'manager',()=>false),/not authorized/);
 auth.currentUser=null;await assert.rejects(ui.saveRetailerAssignments('r',[],[],'manager',()=>true),/not authorized/);
});

test('mixed-role eligibility and current status labels preserve stale assignment identity',()=>{
 const profiles=['owner','admin','field_rep','viewer','unknown'].flatMap(role=>[true,false].map(active=>({uid:role+'-'+active,role,active,displayName:role})));
 assert.deepEqual(profiles.filter(client.isAssignableRetailerUser).map(p=>p.uid),['owner-true','admin-true','field_rep-true']);
 assert(!client.isAssignableRetailerUser(null));
 for(const [uid,expected] of [['owner-true','Owner (Active)'],['admin-true','Admin (Active)'],['owner-false','Inactive Owner'],['admin-false','Inactive Admin'],['viewer-true','Viewer (Active; not assignable)']])assert(client.assignedRepLabel(uid,'',true,profiles).includes(expected));
 const retailer={assignedRepUids:['owner-false','admin-false','viewer-true','missing']},before=JSON.stringify(retailer);
 assert.match(client.assignmentSummary(retailer,'',true,profiles),/Unavailable user/);assert.equal(JSON.stringify(retailer),before);
 for(const uid of ['owner-true','admin-true'])assert.equal(client.assignedRepLabel(uid,'rep',false,profiles),'Other assigned user');
});

test('assignment validators and indexes remain unchanged',()=>{
 const cp=require('node:child_process');
 const rules=fs.readFileSync('firestore.rules','utf8').replace(/\r\n/g,'\n'),oldRules=cp.execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
 const assignments=value=>value.slice(value.indexOf('function validRepUidAt'),value.indexOf('function validRetailer(')).replace(/\/\/ Optional organizational territory[\s\S]*/,'');
 assert.equal(assignments(rules),assignments(oldRules));
 for(const file of ['firestore.indexes.json'])assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'}).replace(/\r\n/g,'\n'));
});
