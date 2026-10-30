export class InMemoryRedisClient {
  private readonly store = new Map<string, { value: string; expiresAt?: number | undefined }>();
  public status = 'ready';

  private cleanup(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    if (!this.cleanup(key)) return null;
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
    let expiresAt: number | undefined = undefined;
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX' && typeof args[i + 1] === 'number') {
        expiresAt = Date.now() + (args[i + 1] as number) * 1000;
        i++;
      } else if (arg === 'PX' && typeof args[i + 1] === 'number') {
        expiresAt = Date.now() + (args[i + 1] as number);
        i++;
      }
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        count++;
      }
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const regexStr = '^' + pattern.replace(/\*/g, '.*') + '$';
    const regex = new RegExp(regexStr);
    const matched: string[] = [];
    for (const key of this.store.keys()) {
      if (this.cleanup(key) && regex.test(key)) {
        matched.push(key);
      }
    }
    return matched;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    if (!this.cleanup(key)) return 0;
    const entry = this.store.get(key)!;
    entry.expiresAt = Date.now() + ms;
    return 1;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.pexpire(key, seconds * 1000);
  }

  async pttl(key: string): Promise<number> {
    if (!this.cleanup(key)) return -2;
    const entry = this.store.get(key)!;
    if (!entry.expiresAt) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  async ttl(key: string): Promise<number> {
    const pttl = await this.pttl(key);
    if (pttl <= 0) return pttl;
    return Math.ceil(pttl / 1000);
  }

  async incr(key: string): Promise<number> {
    let currentVal = 0;
    let expiresAt: number | undefined = undefined;
    if (this.cleanup(key)) {
      const entry = this.store.get(key)!;
      currentVal = parseInt(entry.value, 10) || 0;
      expiresAt = entry.expiresAt;
    }
    const newVal = currentVal + 1;
    this.store.set(key, { value: String(newVal), expiresAt });
    return newVal;
  }

  multi() {
    const ops: Array<() => unknown> = [];
    const multiObj = {
      incr: (key: string) => {
        ops.push(() => this.incr(key));
        return multiObj;
      },
      pttl: (key: string) => {
        ops.push(() => this.pttl(key));
        return multiObj;
      },
      exec: async () => {
        const results: Array<[null, unknown]> = [];
        for (const op of ops) {
          const val = await op();
          results.push([null, val]);
        }
        return results;
      },
    };
    return multiObj;
  }

  async quit(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  disconnect(): void {
    this.store.clear();
  }

  duplicate(): InMemoryRedisClient {
    return this;
  }

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }
}
