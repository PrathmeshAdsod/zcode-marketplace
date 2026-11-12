import { assert, providerId, sha256, type Env, Problem } from './common';
import { moneyValue } from '../src/domain';
import { paypalConfigured } from './catalog';

const SANDBOX_HOSTS = ['https://api-m.sandbox.paypal.com', 'https://api.sandbox.paypal.com'];
export const sandboxEvents = [
  'CHECKOUT.ORDER.COMPLETED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
];
export type Money = { currency_code: string; value: string };
export type Capture = { id: string; status: string; amount: Money; final_capture?: boolean };
export type PayPalOrder = {
  id: string; intent: string; status: string;
  links?: { href: string; rel: string; method?: string }[];
  purchase_units?: { reference_id: string; invoice_id: string; payee?: { merchant_id: string }; amount: Money; payments?: { captures?: Capture[] } }[];
};
export type Agreement = { id: string; provider_order: string | null; amount: number; currency: string; merchant: string };
export class PayPal {
  private token?: string;
  private base = SANDBOX_HOSTS[0];
  constructor(private readonly env: Env) {}
  async request<T>(path: string, method = 'GET', body?: unknown, requestId?: string, rawBody?: string): Promise<T> {
    assert(paypalConfigured(this.env), 503, 'PayPal Sandbox is awaiting configuration.');
    let phase = this.token ? 'API request' : 'OAuth connection';
    const checking = method === 'GET' && path.startsWith('/v1/notifications/webhooks/');
    try {
      if (!this.token) {
        phase = 'credential encoding';
        const credentials = btoa(this.env.PAYPAL_CLIENT_ID + ':' + this.env.PAYPAL_CLIENT_SECRET);
        phase = 'OAuth connection';
        let auth: Response | undefined;
        let connectError: unknown;
        // Both names are PayPal's Sandbox API. Retry only OAuth transport failures;
        // order creation, capture and refund never use host failover.
        for (const host of SANDBOX_HOSTS) {
          try {
            auth = await fetch(host + '/v1/oauth2/token', {
              method: 'POST', redirect: 'manual', headers: { Authorization: 'Basic ' + credentials,
                'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
              body: 'grant_type=client_credentials', signal: AbortSignal.timeout(5500),
            });
            this.base = host;
            break;
          } catch (error) { connectError = error; }
        }
        if (!auth) throw connectError;
        assert(auth.ok, 502, 'PayPal could not authenticate the Sandbox merchant.' + (checking ? ' HTTP ' + auth.status + '.' : ''));
        phase = 'OAuth response';
        const result = await auth.json() as { access_token?: string };
        assert(result.access_token, 502, 'PayPal could not authenticate the Sandbox merchant.');
        this.token = result.access_token;
      }
      phase = 'API request';
      const response = await fetch(this.base + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(9000), headers: {
          Authorization: 'Bearer ' + this.token, Accept: 'application/json',
          ...(body === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(requestId ? { 'PayPal-Request-Id': requestId, Prefer: 'return=representation' } : {}),
        }, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      assert(response.ok, 502, checking ? 'PayPal Sandbox webhook readback returned HTTP ' + response.status + '.' :
        'PayPal could not confirm this operation. Check the order status before trying again.');
      phase = 'API response';
      return await response.json() as T;
    } catch (error) {
      if (error instanceof Problem) throw error;
      const type = error instanceof Error && ['TypeError','TimeoutError','AbortError','InvalidCharacterError'].includes(error.name) ? ' (' + error.name + ')' : '';
      throw new Problem(502, checking ? 'PayPal Sandbox ' + phase + ' failed' + type + '.' :
        'PayPal Sandbox is temporarily unavailable. Check the receipt before trying again.');
    }
  }
  async create(order: Agreement) {
    return this.request<PayPalOrder>('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: order.id, invoice_id: order.id, payee: { merchant_id: order.merchant },
        amount: { currency_code: order.currency, value: moneyValue(order.amount) } }],
      payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: this.env.APP_ORIGIN + '/receipt/' + order.id,
        cancel_url: this.env.APP_ORIGIN + '/receipt/' + order.id + '?cancelled=1' } } },
    }, await operationKey(order.id, 'create'));
  }
  verifyWebhook(headers: Record<string, string | undefined>, rawEvent: string) {
    // Keep the original event bytes in the verification envelope.
    const prefix = JSON.stringify({ ...headers, webhook_id: this.env.PAYPAL_WEBHOOK_ID }).slice(0, -1);
    return this.request<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', 'POST',
      undefined, undefined, prefix + ',"webhook_event":' + rawEvent + '}');
  }
  async checkWebhook() {
    const id = this.env.PAYPAL_WEBHOOK_ID;
    const origin = this.env.APP_ORIGIN;
    assert(providerId(id) && origin, 503, 'PayPal Sandbox webhook configuration is incomplete.');
    const hook = await this.request<{ id: string; url: string; event_types: { name: string }[] }>(
      '/v1/notifications/webhooks/' + encodeURIComponent(id));
    assert(hook?.id === id && hook.url === new URL('/api/webhooks/paypal', origin).href &&
      Array.isArray(hook.event_types) && hook.event_types.length === sandboxEvents.length &&
      sandboxEvents.every(event => hook.event_types.some(entry => entry.name === event)),
      409, 'The Sandbox webhook destination or event subscriptions do not match Zcode.');
  }
  order(id: string) { return this.request<PayPalOrder>('/v2/checkout/orders/' + encodeURIComponent(id)); }
  async capture(order: Agreement) {
    return this.request<PayPalOrder>('/v2/checkout/orders/' + encodeURIComponent(order.provider_order!) + '/capture', 'POST', {}, await operationKey(order.id, 'capture'));
  }
  readCapture(id: string) { return this.request<Capture>('/v2/payments/captures/' + encodeURIComponent(id)); }
  async refund(order: Agreement, capture: string) {
    return this.request<{ id: string; status: string; amount: Money }>('/v2/payments/captures/' + encodeURIComponent(capture) + '/refund',
      'POST', { amount: { currency_code: order.currency, value: moneyValue(order.amount) } }, await operationKey(order.id, 'refund'));
  }
}
async function operationKey(purchase: string, operation: 'create' | 'capture' | 'refund') {
  return (await sha256(purchase + ':' + operation)).slice(0, 32);
}
export function sameMoney(expected: Agreement, money: Money | undefined) {
  if (money?.currency_code !== expected.currency || typeof money.value !== 'string') return false;
  const parts = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(money.value);
  return Boolean(parts && Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0')) === expected.amount);
}
export function approvalURL(order: PayPalOrder) {
  if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'SAVED'].includes(order.status)) return null;
  for (const link of order.links ?? []) {
    if (!['approve', 'payer-action'].includes(link.rel) || (link.method && link.method !== 'GET')) continue;
    const url = URL.canParse(link.href) ? new URL(link.href) : null;
    if (url && ['https://www.sandbox.paypal.com', 'https://sandbox.paypal.com'].includes(url.origin) &&
      !url.username && !url.password && url.pathname === '/checkoutnow' && url.searchParams.getAll('token').length === 1 &&
      url.searchParams.get('token') === order.id) return url.href;
  }
  return null;
}
export function verifyOrder(expected: Agreement, order: PayPalOrder) {
  const unit = order.purchase_units?.[0];
  assert(order.id === expected.provider_order && order.intent === 'CAPTURE' && order.purchase_units?.length === 1 &&
    unit?.reference_id === expected.id && unit.invoice_id === expected.id && unit.payee?.merchant_id === expected.merchant &&
    sameMoney(expected, unit.amount), 409, 'PayPal order details did not match the accepted offer.');
  const captures = unit.payments?.captures ?? [];
  assert(captures.length <= 1, 409, 'PayPal returned multiple captures for this single-item order.');
  const capture = captures[0];
  assert(!capture || (providerId(capture.id) && sameMoney(expected, capture.amount)), 409, 'The capture amount did not match the accepted offer.');
  return capture;
}
