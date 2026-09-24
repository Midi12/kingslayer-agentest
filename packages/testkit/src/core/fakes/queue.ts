/**
 * In-memory Queue port (ADR M03-port-fakes), with the lease rules of the runner protocol:
 * a lease lives for three heartbeat intervals (3 × 15 s), a heartbeat renews it, an
 * expired lease is re-queued at most twice and then reported lost. Time comes from a Clock.
 */
import { err, ok } from '@argus/contracts';
import type {
  Clock,
  EnqueueInput,
  ExpiryResult,
  HeartbeatResult,
  IdGenerator,
  Lease,
  LeaseQuery,
  Queue,
  QueueError,
  QueueJob,
  Result,
} from '@argus/contracts';

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A lease that misses three heartbeats expires. */
export const LEASE_TTL_MS = 3 * HEARTBEAT_INTERVAL_MS;
/** A run is re-queued at most twice, so a third expired lease loses it. */
export const MAX_LEASES = 3;

interface JobState {
  job: QueueJob;
  lease?: { leaseId: string; runnerId: string; expiresAt: number };
  cancelRequested: boolean;
}

export interface InMemoryQueueOptions {
  readonly clock: Pick<Clock, 'now'>;
  readonly ids: IdGenerator;
  readonly leaseTtlMs?: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class InMemoryQueue implements Queue {
  readonly #clock: Pick<Clock, 'now'>;
  readonly #ids: IdGenerator;
  readonly #ttl: number;
  readonly #jobs = new Map<string, JobState>();
  #unavailable: string | undefined;

  constructor(options: InMemoryQueueOptions) {
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#ttl = options.leaseTtlMs ?? LEASE_TTL_MS;
  }

  /** Makes every call fail with `unavailable` until called with undefined. */
  setUnavailable(message: string | undefined): void {
    this.#unavailable = message;
  }

  /** Jobs in queue order, leased or not. */
  snapshot(): readonly { job: QueueJob; leaseId: string | null; cancelRequested: boolean }[] {
    return [...this.#jobs.values()].map((state) => ({
      job: state.job,
      leaseId: state.lease?.leaseId ?? null,
      cancelRequested: state.cancelRequested,
    }));
  }

  #down<T>(): Result<T, QueueError> | undefined {
    return this.#unavailable === undefined
      ? undefined
      : err({ code: 'unavailable', message: this.#unavailable });
  }

  #byLease(leaseId: string): JobState | undefined {
    return [...this.#jobs.values()].find((state) => state.lease?.leaseId === leaseId);
  }

  #leaseCheck(leaseId: string): Result<JobState, QueueError> {
    const state = this.#byLease(leaseId);
    if (state?.lease === undefined) {
      return err({ code: 'not_found' });
    }
    if (state.lease.expiresAt < this.#clock.now()) {
      return err({ code: 'lease_expired' });
    }
    return ok(state);
  }

  enqueue(input: EnqueueInput): Promise<Result<QueueJob, QueueError>> {
    const down = this.#down<QueueJob>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    if (this.#jobs.has(input.runId)) {
      return Promise.resolve(
        err({ code: 'conflict', message: `run ${input.runId} is already queued` }),
      );
    }
    const job: QueueJob = {
      runId: input.runId,
      orgId: input.orgId,
      labels: [...input.labels],
      enqueuedAt: iso(this.#clock.now()),
      attempts: 0,
    };
    this.#jobs.set(input.runId, { job, cancelRequested: false });
    return Promise.resolve(ok(job));
  }

  lease(query: LeaseQuery): Promise<Result<Lease | null, QueueError>> {
    const down = this.#down<Lease | null>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const now = this.#clock.now();
    const state = [...this.#jobs.values()].find(
      (candidate) =>
        candidate.lease === undefined &&
        !candidate.cancelRequested &&
        (query.runnerOrgId === null || query.runnerOrgId === candidate.job.orgId) &&
        candidate.job.labels.every((label) => query.labels.includes(label)),
    );
    if (state === undefined) {
      return Promise.resolve(ok(null));
    }
    state.job = { ...state.job, attempts: state.job.attempts + 1 };
    state.lease = {
      leaseId: this.#ids.next('lease'),
      runnerId: query.runnerId,
      expiresAt: now + this.#ttl,
    };
    return Promise.resolve(
      ok({
        leaseId: state.lease.leaseId,
        runnerId: query.runnerId,
        job: state.job,
        expiresAt: iso(state.lease.expiresAt),
      }),
    );
  }

  heartbeat(leaseId: string): Promise<Result<HeartbeatResult, QueueError>> {
    const down = this.#down<HeartbeatResult>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const checked = this.#leaseCheck(leaseId);
    if (!checked.ok) {
      return Promise.resolve(checked);
    }
    const lease = checked.value.lease;
    if (lease === undefined) {
      return Promise.resolve(err({ code: 'not_found' }));
    }
    lease.expiresAt = this.#clock.now() + this.#ttl;
    return Promise.resolve(
      ok({ expiresAt: iso(lease.expiresAt), cancelRequested: checked.value.cancelRequested }),
    );
  }

  complete(leaseId: string): Promise<Result<void, QueueError>> {
    const down = this.#down<undefined>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const checked = this.#leaseCheck(leaseId);
    if (!checked.ok) {
      return Promise.resolve(checked);
    }
    this.#jobs.delete(checked.value.job.runId);
    return Promise.resolve(ok(undefined));
  }

  release(leaseId: string): Promise<Result<void, QueueError>> {
    const down = this.#down<undefined>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const checked = this.#leaseCheck(leaseId);
    if (!checked.ok) {
      return Promise.resolve(checked);
    }
    const state = checked.value;
    delete state.lease;
    state.job = { ...state.job, attempts: Math.max(0, state.job.attempts - 1) };
    return Promise.resolve(ok(undefined));
  }

  cancel(runId: string): Promise<Result<void, QueueError>> {
    const down = this.#down<undefined>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const state = this.#jobs.get(runId);
    if (state === undefined) {
      return Promise.resolve(err({ code: 'not_found' }));
    }
    if (state.lease === undefined) {
      this.#jobs.delete(runId);
    } else {
      state.cancelRequested = true;
    }
    return Promise.resolve(ok(undefined));
  }

  expireStale(now: string): Promise<Result<ExpiryResult, QueueError>> {
    const down = this.#down<ExpiryResult>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const at = Date.parse(now);
    if (!Number.isFinite(at)) {
      return Promise.resolve(err({ code: 'conflict', message: `not an ISO timestamp: ${now}` }));
    }
    const requeued: string[] = [];
    const lost: string[] = [];
    for (const state of [...this.#jobs.values()]) {
      if (state.lease === undefined || state.lease.expiresAt >= at) {
        continue;
      }
      delete state.lease;
      if (state.cancelRequested || state.job.attempts >= MAX_LEASES) {
        this.#jobs.delete(state.job.runId);
        if (!state.cancelRequested) {
          lost.push(state.job.runId);
        }
      } else {
        requeued.push(state.job.runId);
      }
    }
    return Promise.resolve(ok({ requeued, lost }));
  }
}
