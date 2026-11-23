<script setup lang="ts">
import { findLegalDocument } from './routes'

/** The terms checkbox of Register and "Set up your first workspace". */
interface LegalAcceptanceProps {
	error?: string | null
}

withDefaults(defineProps<LegalAcceptanceProps>(), { error: null })
const accepted = defineModel<boolean>({ required: true })

const TERMS = findLegalDocument('termsAndConditions')
const PRIVACY = findLegalDocument('privacyPolicy')
</script>

<template>
	<UFormField name="legal" :error="error ?? undefined">
		<UCheckbox v-model="accepted" required>
			<template #label>
				<i18n-t
					keypath="saas.public.register.legal_acceptance"
					tag="span"
					scope="global"
				>
					<template #terms_and_conditions>
						<DmsLink
							:to="TERMS.path"
							target="_blank"
							class="text-primary underline"
						>
							{{ $t(TERMS.labelKey) }}
						</DmsLink>
					</template>
					<template #privacy_policy>
						<DmsLink
							:to="PRIVACY.path"
							target="_blank"
							class="text-primary underline"
						>
							{{ $t(PRIVACY.labelKey) }}
						</DmsLink>
					</template>
				</i18n-t>
			</template>
		</UCheckbox>
	</UFormField>
</template>
