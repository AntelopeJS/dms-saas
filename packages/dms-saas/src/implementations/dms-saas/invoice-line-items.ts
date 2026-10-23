import { Logging } from "@antelopejs/interface-core/logging";
import type { InvoiceLineItemsProvider } from "@antelopejs/interface-dms-saas/invoice-line-items";

const LOG_PREFIX = "[dms-saas:invoice-line-items]";

const providers = new Map<string, InvoiceLineItemsProvider>();

// Last writer wins rather than throws: RegisteringProxy records the id before
// the callback runs, so refusing a collision here would leave the proxy
// attributing the live registration to the module whose call was rejected —
// its unload, or its stop(), would then drop the provider that is actually
// serving. A collision is a naming bug in one of the two modules, so it is
// reported at error level instead.
function register(
  providerId: string,
  provider: InvoiceLineItemsProvider,
): void {
  if (providers.has(providerId)) {
    Logging.Error(
      `${LOG_PREFIX} provider id '${providerId}' is already taken: the previous provider is replaced and its usage lines will no longer be invoiced`,
    );
  }
  providers.set(providerId, { ...provider, id: providerId });
}

function unregister(providerId: string): void {
  providers.delete(providerId);
}

export namespace internal {
  export const RegisterInvoiceLineItemsProvider = { register, unregister };
}

export function getInvoiceLineItemsProviders(): InvoiceLineItemsProvider[] {
  return [...providers.values()];
}
