import {
  createRenderer,
  defineComponent,
} from "../../frontend-vue/node_modules/vue/index.mjs";

/**
 * The Vue the frontend layer's composables import as `vue`. A ref made with
 * another copy of Vue would not be tracked by their computeds, so tests make
 * the refs they hand those composables with this one.
 */
export {
  type MaybeRefOrGetter,
  type Ref,
  nextTick,
  ref,
  toValue,
} from "../../frontend-vue/node_modules/vue/index.mjs";

/** A host node of {@link headless}: it draws nothing. */
interface HeadlessNode {
  children: HeadlessNode[];
}

/**
 * A Vue renderer whose host nodes draw nothing: a component mounted with it
 * runs its setup, its renders and its lifecycle hooks as in a browser, with
 * no DOM.
 */
const headless = createRenderer<HeadlessNode, HeadlessNode>({
  createElement: () => ({ children: [] }),
  createText: () => ({ children: [] }),
  createComment: () => ({ children: [] }),
  insert: (child, parent) => {
    parent.children.push(child);
  },
  remove: () => undefined,
  setText: () => undefined,
  setElementText: () => undefined,
  parentNode: () => null,
  nextSibling: () => null,
  patchProp: () => undefined,
});

/** A component mounted with {@link mountComposable}. */
export interface MountedComposable<T, R> {
  /** What the composable returned. */
  state: T;
  /** Each value the component's render read, in order. */
  renders: R[];
  unmount(): void;
}

/**
 * Mounts a component whose setup calls `composable`, and whose render reads
 * `rendered(state)`: the composable's `onMounted` hooks run once its first
 * render is done, as in the browser.
 *
 * @param composable Called in the component's setup
 * @param rendered What the component's render reads from the composable's result
 */
export function mountComposable<T, R>(
  composable: () => T,
  rendered: (state: T) => R,
): MountedComposable<T, R> {
  const renders: R[] = [];
  let state: T | undefined;
  const component = defineComponent({
    setup() {
      const result = composable();
      state = result;
      return () => {
        renders.push(rendered(result));
        return null;
      };
    },
  });
  const app = headless.createApp(component);
  app.mount({ children: [] });
  if (state === undefined) throw new Error("The component never ran its setup");
  return { state, renders, unmount: () => app.unmount() };
}
