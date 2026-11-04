// The credit check, through a provider (a credit reference agency or a referencing API). Nothing is sent anywhere
// until one is configured with CREDIT_PROVIDER and its keys. Every provider has the same shape:
//   configured() → true when its keys are set
//   run({ tenant, addresses, dob, consentAt }) → { status, summary, providerRef }
//     status: 'clear' | 'adverse' | 'no_trace' | 'error'
//     summary: { ccjs, ccjValue, insolvency, defaults, electoralRoll, score, notes }  (any may be null)
// To add a real provider: add an entry below that calls its API (its own documentation decides the calls and fields),
// and set CREDIT_PROVIDER to its name. Until then the landlord can record a credit report the tenant or landlord got
// themselves ('manual', with the PDF attached), and the report says which it was.
const PROVIDERS = {
  // For trying the flow only. Refuses to run unless CREDIT_SANDBOX=1, and every result says TEST DATA.
  sandbox: {
    label: 'Sandbox (test data, not a real check)',
    configured: () => process.env.CREDIT_SANDBOX === '1',
    async run({ tenant }){
      const bad = /adverse/i.test(tenant.lastName || '');
      return { status: bad ? 'adverse' : 'clear', providerRef: 'SANDBOX-' + Date.now().toString(36),
        summary: { ccjs: bad ? 1 : 0, ccjValue: bad ? 1450 : 0, insolvency: false, defaults: bad ? 2 : 0, electoralRoll: true, score: null, notes: 'TEST DATA from the sandbox, not a real credit check.' } };
    }
  },
};
function provider(){ const n = String(process.env.CREDIT_PROVIDER || '').toLowerCase(); return PROVIDERS[n] && PROVIDERS[n].configured() ? n : ''; }
function label(){ const p = provider(); return p ? PROVIDERS[p].label : ''; }
async function run(input){
  const p = provider();
  if (!p) return { status: 'not_configured' };
  try { const r = await PROVIDERS[p].run(input); return Object.assign({ provider: p, at: new Date().toISOString() }, r); }
  catch (e) { console.error('credit: ' + p + ' failed: ' + e.message); return { provider: p, status: 'error', at: new Date().toISOString() }; }
}
module.exports = { provider, label, run };
