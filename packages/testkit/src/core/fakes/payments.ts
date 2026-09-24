/**
 * In-memory Payments port (ADR M03-port-fakes). Checkout and portal sessions get fake
 * URLs on the reserved `.invalid` domain; off-session charges succeed unless an outcome is
 * queued; idempotency keys return the first result. Webhooks are signed like Stripe's
 * (`t=<unix seconds>,v1=<HMAC-SHA256 of "t.body">`) with a test secret, and verified with
 * a 300 s tolerance against the clock.
 */
import { err, ok } from '@argus/contracts';
import type {
  Clock,
  IdGenerator,
  Payments,
  PaymentsError,
  PaymentsEvent,
  Result,
} from '@argus/contracts';
import { constantTimeEqual, hmacSha256Hex } from './hmac.js';

export const DEFAULT_WEBHOOK_SECRET = 'whsec_fake_argus_testkit';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type ChargeStatus = 'succeeded' | 'requires_action' | 'failed';
export type ChargeOutcome = ChargeStatus | PaymentsError;

type CheckoutInput = Parameters<Payments['createCheckoutSession']>[0];
type ChargeInput = Parameters<Payments['chargeOffSession']>[0];

export interface InMemoryPaymentsOptions {
  readonly clock: Pick<Clock, 'now'>;
  readonly ids: IdGenerator;
  readonly webhookSecret?: string;
}

/** Signs a webhook body the way `verifyWebhook` expects. */
export function signWebhook(body: string, secret: string, timestampSeconds: number): string {
  return `t=${String(timestampSeconds)},v1=${hmacSha256Hex(secret, `${String(timestampSeconds)}.${body}`)}`;
}

export class InMemoryPayments implements Payments {
  readonly checkouts: (CheckoutInput & { readonly sessionId: string })[] = [];
  readonly charges: (ChargeInput & {
    readonly paymentId: string;
    readonly status: ChargeStatus;
  })[] = [];
  readonly #clock: Pick<Clock, 'now'>;
  readonly #ids: IdGenerator;
  readonly #secret: string;
  readonly #chargeOutcomes: ChargeOutcome[] = [];
  readonly #idempotent = new Map<string, unknown>();
  #unavailable: string | undefined;

  constructor(options: InMemoryPaymentsOptions) {
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#secret = options.webhookSecret ?? DEFAULT_WEBHOOK_SECRET;
  }

  setUnavailable(message: string | undefined): void {
    this.#unavailable = message;
  }

  /** The next off-session charges end with these outcomes, in order. */
  queueCharges(...outcomes: readonly ChargeOutcome[]): void {
    this.#chargeOutcomes.push(...outcomes);
  }

  /** A signed webhook for `event`, as the provider would send it. */
  webhook(event: { readonly id: string; readonly type: string; readonly data: unknown }): {
    readonly body: string;
    readonly signature: string;
  } {
    const created = Math.floor(this.#clock.now() / 1000);
    const body = JSON.stringify({ id: event.id, type: event.type, created, data: event.data });
    return { body, signature: signWebhook(body, this.#secret, created) };
  }

  createCheckoutSession(
    input: CheckoutInput,
  ): Promise<Result<{ readonly sessionId: string; readonly url: string }, PaymentsError>> {
    if (this.#unavailable !== undefined) {
      return Promise.resolve(err({ code: 'unavailable', message: this.#unavailable }));
    }
    const key = `checkout:${input.idempotencyKey}`;
    const previous = this.#idempotent.get(key) as { sessionId: string; url: string } | undefined;
    if (previous !== undefined) {
      return Promise.resolve(ok(previous));
    }
    const sessionId = this.#ids.next('cs_fake');
    const session = { sessionId, url: `https://checkout.payments.invalid/${sessionId}` };
    this.#idempotent.set(key, session);
    this.checkouts.push({ ...input, sessionId });
    return Promise.resolve(ok(session));
  }

  createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<Result<{ readonly url: string }, PaymentsError>> {
    if (this.#unavailable !== undefined) {
      return Promise.resolve(err({ code: 'unavailable', message: this.#unavailable }));
    }
    return Promise.resolve(
      ok({ url: `https://billing.payments.invalid/${encodeURIComponent(input.customerId)}` }),
    );
  }

  chargeOffSession(
    input: ChargeInput,
  ): Promise<Result<{ readonly paymentId: string; readonly status: ChargeStatus }, PaymentsError>> {
    if (this.#unavailable !== undefined) {
      return Promise.resolve(err({ code: 'unavailable', message: this.#unavailable }));
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return Promise.resolve(
        err({ code: 'declined', message: 'amount must be a positive number of cents' }),
      );
    }
    const key = `charge:${input.idempotencyKey}`;
    const previous = this.#idempotent.get(key) as
      Result<{ paymentId: string; status: ChargeStatus }, PaymentsError> | undefined;
    if (previous !== undefined) {
      return Promise.resolve(previous);
    }
    const outcome = this.#chargeOutcomes.shift() ?? 'succeeded';
    let result: Result<{ paymentId: string; status: ChargeStatus }, PaymentsError>;
    if (typeof outcome === 'string') {
      const paymentId = this.#ids.next('pi_fake');
      this.charges.push({ ...input, paymentId, status: outcome });
      result = ok({ paymentId, status: outcome });
    } else {
      result = err(outcome);
    }
    this.#idempotent.set(key, result);
    return Promise.resolve(result);
  }

  verifyWebhook(rawBody: string, signatureHeader: string): Result<PaymentsEvent, PaymentsError> {
    const parts = new Map<string, string[]>();
    for (const part of signatureHeader.split(',')) {
      const [name, ...value] = part.trim().split('=');
      if (name !== undefined && value.length > 0) {
        parts.set(name, [...(parts.get(name) ?? []), value.join('=')]);
      }
    }
    const timestamp = Number(parts.get('t')?.[0]);
    const signatures = parts.get('v1') ?? [];
    if (!Number.isInteger(timestamp) || signatures.length === 0) {
      return err({ code: 'invalid_signature' });
    }
    if (Math.abs(this.#clock.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      return err({ code: 'invalid_signature' });
    }
    const expected = hmacSha256Hex(this.#secret, `${String(timestamp)}.${rawBody}`);
    if (!signatures.some((signature) => constantTimeEqual(signature, expected))) {
      return err({ code: 'invalid_signature' });
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return err({ code: 'invalid_signature' });
    }
    const record = event as { id?: unknown; type?: unknown; created?: unknown; data?: unknown };
    if (
      typeof record.id !== 'string' ||
      typeof record.type !== 'string' ||
      typeof record.created !== 'number'
    ) {
      return err({ code: 'invalid_signature' });
    }
    return ok({
      id: record.id,
      type: record.type,
      createdAt: new Date(record.created * 1000).toISOString(),
      data: record.data,
    });
  }
}
