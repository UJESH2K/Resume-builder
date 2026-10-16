import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Guard for the one place the server fetches a URL a student typed (app/api/fetch-url).
 *
 * Without this it is a server-side request forgery hole: our machine would fetch whatever
 * address someone pasted, including things only reachable from inside the network. On a cloud
 * host, http://169.254.169.254/ hands out instance credentials.
 *
 * Kept separate from the route so it can be tested on its own.
 */

/** Private, loopback, link-local, CGNAT, multicast and cloud-metadata addresses. */
export function isForbiddenAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // includes 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fec0")) return true; // link / site-local
    const first = parseInt(v.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    // IPv4-mapped (::ffff:10.0.0.1) — re-check the embedded address.
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(v);
    if (mapped) return isForbiddenAddress(mapped[1]);
    return false;
  }
  return true; // not a literal IP
}

export class UnsafeUrlError extends Error {}

/**
 * Resolve and vet a URL. Throws UnsafeUrlError with a message meant for the student.
 * Call this again for every redirect hop: a public host can redirect to 127.0.0.1.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That does not look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https links can be imported.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal IP needs no lookup, and must be checked before one.
  if (net.isIP(host) && isForbiddenAddress(host)) {
    throw new UnsafeUrlError("That address is not allowed.");
  }
  // "localhost" and friends resolve to loopback, which the lookup below catches.

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not find ${host}. Check the address.`);
  }
  if (!addresses.length || addresses.some((a) => isForbiddenAddress(a.address))) {
    throw new UnsafeUrlError("That address is not allowed.");
  }
  return url;
}
