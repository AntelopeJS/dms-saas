<script setup lang="ts">
/** The terms checkbox of Register and "Set up your first workspace". */
import { LEGAL_DOCUMENTS } from './routes'

interface LegalAcceptanceProps {
	error?: string | null
}

withDefaults(defineProps<LegalAcceptanceProps>(), { error: null })
const accepted = defineModel<boolean>({ required: true })

const TERMS = LEGAL_DOCUMENTS.find(
	(document) => document.field === 'termsAndConditions',
)!
const PRIVACY = LEGAL_DOCUMENTS.find(
	(document) => document.field === 'privacyPolicy',
)!
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
