import { describe, it, expect } from 'vitest';
import { isLoopbackOnly, reachableUrls } from '../src/net.js';

describe('reachableUrls', () => {
  it('reports only the one address when a specific host is bound', () => {
    expect(reachableUrls('127.0.0.1', 8080)).toEqual(['http://127.0.0.1:8080']);
  });

  it('brackets an IPv6 host, which is otherwise an unusable URL', () => {
    expect(reachableUrls('fd00::1', 8080)).toEqual(['http://[fd00::1]:8080']);
  });

  /**
   * The point of the whole module: the phone reports the address it tried, and
   * this is the list it has to appear in. A wildcard bind must therefore name
   * every interface, not just loopback.
   */
  it('names loopback and every external IPv4 interface for a wildcard bind', () => {
    const urls = reachableUrls('0.0.0.0', 8080);

    expect(urls).toContain('http://127.0.0.1:8080');
    expect(urls.every((u) => u.endsWith(':8080'))).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('treats :: and an empty host as wildcards too', () => {
    expect(reachableUrls('::', 8080)).toContain('http://127.0.0.1:8080');
    expect(reachableUrls('', 8080)).toContain('http://127.0.0.1:8080');
  });
});

describe('isLoopbackOnly', () => {
  it('flags the binds a phone cannot reach', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(isLoopbackOnly(host)).toBe(true);
    }
  });

  it('does not flag a wildcard or a LAN address', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10']) {
      expect(isLoopbackOnly(host)).toBe(false);
    }
  });
});
