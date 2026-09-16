/**
 * The part of a bound external identity that names the provider a login came
 * from. Structural on purpose: the caller passes the stored rows, the rule
 * below stays independent of the table they live in.
 */
export interface ExternalIdentityEntry {
  provider: string;
  lastLoginAt: Date;
}

/**
 * Name the provider a pending registration entered with.
 *
 * Read from the account's bound identities rather than from the `provider`
 * query parameter the OAuth completion page carries: by the time the
 * registration screen reads that parameter it has been through a client-side
 * navigation, and the provider is shown to the user as the identity about to
 * own — and pay for — the workspace.
 *
 * The most recent login wins, so an account holding several providers names
 * the one that just came back from the round-trip.
 *
 * @param identities Identities bound to the account
 * @returns Provider id, or null for an account that signs in with a password
 */
export function resolveEntryProvider(
  identities: readonly ExternalIdentityEntry[],
): string | null {
  const mostRecent = identities.reduce<ExternalIdentityEntry | undefined>(
    (latest, identity) =>
      !latest || +new Date(identity.lastLoginAt) > +new Date(latest.lastLoginAt)
        ? identity
        : latest,
    undefined,
  );
  return mostRecent?.provider ?? null;
}
