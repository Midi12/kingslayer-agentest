/**
 * In-memory Mailer port: messages land in `outbox`; a retry with the same idempotency
 * key returns the first message id without sending twice; failures can be scripted.
 */
import { err, ok } from '@argus/contracts';
import type { IdGenerator, MailMessage, Mailer, Result } from '@argus/contracts';

type MailError = { readonly code: 'rejected' | 'unavailable'; readonly message: string };

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InMemoryMailer implements Mailer {
  readonly outbox: { readonly messageId: string; readonly message: MailMessage }[] = [];
  readonly #ids: IdGenerator;
  readonly #sent = new Map<string, string>();
  readonly #failures: MailError[] = [];

  constructor(ids: IdGenerator) {
    this.#ids = ids;
  }

  /** The next sends fail with these errors, in order. */
  failNext(...errors: readonly MailError[]): void {
    this.#failures.push(...errors);
  }

  send(message: MailMessage): Promise<Result<{ readonly messageId: string }, MailError>> {
    const failure = this.#failures.shift();
    if (failure !== undefined) {
      return Promise.resolve(err(failure));
    }
    const previous = this.#sent.get(message.idempotencyKey);
    if (previous !== undefined) {
      return Promise.resolve(ok({ messageId: previous }));
    }
    if (message.to.length === 0) {
      return Promise.resolve(err({ code: 'rejected', message: 'no recipient' }));
    }
    const invalid = message.to.find((address) => !ADDRESS.test(address));
    if (invalid !== undefined) {
      return Promise.resolve(err({ code: 'rejected', message: `invalid recipient ${invalid}` }));
    }
    const messageId = this.#ids.next('mail');
    this.#sent.set(message.idempotencyKey, messageId);
    this.outbox.push({ messageId, message });
    return Promise.resolve(ok({ messageId }));
  }
}
