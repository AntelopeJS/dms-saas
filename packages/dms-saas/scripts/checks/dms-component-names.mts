import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LAYER_APP = join(MODULE_ROOT, "frontend-vue/app");
const OWN_PREFIX = "DmsSaas";
const DMS_PREFIX = "Dms";
const OWN_COMPONENT_DIRECTORIES = ["components/", "build/"];
const OWN_PAGE_DIRECTORY = "custom-pages/";
const DMS_COMPONENT_PATH = /\/app\/(?:components|build\/components)\//;
const DMS_ALIASES = /COMPONENT_ALIASES[^=]*=\s*\{([^}]*)\}/;
const ALIAS_VALUE = /:\s*"(\w+)"/g;
const FRONTEND_REGISTRATION = /app\.component\(\s*"(\w+)"/g;
const TEMPLATE = /^<template>([\s\S]*)^<\/template>/m;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?((?:Dms[A-Z]\w*)|(?:dms-[a-z][\w-]*))(?=[\s/>])/g;
const RESOLVED = /resolveComponent\(\s*['"](Dms[A-Z]\w*)['"]/g;

/** A path with `/` separators, as the patterns below read it on every platform. */
function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => posixPath(join(entry.parentPath, entry.name)));
}

/** A component name as the DMS registers it: each path part capitalised and joined. */
function pascalCase(path: string): string {
  return path
    .replace(/\.vue$/, "")
    .split(/[./_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function packageRoot(name: string): string {
  const require = createRequire(join(MODULE_ROOT, "package.json"));
  return dirname(require.resolve(`${name}/package.json`));
}

/** The names `@antelopejs/dms` registers: its component files and their aliases. */
function dmsComponents(): string[] {
  const root = join(packageRoot("@antelopejs/dms"), "frontend-vue");
  const files = filesUnder(join(root, "layers"), ".vue")
    .filter((file) => DMS_COMPONENT_PATH.test(file))
    .map((file) => `${DMS_PREFIX}${pascalCase(basename(file))}`);
  const aliases =
    DMS_ALIASES.exec(
      readFileSync(join(root, "dms.frontend.ts"), "utf8"),
    )?.[1] ?? "";
  const aliased = [...aliases.matchAll(ALIAS_VALUE)].map(
    ([, alias]) => `${DMS_PREFIX}${alias}`,
  );
  return [...files, ...aliased];
}

/** The names the `@antelopejs/dms-frontend` renderer registers itself (`DmsLink`, `DmsClientOnly`). */
function rendererComponents(): string[] {
  const sdk = join(
    packageRoot("@antelopejs/dms-frontend"),
    "templates/vue/frontend-runtime/sdk.ts",
  );
  return [...readFileSync(sdk, "utf8").matchAll(FRONTEND_REGISTRATION)].map(
    ([, name = ""]) => name,
  );
}

/** The names this module registers: its component files and its custom pages. */
function ownComponents(): string[] {
  return filesUnder(LAYER_APP, ".vue").flatMap((file) => {
    const path = posixPath(relative(LAYER_APP, file));
    if (
      OWN_COMPONENT_DIRECTORIES.some((directory) => path.startsWith(directory))
    )
      return [`${OWN_PREFIX}${pascalCase(basename(file))}`];
    if (path.startsWith(OWN_PAGE_DIRECTORY))
      return [
        `${OWN_PREFIX}${pascalCase(path.slice(OWN_PAGE_DIRECTORY.length))}`,
      ];
    return [];
  });
}

function namedComponent(tag: string): string {
  return tag.startsWith("dms-")
    ? `${DMS_PREFIX}${pascalCase(tag.slice(4))}`
    : tag;
}

/**
 * Every `Dms*` or `dms-*` component a template of the frontend layer draws, or
 * that it resolves by name, must be one a package ships or the layer defines:
 * Vue leaves an unknown tag unrendered and no build or typecheck reports it.
 */
export function dmsComponentNameFailures(): string[] {
  const known = new Set([
    ...dmsComponents(),
    ...rendererComponents(),
    ...ownComponents(),
  ]);
  return filesUnder(LAYER_APP, ".vue").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const template = (TEMPLATE.exec(source)?.[1] ?? "").replace(COMMENT, "");
    const used = [
      ...[...template.matchAll(TAG)].map(([, tag = ""]) => tag),
      ...[...source.matchAll(RESOLVED)].map(([, name = ""]) => name),
    ];
    return [...new Set(used)]
      .filter((tag) => !known.has(namedComponent(tag)))
      .map(
        (tag) =>
          `${posixPath(relative(MODULE_ROOT, file))}: <${tag}> is no component @antelopejs/dms, @antelopejs/dms-frontend or this layer registers`,
      );
  });
}
