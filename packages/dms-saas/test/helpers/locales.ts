import type {
  LocaleTree,
  LocaleValue,
} from "../../scripts/checks/locale-files.mts";
import { isString } from "../../src/utils/primitive-guards";

export {
  duplicatedLocaleKeys,
  flattenLocale,
  type LocaleTree,
  localeFiles,
  readLocale,
} from "../../scripts/checks/locale-files.mts";

/**
 * The message a dotted key names in a catalog; `undefined` when the key names
 * nothing, or a group of messages rather than one.
 *
 * @param tree A locale catalog
 * @param key Dotted key, without the `$` of a display string
 */
export function localeMessage(
  tree: LocaleTree,
  key: string,
): string | undefined {
  let node: LocaleValue | undefined = tree;
  for (const segment of key.split(".")) {
    if (node === undefined || isString(node)) return undefined;
    node = node[segment];
  }
  return isString(node) ? node : undefined;
}
