/**
 * Keeps the last `limit` lines of one or more interleaved text streams. Each stream has
 * its own partial-line buffer, so a line on stdout is never glued to one on stderr.
 */
export class LineTail {
  private readonly buffer: string[] = [];
  private readonly partial = new Map<string, string>();
  private count = 0;

  constructor(private readonly limit: number) {}

  /** Adds a chunk of `stream` and returns the complete lines it finished. */
  push(chunk: string, stream = 'default'): string[] {
    const parts = ((this.partial.get(stream) ?? '') + chunk).split(/\r?\n/);
    this.partial.set(stream, parts.pop() ?? '');
    for (const line of parts) {
      this.add(line);
    }
    return parts;
  }

  /** Flushes the trailing lines without a newline, stream by stream, and returns them. */
  end(): string[] {
    const flushed: string[] = [];
    for (const [stream, line] of this.partial) {
      if (line !== '') {
        this.add(line);
        flushed.push(line);
      }
      this.partial.delete(stream);
    }
    return flushed;
  }

  private add(line: string): void {
    this.count += 1;
    this.buffer.push(line);
    if (this.buffer.length > this.limit) {
      this.buffer.shift();
    }
  }

  lines(): string[] {
    return [...this.buffer];
  }

  totalLines(): number {
    return this.count;
  }
}
