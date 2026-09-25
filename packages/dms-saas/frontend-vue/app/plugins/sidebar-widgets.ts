const WORKSPACE_SWITCHER_ID = "saas:workspace-switcher";
const WORKSPACE_SWITCHER_COMPONENT = "DmsSaasWorkspaceSwitcherWidget";
const WORKSPACE_SWITCHER_ORDER = 0;
// Renders nothing in the sidebar itself: see PastDueBannerHost.
const PAST_DUE_BANNER_HOST_ID = "saas:past-due-banner-host";
const PAST_DUE_BANNER_HOST_COMPONENT = "DmsSaasPastDueBannerHost";
const PAST_DUE_BANNER_HOST_ORDER = 1000;

export default defineDmsPlugin(() => {
  const { register } = useSidebarWidgets();

  register({
    id: WORKSPACE_SWITCHER_ID,
    component: WORKSPACE_SWITCHER_COMPONENT,
    order: WORKSPACE_SWITCHER_ORDER,
  });

  register({
    id: PAST_DUE_BANNER_HOST_ID,
    component: PAST_DUE_BANNER_HOST_COMPONENT,
    order: PAST_DUE_BANNER_HOST_ORDER,
  });
});
