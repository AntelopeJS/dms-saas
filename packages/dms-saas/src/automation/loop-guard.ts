import { Logging } from "@antelopejs/interface-core/logging";

/** Procedure-made events of one subject a window lets through. */
export const LOOP_GUARD_LIMIT = 5;
/** The sliding window the limit counts over. */
export const LOOP_GUARD_WINDOW_MS = 60_000;

/**
 * Circuit breaker for events procedures cause: past {@link LOOP_GUARD_LIMIT}
 * of one subject within {@link LOOP_GUARD_WINDOW_MS}, the next ones are
 * dropped, so a procedure answering its own writes, or two procedures
 * answering each other, stop. Counts are per process: the write and the event
 * it causes run in the process that ran the step.
 */
export class AutomationLoopGuard {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly limit = LOOP_GUARD_LIMIT,
    private readonly windowMs = LOOP_GUARD_WINDOW_MS,
  ) {}

  admit(subject: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    for (const [key, times] of this.recent)
      if (times.every((time) => time <= since)) this.recent.delete(key);
    const times = (this.recent.get(subject) ?? []).filter(
      (time) => time > since,
    );
    const admitted = times.length < this.limit;
    if (admitted) times.push(now);
    this.recent.set(subject, times);
    return admitted;
  }

  reset(): void {
    this.recent.clear();
  }
}

/** The breaker every saas trigger fed by procedure writes shares. */
export const automationLoopGuard = new AutomationLoopGuard();

/**
 * Whether an event a procedure caused may fire, logging a warning when the
 * breaker drops it.
 */
export function admitOriginatedEvent(event: string, subject: string): boolean {
  if (automationLoopGuard.admit(`${event}|${subject}`)) return true;
  Logging.Warn(
    `[dms-saas:automation] loop guard dropped ${event} for ${subject}: more than ${LOOP_GUARD_LIMIT} procedure-made changes within ${LOOP_GUARD_WINDOW_MS / 1000} s`,
  );
  return false;
}
