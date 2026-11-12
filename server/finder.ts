import { Hono } from 'hono';
import { capabilities, categories, dollars, type Capability, type Release } from '../src/domain';
import { blankFinderBrief, type FinderBrief, type FinderEvidence, type FinderResult, type Requirement } from '../src/finder-contract';
import { listCatalog } from './catalog';
import { assert, byIP, local, readJSON, str, throttle, type AppEnv } from './common';
import { interpretWithGemini } from './gemini';
import { literalBrief } from './search';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000;
const noPreference = /\b(?:do not|don't|does not|doesn't)\s+(?:need|require|care about)\b|\b(?:public internet|public hosting)\b.*\boptional\b/i;
const requiresConnection = /\b(?:must never|must not|cannot|can't|should never)\s+(?:run|work|play)\s+(?:offline|without (?:an? )?(?:internet|network))/i;
const costClarification = /\b(?:cheap enough|affordable enough)\s+(?:to|for)\b/i;
const bareBudget = /\bbudget(?: of)?\s+\d+(?:\.\d{1,2})?(?![\d.])\b/i;
const splitBrief = (query: string) => query.split(/[.!?](?=\s|$)|[,;]|\b(?:but|and)\b/i).map(part => part.trim()).filter(Boolean);
const upfront = /\b(under|less than|below|up to|at most|max(?:imum)?|budget(?: of)?|no more than)\s*\$\s*(\d+)(?:\.(\d{1,2}))?(?![\d.])/i;
const recurring = /\$\s*(\d+)(?:\.(\d{1,2}))?\s*(?:per month|a month|monthly)\b/i;
const toCents = (whole: string, fraction?: string) => Number(whole) * 100 + Number((fraction ?? '').padEnd(2, '0'));
const excludesStack = /\b(?:must not|cannot|can't)\s+(?:depend on|use|require)\s+([a-z][\w.+#-]{1,32})/i;
const hardBrowser = /\b(?:need|require|must|mandatory)\b.*\bbrowser\b|\bbrowser\b.*\bmandatory\b/i;

function explicitRequirements(query: string): Requirement[] {
  const result: Requirement[] = [];
  for (const clause of splitBrief(query)) {
    const quote = clause.slice(0, 240);
    const stack = excludesStack.exec(clause);
    const monthly = recurring.exec(clause);
    if (stack) result.push({ kind: 'stack', value: stack[1].replace(/[.]$/, ''), priority: 'must', expected: false, quote });
    if (monthly) {
      const value = toCents(monthly[1], monthly[2]);
      if (money(value)) result.push({ kind: 'recurring-budget', value, priority: 'must', expected: true, quote });
    }
    if (requiresConnection.test(clause)) result.push({ kind: 'capability', key: 'offline', priority: 'must', expected: false, quote });
    if (hardBrowser.test(clause) && !noPreference.test(clause)) result.push({ kind: 'capability', key: 'browser', priority: 'must', expected: true, quote });
  }
  return result;
}

function statedUpfront(query: string) {
  for (const clause of splitBrief(query)) {
    const cap = upfront.exec(clause);
    if (!cap || recurring.test(clause)) continue;
    const cents = toCents(cap[2], cap[3]);
    if (money(cents)) return { cents, inclusive: !/^(under|less than|below)$/i.test(cap[1]), quote: cap[0] };
  }
  return null;
}

function grounded(input: FinderBrief, query: string): FinderBrief {
  const clauses = splitBrief(query);
  const requirements = input.requirements.filter(entry => !clauses.some(clause => clause.includes(entry.quote) && noPreference.test(clause)));
  for (const explicit of explicitRequirements(query)) {
    const already = requirements.some(entry => identity(entry) === identity(explicit) && entry.expected === explicit.expected && entry.priority === 'must');
    if (!already && requirements.length < 12) requirements.push(explicit);
  }
  const ambiguities = [...input.ambiguities];
  const upfront = statedUpfront(query);
  const unqualifiedBudget = !upfront && clauses.find(clause => bareBudget.test(clause) && !/\bUSD\b|\$/i.test(clause));
  if (unqualifiedBudget && !ambiguities.some(entry => bareBudget.test(entry.quote))) {
    ambiguities.push({ reason: 'Confirm the budget currency and whether the amount is one-time.', quote: unqualifiedBudget.slice(0, 240) });
  }
  if (costClarification.test(query) && !ambiguities.length) {
    ambiguities.push({ reason: 'Specify the operating budget and billing period.', quote: query.slice(0, 240) });
  }
  return { ...input, requirements, budget: unqualifiedBudget ? null : upfront ?? input.budget, ambiguities: ambiguities.slice(0, 4) };
}

export function validateBrief(input: unknown, query: string, generated = false): FinderBrief | null {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.requirements) || input.requirements.length > 12 ||
    !Array.isArray(input.ambiguities) || input.ambiguities.length > 4) return null;
  const quote = (value: unknown): value is string => typeof value === 'string' && value.length <= 240 &&
    (value ? Boolean(value.trim() && query.includes(value)) : !generated);
  const requirements: Requirement[] = [];
  for (const entry of input.requirements) {
    if (!object(entry) || !quote(entry.quote) || typeof entry.expected !== 'boolean' ||
      (entry.priority !== 'must' && entry.priority !== 'prefer')) return null;
    const base = { quote: entry.quote, expected: entry.expected, priority: entry.priority } as const;
    if (entry.kind === 'capability') {
      const key = generated ? entry.value : entry.key;
      if (typeof key !== 'string' || !Object.hasOwn(capabilities, key)) return null;
      requirements.push({ ...base, kind: 'capability', key: key as Capability });
    } else if (entry.kind === 'stack' || entry.kind === 'deployment') {
      if (typeof entry.value !== 'string' || !entry.value.trim() || entry.value.length > 55) return null;
      requirements.push({ ...base, kind: entry.kind, value: entry.value.trim() });
    } else if (entry.kind === 'recurring-budget') {
      const value = generated && typeof entry.value === 'string' && /^\d+$/.test(entry.value) ? Number(entry.value) : entry.value;
      if (!money(value) || !entry.expected) return null;
      requirements.push({ ...base, kind: entry.kind, value });
    } else return null;
  }
  const ambiguities: FinderBrief['ambiguities'] = [];
  for (const entry of input.ambiguities) {
    if (!object(entry) || !quote(entry.quote) || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 200) return null;
    ambiguities.push({ reason: entry.reason.trim(), quote: entry.quote });
  }
  const budget = input.budget;
  if (budget !== null && (!object(budget) || !money(budget.cents) || typeof budget.inclusive !== 'boolean' || !quote(budget.quote))) return null;
  const category = input.category;
  if (category !== null && (!object(category) || !categories.includes(category.value as typeof categories[number]) || !quote(category.quote))) return null;
  const unique = new Map<string, Requirement>();
  for (const entry of requirements) {
    const key = identity(entry) + ':' + entry.expected;
    if (unique.get(key)?.priority !== 'must') unique.set(key, entry);
  }
  const brief: FinderBrief = { version: 1, requirements: [...unique.values()], ambiguities,
    budget: budget === null ? null : { cents: budget.cents as number, inclusive: budget.inclusive as boolean, quote: budget.quote as string },
    category: category === null ? null : { value: category.value as typeof categories[number], quote: category.quote as string } };
  return generated ? grounded(brief, query) : brief;
}

export function literalFinder(query: string): FinderBrief {
  const parsed = literalBrief(query);
  const clauses = splitBrief(query);
  const requirements: Requirement[] = clauses.filter(clause => !noPreference.test(clause) && !requiresConnection.test(clause))
    .flatMap(clause => {
      const literal = literalBrief(clause);
      return (['hard', 'preferences'] as const).flatMap(field => literal[field].map(entry => ({
        ...entry, kind: 'capability' as const, priority: field === 'hard' ? 'must' as const : 'prefer' as const, quote: clause.slice(0, 240),
      })));
    }).slice(0, 12);
  const cap = statedUpfront(query);
  return grounded({
    ...blankFinderBrief, requirements,
    budget: cap,
    category: parsed.category ? { value: parsed.category,
      quote: (clauses.find(clause => literalBrief(clause).category === parsed.category) ?? query).slice(0, 240) } : null,
    ambiguities: parsed.ambiguities.map(reason => ({ reason, quote: query.slice(0, 240) })),
  }, query);
}

const identity = (entry: Requirement) => entry.kind + ':' + (entry.kind === 'capability' ? entry.key : String(entry.value).toLowerCase());
const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]*/g) ?? [];
const csvCapability = (key: Capability) => key.startsWith('csv-') || key === 'schema-export';
const explicitClaims: Partial<Record<Capability, RegExp>> = {
  multiplayer: /\b(?:multiplayer|co-op)\b/i, browser: /\bbrowser\b/i, keyboard: /\bkeyboard controls\b/i,
  mobile: /\b(?:touch controls|mobile support)\b/i, offline: /\bruns offline\b/i,
  'csv-inspection': /\binspect(?:s|ion)? (?:the )?csv structure\b/i,
  'csv-validation': /\b(?:csv validation|validate(?:s)? csv values)\b/i,
  'schema-export': /\b(?:reusable csv contract|exports? (?:a )?csv contract)\b/i,
};
export const evidenceLabels = { verified: 'Verified', contradicted: 'Contradicted', 'seller-claimed': 'Seller claimed', 'not-tested': 'Not tested' } as const;

export function evidenceFor(item: Release, entry: Requirement): FinderEvidence {
  const { priority } = entry;
  if (entry.kind === 'capability') {
    const key = entry.key;
    const observed = item.digest && item.report?.digest === item.digest ? item.report.findings.find(row => row.capability === key) : undefined;
    const label = (entry.expected ? '' : 'Exclude: ') + capabilities[key];
    if (observed?.status === 'pass' || (observed?.status === 'fail' && entry.expected)) {
      const supported = observed.status === 'pass';
      return { key, label, priority, state: supported === entry.expected ? 'verified' : 'contradicted',
        evidenceId: observed.id, observation: observed.observation };
    }
    const claim = explicitClaims[key]?.test(item.summary) && !/\b(?:not|without|no)\b/i.test(item.summary);
    return { key, label, priority, state: claim ? 'seller-claimed' : 'not-tested', evidenceId: observed?.id ?? null,
      observation: claim ? item.summary : observed?.observation ?? 'This exact release has no independent observation for this requirement.' };
  }
  const label = entry.kind === 'recurring-budget' ? 'Operating budget of ' + dollars(entry.value) + ' per month' :
    (entry.expected ? '' : 'Exclude: ') + entry.value;
  const declared = entry.kind === 'stack' && tokens(item.stack).includes(entry.value.toLowerCase());
  return { key: null, label, priority, state: declared ? 'seller-claimed' : 'not-tested', evidenceId: null,
    observation: declared ? 'Declared stack: ' + item.stack : entry.kind === 'recurring-budget' ? item.costs : 'No independent finding covers this requirement.' };
}

export function finderMatches(items: Release[], query: string, brief: FinderBrief) {
  const hard = brief.requirements.filter(entry => entry.priority === 'must');
  const conflict = hard.some(entry => hard.some(other => identity(entry) === identity(other) && entry.expected !== other.expected));
  const needsCsv = hard.some(entry => entry.kind === 'capability' && entry.expected && csvCapability(entry.key));
  const candidates = items.filter(item => {
    if (brief.category && !item.categories.includes(brief.category.value)) return false;
    if (brief.budget && (brief.budget.inclusive ? item.amount > brief.budget.cents : item.amount >= brief.budget.cents)) return false;
    return !needsCsv || /\bcsv\b/i.test(item.title + ' ' + item.summary + ' ' + item.description) ||
      Boolean(item.digest && item.report?.digest === item.digest && item.report.findings.some(finding => csvCapability(finding.capability)));
  });
  const words = new Set(tokens(query).filter(word => word.length > 2));
  const results = candidates.map(item => {
    const evidence = brief.requirements.map(entry => evidenceFor(item, entry));
    const hardChecks = evidence.filter(check => check.priority === 'must');
    const rank = (title: boolean) => new Set(tokens(title ? item.title : item.summary + ' ' + item.stack));
    const title = rank(true), description = rank(false);
    const lexical = [...words].reduce((score, word) => score + (title.has(word) ? 4 : description.has(word) ? 1 : 0), 0);
    const qualified = !item.fixture && !conflict && !brief.ambiguities.length &&
      hardChecks.every(check => check.state === 'verified') && (lexical > 0 || brief.requirements.length > 0 || Boolean(brief.category || brief.budget));
    const value: FinderResult = { item, evidence, status: qualified ? 'match' : 'near' };
    return { value, testedRequirements: hardChecks
      .filter(check => check.evidenceId && (check.state === 'verified' || check.state === 'contradicted')).length,
      verified: hardChecks.filter(check => check.state === 'verified').length,
      contradicted: hardChecks.filter(check => check.state === 'contradicted').length,
      preferences: evidence.filter(check => check.priority === 'prefer' && check.state === 'verified').length, lexical };
  });
  results.sort((a, b) => Number(b.value.status === 'match') - Number(a.value.status === 'match') ||
    b.testedRequirements - a.testedRequirements || a.contradicted - b.contradicted || b.verified - a.verified || b.preferences - a.preferences ||
    b.lexical - a.lexical || Number(b.value.item.purchasable) - Number(a.value.item.purchasable));
  return { conflict, results: results.slice(0, 12).map(row => row.value) };
}

export const finder = new Hono<AppEnv>();
finder.post('/interpret', async c => {
  const body = await readJSON(c, 3000);
  const query = str(body.query, 360);
  assert(query, 400, 'Describe the software you need.');
  await throttle(c, 'finder-interpret', c.get('actor')?.id ?? byIP(c), 25, 300);
  const inferred = body.allowGemini === true ? await interpretWithGemini(c.env, query, value => validateBrief(value, query, true)) : null;
  return c.json(inferred ?? { brief: literalFinder(query), mode: 'literal', model: null });
});
finder.post('/match', async c => {
  const body = await readJSON(c, 14000);
  const query = str(body.query, 360);
  const brief = validateBrief(body.brief, query);
  assert(query && brief, 400, 'Review the requirements before finding releases.');
  await throttle(c, 'finder-match', c.get('actor')?.id ?? byIP(c), 30, 300);
  return c.json(finderMatches(await listCatalog(c.env, local(c)), query, brief));
});
