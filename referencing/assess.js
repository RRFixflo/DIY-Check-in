// Turns a reference into the report's findings and outcome. Pure: no files, no network.
// The outcome is a recommendation for the landlord, never a decision, and nothing here looks at whether the tenant
// receives benefits or has children (refusing for either is unlawful in England).
const RATIO = 30, GUARANTOR_RATIO = 36;   // annual income needed, as a multiple of the monthly rent

const monthIndex = s => { const m = /^(\d{4})-(\d{2})/.exec(String(s || '')); return m ? +m[1] * 12 + (+m[2] - 1) : null; };
const nowIndex = d => { d = d || new Date(); return d.getFullYear() * 12 + d.getMonth(); };
const pounds = n => '£' + Math.round(n).toLocaleString('en-GB');

// Months of address history and the gaps in it (needs 3 years).
function history(addresses, today){
  const now = nowIndex(today), spans = (addresses || []).map(a => [monthIndex(a.from), a.to === 'current' || !a.to ? now : monthIndex(a.to)]).filter(s => s[0] != null && s[1] != null && s[1] >= s[0]).sort((a, b) => a[0] - b[0]);
  if (!spans.length) return { months: 0, gaps: [], ok: false };
  const gaps = []; let end = spans[0][1];
  for (const [s, e] of spans.slice(1)) { if (s > end + 1) gaps.push(s - end - 1); end = Math.max(end, e); }
  if (now > end + 1) gaps.push(now - end - 1);
  const months = Math.min(now, end) - spans[0][0] + 1;
  return { months, gaps, ok: months >= 36 && !gaps.some(g => g > 2) };
}

function assess(r, today){
  const a = r.application || {}, rent = (r.property && r.property.rentP || 0) / 100, emp = a.employment || {};
  const er = (r.refs && r.refs.employer) || {}, lr = (r.refs && r.refs.landlord) || {}, cr = r.credit || {};
  const items = [];
  const add = (key, title, status, detail) => items.push({ key, title, status, detail });
  const submitted = !!a.submittedAt, g = r.role === 'guarantor', ratio = g ? GUARANTOR_RATIO : RATIO;

  // Identity and Right to Rent: the landlord's own legal duty; we collect the evidence, they confirm on GOV.UK.
  const rtr = a.rtr || {}, hasId = (r.files || []).some(f => f.kind === 'id');
  if (!submitted) add('rtr', 'Identity and Right to Rent', 'pending', 'Waiting for the application.');
  else if (r.rtrChecked) add('rtr', 'Identity and Right to Rent', 'pass', `Checked by the landlord on ${r.rtrChecked.date}${r.rtrChecked.how ? ' (' + r.rtrChecked.how + ')' : ''}.`);
  else add('rtr', 'Identity and Right to Rent', hasId || rtr.shareCode ? 'warn' : 'fail',
    (rtr.route === 'sharecode' ? `Share code ${rtr.shareCode || '(missing)'} given. ` : hasId ? 'Passport or ID uploaded. ' : 'No evidence given. ') + 'The landlord must check it before the tenancy starts and record the check.');

  // Affordability: income confirmed by the employer counts as verified; otherwise what the tenant declared.
  const confirmed = er.answers && er.answers.employed === 'yes' && +er.answers.salary > 0 ? +er.answers.salary : null;
  const declared = (+emp.salary || 0) + (+((a.otherIncome || {}).amount) || 0);
  const income = (confirmed || +emp.salary || 0) + (+((a.otherIncome || {}).amount) || 0), need = rent * ratio;
  const afford = { income, need, ratio: rent ? income / rent : 0, verified: confirmed != null, guarantorNeed: rent * GUARANTOR_RATIO, multiple: ratio, guarantor: g };
  if (!submitted) add('afford', 'Affordability', 'pending', 'Waiting for the application.');
  else if (!rent) add('afford', 'Affordability', 'warn', 'No rent set on the reference.');
  else if (income >= need) add('afford', 'Affordability', confirmed != null ? 'pass' : 'warn', `${pounds(income)} a year against ${pounds(need)} needed (${ratio} × ${pounds(rent)} rent${g ? ', as guarantor' : ''}): ${(income / rent).toFixed(1)} times the monthly rent${confirmed != null ? ', salary confirmed by the employer' : ', as declared (not yet confirmed)'}.`);
  else add('afford', 'Affordability', 'fail', `${pounds(income)} a year against ${pounds(need)} needed (${ratio} × ${pounds(rent)} rent${g ? ', as guarantor' : ''}).` + (g ? ' Not enough income to stand as guarantor for this rent.' : ` A guarantor earning ${pounds(afford.guarantorNeed)} or more would cover it.`));

  // Employer reference (or evidence of other income).
  const working = ['employed', 'self-employed'].includes(emp.status);
  if (!submitted) add('employer', 'Employment and income', 'pending', 'Waiting for the application.');
  else if (emp.status !== 'employed') add('employer', 'Employment and income', (r.files || []).some(f => f.kind === 'income') ? 'warn' : working ? 'fail' : 'na',
    { 'self-employed': 'Self-employed: check the accounts or tax returns uploaded.', student: 'Student: a guarantor is usual.', retired: 'Retired: check the pension statements uploaded.', 'not working': 'Not working: check the income evidence uploaded.' }[emp.status] || 'No employment given.');
  else if (!er.answers) add('employer', 'Employment and income', 'pending', `Reference requested from ${emp.employer || 'the employer'}${er.requestedAt ? '' : ' (not sent yet)'}.`);
  else if (er.answers.employed !== 'yes') add('employer', 'Employment and income', 'fail', `${emp.employer || 'The employer'} did not confirm the employment.`);
  else add('employer', 'Employment and income', er.answers.contract === 'permanent' && er.answers.probation !== 'yes' ? 'pass' : 'warn',
    `${er.answers.refName || 'The employer'} confirmed: ${er.answers.jobTitle || emp.jobTitle || 'employed'}, ${er.answers.contract || 'contract not given'}${er.answers.probation === 'yes' ? ', in probation' : ''}, ${pounds(+er.answers.salary || 0)} a year.`);

  // Previous landlord reference.
  const pl = a.prevLandlord || {};
  if (!submitted) add('landlord', 'Previous landlord', 'pending', 'Waiting for the application.');
  else if (g && pl.has !== 'yes') add('landlord', 'Previous landlord', 'na', 'Not needed for a guarantor.');
  else if (pl.has !== 'yes') add('landlord', 'Previous landlord', 'na', 'No previous landlord (for example lived with family or owned their home).');
  else if (!lr.answers) add('landlord', 'Previous landlord', 'pending', `Reference requested from ${pl.name || 'the previous landlord'}.`);
  else {
    const x = lr.answers, worry = x.paidOnTime === 'no' || +x.arrears > 0 || x.again === 'no' || x.condition === 'poor';
    add('landlord', 'Previous landlord', worry ? 'fail' : x.paidOnTime === 'mostly' ? 'warn' : 'pass',
      `Rent paid on time: ${x.paidOnTime || 'not said'}${+x.arrears > 0 ? ', arrears ' + pounds(+x.arrears) : ', no arrears'}; condition ${x.condition || 'not said'}; would rent to them again: ${x.again || 'not said'}.`);
  }

  // Address history.
  const h = history(a.addresses, today);
  if (!submitted) add('history', 'Address history', 'pending', 'Waiting for the application.');
  else add('history', 'Address history', h.ok ? 'pass' : 'warn', `${Math.floor(h.months / 12)} years ${h.months % 12} months given${h.gaps.length ? ', gaps of ' + h.gaps.map(g => g + ' month' + (g === 1 ? '' : 's')).join(', ') : ''}.`);

  // Credit.
  if (!submitted) add('credit', 'Credit check', 'pending', 'Waiting for the application and consent.');
  else if (cr.status === 'clear') add('credit', 'Credit check', 'pass', creditText(cr));
  else if (cr.status === 'adverse') add('credit', 'Credit check', 'fail', creditText(cr));
  else if (cr.status === 'no_trace') add('credit', 'Credit check', 'warn', 'No credit file found at the address (common for people new to the UK).');
  else if (cr.status === 'error') add('credit', 'Credit check', 'pending', 'The credit check could not be completed; it will be retried.');
  else add('credit', 'Credit check', 'pending', 'Not run yet: no credit check provider is connected. A credit report can be added by hand.');

  // Self-declared adverse credit.
  const adv = a.adverse || {};
  if (submitted && (adv.ccj === 'yes' || adv.bankrupt === 'yes')) add('declared', 'Declared by the tenant', 'warn', [adv.ccj === 'yes' && 'a CCJ', adv.bankrupt === 'yes' && 'a bankruptcy or IVA'].filter(Boolean).join(' and ') + (adv.details ? ': ' + adv.details : '') + '.');

  // Outcome.
  const st = k => (items.find(i => i.key === k) || {}).status, pending = items.filter(i => i.status === 'pending').map(i => i.title);
  const serious = ['rtr', 'employer', 'landlord', 'credit'].filter(k => st(k) === 'fail');
  let outcome, label;
  if (!submitted) { outcome = 'waiting'; label = g ? 'Waiting for the guarantor' : 'Waiting for the applicant'; }
  else if (serious.length) { outcome = 'checks'; label = 'Further checks needed'; }
  else if (pending.length) { outcome = 'progress'; label = 'In progress'; }
  else if (st('afford') === 'fail') { if (g) { outcome = 'checks'; label = 'Further checks needed'; } else { outcome = 'guarantor'; label = 'Accepted with a guarantor'; } }
  else { outcome = 'accepted'; label = g ? 'Accepted as guarantor' : 'Accepted'; }
  return { outcome, label, items, pending, afford, history: h, complete: submitted && !pending.length };
}
// Where a reference has got to, for the board: pay → applicant → referees → review → complete.
const STAGES = [['pay', 'Awaiting payment'], ['applicant', 'Awaiting the applicant'], ['refs', 'Awaiting referees'], ['review', 'Ready for your review'], ['complete', 'Complete']];
function stage(r, o){
  o = o || assess(r);
  if (r.status === 'awaiting_payment') return 'pay';
  if (!(r.application || {}).submittedAt) return 'applicant';
  if (o.items.some(i => ['employer', 'landlord'].includes(i.key) && i.status === 'pending')) return 'refs';
  return o.complete && r.rtrChecked ? 'complete' : 'review';
}
// The three headline results on the report, worst first: fail, pending, warn, pass (n/a counts as pass).
function headline(o){
  const order = ['fail', 'pending', 'warn', 'pass', 'na'], worst = keys => keys.map(k => (o.items.find(i => i.key === k) || {}).status).filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] || 'na';
  return [['Identity and Right to Rent', worst(['rtr'])], ['Background and credit', worst(['credit', 'landlord', 'history', 'declared'])], ['Income and affordability', worst(['afford', 'employer'])]];
}
function creditText(c){
  const s = c.summary || {}, bits = [];
  bits.push(s.ccjs ? `${s.ccjs} CCJ${s.ccjs === 1 ? '' : 's'}${s.ccjValue ? ' (' + pounds(s.ccjValue) + ')' : ''}` : 'no CCJs');
  bits.push(s.insolvency ? 'insolvency recorded' : 'no insolvency');
  if (s.defaults != null) bits.push(s.defaults ? s.defaults + ' default' + (s.defaults === 1 ? '' : 's') : 'no defaults');
  if (s.electoralRoll != null) bits.push(s.electoralRoll ? 'on the electoral roll' : 'not on the electoral roll');
  return bits.join(', ').replace(/^./, c => c.toUpperCase()) + '.' + (c.provider === 'manual' ? ' From a credit report added by hand.' : c.provider === 'sandbox' ? ' TEST DATA.' : '') + (s.notes && c.provider !== 'sandbox' ? ' ' + s.notes : '');
}
module.exports = { assess, history, stage, headline, STAGES, RATIO, GUARANTOR_RATIO, pounds };
