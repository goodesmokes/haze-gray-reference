const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),cp=require('node:child_process');
const {loadClient}=require('./client-helpers.cjs');
const {importNativeModule,readApplicationModule,readRepositoryFile}=require('./test-support.cjs');
let createRetailerService;
test.before(async()=>{({createRetailerService}=await importNativeModule('js/services/retailer-service.mjs'));});
const client=loadClient();
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const source=readApplicationModule();
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']}),nodes={};
traverse(ast,{FunctionDeclaration(p){nodes[p.node.id.name]=p.node;},VariableDeclarator(p){if(p.node.id.name !== 'filtered' || p.getFunctionParent()?.node.id?.name === 'OrderHistory') nodes[p.node.id.name]=p.node.init;}});
const editorSource=readRepositoryFile('js/components/retailer-editors.mjs');
const editorAst=parser.parse(editorSource,{sourceType:'module',plugins:['jsx']}),editorNodes={};
traverse(editorAst,{FunctionDeclaration(p){editorNodes[p.node.id.name]=p.node;}});
const directorySource=readRepositoryFile('js/components/retailer-directory.mjs');
const directoryAst=parser.parse(directorySource,{sourceType:'module'}),directoryNodes={};
traverse(directoryAst,{FunctionDeclaration(p){directoryNodes[p.node.id.name]=p.node;}});
const text=name=>{const node=editorNodes[name]||directoryNodes[name]||nodes[name],value=editorNodes[name]?editorSource:directoryNodes[name]?directorySource:source;return value.slice(node.start,node.end);};
const form={...Object.fromEntries(Object.keys(client.RETAILER_FIELDS).map(key=>[key,''])),name:'  Harbor Shop  ',active:true};
test('directory cards render normalized location only when available',()=>{
 const ui=loadClient({React:{createElement:(tag,props,child)=>({tag,props,child})}});
 for(const [retailer,expected] of [[{city:' Esteli ',state:' OK '},'Esteli, OK'],[{city:'Esteli'},'Esteli'],[{state:'OK'},'OK']]){
   const rendered=ui.RetailerLocation({retailer});assert.equal(rendered.tag,'div');assert.equal(rendered.child,expected);assert.equal(rendered.props.style.display,'block');
 }
 for(const retailer of [{},{city:'',state:''},{city:'  ',state:'  '}])assert.equal(ui.RetailerLocation({retailer}),null);
 // Ensure the actual directory card uses this component, rather than testing an unused formatter.
 assert.match(text('RetailerDirectory'),/h\(RetailerLocation, \{ retailer: item \}\)/);
});
test('directory search matches individual and combined location, name and contact',()=>{
 const retailer={name:'Harbor Shop',contactName:'Pat Smith',city:' Esteli ',state:' OK '};
 for(const query of ['Esteli','OK','Esteli, OK','esteli, ok','  ESTELI ,   ok  ','Esteli,OK','harbor',' PAT SMITH '])assert(client.retailerSearch(retailer,query),query);
 assert(!client.retailerSearch(retailer,'Esteli, VA'));
});
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
 const subscriptionApi={collection:()=>({}),query:()=>({}),where:()=>({}),onSnapshot:(_source,next,error)=>{callback=next;fail=error;return ()=>stopped++;}};
 const env={auth,getProfilePermissions:client.getProfilePermissions,subscribeRetailerDirectory:createRetailerService({db:{},auth,api:subscriptionApi}).subscribeRetailerDirectory,
 useState:initial=>[state===undefined?initial:state,value=>{state=value;}],
 useEffect:effect=>{cleanup=effect();}};
 const hook=Function(...Object.keys(env),'return '+text('useRetailerDirectory'))(...Object.values(env));
 hook({uid:'owner'},{role:'owner',active:true},true);
 callback({docs:[{id:'r1',data:()=>({name:'Private',nameNormalized:'private',active:true})}]});assert.equal(state.records.length,1);
 const old=callback;cleanup();auth.currentUser={uid:'rep'};
 const next=hook({uid:'rep'},{role:'field_rep',active:true},true);assert.deepEqual(next.records,[]);
 old({docs:[{id:'old',data:()=>({name:'Old',nameNormalized:'old',active:true})}]});assert.deepEqual(state.records,[]);
 fail(new Error('denied'));assert.deepEqual(state.records,[]);assert.match(state.error,/denied/);
 cleanup();auth.currentUser=null;hook(null,null,false);assert.deepEqual(state.records,[]);assert.equal(stopped,2);
});
test('only optional territory validation and permissions change in Firestore rules',()=>{
 const current=fs.readFileSync('firestore.rules','utf8').replace(/\r\n/g,'\n');
 const old=cp.execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
 const withoutTerritory=value=>value
 .replace("&& (isManager() || (request.resource.data.get('territory', '').trim() == userDoc(request.auth.uid).data.get('territory', '').trim()\n      && (!('assignedRepUids' in request.resource.data) || request.resource.data.assignedRepUids == [])))", "&& (isManager() || !('assignedRepUids' in request.resource.data) || request.resource.data.assignedRepUids == [])")
 .replace("&& (isManager() || (resource.data.active == true && request.resource.data.active == resource.data.active\n      && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['assignedRepUids', 'territory', 'territoryNormalized'])))", "&& (isManager() || !request.resource.data.diff(resource.data).affectedKeys().hasAny(['assignedRepUids']))\n    && (isManager() || (resource.data.active == true && request.resource.data.active == resource.data.active))")
 .replace(/\/\/ Optional organizational territory[\s\S]*?(?=function validRetailer\()/,'')
 .replace("hasOnly(['territory', 'territoryNormalized', 'assignedRepUids'", "hasOnly(['assignedRepUids'")
 .split('\n').filter(line=>!line.includes('&& validRetailerTerritory(data)') && !line.includes("&& (isManager() || request.resource.data.get('territory'") && !line.includes("hasAny(['territory', 'territoryNormalized'])")).join('\n');
 assert.equal(withoutTerritory(current),withoutTerritory(old));
});

test('US phone formats raw, punctuated, country-code and progressive values',()=>{
 const format=client.formatRetailerPhone;
 for(const country of ['', 'United States','USA','US',' us ']){
  for(const phone of ['5551234567','555-123-4567','(555)1234567','15551234567','+1 (555) 123-4567'])assert.equal(format(phone,country),'(555) 123-4567');
 }
 const expected=['','5','55','(555)','(555) 1','(555) 12','(555) 123','(555) 123-4','(555) 123-45','(555) 123-456','(555) 123-4567'];
 expected.forEach((value,index)=>assert.equal(format('5551234567'.slice(0,index)),value));
 assert.equal(format('   '),'');
 for(const phone of ['+44 20 7946 0958','5551234567','  020 7946 0958 ext 2  '])assert.equal(format(phone,'United Kingdom'),phone);
 for(const phone of ['+44 20 7946 0958','555123456789','555-123-4567 ext 2'])assert.equal(format(phone,''),phone);
});

test('phone input normalizes typing and paste but preserves cursor edits until blur',()=>{
 const ui=loadClient({React:{createElement:(tag,props)=>({tag,props})},userFieldStyle:{}});
 let result;
 const input=ui.RetailerPhoneInput({value:'',country:'US',disabled:false,onChange:value=>result=value}).props;
 const event=(value,inputType='insertText',selectionStart=value.length)=>({target:{value,selectionStart},nativeEvent:{inputType}});
 input.onChange(event('555'));assert.equal(result,'(555)');
 input.onChange(event('555-123-4567','insertFromPaste'));assert.equal(result,'(555) 123-4567');
 input.onChange(event('15551234567','insertFromPaste'));assert.equal(result,'(555) 123-4567');
 input.onChange(event('(555','deleteContentBackward'));assert.equal(result,'(555');
 input.onChange(event('5551234567','insertText',2));assert.equal(result,'5551234567');
 input.onBlur(event('5551234567'));assert.equal(result,'(555) 123-4567');
 const foreign=ui.RetailerPhoneInput({value:'',country:'France',onChange:value=>result=value}).props;
 foreign.onChange(event('+33 1 23 45 67 89','insertFromPaste'));assert.equal(result,'+33 1 23 45 67 89');
 foreign.onBlur(event('+33 1 23 45 67 89'));assert.equal(result,'+33 1 23 45 67 89');
});

test('retailer form identifies address fields while keeping territory out of browser address autofill',()=>{
 const autocomplete=client.RETAILER_AUTOCOMPLETE;
 assert.deepEqual(autocomplete,{contactName:'name',email:'email',phone:'tel',address1:'address-line1',address2:'address-line2',city:'address-level2',state:'address-level1',postalCode:'postal-code',country:'country-name',website:'url'});
 const editor=text('RetailerEditor');
 assert.match(editor,/autoComplete: RETAILER_AUTOCOMPLETE\[key\]/);
 assert.match(editor,/"aria-label": "Retailer territory", autoComplete: "off", list: "retailer-territory-options"/);
 assert.match(editor,/onChange: \(e\) => setForm\(\{ \.\.\.form, \[key\]: e\.target\.value \}\)/);
 assert.doesNotMatch(editor,/address2\s*:\s*form\.address1|address1\s*:\s*form\.address2/);
 const phone=loadClient({React:{createElement:(tag,props)=>({tag,props})},userFieldStyle:{}}).RetailerPhoneInput({value:'',country:'US',onChange:()=>{}});
 assert.equal(phone.props.autoComplete,'tel');
});

test('existing retailer phones format on edit, display and save through shared helper',()=>{
 let initializer;
 traverse(editorAst,{CallExpression(p){if(p.node.callee.name==='useState' && p.getFunctionParent()?.node.id?.name==='RetailerEditor' && p.node.arguments[0]?.type==='ArrowFunctionExpression' && p.parentPath.node.id?.elements?.[0]?.name==='form')initializer=p.node.arguments[0];}});
 const initialize=Function('retailer','RETAILER_FIELDS','formatRetailerPhone','return ('+editorSource.slice(initializer.start,initializer.end)+')()');
 assert.equal(initialize({phone:'5551234567',country:'US'},client.RETAILER_FIELDS,client.formatRetailerPhone).phone,'(555) 123-4567');
 assert.equal(initialize(null,client.RETAILER_FIELDS,client.formatRetailerPhone).phone,'');
 assert.equal(initialize({phone:'5551234567',country:'France'},client.RETAILER_FIELDS,client.formatRetailerPhone).phone,'5551234567');
 assert.equal(client.validateRetailer({...form,phone:'5551234567'}).phone,'(555) 123-4567');
 assert.equal(client.validateRetailer({...form,phone:'5551234567',country:'France'}).phone,'5551234567');
 assert.match(text('RetailerEditor'),/h\(RetailerPhoneInput, \{ value: form.phone, country: form.country/);
 assert.match(text('RetailerDirectory'),/formatRetailerPhone\(selected.phone, selected.country\)/);
 assert.match(text('RetailerDirectory'),/formatRetailerPhone\(item.phone, item.country\)/);
});
