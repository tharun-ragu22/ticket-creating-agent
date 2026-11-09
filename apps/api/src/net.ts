import { networkInterfaces } from 'node:os';

/**
 * The URLs this process is actually reachable at.
 *
 * The startup log used to print `publicBaseUrl`, which is a configured string:
 * it said 127.0.0.1 whatever the socket was bound to, so "can the phone reach
 * this?" could not be answered from the server's own output. These are read
 * from the interfaces the process can see instead, which also settles the case
 * a configured value hides — an API running inside WSL or a VM lists its own
 * NAT address here and never the host's LAN address, so a phone that resolved
 * the host will be talking to a machine with nothing listening. The mismatch
 * between this list and the URL the app reports is the whole diagnosis.
 */
export function reachableUrls(host: string, port: number): string[] {
  if (!isWildcard(host)) return [url(host, port)];

  const urls = [url('127.0.0.1', port)];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      // IPv6 link-local addresses need a scope id to be usable and would only
      // add noise to a line someone reads while debugging.
      if (address.family !== 'IPv4' || address.internal) continue;
      urls.push(url(address.address, port));
    }
  }
  return urls;
}

/** Whether anything off this machine can reach the bind at all. */
export function isLoopbackOnly(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** 0.0.0.0 and :: mean every interface. An empty host is Node's wildcard too. */
const isWildcard = (host: string): boolean =>
  host === '0.0.0.0' || host === '::' || host === '';

const url = (host: string, port: number): string =>
  `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
