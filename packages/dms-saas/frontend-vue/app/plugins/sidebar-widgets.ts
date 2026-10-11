const WORKSPACE_SWITCHER_ID = 'saas:workspace-switcher'
const WORKSPACE_SWITCHER_COMPONENT = 'DmsSaasWorkspaceSwitcherWidget'
const WORKSPACE_SWITCHER_ORDER = 0

// The switcher sits at the very top of the sidebar, above search: which
// workspace you are in frames everything below it.
export default defineDmsPlugin(() => {
	const { register } = useSidebarWidgets()

	register({
		id: WORKSPACE_SWITCHER_ID,
		component: WORKSPACE_SWITCHER_COMPONENT,
		position: SidebarWidgetPosition.ABOVE_SEARCH_BAR,
		order: WORKSPACE_SWITCHER_ORDER,
	})
})
