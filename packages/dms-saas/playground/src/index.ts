import "./welcome/page";
import { registerPlaygroundSeed } from "./seed";

// Registered at construct, so the handler is in place before DMS provisions
// its default tenant from its own start().
export async function construct(): Promise<void> {
  registerPlaygroundSeed();
}

export async function start(): Promise<void> {}

export async function stop(): Promise<void> {}
