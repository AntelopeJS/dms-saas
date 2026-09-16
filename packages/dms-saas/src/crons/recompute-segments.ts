import { Logging } from "@antelopejs/interface-core/logging";
import cron, { type ScheduledTask } from "node-cron";
import { recomputeAllSegments } from "../utils";

const CRON_NAME = "recompute-segments";
const CRON_SCHEDULE = "*/15 * * * *";

export function scheduleRecomputeSegments(): ScheduledTask {
  return cron.schedule(CRON_SCHEDULE, () => {
    void recomputeAllSegments().catch((error: unknown) => {
      Logging.Error(`[dms-saas:cron:${CRON_NAME}] failed`, error);
    });
  });
}
