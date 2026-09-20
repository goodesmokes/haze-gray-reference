const { extractInlineModule, readRepositoryFile, collectNamedNodes, nodeText } = require('./test-support.cjs');
const source = extractInlineModule();
const pricingSource = readRepositoryFile('js/domain/pricing.mjs');
const pricingNames = ['parseMoney', 'getNumericPrice', 'getSinglePrice', 'computePackageMargins'];
const authorizationSource = readRepositoryFile('js/domain/authorization.mjs');
const authorizationNames = ['ROLE_LABELS', 'NO_PERMISSIONS', 'ROLE_PERMISSIONS', 'isValidRole', 'isActiveProfile', 'getProfilePermissions'];
const names = ['ROLE_LABELS', 'NO_PERMISSIONS', 'ROLE_PERMISSIONS', 'isValidRole', 'isActiveProfile', 'getProfilePermissions', 'normalizeRetailerName', 'nonnegativeMoney', 'PACK_OPTIONS', 'SEED_CIGARS', 'parseMoney', 'getNumericPrice', 'getSinglePrice', 'validRetailerId', 'buildSavedOrder', 'isReadableSavedOrder', 'buildReorderPlan', 'mergeReorderItems', 'savePendingOrder', 'RETAILER_FIELDS', 'territoryDisplay', 'normalizeTerritory', 'retailerTerritoryLabel', 'retailerTerritoryFields', 'retailerTerritoryOptions', 'filterRetailerTerritories', 'territoryMismatches', 'retailerAssignments', 'isAssignableRetailerUser', 'validateRepAssignments', 'assignedRepLabel', 'assignmentSummary', 'filterRetailerAssignments', 'checkNewRepAssignments', 'saveRetailerAssignments', 'useAssignmentProfiles', 'formatRetailerPhone', 'RetailerPhoneInput', 'validateRetailer', 'findDuplicateRetailer', 'retailerLocation', 'normalizeRetailerSearch', 'RetailerLocation', 'retailerSearch', 'hasMeaningfulDraft', 'retailerOrderFields', 'saveRetailerProfile'];
const nodes = collectNamedNodes(source, (name) => names.includes(name));
const pricingNodes = collectNamedNodes(pricingSource, (name) => pricingNames.includes(name));
const authorizationNodes = collectNamedNodes(authorizationSource, (name) => authorizationNames.includes(name));
exports.loadClient = (environment = {}) => {
  const code = names.map((name) => {
    const sourceNodes = pricingNodes.has(name) ? pricingNodes : authorizationNodes.has(name) ? authorizationNodes : nodes;
    const declarationSource = pricingNodes.has(name) ? pricingSource : authorizationNodes.has(name) ? authorizationSource : source;
    const node = sourceNodes.get(name); if (!node) throw new Error('Missing client helper: ' + name);
    const body = nodeText(declarationSource, sourceNodes, name);
    return node.type === 'FunctionDeclaration' ? body : `const ${name} = ${body};`;
  }).join('\n');
  return Function(...Object.keys(environment), code + '\nreturn {' + names.join(',') + '};')(...Object.values(environment));
};
