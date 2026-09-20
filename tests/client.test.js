const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),cp=require('child_process');
const {loadClient}=require('./client-helpers.cjs');
const parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const babel={babelParse:code=>parser.parse(code,{sourceType:'module',plugins:['jsx']}),traverse};
process.chdir(require('node:path').join(__dirname,'..'));
const source=fs.readFileSync('index.html','utf8').replace(/\r\n/g,'\n').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const original=cp.execFileSync('git',['show','HEAD:index.html'],{encoding:'utf8',maxBuffer:2000000}).replace(/\r\n/g,'\n').match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast=babel.babelParse(source,'index.jsx',true),oldAst=babel.babelParse(original,'index.jsx',true);
function named(tree,name){let result;babel.traverse(tree,{FunctionDeclaration(p){if(p.node.id.name===name)result=p.node;},VariableDeclarator(p){if(p.node.id.name===name)result=p.node.init;}});assert(result,name);return result;}
const text=name=>{const n=named(ast,name);return source.slice(n.start,n.end);};
const clean=n=>JSON.parse(JSON.stringify(n,(key,value)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:value));
for(const name of ['firebaseConfig','getGaugePosition','Gauge','addToOrder','DetailOrderControls','saveAuthorizationProfile','AuthorizationProfileEditor','AuthorizedUsers','orderWholesaleTotal','orderRetailTotal','orderGrossProfit','orderMarginPct','buildOrderText','emailOrder','copyOrderText'])assert.deepEqual(clean(named(ast,name)),clean(named(oldAst,name)),name+' changed');
const rules=fs.readFileSync('firestore.rules','utf8').replace(/\r\n/g,'\n');
const oldRules=cp.execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
// Exclude only the new orders section on both sides, whether HEAD predates or includes it.
// Catalog, Authorized Users, legacy access and the catch-all remain compared in full.
const legacyRules = (value) => value.replace(/\/\/ -------------------------------\n\/\/ IMMUTABLE SAVED ORDERS[\s\S]*?(?=\/\/ Everything else denied\.)/,'');
assert.equal(legacyRules(rules),legacyRules(oldRules));
assert.equal(legacyRules(rules),legacyRules(legacyRules(rules)), 'Normalization must work with or without the orders section');
assert.notEqual(legacyRules(rules.replace('allow create, update, delete: if isManager();','allow create, update, delete: if true;')),legacyRules(rules), 'Catalog changes must remain detectable');
assert.notEqual(legacyRules(rules.replace('request.resource.data.role == resource.data.role','true')),legacyRules(rules), 'Authorized Users protection changes must remain detectable');
console.log('PASS preservation: config, seed data, gauges, catalog/Authorized Users rules, pricing, original order handlers and exports');
const ctx={console,TextEncoder};vm.createContext(ctx);
const domain=loadClient();Object.assign(ctx,{parseMoney:domain.parseMoney,getNumericPrice:domain.getNumericPrice,getSinglePrice:domain.getSinglePrice,computePackageMargins:domain.computePackageMargins,validRetailerId:domain.validRetailerId,normalizeRetailerName:domain.normalizeRetailerName,nonnegativeMoney:domain.nonnegativeMoney,buildSavedOrder:domain.buildSavedOrder,buildReorderPlan:domain.buildReorderPlan,mergeReorderItems:domain.mergeReorderItems,PACK_OPTIONS:domain.PACK_OPTIONS,SEED_CIGARS:domain.SEED_CIGARS});
vm.runInContext(text('loadOrderDraft'),ctx);
for(const name of ['orderMoney','savedOrderDate','ORDER_DRAFT_STORAGE_KEY'])vm.runInContext('globalThis.'+name+'='+text(name),ctx);
const user={uid:'rep'},profile={displayName:'Test Rep',role:'field_rep',active:true};
const line={lineKey:'1982__1982-robusto__box10',cigarId:'1982',cigarName:'1982',vitola:'Robusto',dims:'50 x 5',packKey:'box10',packLabel:'10ct Box',unitPrice:60,retailUnitValue:124,qty:2};
const draft={orderItems:[line],orderRetailer:'  Test SHOP  ',orderEmail:'test@example.test',orderNotes:'Keep this draft'};
const before=JSON.stringify(draft),saved=ctx.buildSavedOrder(draft,user,profile);
assert.equal(saved.retailerName,'  Test SHOP  ');assert.equal(saved.retailerNameNormalized,'test shop');assert.equal(saved.lineItems[0].sizeKey,'1982-robusto');assert.equal(saved.totals.wholesaleTotal,120);assert.equal(saved.creatorUid,'rep');assert.equal(JSON.stringify(draft),before);
const plan=ctx.buildReorderPlan(saved,ctx.SEED_CIGARS,ctx.PACK_OPTIONS,[line]);assert.equal(plan.available[0].line.unitPrice,64.5);assert.equal(plan.available[0].historicalPrice,60);assert.equal(plan.available[0].activePrice,60);
const unrelated={...line,lineKey:'other__s__box10',cigarId:'other',unitPrice:77};
const added=ctx.mergeReorderItems([line,unrelated],plan.available.map(x=>x.line));assert.equal(added[0].qty,4);assert.equal(added[0].unitPrice,64.5);assert.equal(added[1].unitPrice,77);assert.equal(line.unitPrice,60);
assert.equal(ctx.mergeReorderItems([],plan.available.map(x=>x.line))[0].qty,2);
for(const field of ['cigarId','sizeKey','packKey']){const missing=structuredClone(saved);missing.lineItems[0][field]='missing';assert.equal(ctx.buildReorderPlan(missing,ctx.SEED_CIGARS,ctx.PACK_OPTIONS,[]).unavailable.length,1);}
for(const qty of [0,-1,1.5,Infinity])assert.throws(()=>ctx.buildSavedOrder({...draft,orderItems:[{...line,qty}]},user,profile));
console.log('PASS saved snapshots, identity, retailer normalization, quantities, current-price reorder, merge/replace, missing configurations and immutable source objects');
