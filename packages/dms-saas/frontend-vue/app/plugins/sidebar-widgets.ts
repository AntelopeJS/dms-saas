const WORKSPACE_SWITCHER_ID = "saas:workspace-switcher";
const WORKSPACE_SWITCHER_COMPONENT = "DmsSaasWorkspaceSwitcherWidget";
const WORKSPACE_SWITCHER_ORDER = 0;

export default defineDmsPlugin(() => {
  const { register } = useSidebarWidgets();

  register({
    id: WORKSPACE_SWITCHER_ID,
    component: WORKSPACE_SWITCHER_COMPONENT,
    order: WORKSPACE_SWITCHER_ORDER,
  });
});
