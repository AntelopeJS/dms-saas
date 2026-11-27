/**
 * The entry of `table` stored under `key` itself, never one inherited from
 * `Object.prototype`.
 *
 * @param table A table holding an entry for every key
 * @param key The key to read
 * @returns The entry
 * @throws RangeError when the table holds no entry of its own for the key
 */
export function ownValue<Key extends string, Value>(
  table: Record<Key, Value>,
  key: Key,
): Value {
  if (!Object.hasOwn(table, key)) {
    throw new RangeError(`No entry for "${key}"`);
  }
  return table[key];
}
