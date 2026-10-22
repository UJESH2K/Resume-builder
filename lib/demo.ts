import "server-only";

/**
 * The shared demo account.
 *
 * One account, one password, handed to a room of people so they can see a filled-in resume
 * without signing up first. Three things follow from that, and all three are deliberate:
 *
 *  * It holds a *copy* of a real library, not the original. Row level security gives the demo
 *    account its own row, so sixty people editing it cannot touch the account it was copied
 *    from. Refreshing the copy is a deliberate act — see scripts/demo.ts.
 *  * Saves are last-write-wins instead of returning 409. Optimistic locking is right for one
 *    person with two tabs and wrong for sixty people on one row: every save after the first
 *    would conflict, and a student who came to look at a resume builder would instead spend
 *    the evening reading merge errors. The version history still records every save, so the
 *    demo can be rolled back afterwards.
 *  * It is off unless switched on. A deployment with no DEMO_EMAIL has no demo account, no
 *    weak password, and no extra way in.
 *
 * The password is weak on purpose — it is typed out on a projector — which is exactly why
 * this account must never hold anything private. Whatever is copied into it is public to
 * everyone who has the password, and it is kept apart from real accounts for that reason.
 */

/** The address the demo account actually authenticates with. Never shown to students. */
export const demoEmail = (): string => (process.env.DEMO_EMAIL ?? "").trim().toLowerCase();

/** What students type in the email box. Mapped to `demoEmail()` before Supabase sees it. */
export const demoUsername = (): string =>
  (process.env.DEMO_USERNAME ?? process.env.NEXT_PUBLIC_DEMO_USERNAME ?? "demo").trim().toLowerCase();

export const demoEnabled = (): boolean => demoEmail().length > 0;

/**
 * Translate the demo username into the demo account's real address.
 *
 * Returns the input unchanged for anything else, so this cannot interfere with a normal
 * login. Only an exact match on the username counts: no prefix or substring matching, or a
 * student whose address happens to start with "demo" would be redirected into the sandbox.
 */
export function resolveLoginEmail(entered: string): string {
  const value = entered.trim().toLowerCase();
  if (!demoEnabled()) return value;
  return value === demoUsername() ? demoEmail() : value;
}

/** Is this the demo account? Drives the last-write-wins save path and the banner. */
export function isDemoEmail(email: string | null | undefined): boolean {
  if (!demoEnabled()) return false;
  return (email ?? "").trim().toLowerCase() === demoEmail();
}
