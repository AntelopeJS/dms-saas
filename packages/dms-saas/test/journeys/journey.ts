import { randomBytes } from "node:crypto";
import { test as base, expect, inject } from "vitest";
import {
  apiRequest,
  capturedMail,
  freshDatabase,
  loadRun,
  onboard,
  restartBackend,
  type RunState,
  saveRun,
} from "./run.ts";

/** A backend answer: its status (null when the call failed), its JSON body and the failure. */
export type Answer = Omit<Awaited<ReturnType<typeof apiRequest>>, "folder">;

/** A message the run's mail sink captured. */
export type CapturedMail = ReturnType<typeof capturedMail>[number];

/** A JSON value a test sends. */
export type Json = string | number | boolean | null | Json[] | JsonObject;

/** A JSON object a test sends; an undefined field is left out. */
export interface JsonObject {
  [key: string]: Json | undefined;
}

/** A call to the backend, as `as`: an account of the run, `anon` for nobody, `admin` by default. */
export interface ApiCall {
  method: string;
  path: string;
  body?: Json;
  as?: string;
}

const MAIL_TIMEOUT_MS = 15_000;
const MAIL_POLL_MS = 250;
const UNIQUE_BYTES = 4;
const PASSWORD_BYTES = 9;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * One test's hold on the run: a fresh database with an onboarded
 * administrator, the accounts the test adds, the mail sink, and restarts of
 * the backend under other module options.
 */
export class Journey {
  readonly #startedAt = new Date().toISOString();

  constructor(
    readonly state: RunState,
    readonly name: string,
  ) {}

  /** Calls the backend; `label` names the call in the run's evidence folder. */
  async api(label: string, call: ApiCall): Promise<Answer> {
    const { status, body, error } = await apiRequest(this.state, {
      ...call,
      as: call.as ?? "admin",
      label,
    });
    return { status, body, error };
  }

  /** Keeps the credentials of an account the test created, so calls can act as it. */
  addAccount(name: string, credentials: { email: string; password: string }) {
    this.state.accounts = { ...this.state.accounts, [name]: credentials };
    saveRun(this.state);
  }

  /** An address unique to this run and test, which the mail sink receives. */
  email(name: string): string {
    return `${name}+${this.state.id}-${slug(this.name)}@verify.local`.toLowerCase();
  }

  /** A string unique to this test, for names it creates. */
  unique(prefix: string): string {
    return `${prefix} ${randomBytes(UNIQUE_BYTES).toString("hex")}`;
  }

  /** A password the DMS policy accepts. */
  password(): string {
    return `Vr1!${randomBytes(PASSWORD_BYTES).toString("base64url").replace(/[-_]/g, "x")}`;
  }

  /** Restarts the backend on the same database, under `state.extraEnv`. */
  async restartBackend(): Promise<void> {
    try {
      await restartBackend(this.state);
    } finally {
      saveRun(this.state);
    }
  }

  /**
   * The mail captured since the test started, waiting until `accept` matches
   * one or the timeout passes; `match` is the latest match.
   */
  async mail(
    accept: (message: CapturedMail) => boolean,
  ): Promise<{ messages: CapturedMail[]; match: CapturedMail | undefined }> {
    const deadline = Date.now() + MAIL_TIMEOUT_MS;
    const read = () =>
      capturedMail(this.state.mail).filter(
        (message) => message.receivedAt >= this.#startedAt,
      );
    let messages = read();
    while (!messages.some(accept) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MS));
      messages = read();
    }
    return { messages, match: messages.findLast(accept) };
  }
}

/**
 * Vitest's `test` with a `journey`: before the test, the run moves onto an
 * empty database served by a backend of its own, and its administrator is
 * onboarded and signed in. The tests of the project share one run, so they
 * run one at a time.
 */
export const test = base.extend<{ journey: Journey }>({
  journey: async ({ task }, use) => {
    const state = loadRun(inject("dmsRun"));
    const index = (state.journeyCount ?? 0) + 1;
    state.journeyCount = index;
    try {
      await freshDatabase(state, `j${String(index).padStart(3, "0")}`);
      const { register, login } = await onboard(state, {});
      expect(register.status, "the administrator registers").toBe(200);
      expect(login?.status, "the administrator signs in").toBe(200);
      saveRun(state);
      await use(new Journey(state, task.name));
    } finally {
      saveRun(state);
    }
  },
});

export { expect };
