/**
 * In-memory EventBus port: publish delivers to the channel's subscribers in subscription
 * order, synchronously, and keeps a log of every message for assertions.
 */
import { err, ok } from '@argus/contracts';
import type { EventBus, Result } from '@argus/contracts';

export class InMemoryEventBus implements EventBus {
  readonly #subscribers = new Map<string, Set<(payload: string) => void>>();
  readonly published: { readonly channel: string; readonly payload: string }[] = [];
  #unavailable: string | undefined;

  setUnavailable(message: string | undefined): void {
    this.#unavailable = message;
  }

  publish(
    channel: string,
    payload: string,
  ): Promise<Result<void, { readonly code: 'unavailable'; readonly message: string }>> {
    if (this.#unavailable !== undefined) {
      return Promise.resolve(err({ code: 'unavailable', message: this.#unavailable }));
    }
    this.published.push({ channel, payload });
    for (const subscriber of [...(this.#subscribers.get(channel) ?? [])]) {
      subscriber(payload);
    }
    return Promise.resolve(ok(undefined));
  }

  subscribe(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>> {
    const subscribers = this.#subscribers.get(channel) ?? new Set();
    const handler = (payload: string): void => {
      onMessage(payload);
    };
    subscribers.add(handler);
    this.#subscribers.set(channel, subscribers);
    return Promise.resolve(() => {
      subscribers.delete(handler);
      return Promise.resolve();
    });
  }

  /** Number of live subscriptions on a channel. */
  subscriberCount(channel: string): number {
    return this.#subscribers.get(channel)?.size ?? 0;
  }
}
