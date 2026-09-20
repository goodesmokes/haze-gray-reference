const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadClient}=require('./client-helpers.cjs');
const c=loadClient();
test('territory normalization, legacy labels, options and bounds',()=>{
 assert.deepEqual(c.retailerTerritoryFields(' Eastern   Oklahoma '),{territory:'Eastern   Oklahoma',territoryNormalized:'eastern oklahoma'});
 for(const r of [{},{territory:''},{territory:'  '}])assert.equal(c.retailerTerritoryLabel(r),'Unassigned Territory');
 assert.equal(c.retailerTerritoryLabel({territory:' West '}),'West');
 assert.throws(()=>c.retailerTerritoryFields('x'.repeat(501)));
 assert.throws(()=>c.retailerTerritoryFields(123));
 assert.equal(c.retailerTerritoryFields('x'.repeat(500)).territory.length,500);
 assert.deepEqual(c.retailerTerritoryOptions([{territory:' Eastern  Oklahoma '},{territory:'eastern oklahoma'}],[{active:true,territory:'West'},{active:false,territory:'Hidden'}],{territory:'WEST'}),[{value:'eastern oklahoma',label:'Eastern Oklahoma'},{value:'west',label:'West'}]);
});
test('territory filters remain distinct from assignments and respond to live home changes',()=>{
 const rows=[{id:'a',territory:'East',assignedRepUids:[]},{id:'b',territory:'West',assignedRepUids:['rep']},{id:'c',territory:' EAST ',assignedRepUids:['rep']},{id:'d'}];
 const before=JSON.stringify(rows), ids=r=>r.map(x=>x.id);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'mine','east')),['a','c']);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'mine','west')),['b']);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'other','east')),['b']);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'unassigned','east')),['d']);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'mine','')),[]);
 assert.deepEqual(ids(c.filterRetailerTerritories(rows,'all','')),['a','b','c','d']);
 assert.deepEqual(ids(c.filterRetailerTerritories(c.filterRetailerAssignments(rows,'mine','rep'),'territory:east','')),['c']);
 assert.equal(JSON.stringify(rows),before);
});
test('territory search and manager-only cross-territory information preserve privacy',()=>{
 const retailer={territory:'Eastern Oklahoma',assignedRepUids:['other']};
 assert(c.retailerSearch(retailer,'  EASTERN OKLAHOMA '));
 const profiles=[{uid:'other',displayName:'Pat',territory:'West'}];
 assert.deepEqual(c.territoryMismatches(retailer,profiles,false),[]);
 assert.deepEqual(c.territoryMismatches(retailer,profiles,true),[{uid:'other',name:'Pat',territory:'West'}]);
 for(const role of ['owner','admin'])assert(c.getProfilePermissions({role,active:true}).canEditRetailerTerritory);
 for(const role of ['field_rep','viewer'])assert(!c.getProfilePermissions({role,active:true}).canEditRetailerTerritory);
});
