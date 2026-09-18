import { defineAsyncComponent, type Component } from 'vue'
import type {
	DmsFrontendModule,
	DmsFrontendSdk,
} from '#dms/frontend-module'
import authLinks from './app/plugins/auth-links'
import billingDataTypes from './app/plugins/billing-data-types'
import footerLinks from './app/plugins/footer-links'
import planCards from './app/plugins/plan-cards-display.client'
import segmentConditions from './app/plugins/segment-conditions-data-type.client'
import sidebarWidgets from './app/plugins/sidebar-widgets'
import workspaceSuspended from './app/middleware/workspace-suspended.global'

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
			sdk.registerComponent(
				`DmsSaas${pascalCase(name)}`,
				defineAsyncComponent(loader),
			)
		})
	Object.entries(pages)
		.sort()
		.forEach(([path, loader]) => {
			const name = path.replace('./app/custom-pages/', '').replace(/\.vue$/, '')
			const component = defineAsyncComponent(loader)
			sdk.registerPage(name, component, loader)
			sdk.registerComponent(`Dms${pascalCase(name)}`, component)
		})
}

const frontendModule: DmsFrontendModule = {
	setup(sdk) {
		registerComponents(sdk)
		sdk.registerPlugin(authLinks)
		sdk.registerPlugin(billingDataTypes)
		sdk.registerPlugin(footerLinks)
		sdk.registerPlugin(planCards, { clientOnly: true })
		sdk.registerPlugin(segmentConditions, { clientOnly: true })
		sdk.registerPlugin(sidebarWidgets)
		sdk.registerMiddleware('workspace-suspended', workspaceSuspended, {
			global: true,
		})
	},
}

export default frontendModule
