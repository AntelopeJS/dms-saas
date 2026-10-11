<script setup lang="ts">
/**
 * The bar heading every public page: the public pages a visitor can browse,
 * then the way in, signing in or opening an account.
 */
import {
	isPublicScreenServed,
	isSelfRegistrationOpen,
	LOGIN_PATH,
	PRICING_PATH,
	REGISTER_PATH,
} from '../build/public/routes'

/** The public page the bar sits on: its link reads as the current one. */
type PublicNavPage = 'pricing' | 'register' | 'legal'

interface PublicNavBarProps {
	current?: PublicNavPage
}

const props = defineProps<PublicNavBarProps>()

const config = useDmsRuntimeConfig()
const saasConfig = config.public.dmsSaas as
	| DmsSaasPublicRuntimeConfig
	| undefined

const showsPricing = isPublicScreenServed(saasConfig, 'pricing')
// Register already is the way in: the bar does not offer it to itself.
const showsCreateAccount =
	isSelfRegistrationOpen(saasConfig) && props.current !== 'register'
const isPricingCurrent = props.current === 'pricing'
</script>

<template>
	<header
		class="border-default mx-auto flex w-full max-w-6xl items-center gap-2 border-b pb-3 print:hidden"
	>
		<nav
			class="flex items-center gap-0.5"
			:aria-label="$t('saas.public.nav.label')"
		>
			<UButton
				v-if="showsPricing"
				:to="PRICING_PATH"
				:label="$t('saas.public.nav.pricing')"
				:aria-current="isPricingCurrent ? 'page' : undefined"
				color="neutral"
				variant="ghost"
				size="sm"
				:class="isPricingCurrent ? 'text-highlighted' : 'text-muted'"
			/>
		</nav>
		<div class="ms-auto flex items-center gap-2">
			<UButton
				:to="LOGIN_PATH"
				:label="$t('saas.public.nav.sign_in')"
				color="neutral"
				variant="ghost"
				size="sm"
			/>
			<UButton
				v-if="showsCreateAccount"
				:to="REGISTER_PATH"
				:label="$t('saas.public.nav.create_account')"
				size="sm"
			/>
		</div>
	</header>
</template>
