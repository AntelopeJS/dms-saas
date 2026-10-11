import "./welcome/page";
import { registerPlaygroundSeed } from "./seed";

export async function construct(): Promise<void> {}

export async function start(): Promise<void> {
  registerPlaygroundSeed();
}

export async function stop(): Promise<void> {}
