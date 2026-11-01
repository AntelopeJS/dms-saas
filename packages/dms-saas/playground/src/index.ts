import "./welcome/page";
import { registerPlaygroundSeed } from "./seed";

/**
 * Registers the seed at construct, so its handler is in place before DMS
 * provisions its default tenant from its own `start()`.
 */
export async function construct(): Promise<void> {
  registerPlaygroundSeed();
}

export async function start(): Promise<void> {}

export async function stop(): Promise<void> {}
