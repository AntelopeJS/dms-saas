/**
 * The part of playwright-core's API the journeys use. `prepare` installs
 * playwright-core into this folder for a run, but the repository's checks
 * lint without it, so `tsconfig.json` maps the module name to this file and
 * the journeys type-check the same way in both.
 */
declare module "playwright-core" {
  type Role = string;

  interface RoleOptions {
    name?: string | RegExp;
    exact?: boolean;
    level?: number;
    checked?: boolean;
    pressed?: boolean;
    selected?: boolean;
  }

  interface Timeout {
    timeout?: number;
  }

  interface Locator {
    getByRole(role: Role, options?: RoleOptions): Locator;
    getByText(text: string | RegExp): Locator;
    first(): Locator;
    last(): Locator;
    click(options?: Timeout & { button?: "left" | "right"; position?: { x: number; y: number } }): Promise<void>;
    dblclick(options?: Timeout): Promise<void>;
    fill(value: string, options?: Timeout): Promise<void>;
    check(options?: Timeout): Promise<void>;
    press(key: string, options?: Timeout): Promise<void>;
    focus(options?: Timeout): Promise<void>;
    count(): Promise<number>;
    isVisible(options?: Timeout): Promise<boolean>;
    isEnabled(options?: Timeout): Promise<boolean>;
    getAttribute(name: string, options?: Timeout): Promise<string | null>;
    inputValue(options?: Timeout): Promise<string>;
    textContent(options?: Timeout): Promise<string | null>;
    allTextContents(): Promise<string[]>;
    waitFor(options?: Timeout & { state?: "attached" | "detached" | "visible" | "hidden" }): Promise<void>;
    evaluate<R, A>(callback: (element: HTMLElement, argument: A) => R, argument?: A): Promise<R>;
    setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void>;
  }

  interface Download {
    path(): Promise<string | null>;
  }

  interface FileChooser {
    isMultiple(): boolean;
    setFiles(files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void>;
  }

  interface Cookie {
    name: string;
    value: string;
  }

  interface BrowserContext {
    grantPermissions(permissions: string[], options?: { origin?: string }): Promise<void>;
    cookies(urls?: string | string[]): Promise<Cookie[]>;
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  interface Keyboard {
    press(key: string): Promise<void>;
    type(text: string): Promise<void>;
  }

  interface Route {
    continue(): Promise<void>;
  }

  interface Page {
    route(url: string, handler: (route: Route) => Promise<void>): Promise<void>;
    getByRole(role: Role, options?: RoleOptions): Locator;
    getByText(text: string | RegExp): Locator;
    locator(selector: string): Locator;
    goto(url: string): Promise<object | null>;
    url(): string;
    waitForTimeout(milliseconds: number): Promise<void>;
    waitForURL(predicate: (url: URL) => boolean, options?: Timeout): Promise<void>;
    waitForEvent(event: "download", options?: Timeout): Promise<Download>;
    waitForEvent(event: "filechooser", options?: Timeout): Promise<FileChooser>;
    evaluate<R>(callback: () => R): Promise<R>;
    setViewportSize(size: { width: number; height: number }): Promise<void>;
    context(): BrowserContext;
    keyboard: Keyboard;
  }

  interface Browser {
    newContext(): Promise<BrowserContext>;
    close(): Promise<void>;
  }
}
