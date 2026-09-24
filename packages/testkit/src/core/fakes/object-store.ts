/**
 * In-memory ObjectStore port (ADR M03-port-fakes). Pre-signed URLs point at a loopback
 * server (`serveObjectStore`) that checks the signature, the expiry against the store's
 * clock and, for PUT, the content type, exactly the checks a real S3 endpoint makes.
 */
import { err, ok, sha256Hex, utf8 } from '@argus/contracts';
import type {
  Clock,
  ObjectStore,
  ObjectStoreError,
  PresignedUrl,
  Result,
  StoredObjectInfo,
} from '@argus/contracts';

interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly lastModified: number;
}

export interface InMemoryObjectStoreOptions {
  readonly clock: Pick<Clock, 'now'>;
  /** Objects per `list` page; 1,000 like S3. */
  readonly pageSize?: number;
  /** Secret the pre-signed URLs are signed with. */
  readonly signingSecret?: string;
}

export type PresignCheck =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly status: 403; readonly reason: string };

const iso = (ms: number): string => new Date(ms).toISOString();

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, StoredObject>();
  readonly #clock: Pick<Clock, 'now'>;
  readonly #pageSize: number;
  readonly #secret: string;
  #baseUrl: string | undefined;
  #unavailable: string | undefined;

  constructor(options: InMemoryObjectStoreOptions) {
    this.#clock = options.clock;
    this.#pageSize = options.pageSize ?? 1000;
    this.#secret = options.signingSecret ?? 'fake-object-store-secret';
  }

  /** Where pre-signed URLs point; set by `serveObjectStore`. */
  setBaseUrl(url: string | undefined): void {
    this.#baseUrl = url?.replace(/\/+$/, '');
  }

  setUnavailable(message: string | undefined): void {
    this.#unavailable = message;
  }

  /** Every key, sorted. */
  keys(): string[] {
    return [...this.#objects.keys()].sort();
  }

  #down<T>(): Result<T, ObjectStoreError> | undefined {
    return this.#unavailable === undefined
      ? undefined
      : err({ code: 'unavailable', message: this.#unavailable });
  }

  #info(key: string, object: StoredObject): StoredObjectInfo {
    return {
      key,
      bytes: object.body.length,
      contentType: object.contentType,
      lastModified: iso(object.lastModified),
    };
  }

  put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<Result<{ readonly bytes: number; readonly sha256: string }, ObjectStoreError>> {
    const down = this.#down<{ bytes: number; sha256: string }>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const copy = new Uint8Array(body);
    this.#objects.set(key, { body: copy, contentType, lastModified: this.#clock.now() });
    return Promise.resolve(ok({ bytes: copy.length, sha256: sha256Hex(copy) }));
  }

  get(
    key: string,
  ): Promise<
    Result<{ readonly body: Uint8Array; readonly contentType: string }, ObjectStoreError>
  > {
    const down = this.#down<{ body: Uint8Array; contentType: string }>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const object = this.#objects.get(key);
    return Promise.resolve(
      object === undefined
        ? err({ code: 'not_found', key })
        : ok({ body: new Uint8Array(object.body), contentType: object.contentType }),
    );
  }

  head(key: string): Promise<Result<StoredObjectInfo | null, ObjectStoreError>> {
    const down = this.#down<StoredObjectInfo | null>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const object = this.#objects.get(key);
    return Promise.resolve(ok(object === undefined ? null : this.#info(key, object)));
  }

  delete(keys: readonly string[]): Promise<Result<{ readonly deleted: number }, ObjectStoreError>> {
    const down = this.#down<{ deleted: number }>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    let deleted = 0;
    for (const key of keys) {
      if (this.#objects.delete(key)) {
        deleted += 1;
      }
    }
    return Promise.resolve(ok({ deleted }));
  }

  list(
    prefix: string,
    cursor?: string,
  ): Promise<
    Result<
      { readonly objects: readonly StoredObjectInfo[]; readonly nextCursor: string | null },
      ObjectStoreError
    >
  > {
    const down = this.#down<{ objects: StoredObjectInfo[]; nextCursor: string | null }>();
    if (down !== undefined) {
      return Promise.resolve(down);
    }
    const keys = this.keys().filter(
      (key) => key.startsWith(prefix) && (cursor === undefined || key > cursor),
    );
    const page = keys.slice(0, this.#pageSize);
    const objects = page.flatMap((key) => {
      const object = this.#objects.get(key);
      return object === undefined ? [] : [this.#info(key, object)];
    });
    const last = page[page.length - 1];
    return Promise.resolve(
      ok({ objects, nextCursor: keys.length > page.length && last !== undefined ? last : null }),
    );
  }

  #signature(method: string, key: string, expires: number, contentType: string): string {
    return sha256Hex(
      utf8(`${this.#secret}\n${method}\n${key}\n${String(expires)}\n${contentType}`),
    );
  }

  #presign(
    method: 'GET' | 'PUT',
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Result<PresignedUrl, ObjectStoreError> {
    if (this.#baseUrl === undefined) {
      return err({
        code: 'unavailable',
        message: 'no pre-signing server: call serveObjectStore(store) first',
      });
    }
    if (!(expiresInSeconds > 0)) {
      return err({ code: 'unavailable', message: 'expiresInSeconds must be positive' });
    }
    const expires = this.#clock.now() + expiresInSeconds * 1000;
    const signature = this.#signature(method, key, expires, contentType);
    const headers: Record<string, string> = method === 'PUT' ? { 'content-type': contentType } : {};
    return ok({
      url: `${this.#baseUrl}/objects/${encodeKey(key)}?expires=${String(expires)}&signature=${signature}`,
      headers,
      expiresAt: iso(expires),
    });
  }

  presignPut(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<Result<PresignedUrl, ObjectStoreError>> {
    return Promise.resolve(
      this.#down<PresignedUrl>() ?? this.#presign('PUT', key, contentType, expiresInSeconds),
    );
  }

  presignGet(
    key: string,
    expiresInSeconds: number,
  ): Promise<Result<PresignedUrl, ObjectStoreError>> {
    return Promise.resolve(
      this.#down<PresignedUrl>() ?? this.#presign('GET', key, '', expiresInSeconds),
    );
  }

  /**
   * Checks a pre-signed request: path `/objects/<key>`, a valid signature for this method
   * and content type, and an expiry not yet passed.
   */
  checkPresigned(
    method: string,
    pathWithQuery: string,
    contentType: string | undefined,
  ): PresignCheck {
    const url = new URL(pathWithQuery, 'http://store.invalid');
    if (!url.pathname.startsWith('/objects/')) {
      return { ok: false, status: 403, reason: 'not a pre-signed object path' };
    }
    let key: string;
    try {
      key = url.pathname.slice('/objects/'.length).split('/').map(decodeURIComponent).join('/');
    } catch {
      return { ok: false, status: 403, reason: 'malformed key' };
    }
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';
    if (method !== 'GET' && method !== 'PUT') {
      return { ok: false, status: 403, reason: `method ${method} is not pre-signed` };
    }
    const expected = this.#signature(
      method,
      key,
      expires,
      method === 'PUT' ? (contentType ?? '') : '',
    );
    if (!Number.isFinite(expires) || signature !== expected) {
      return { ok: false, status: 403, reason: 'SignatureDoesNotMatch' };
    }
    if (expires < this.#clock.now()) {
      return { ok: false, status: 403, reason: 'Request has expired' };
    }
    return { ok: true, key };
  }
}
