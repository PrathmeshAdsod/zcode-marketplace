export const BRAND_NAME = 'Zcode';

export const categories = ['Games', 'Web apps', 'Developer tools', 'UI kits', 'Automation'] as const;
export type Category = typeof categories[number];

export const capabilities = {
  'local': 'Runs on localhost',
  'offline': 'Works without network after setup',
  'no-paid-api': 'Core workflow needs no paid API',
  'keyboard': 'Keyboard controls',
  'browser': 'Runs in a browser',
  'multiplayer': 'Multiplayer',
  'persistence': 'Save and reload',
  'mobile': 'Mobile controls',
  'csv-inspection': 'Inspect CSV structure',
  'csv-validation': 'Check duplicate IDs, missing values, emails and numeric totals',
  'csv-iso-date': 'Validate ISO dates in a CSV',
  'schema-export': 'Save and reload a reusable CSV contract',
} as const;
export type Capability = keyof typeof capabilities;
export type FindingStatus = 'pass' | 'fail' | 'untested' | 'inconclusive';
export type Finding = { id: string; capability: Capability; status: FindingStatus; observation: string };
export type Report = {
  adapter: string;
  environment: string;
  checkedAt: string;
  elapsedMs: number;
  digest: string;
  corePassed: boolean;
  findings: Finding[];
};
export type Draft = {
  title: string; summary: string; description: string; categories: Category[]; stack: string;
  version: string; price: string; productVideo: string; setupVideo: string; productTranscript: string;
  setupTranscript: string; cover: string; setup: string; costs: string; support: string; notices: string;
  repoId: number; ref: string; rights: boolean;
};
export type Release = {
  id: string; title: string; seller: string; summary: string; description: string;
  categories: Category[]; stack: string; version: string; amount: number; cover: string;
  productVideo: string; setupVideo: string; productTranscript: string; setupTranscript: string;
  setup: string; costs: string; support: string; notices: string;
  report: Report | null; digest: string | null; purchasable: boolean; sample?: boolean;
  demo?: string; sampleDownload?: string; fixture?: boolean;
};
export type Constraint = { key: Capability; expected: boolean };
export type Brief = { hard: Constraint[]; preferences: Constraint[]; ambiguities: string[]; maxCents: number | null; category: Category | null };
export const blankDraft: Draft = {
  title: '', summary: '', description: '', categories: [], stack: 'Node.js, Browser',
  version: '1.0.0', price: '', productVideo: '', setupVideo: '', productTranscript: '',
  setupTranscript: '', cover: '', setup: '', costs: '', support: '', notices: '',
  repoId: 0, ref: 'main', rights: false,
};
export const LICENSE_VERSION = 'zcode-single-product-1.0';
export const LICENSE_TEXT = 'The named seller grants the named buyer a nonexclusive, nontransferable license to use, modify, and commercially distribute one end product built with this release. Standalone resale, sublicensing, or redistribution of the seller’s source or reusable package is prohibited. Preserve all applicable third-party licenses and notices; those rights are governed by their own terms. Keep proprietary source private. This license does not limit nonwaivable rights or remedies.';

export function dollars(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
export function cents(price: string) {
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(price)) return null;
  const [whole, fraction = ''] = price.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return result >= 100 && result <= 100000 ? result : null;
}
export function moneyValue(amount: number) {
  return (amount / 100).toFixed(2);
}
