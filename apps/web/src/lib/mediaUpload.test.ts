import { afterEach, expect, it, vi } from 'vitest';
import { OffsetConflict, type UploadState } from '../api';
import { DeviceError } from './friendlyError';
import { CHUNK_BYTES, UploadQueue, type UploadTransport } from './mediaUpload';

const state = (
  offset: number,
  size: number,
  phase: UploadState['import'] = { state: 'receiving' },
): UploadState => ({
  id: 'u1',
  title: 'Song',
  format: 'mp3',
  size,
  offset,
  complete: offset === size,
  import: phase,
});

type Api = UploadTransport;
function transport(size: number) {
  let confirmed = 0;
  return {
    startUpload: vi.fn<Api['startUpload']>(async () => state(0, size)),
    sendChunk: vi.fn<Api['sendChunk']>(async (_id, offset, chunk) => {
      confirmed = offset + chunk.size;
      return state(confirmed, size);
    }),
    uploadStatus: vi.fn<Api['uploadStatus']>(async () =>
      state(
        confirmed,
        size,
        confirmed === size ? { state: 'ready', asset: 'a1' } : undefined,
      ),
    ),
    cancelUpload: vi.fn<Api['cancelUpload']>(async () => undefined),
    importCopy: vi.fn<Api['importCopy']>(async () =>
      state(size, size, { state: 'queued' }),
    ),
  };
}

const file = (size: number, name = 'Song.mp3') =>
  new File([new Uint8Array(size)], name, { type: 'audio/mpeg' });
const fast = { retry: 5, poll: 1 };

afterEach(() => vi.restoreAllMocks());

it('sends 8 MiB chunks at confirmed offsets and reports the new track', async () => {
  const size = CHUNK_BYTES * 2 + 100;
  const api = transport(size);
  const queue = new UploadQueue(api, fast);
  const ready = vi.fn();
  queue.whenReady(ready);
  queue.add(file(size));
  await vi.waitFor(() => expect(ready).toHaveBeenCalledWith('a1', 'Song'));
  expect(api.startUpload).toHaveBeenCalledWith('Song.mp3', size);
  expect(
    api.sendChunk.mock.calls.map(([, offset, chunk]) => [offset, chunk.size]),
  ).toEqual([
    [0, CHUNK_BYTES],
    [CHUNK_BYTES, CHUNK_BYTES],
    [CHUNK_BYTES * 2, 100],
  ]);
  expect(queue.snapshot()).toEqual([]);
});

it('resumes from the offset a 409 reports instead of resending', async () => {
  const size = CHUNK_BYTES + 10;
  let first = true;
  const api = transport(size);
  const send = api.sendChunk.getMockImplementation()!;
  api.sendChunk.mockImplementation(async (id, offset, chunk, signal) => {
    if (first) {
      first = false;
      // The device already has the first chunk: a lost response.
      throw new OffsetConflict(state(CHUNK_BYTES, size));
    }
    return send(id, offset, chunk, signal);
  });
  const queue = new UploadQueue(api, fast);
  const ready = vi.fn();
  queue.whenReady(ready);
  queue.add(file(size));
  await vi.waitFor(() => expect(ready).toHaveBeenCalled());
  expect(api.sendChunk.mock.calls.map(([, offset]) => offset)).toEqual([
    0,
    CHUNK_BYTES,
  ]);
});

it('pauses on a lost connection and resumes from the confirmed offset', async () => {
  const size = CHUNK_BYTES + 10;
  let fail = 0;
  const api = transport(size);
  const send = api.sendChunk.getMockImplementation()!;
  api.sendChunk.mockImplementation(async (id, offset, chunk, signal) => {
    if (offset === CHUNK_BYTES && fail++ === 0)
      throw new TypeError('Failed to fetch');
    return send(id, offset, chunk, signal);
  });
  const queue = new UploadQueue(api, { retry: 60_000, poll: 1 });
  const ready = vi.fn();
  queue.whenReady(ready);
  const key = queue.add(file(size));
  await vi.waitFor(() => expect(queue.snapshot()[0]?.stage).toBe('paused'));
  expect(queue.snapshot()[0]?.sent).toBe(CHUNK_BYTES);
  // Coming back online wakes it before the long retry.
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(ready).toHaveBeenCalled());
  expect(api.uploadStatus).toHaveBeenCalled();
  expect(api.sendChunk.mock.calls.map(([, offset]) => offset)).toEqual([
    0,
    CHUNK_BYTES,
    CHUNK_BYTES,
  ]);
  expect(key).toMatch(/^upload-/);
});

it('cancels: stops sending, removes the row and the partial file', async () => {
  const size = CHUNK_BYTES * 3;
  const api = transport(size);
  let release: () => void = () => {};
  api.sendChunk.mockImplementation(
    (_id, _offset, _chunk, signal) =>
      new Promise((_resolve, reject) => {
        release = () => reject(new DOMException('aborted', 'AbortError'));
        signal?.addEventListener('abort', release);
      }),
  );
  const queue = new UploadQueue(api, fast);
  const key = queue.add(file(size));
  await vi.waitFor(() => expect(api.sendChunk).toHaveBeenCalledTimes(1));
  await queue.cancel(key);
  expect(api.cancelUpload).toHaveBeenCalledWith('u1');
  expect(queue.snapshot()).toEqual([]);
  expect(api.sendChunk).toHaveBeenCalledTimes(1);
});

it('waits for a duplicate choice, then imports a copy', async () => {
  const size = 10;
  const api = transport(size);
  api.uploadStatus.mockResolvedValue(
    state(size, size, { state: 'ready', asset: 'copy' }),
  );
  api.sendChunk.mockResolvedValue(
    state(size, size, { state: 'duplicate', existing: 'a0', title: 'Song' }),
  );
  const queue = new UploadQueue(api, fast);
  const ready = vi.fn();
  queue.whenReady(ready);
  const key = queue.add(file(size));
  await vi.waitFor(() => expect(queue.snapshot()[0]?.stage).toBe('duplicate'));
  expect(queue.snapshot()[0]?.duplicate).toEqual({
    existing: 'a0',
    title: 'Song',
  });
  await queue.importCopy(key);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledWith('copy', 'Song'));
});

it('shows the device reason when a file is refused or fails to import', async () => {
  const api = transport(10);
  api.startUpload.mockRejectedValue(
    new DeviceError('Only WAV and MP3 files can be imported', 'invalid', 415),
  );
  const queue = new UploadQueue(api, fast);
  queue.add(file(10, 'notes.txt'));
  await vi.waitFor(() => expect(queue.snapshot()[0]?.stage).toBe('failed'));
  expect(queue.snapshot()[0]?.error).toBe(
    'Only WAV and MP3 files can be imported.',
  );

  const failing = transport(10);
  failing.sendChunk.mockResolvedValue(
    state(10, 10, { state: 'failed', reason: 'Unsupported: 6 channels.' }),
  );
  const second = new UploadQueue(failing, fast);
  const key = second.add(file(10));
  await vi.waitFor(() => expect(second.snapshot()[0]?.stage).toBe('failed'));
  expect(second.snapshot()[0]?.error).toBe('Unsupported: 6 channels.');
  second.dismiss(key);
  expect(second.snapshot()).toEqual([]);
});
