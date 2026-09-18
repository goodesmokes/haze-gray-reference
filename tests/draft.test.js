const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const source=fs.readFileSync('index.html','utf8').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const nodes={};let authEffect,persistEffect;
traverse(ast,{FunctionDeclaration(p){nodes[p.node.id.name]=p.node;},VariableDeclarator(p){nodes[p.node.id.name]=p.node.init;},CallExpression(p){if(p.node.callee.name==='useEffect'){const body=source.slice(p.node.arguments[0].start,p.node.arguments[0].end);if(body.includes('onAuthStateChanged'))authEffect=body;if(body.includes('Never persist'))persistEffect=body;}}});
const text=name=>source.slice(nodes[name].start,nodes[name].end);
test('UID-scoped draft lifecycle isolates accounts, authorization, transitions and legacy storage',()=>{
 const storage=new Map([['haze-gray-cigars.order-draft.v1',JSON.stringify({orderRetailer:'Unowned legacy'})]]);
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const state={}; const env={localStorage,auth:{currentUser:null},db:{},doc:(_db,_col,uid)=>uid,
 draftOwnerRef:{current:null},accessRef:{current:{}},NO_PERMISSIONS:{canUseOrderBuilder:false}};
 for(const name of ['RetailerId','ShowRetailers','SelectedRetailerId','HistoryRetailerId','DraftUid','OrderItems','OrderRetailer','OrderEmail','OrderNotes','ShowOrderBuilder','ShowFinalReview','ShowOrderHistory','CompareOrderId','CopyConfirmed','FormOpen','ConfirmDeleteId','ShowAuthorizedUsers','UserProfile','ProfileReady','ProfileError','User','AuthReady'])env['set'+name]=value=>state[name]=value;
 let authCallback,profileCallback;
 env.onAuthStateChanged=(_auth,cb)=>{authCallback=cb;return ()=>{};};
 env.onSnapshot=(_doc,cb)=>{profileCallback=cb;return ()=>{};};
 env.getProfilePermissions=p=>({canUseOrderBuilder:!!p?.active&&['owner','admin','field_rep'].includes(p.role)});
 const compile=body=>Function(...Object.keys(env),'return '+body)(...Object.values(env));
 env.ORDER_DRAFT_STORAGE_KEY=compile(text('ORDER_DRAFT_STORAGE_KEY'));
 env.validRetailerId=compile(text('validRetailerId'));env.orderDraftKey=compile(text('orderDraftKey'));env.loadOrderDraft=compile(text('loadOrderDraft'));env.clearProtectedDraft=compile(text('clearProtectedDraft'));
 compile(authEffect)();
 const login=(uid,role='owner',active=true)=>{env.auth.currentUser=uid?{uid}:null;authCallback(env.auth.currentUser);assert.deepEqual(state.OrderItems,[]);assert.equal(state.OrderRetailer,'');assert.equal(state.RetailerId,'');if(uid)profileCallback({exists:()=>true,data:()=>({role,active})});};
 const persist=()=>Function(...Object.keys(env),'draftUid','orderItems','orderRetailer','orderEmail','orderNotes','retailerId','return ('+persistEffect+')()')(...Object.values(env),state.DraftUid,state.OrderItems,state.OrderRetailer,state.OrderEmail,state.OrderNotes,state.RetailerId);
 login('owner');assert.equal(state.OrderRetailer,'');state.RetailerId='owner-retailer';state.OrderRetailer='Owner A';state.OrderEmail='owner@example.test';state.OrderNotes='Owner notes';state.OrderItems=[{lineKey:'1982__1982-robusto__box10',cigarId:'1982',cigarName:'1982',vitola:'Robusto',dims:'50 x 5',packKey:'box10',packLabel:'10ct Box',unitPrice:64.5,retailUnitValue:124,qty:2}];persist();assert.equal(JSON.parse(storage.get(env.orderDraftKey('owner'))).orderRetailer,'Owner A');
 login(null);persist();assert.equal(state.ShowOrderHistory,false);assert.equal(state.ShowFinalReview,false);
 login('rep','field_rep');assert.equal(state.OrderRetailer,'');state.OrderRetailer='Rep B';persist();login(null);
 login('owner');assert.equal(state.OrderRetailer,'Owner A');assert.equal(state.RetailerId,'owner-retailer');assert.equal(state.OrderItems[0].qty,2);assert.equal(state.OrderEmail,'owner@example.test');assert.equal(state.OrderNotes,'Owner notes');login('rep','field_rep');assert.deepEqual(state.OrderItems,[]);assert.equal(state.OrderRetailer,'Rep B');
 profileCallback({exists:()=>true,data:()=>({role:'viewer',active:true})});assert.equal(state.OrderRetailer,'');persist();
 login('rep','field_rep');assert.equal(state.OrderRetailer,'Rep B');
 for(const [role,active] of [['viewer',true],['unknown',true],['owner',false]]){login('owner',role,active);assert.equal(state.OrderRetailer,'');persist();}
 login('owner');assert.equal(state.OrderRetailer,'Owner A');
 const staleProfile=profileCallback;login('rep','field_rep');staleProfile({exists:()=>true,data:()=>({role:'owner',active:true})});assert.equal(state.OrderRetailer,'Rep B');
 assert.equal(JSON.parse(storage.get('haze-gray-cigars.order-draft.v1')).orderRetailer,'Unowned legacy');
});
