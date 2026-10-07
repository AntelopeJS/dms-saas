import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule, DmsFrontendSdk } from '#dms/frontend-module'
import authLinks from './app/plugins/auth-links'
import billingDataTypes from './app/plugins/billing-data-types'
import footerLinks from './app/plugins/footer-links'
import operatorCellDisplays from './app/plugins/operator-cell-displays'
import planCards from './app/plugins/plan-cards-display'
import segmentConditions from './app/plugins/segment-conditions-data-type'
import sidebarWidgets from './app/plugins/sidebar-widgets'

// The tenant access gate's refusal code: the server answers a refused page
// visit, a reload as much as an Inertia one, with a redirect to the suspended
// screen instead of its generic 403 page.
const WORKSPACE_ACCESS_BLOCKED_CODE = 'saas.errors.workspace.access_blocked'
const WORKSPACE_SUSPENDED_PATH = '/workspace-suspended'

interface VueModule {
	default: Component
}

const components = import.meta.glob<VueModule>(
	'./app/{components,build}/**/*.vue',
)
const pages = import.meta.glob<VueModule>('./app/custom-pages/**/*.vue')

function pascalCase(value: string): string {
	return value
		.split(/[\/_-]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')
}

function registerComponents(sdk: DmsFrontendSdk): void {
	Object.entries(components)
		.sort()
		.forEach(([path, loader]) => {
			const name = path
				.split('/')
				.at(-1)!
				.replace(/\.vue$/, '')
			sdk.registerComponent(pascalCase(name), defineAsyncComponent(loader))
		})
	Object.entries(pages)
		.sort()
		.forEach(([path, loader]) => {
			const name = path.replace('./app/custom-pages/', '').replace(/\.vue$/, '')
			const component = defineAsyncComponent(loader)
			sdk.registerPage(name, component, loader)
			sdk.registerComponent(pascalCase(name), component)
		})
}

const frontendModule: DmsFrontendModule = {
	componentPrefix: 'DmsSaas',
	setup(sdk) {
		registerComponents(sdk)
		sdk.registerPlugin(authLinks)
		sdk.registerPlugin(billingDataTypes)
		sdk.registerPlugin(footerLinks)
		sdk.registerPlugin(operatorCellDisplays)
		sdk.registerPlugin(planCards)
		sdk.registerPlugin(segmentConditions)
		sdk.registerPlugin(sidebarWidgets)
		sdk.registerAccessRedirect(
			WORKSPACE_ACCESS_BLOCKED_CODE,
			WORKSPACE_SUSPENDED_PATH,
		)
	},
}

export default frontendModule
