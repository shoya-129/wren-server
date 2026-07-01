import { Injectable } from '@nestjs/common';

@Injectable()
export class CacheService {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();

  set(key: string, value: unknown, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  get<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return cached.value as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deletePattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
