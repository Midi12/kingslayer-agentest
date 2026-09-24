/**
 * The loopback server behind the in-memory ObjectStore's pre-signed URLs: GET returns the
 * object, PUT stores the body, and an invalid signature, a wrong content type or an
 * expired URL answers 403 like S3.
 */
import type { InMemoryObjectStore } from '../core/fakes/object-store.js';
import { listen, sendBytes, sendJson, type FakeServer, type ListenOptions } from './http.js';

export interface ObjectStoreRequestRecord {
  readonly method: string;
  readonly path: string;
  status: number;
  key?: string;
}

/** Serves `store` on loopback and points its pre-signed URLs at the server. */
export async function serveObjectStore(
  store: InMemoryObjectStore,
  options: ListenOptions = {},
): Promise<FakeServer<ObjectStoreRequestRecord>> {
  const requests: ObjectStoreRequestRecord[] = [];
  const listening = await listen(async (call, response) => {
    const record: ObjectStoreRequestRecord = { method: call.method, path: call.path, status: 0 };
    requests.push(record);
    const check = store.checkPresigned(call.method, call.path, call.headers['content-type']);
    if (!check.ok) {
      record.status = check.status;
      sendJson(response, check.status, { error: { code: 'AccessDenied', message: check.reason } });
      return;
    }
    record.key = check.key;
    if (call.method === 'PUT') {
      const stored = await store.put(
        check.key,
        call.body,
        call.headers['content-type'] ?? 'application/octet-stream',
      );
      record.status = stored.ok ? 200 : 503;
      sendJson(
        response,
        record.status,
        stored.ok ? { etag: stored.value.sha256 } : { error: stored.error },
      );
      return;
    }
    const object = await store.get(check.key);
    if (!object.ok) {
      record.status = object.error.code === 'not_found' ? 404 : 503;
      sendJson(response, record.status, { error: object.error });
      return;
    }
    record.status = 200;
    sendBytes(response, 200, object.value.body, { 'content-type': object.value.contentType });
  }, options);
  store.setBaseUrl(listening.url);
  return {
    url: listening.url,
    requests,
    close: async () => {
      store.setBaseUrl(undefined);
      await listening.close();
    },
  };
}
