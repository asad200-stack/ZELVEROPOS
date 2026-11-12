import { resolveEmulatorHubHostPort } from './emulatorSafety';

/**
 * Functions emulator execution barrier for test cleanup.
 *
 * The emulator's info log does not include an execution id. A start is
 * `Beginning execution of "<trigger>"` and a finish is `Finished "<trigger>" in <ms>`.
 * Overlapping runs of the same trigger can only be counted, not paired one-to-one.
 * An extra finish for a trigger with no outstanding start is reported and blocks cleanup.
 *
 * The quiet period starts when this process observes the latest relevant finish (or
 * observes that the replayed log has no outstanding starts). It is not taken from a
 * timestamp stored in an older log line. Silence does not prove that a trigger still
 * queued inside the emulator has started. Cleanup is refused while any counted
 * execution is outstanding. This is not a guarantee that every queued trigger has run.
 */
export class UnmatchedFunctionFinish extends Error {
  constructor(trigger: string) {
    super(`Unmatched Functions emulator finish for ${trigger}`);
    this.name = 'UnmatchedFunctionFinish';
  }
}

export interface FunctionActivity {
  pendingByTrigger: Record<string, number>;
  /** Wall clock when the outstanding set last became empty. 0 until that observation. */
  quietArmedAt: number;
}

const BEGIN = /Beginning execution of "([^"]+)"/;
const END = /Finished "([^"]+)" in /;

export function emptyFunctionActivity(): FunctionActivity {
  return { pendingByTrigger: {}, quietArmedAt: 0 };
}

export function pendingFunctionCount(state: FunctionActivity): number {
  return Object.values(state.pendingByTrigger).reduce((sum, count) => sum + count, 0);
}

export function noteFunctionLog(state: FunctionActivity, message: string, observedAt: number): void {
  const started = BEGIN.exec(message);
  if (started?.[1]) {
    const trigger = started[1];
    state.pendingByTrigger[trigger] = (state.pendingByTrigger[trigger] ?? 0) + 1;
    state.quietArmedAt = 0;
    return;
  }
  const finished = END.exec(message);
  if (!finished?.[1]) return;
  const trigger = finished[1];
  const pending = state.pendingByTrigger[trigger] ?? 0;
  if (pending < 1) throw new UnmatchedFunctionFinish(trigger);
  const next = pending - 1;
  if (next === 0) delete state.pendingByTrigger[trigger];
  else state.pendingByTrigger[trigger] = next;
  if (pendingFunctionCount(state) === 0) state.quietArmedAt = observedAt;
}

/** Arms the quiet clock when nothing is outstanding and no finish has armed it yet. */
export function armFunctionQuiet(state: FunctionActivity, observedAt: number): void {
  if (pendingFunctionCount(state) === 0 && state.quietArmedAt === 0) state.quietArmedAt = observedAt;
}

export function functionActivityIdle(state: FunctionActivity, now: number, quietMs: number): boolean {
  if (pendingFunctionCount(state) > 0) return false;
  if (state.quietArmedAt === 0) return false;
  return now - state.quietArmedAt >= quietMs;
}

export function messageFromLog(raw: string): string {
  try {
    const bundle = JSON.parse(raw) as { message?: string; data?: { metadata?: { message?: string } } };
    return bundle.data?.metadata?.message || bundle.message || '';
  } catch {
    return raw;
  }
}

const QUIET_MS = 500;
const IDLE_TIMEOUT_MS = 90_000;
const HISTORY_QUIET_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  return '';
}

function socketUrl(host: string, port: number): string {
  const name = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `ws://${name}:${port}`;
}

class FunctionLogMonitor {
  readonly state: FunctionActivity = emptyFunctionActivity();
  messages = 0;
  failure: Error | null = null;
  private readonly opened: Promise<void>;

  constructor(url: string) {
    this.opened = new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('Logging emulator websocket timed out')), 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Logging emulator websocket failed'));
      });
      ws.addEventListener('message', (event) => {
        const text = asText(event.data);
        if (!text) return;
        this.messages += 1;
        if (this.failure) return;
        try {
          noteFunctionLog(this.state, messageFromLog(text), Date.now());
        } catch (error) {
          this.failure = error instanceof Error ? error : new Error(String(error));
        }
      });
    });
  }

  ready(): Promise<void> {
    return this.opened;
  }

  async ingestHistory(): Promise<void> {
    const started = Date.now();
    let seen = -1;
    while (Date.now() - started < 3_000) {
      if (this.messages === seen) return;
      seen = this.messages;
      await sleep(HISTORY_QUIET_MS);
    }
  }
}

let connecting: Promise<FunctionLogMonitor> | null = null;

async function monitor(): Promise<FunctionLogMonitor> {
  if (!connecting) {
    connecting = openMonitor().catch((error: unknown) => {
      connecting = null;
      throw error;
    });
  }
  return connecting;
}

async function openMonitor(): Promise<FunctionLogMonitor> {
  const hub = resolveEmulatorHubHostPort();
  const res = await fetch(`http://${hub}/emulators`);
  if (!res.ok) throw new Error(`Emulator hub returned ${res.status}`);
  const body = (await res.json()) as Record<string, { host?: string; port?: number }>;
  const logging = body.logging;
  if (!logging?.port) throw new Error('Logging emulator is not running');
  const watcher = new FunctionLogMonitor(socketUrl(logging.host ?? '127.0.0.1', logging.port));
  await watcher.ready();
  await watcher.ingestHistory();
  if (watcher.failure) throw watcher.failure;
  armFunctionQuiet(watcher.state, Date.now());
  return watcher;
}

/**
 * Waits until every counted execution has finished and the post-observation quiet
 * period has elapsed. Throws if a finish does not match an outstanding start.
 */
export async function waitForFunctionsIdle(): Promise<void> {
  const watcher = await monitor();
  const started = Date.now();
  while (Date.now() - started < IDLE_TIMEOUT_MS) {
    if (watcher.failure) throw watcher.failure;
    if (functionActivityIdle(watcher.state, Date.now(), QUIET_MS)) return;
    await sleep(50);
  }
  if (watcher.failure) throw watcher.failure;
  throw new Error(`Functions emulator still executing ${pendingFunctionCount(watcher.state)} function(s)`);
}
