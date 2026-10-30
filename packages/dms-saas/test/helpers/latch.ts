/** A promise that settles when the test says so. */
export interface Latch {
  promise: Promise<void>;
  resolve(): void;
}

/** Holds whatever awaits `promise` until `resolve()` is called. */
export function latch(): Latch {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: () => release() };
}
