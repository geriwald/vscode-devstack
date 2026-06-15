import { LogLine } from "./types";

const PER_CHANNEL_CAP = 500;
const REPLAY_CAP = 2000;
const MAX_PARTIAL = 16384; // flush a newline-less line (progress bars) past this
const MAX_CHANNELS = 128; // evict oldest script:: channels past this

type Listener = (line: LogLine) => void;

/**
 * Central log fan-in/fan-out. Every service/script feeds raw chunks here; the
 * bus splits them into lines, stamps a monotonic `seq`, keeps a per-channel ring
 * buffer (for `/api/logs/:id`) and a global recent buffer (for SSE replay on
 * connect), and notifies live SSE listeners.
 */
export class LogBus {
  private seq = 0;
  private buffers = new Map<string, LogLine[]>();
  private recentLines: LogLine[] = [];
  private listeners = new Set<Listener>();
  /** Carry partial (newline-less) chunks per "id::stream" until the line ends. */
  private partials = new Map<string, string>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Feed a raw chunk; emits one LogLine per completed line. */
  push(id: string, stream: LogLine["stream"], chunk: string): void {
    const key = `${id}::${stream}`;
    const buffered = (this.partials.get(key) ?? "") + chunk.replace(/\r/g, "");
    const parts = buffered.split("\n");
    let partial = parts.pop() ?? ""; // last part is the new partial
    for (const line of parts) {
      this.emit(id, stream, line);
    }
    // A stream that never emits a newline (e.g. a \r progress bar) must not grow
    // the partial buffer without bound — flush it as a line past the cap.
    if (partial.length > MAX_PARTIAL) {
      this.emit(id, stream, partial);
      partial = "";
    }
    this.partials.set(key, partial);
  }

  /** Flush any pending partial line for an id (e.g. on process exit). */
  flush(id: string): void {
    for (const stream of ["out", "err", "sys"] as const) {
      const key = `${id}::${stream}`;
      const partial = this.partials.get(key);
      if (partial) {
        this.partials.delete(key);
        this.emit(id, stream, partial);
      }
    }
  }

  /** Emit a synthetic system line (e.g. "[exited with code 1]"). */
  system(id: string, line: string): void {
    this.emit(id, "sys", line);
  }

  private emit(id: string, stream: LogLine["stream"], line: string): void {
    const entry: LogLine = { id, seq: ++this.seq, ts: Date.now(), stream, line };

    let buf = this.buffers.get(id);
    if (!buf) {
      this.evictIfNeeded();
      buf = [];
      this.buffers.set(id, buf);
    }
    buf.push(entry);
    if (buf.length > PER_CHANNEL_CAP) {
      buf.splice(0, buf.length - PER_CHANNEL_CAP);
    }

    this.recentLines.push(entry);
    if (this.recentLines.length > REPLAY_CAP) {
      this.recentLines.splice(0, this.recentLines.length - REPLAY_CAP);
    }

    for (const fn of this.listeners) {
      fn(entry);
    }
  }

  /** Bound the channel count: drop the oldest one-shot script:: channels. */
  private evictIfNeeded(): void {
    if (this.buffers.size < MAX_CHANNELS) {
      return;
    }
    for (const id of this.buffers.keys()) {
      if (id.startsWith("script::")) {
        this.buffers.delete(id);
        this.partials.delete(`${id}::out`);
        this.partials.delete(`${id}::err`);
        this.partials.delete(`${id}::sys`);
        return;
      }
    }
  }

  tail(id: string, n: number): LogLine[] {
    const buf = this.buffers.get(id) ?? [];
    return n >= buf.length ? buf.slice() : buf.slice(buf.length - n);
  }

  /** Recent lines across all channels, for SSE replay on connect. */
  recent(n: number): LogLine[] {
    return n >= this.recentLines.length
      ? this.recentLines.slice()
      : this.recentLines.slice(this.recentLines.length - n);
  }
}
