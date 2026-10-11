const tailByTenant = new Map<string, Promise<unknown>>();

/**
 * Runs `work` once every earlier holder of the tenant's billing identity has
 * finished. Saving the identity updates the Stripe customer, whose
 * `customer.updated` echo comes back while the save still runs: without the
 * queue the echo reads the row before the save writes it and puts the old
 * company name and VAT number back. The queue is per process, like the card
 * hold of free workspaces.
 *
 * @param tenantId Workspace whose billing identity is read and written
 * @param work Reads and writes of the identity
 */
export async function withBillingIdentityLock<T>(
  tenantId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = tailByTenant.get(tenantId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const tail = run.catch(() => undefined);
  tailByTenant.set(tenantId, tail);
  try {
    return await run;
  } finally {
    if (tailByTenant.get(tenantId) === tail) tailByTenant.delete(tenantId);
  }
}
