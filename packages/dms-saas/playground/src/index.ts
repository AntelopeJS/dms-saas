import "./welcome/page";
import { keepDemoMigrationRunning, registerPlaygroundSeed } from "./seed";

export async function construct(): Promise<void> {}

export async function start(): Promise<void> {
  keepDemoMigrationRunning();
  registerPlaygroundSeed();
}

export async function stop(): Promise<void> {}
