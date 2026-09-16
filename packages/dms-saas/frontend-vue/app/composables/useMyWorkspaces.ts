export interface MyWorkspace {
  _id: string;
  name: string;
  planName: string | null;
  isCurrent: boolean;
}

const WORKSPACES_ENDPOINT = "/api/saas/workspaces/mine";
const STATE_KEY = "saas-my-workspaces";

interface MyWorkspacesHandle {
  workspaces: Ref<MyWorkspace[]>;
  isLoaded: Ref<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Shared between the sidebar switcher and the screens that change what it
 * displays (rename today), so a change never waits for a page reload.
 */
export function useMyWorkspaces(): MyWorkspacesHandle {
  const { $authFetch } = useAuthFetch();
  const { loggedIn } = useUserSession();
  const workspaces = useDmsState<MyWorkspace[]>(STATE_KEY, () => []);
  const isLoaded = useDmsState<boolean>(`${STATE_KEY}-loaded`, () => false);

  async function refresh(): Promise<void> {
    if (!loggedIn.value) {
      workspaces.value = [];
      isLoaded.value = true;
      return;
    }

    try {
      workspaces.value = await $authFetch<MyWorkspace[]>(WORKSPACES_ENDPOINT);
      isLoaded.value = true;
    } catch (error) {
      // The sidebar is no place for an error card: render nothing instead. Only
      // the initial load may empty the list — a failed refresh keeps the entries
      // already on screen rather than making the switcher disappear.
      if (!isLoaded.value) workspaces.value = [];
      throw error;
    }
  }

  return { workspaces, isLoaded, refresh };
}
