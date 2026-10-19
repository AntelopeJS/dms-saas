import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { discoverUnregisteredCycleInvoices } from "./discovery";
import { processInvoiceLineInjection } from "./process";
import { InvoiceLineInjectionModel } from "./task.model";

const LOG_PREFIX = "[dms-saas:invoice-line-recovery]";

/** One recovery pass: discover unregistered drafts, then advance every due task. */
export async function reconcileInvoiceLineInjections(
  now: Date = new Date(),
): Promise<void> {
  await discoverUnregisteredCycleInvoices().catch((error: unknown) => {
    Logging.Error(`${LOG_PREFIX} discovery failed`, error);
  });
  const tasks = await GetModel(InvoiceLineInjectionModel).listActive();
  for (const task of tasks) {
    if (task.nextAttemptAt && task.nextAttemptAt.getTime() > now.getTime())
      continue;
    await processInvoiceLineInjection(task._id).catch((error: unknown) => {
      Logging.Error(`${LOG_PREFIX} invoice ${task._id} failed`, error);
    });
  }
}
