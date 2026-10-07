<script setup lang="ts">
/** Shown instead of Register and "Set up your first workspace" when admission is by invitation only. */
import PublicStage from '../build/public/PublicStage.vue'
import { LOGIN_PATH } from '../build/public/routes'
</script>

<template>
	<PublicStage
		icon="i-ph-lock-simple"
		tone="neutral"
		:title="$t('saas.public.registration_closed.title')"
		:description="$t('saas.public.registration_closed.description')"
	>
		<UButton
			:to="LOGIN_PATH"
			:label="$t('saas.public.registration_closed.sign_in')"
			size="lg"
			class="mt-5 justify-center"
			block
		/>
		<DmsBanner
			class="mt-5"
			tone="info"
			size="sm"
			icon="i-ph-envelope-simple"
			:title="$t('saas.public.registration_closed.invitation_title')"
			:description="
				$t('saas.public.registration_closed.invitation_description')
			"
		/>
	</PublicStage>
</template>
