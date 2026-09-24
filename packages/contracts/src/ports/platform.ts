/**
 * Platform ports shared by the control plane (apps/api), billing (packages/billing)
 * and the in-memory fakes in @argus/testkit.
 *
 * Types only. Adapters live in the owning packages and are wired in apps/*\/src/main.ts;
 * fakes live in @argus/testkit. Changes are additive (ADR-0015 review rules apply).
 */
import type { Result } from '../core/result.js';

/** ISO 8601 timestamp in UTC, for example 2026-09-21T10:15:03.120Z. */
export type IsoTimestamp = string;

// ---------------------------------------------------------------------------
// Queue: run jobs leased by runners (Postgres SKIP LOCKED in M12; NATS later).
// ---------------------------------------------------------------------------

export interface QueueJob {
  readonly runId: string;
  readonly orgId: string;
  /** Runner labels the job requires; a runner must carry all of them. */
  readonly labels: readonly string[];
  readonly enqueuedAt: IsoTimestamp;
  /** Number of leases already granted for this job (requeue limit is two). */
  readonly attempts: number;
}

export interface EnqueueInput {
  readonly runId: string;
  readonly orgId: string;
  readonly labels: readonly string[];
}

export interface LeaseQuery {
  readonly runnerId: string;
  /** Org of a self-hosted runner; null for a shared cloud runner. */
  readonly runnerOrgId: string | null;
  readonly labels: readonly string[];
}

export interface Lease {
  readonly leaseId: string;
  readonly runnerId: string;
  readonly job: QueueJob;
  readonly expiresAt: IsoTimestamp;
}

export interface HeartbeatResult {
  readonly expiresAt: IsoTimestamp;
  readonly cancelRequested: boolean;
}

export interface ExpiryResult {
  /** Runs whose lease expired and that were queued again. */
  readonly requeued: readonly string[];
  /** Runs whose lease expired after the requeue limit: marked broken, RUNNER_LOST. */
  readonly lost: readonly string[];
}

export type QueueError =
  | { readonly code: 'not_found' }
  | { readonly code: 'lease_expired' }
  | { readonly code: 'conflict'; readonly message: string }
  | { readonly code: 'unavailable'; readonly message: string };

export interface Queue {
  enqueue(input: EnqueueInput): Promise<Result<QueueJob, QueueError>>;
  /** Returns null when no job is available for this runner right now. */
  lease(query: LeaseQuery): Promise<Result<Lease | null, QueueError>>;
  heartbeat(leaseId: string): Promise<Result<HeartbeatResult, QueueError>>;
  complete(leaseId: string): Promise<Result<void, QueueError>>;
  /** Hands a job back without counting it as lost (runner shutdown). */
  release(leaseId: string): Promise<Result<void, QueueError>>;
  cancel(runId: string): Promise<Result<void, QueueError>>;
  /** Expires leases that missed three heartbeats as of `now`. */
  expireStale(now: IsoTimestamp): Promise<Result<ExpiryResult, QueueError>>;
}

// ---------------------------------------------------------------------------
// EventBus: live fan-out of run events (LISTEN/NOTIFY in M12).
// ---------------------------------------------------------------------------

export interface EventBus {
  publish(
    channel: string,
    payload: string,
  ): Promise<Result<void, { readonly code: 'unavailable'; readonly message: string }>>;
  /** Returns an unsubscribe function. */
  subscribe(channel: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
}

// ---------------------------------------------------------------------------
// ObjectStore: S3 API (VersityGW bundled, any S3 endpoint in production).
// ---------------------------------------------------------------------------

export interface StoredObjectInfo {
  readonly key: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly lastModified: IsoTimestamp;
}

export interface PresignedUrl {
  readonly url: string;
  /** Headers the client must send with the request, for example content-type. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: IsoTimestamp;
}

export type ObjectStoreError =
  | { readonly code: 'not_found'; readonly key: string }
  | { readonly code: 'unavailable'; readonly message: string };

export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<Result<{ readonly bytes: number; readonly sha256: string }, ObjectStoreError>>;
  get(
    key: string,
  ): Promise<Result<{ readonly body: Uint8Array; readonly contentType: string }, ObjectStoreError>>;
  head(key: string): Promise<Result<StoredObjectInfo | null, ObjectStoreError>>;
  delete(keys: readonly string[]): Promise<Result<{ readonly deleted: number }, ObjectStoreError>>;
  list(
    prefix: string,
    cursor?: string,
  ): Promise<
    Result<
      { readonly objects: readonly StoredObjectInfo[]; readonly nextCursor: string | null },
      ObjectStoreError
    >
  >;
  presignPut(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<Result<PresignedUrl, ObjectStoreError>>;
  presignGet(
    key: string,
    expiresInSeconds: number,
  ): Promise<Result<PresignedUrl, ObjectStoreError>>;
}

// ---------------------------------------------------------------------------
// Mailer
// ---------------------------------------------------------------------------

export interface MailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Stable id used to suppress duplicates on retry. */
  readonly idempotencyKey: string;
}

export interface Mailer {
  send(
    message: MailMessage,
  ): Promise<
    Result<
      { readonly messageId: string },
      { readonly code: 'rejected' | 'unavailable'; readonly message: string }
    >
  >;
}

// ---------------------------------------------------------------------------
// Payments: money movement only; the credit ledger stays the source of truth.
// ---------------------------------------------------------------------------

export interface PaymentsEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: IsoTimestamp;
  readonly data: unknown;
}

export type PaymentsError =
  | { readonly code: 'invalid_signature' }
  | { readonly code: 'declined'; readonly message: string }
  | { readonly code: 'unavailable'; readonly message: string };

export interface Payments {
  createCheckoutSession(input: {
    readonly orgId: string;
    readonly customerId: string | null;
    readonly packId: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly idempotencyKey: string;
  }): Promise<Result<{ readonly sessionId: string; readonly url: string }, PaymentsError>>;
  createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<Result<{ readonly url: string }, PaymentsError>>;
  /** Off-session charge on the saved method, used by auto top-up. Amount in minor units. */
  chargeOffSession(input: {
    readonly customerId: string;
    readonly amountMinor: number;
    readonly currency: 'eur';
    readonly description: string;
    readonly idempotencyKey: string;
  }): Promise<
    Result<
      { readonly paymentId: string; readonly status: 'succeeded' | 'requires_action' | 'failed' },
      PaymentsError
    >
  >;
  /** Verifies the provider signature over the raw body and parses the event. */
  verifyWebhook(rawBody: string, signatureHeader: string): Result<PaymentsEvent, PaymentsError>;
}
