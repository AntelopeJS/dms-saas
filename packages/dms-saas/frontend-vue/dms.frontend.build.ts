import { defineDmsFrontendBuild } from '#dms/frontend-build'
import { backendBoundary } from './build/backend-boundary.ts'

/**
 * The public API of the layer: its composables, utils and types. app/build/
 * is private and imported by path.
 */
const PUBLIC_API_DIRECTORIES = ['app/composables', 'app/utils', 'app/types']

export default defineDmsFrontendBuild((build) => {
	build.registerAutoImports(PUBLIC_API_DIRECTORIES)
	build.registerVitePlugins(() => [backendBoundary()])
})
