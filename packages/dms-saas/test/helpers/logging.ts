import { Logging } from "@antelopejs/interface-core/logging";
import listener, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import { afterEach, beforeEach } from "vitest";

/** A severity of {@link Logging.Level} by its name. */
export type LogLevelName = keyof typeof Logging.Level;

/** The entries the module wrote to `Logging`, in order. */
export interface LogCapture {
  entries: Log[];
  /** The arguments of every entry written at `level`, on any channel. */
  at(level: LogLevelName): Log["args"][];
}

/**
 * Listens to `Logging` the way a log sink does, through its listener event,
 * for every test of the file it is called in at the top level. Entries start
 * empty before each test.
 */
export function captureLogs(): LogCapture {
  const entries: Log[] = [];
  const record = (log: Log): void => {
    entries.push(log);
  };
  beforeEach(() => {
    entries.length = 0;
    listener.register(record);
  });
  afterEach(() => {
    listener.unregister(record);
  });
  return {
    entries,
    at: (level) =>
      entries
        .filter((log) => log.levelId === Logging.Level[level])
        .map((log) => log.args),
  };
}
