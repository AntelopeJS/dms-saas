import { defineDmsFrontendBuild } from '#dms/frontend-build'

// The public API of the layer: its composables, utils and types. app/build/
// is private and imported by path.
export default defineDmsFrontendBuild((build) => {
	build.registerAutoImports(['app/composables', 'app/utils', 'app/types'])
})
