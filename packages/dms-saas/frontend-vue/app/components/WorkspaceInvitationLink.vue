<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * The signup link of a pending invitation, for the operator to hand over
 * when the e-mail did not reach the invitee. Each disclosure is journaled.
 */
interface InvitationRow {
	_id: string
	_instance: string
	email?: string
}

const props = defineProps<{
	rowData?: InvitationRow
	onSuccessCallback?: () => void
}>()

const L = 'saas.workspace_detail.invitations.link'
const MS_PER_DAY = 86_400_000

const { locale } = useI18n()
const { resolveApiError } = useApiErrorMessage()
const { fetchInvitationLink, copyLink } = useInvitationLink()

const link = ref<string | null>(null)
const expiresAt = ref<string | null>(null)
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)

const daysLeft = computed(() => {
	if (!expiresAt.value) return 0
	return Math.max(
		0,
		Math.ceil((new Date(expiresAt.value).getTime() - Date.now()) / MS_PER_DAY),
	)
})

async function load(): Promise<void> {
	if (!props.rowData) return
	isLoading.value = true
	errorMessage.value = null
	try {
		const invitation = await fetchInvitationLink({
			tenantId: props.rowData._instance,
			inviteId: props.rowData._id,
		})
		link.value = invitation.link
		expiresAt.value = invitation.expiresAt
	} catch (error) {
		errorMessage.value = resolveApiError(error, `${L}.error`)
	} finally {
		isLoading.value = false
	}
}

async function copy(): Promise<void> {
	if (link.value) await copyLink(link.value)
}

onMounted(load)
</script>

<template>
	<div class="flex flex-col gap-4">
		<p v-if="props.rowData?.email" class="text-muted text-sm">
			{{ $t(`${L}.lead`, { email: props.rowData.email }) }}
		</p>
		<USkeleton v-if="isLoading" class="h-10 w-full" />
		<DmsEmptyState
			v-else-if="errorMessage"
			variant="error"
			size="sm"
			:title="$t(`${L}.error`)"
			:description="errorMessage"
			:actions="[{ label: $t('saas.workspace_detail.retry'), onClick: load }]"
		/>
		<template v-else-if="link">
			<UFormField
				:label="$t(`${L}.label`)"
				:help="
					expiresAt
						? $t(
								`${L}.expires`,
								{
									date: formatDate(expiresAt, locale, { dateStyle: 'medium' }),
									count: daysLeft,
								},
								daysLeft,
							)
						: undefined
				"
			>
				<div class="flex gap-2">
					<UInput
						:model-value="link"
						readonly
						class="w-full font-mono"
						data-testid="invitation-link"
						@focus="($event.target as HTMLInputElement).select()"
					/>
					<UButton icon="i-ph-copy" color="primary" @click="copy">
						{{ $t(`${L}.copy`) }}
					</UButton>
				</div>
			</UFormField>
			<DmsBanner
				size="sm"
				tone="warning"
				icon="i-ph-warning"
				:title="$t(`${L}.warning`)"
			/>
		</template>
		<div class="flex justify-end">
			<UButton
				color="neutral"
				variant="ghost"
				@click="props.onSuccessCallback?.()"
			>
				{{ $t(`${L}.close`) }}
			</UButton>
		</div>
	</div>
</template>
