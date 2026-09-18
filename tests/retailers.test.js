const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),cp=require('node:child_process');
const {loadClient}=require('./client-helpers.cjs');
const client=loadClient();
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const source=fs.readFileSync('index.html','utf8').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']}),nodes={};
traverse(ast,{FunctionDeclaration(p){nodes[p.node.id.name]=p.node;},VariableDeclarator(p){if(p.node.id.name !== 'filtered' || p.getFunctionParent()?.node.id?.name === 'OrderHistory') nodes[p.node.id.name]=p.node.init;}});
const text=name=>source.slice(nodes[name].start,nodes[name].end);
const form={...Object.fromEntries(Object.keys(client.RETAILER_FIELDS).map(key=>[key,''])),name:'  Harbor Shop  ',active:true};
test('retailer normalization, form limits, duplicate warnings, search and roles',()=>{
 const data=client.validateRetailer({...form,email:' sales@example.test ',phone:'+1 (555) ext 7'});
 assert.equal(data.name,'Harbor Shop');assert.equal(data.nameNormalized,'harbor shop');assert.equal(data.email,'sales@example.test');
 for(const invalid of [{name:'   '},{email:'bad email'},{phone:42},{name:'x'.repeat(501)},{notes:'x'.repeat(5001)}])assert.throws(()=>client.validateRetailer({...form,...invalid}));
 const retailer={...data,id:'r1',contactName:'Pat Smith',city:'Norfolk',state:'VA'};
 assert.equal(client.findDuplicateRetailer([retailer],' HARBOR SHOP ').id,'r1');
 assert.equal(client.findDuplicateRetailer([{...retailer,active:false}],'Harbor Shop'),undefined);
 for(const query of ['HARBOR','pat','NORFOLK','va'])assert(client.retailerSearch(retailer,query));
 assert(!client.retailerSearch(retailer,'unmatched'));
 for(const role of ['owner','admin','field_rep'])assert(client.getProfilePermissions({role,active:true}).canUseRetailers);
 for(const role of ['viewer','unknown'])assert(!client.getProfilePermissions({role,active:true}).canUseRetailers);
 assert(!client.getProfilePermissions({role:'owner',active:false}).canUseRetailers);
 assert(!client.getProfilePermissions({role:'field_rep',active:true}).canChangeRetailerStatus);
});
test('actual builder handlers select, switch to manual, and guard replacement without copying customer notes',()=>{
 const retailer={...client.validateRetailer(form),id:'r1',notes:'Customer-level notes',email:'shop@example.test'};
 const state={items:[{qty:2}],notes:'Order-level notes'};
 let permitted=true,opened=0,error='';
 const draft={orderItems:state.items,orderRetailer:'Other',orderEmail:'',orderNotes:state.notes};
 const env={directory:{records:[retailer]},requirePermission:()=>permitted,activeDraft:draft,
 retailerOrderFields:client.retailerOrderFields,hasMeaningfulDraft:client.hasMeaningfulDraft,
 setRetailerId:v=>state.id=v,setOrderRetailer:v=>state.name=v,setOrderEmail:v=>state.email=v,setOrderItems:v=>state.items=v,setOrderNotes:v=>state.notes=v,setError:v=>error=v,openOrderBuilder:()=>opened++};
 const compile=name=>Function(...Object.keys(env),'return '+text(name))(...Object.values(env));
 const select=compile('selectOrderRetailer'),start=compile('startRetailerOrder');
 select('r1');assert.equal(state.id,'r1');assert.equal(state.email,'shop@example.test');assert.equal(state.notes,'Order-level notes');
 select('');assert.equal(state.id,'');assert.equal(state.name,'Harbor Shop');
 start('r1');assert.equal(opened,0);assert.match(error,/Confirm replacement/);assert.equal(state.items.length,1);
 start('r1',true);assert.equal(opened,1);assert.deepEqual(state.items,[]);assert.equal(state.notes,'');assert.equal(state.id,'r1');
 permitted=false;select('');assert.equal(state.id,'r1');start('r1',true);assert.equal(opened,1);
 permitted=true;retailer.active=false;select('r1');assert.match(error,/no longer available/);
});
test('linked snapshots, legacy orders, exact-ID history and immutable historic display',()=>{
 const line={lineKey:'1982__1982-robusto__box10',cigarId:'1982',cigarName:'1982',vitola:'Robusto',dims:'50 x 5',packKey:'box10',packLabel:'10ct Box',qty:2,unitPrice:60,retailUnitValue:124};
 const draft={orderItems:[line],orderRetailer:'Original name',orderEmail:'old@example.test',orderNotes:'Order notes'};
 const legacy=client.buildSavedOrder(draft,{uid:'rep'},{displayName:'Rep'});
 const linked=client.buildSavedOrder({...draft,retailerId:'r1'},{uid:'rep'},{displayName:'Rep'});
 assert(!Object.hasOwn(legacy,'retailerId'));assert(client.isReadableSavedOrder(legacy));assert.equal(linked.retailerId,'r1');assert.equal(linked.retailerEmail,'old@example.test');
 const expression=text('filtered');
 const filter=Function('orders','retailerFilter','search','normalizeRetailerName','return '+expression);
 assert.deepEqual(filter([legacy,linked],'r1','',client.normalizeRetailerName),[linked]);
 assert.equal(filter([legacy,linked],null,'ORIGINAL',client.normalizeRetailerName).length,2);
 assert.equal(client.buildReorderPlan(linked,client.SEED_CIGARS,client.PACK_OPTIONS,[]).available[0].line.unitPrice,64.5);
 assert.equal(linked.lineItems[0].unitPrice,60);
});
test('directory subscriptions fail closed across account, role changes and errors',()=>{
 let state,callback,fail,stopped=0,cleanup;
 const auth={currentUser:{uid:'owner'}};
 const env={auth,getProfilePermissions:client.getProfilePermissions,db:{},collection:()=>({}),query:()=>({}),where:()=>({}),
 useState:initial=>[state===undefined?initial:state,value=>{state=value;}],
 useEffect:effect=>{cleanup=effect();},
 onSnapshot:(_source,next,error)=>{callback=next;fail=error;return ()=>stopped++;}};
 const hook=Function(...Object.keys(env),'return '+text('useRetailerDirectory'))(...Object.values(env));
 hook({uid:'owner'},{role:'owner',active:true},true);
 callback({docs:[{id:'r1',data:()=>({name:'Private',nameNormalized:'private',active:true})}]});assert.equal(state.records.length,1);
 const old=callback;cleanup();auth.currentUser={uid:'rep'};
 const next=hook({uid:'rep'},{role:'field_rep',active:true},true);assert.deepEqual(next.records,[]);
 old({docs:[{id:'old',data:()=>({name:'Old',nameNormalized:'old',active:true})}]});assert.deepEqual(state.records,[]);
 fail(new Error('denied'));assert.deepEqual(state.records,[]);assert.match(state.error,/denied/);
 cleanup();auth.currentUser=null;hook(null,null,false);assert.deepEqual(state.records,[]);assert.equal(stopped,2);
});
test('existing rules change only by adding retailers and optional order retailerId',()=>{
 const current=fs.readFileSync('firestore.rules','utf8').replace(/\r\n/g,'\n');
 const old=cp.execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
 const restored=current.replace(/\/\/ -------------------------------\n\/\/ SHARED RETAILER DIRECTORY[\s\S]*?(?=\/\/ Everything else denied\.)/,'')
 .replace("hasOnly(['retailerId', 'schemaVersion', 'status'","hasOnly(['schemaVersion', 'status'")
 .split('\n').filter(line=>!line.includes("!('retailerId' in request.resource.data)")).join('\n');
 assert.equal(restored,old);
});
