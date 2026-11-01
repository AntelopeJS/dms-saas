import type { ComponentInfoSerialized } from "@antelopejs/interface-dms/component";

/**
 * The serialized block whose child id is `id`, searched depth first under
 * `block`.
 *
 * @param block A serialized component tree
 * @param id The child id the page gives the block
 */
export function findChild(
  block: ComponentInfoSerialized,
  id: string,
): ComponentInfoSerialized | undefined {
  for (const child of block.children ?? []) {
    if (child.id === id) return child.component;
    const nested = findChild(child.component, id);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Whether a serialized option value is an object, whose fields a test then
 * reads one by one, each still unchecked.
 *
 * @param value An option value from a serialized block
 */
export function isOptionRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
