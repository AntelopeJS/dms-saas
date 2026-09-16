export interface CurrentWorkspace {
  _id: string;
  name: string;
  retentionDays: number;
}

const CURRENT_ENDPOINT = "/api/saas/workspaces/current";
const STATE_KEY = "saas-current-workspace";

interface CurrentWorkspaceHandle {
  workspace: Ref<CurrentWorkspace | null>;
  load: () => Promise<void>;
  rename: (name: string) => Promise<void>;
}

/**
 * Shared so the general-settings blocks read the workspace once and a rename
 * done in one of them is immediately visible to the other and to the switcher.
 */
export function useCurrentWorkspace(): CurrentWorkspaceHandle {
  const { $authFetch } = useAuthFetch();
  const workspace = useDmsState<CurrentWorkspace | null>(STATE_KEY, () => null);
  const { refresh: refreshMyWorkspaces } = useMyWorkspaces();

  async function load(): Promise<void> {
    workspace.value = await $authFetch<CurrentWorkspace>(CURRENT_ENDPOINT);
  }

  async function rename(name: string): Promise<void> {
    const updated = await $authFetch<CurrentWorkspace>(CURRENT_ENDPOINT, {
      method: "PUT",
      body: { name },
    });
    workspace.value = workspace.value
      ? { ...workspace.value, name: updated.name }
      : null;
    // The rename is committed at this point: a failing sidebar refresh must
    // not make the caller report it as failed.
    await refreshMyWorkspaces().catch(() => undefined);
  }

  return { workspace, load, rename };
}
