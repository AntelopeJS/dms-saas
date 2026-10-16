<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUserDetail } from '../build/users/useUserDetail'

const props = defineProps<{ routeParams?: Record<string, string> }>()

const I18N = 'saas.users.platform_role'
const API = '/api/saas/platform-owners'

type RoleChange = 'promote' | 'demote'

const { t } = useI18n()
const { $authFetch } = useAuthFetch()
const { confirmFrom } = useConfirmFrom()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()
const detail = useUserDetail(() => props.routeParams)
const user = computed(() => detail.data.value)
const isOpening = ref(false)

const change = computed<RoleChange>(() =>
	user.value?.isPlatformAdmin ? 'demote' : 'promote',
)

async function runChange(kind: RoleChange): Promise<void> {
	await $authFetch(`${API}/${detail.userId.value}/${kind}`, { method: 'POST' })
	toast.add({ color: 'success', title: t(`${I18N}.${kind}d`) })
	// The dialog closes once the card shows the new role.
	await refreshPageBlocks()
}

async function openConfirm(): Promise<void> {
	const kind = change.value
	isOpening.value = true
	try {
		await confirmFrom(`${API}/${detail.userId.value}/${kind}-confirm`, {
			onConfirm: () => runChange(kind),
		})
	} catch (error) {
		toast.add({
			color: 'error',
			title: resolveApiError(error, `${I18N}.confirm_failed`),
		})
	} finally {
		isOpening.value = false
	}
}
</script>

<template>
	<DmsCard :title="$t(`${I18N}.title`)">
		<DmsSaasLoadFailure
			v-if="detail.status.value === 'error' && !user"
			@retry="detail.refresh()"
		/>
		<div v-else-if="!user" class="flex flex-col gap-2">
			<USkeleton class="h-5 w-40" />
			<USkeleton class="h-4 w-full" />
			<USkeleton class="h-8 w-28" />
		</div>
		<div v-else class="flex flex-col gap-3">
			<div class="flex items-start gap-3">
				<DmsIconWell
					:icon="user.isPlatformAdmin ? 'i-ph-shield-check' : 'i-ph-shield'"
					:tone="user.isPlatformAdmin ? 'primary' : 'muted'"
					size="sm"
				/>
				<div class="min-w-0">
					<p class="text-highlighted text-sm font-semibold">
						{{
							user.isPlatformAdmin
								? $t('saas.status.platform_role.admin')
								: $t(`${I18N}.not_admin`)
						}}
					</p>
					<p class="text-muted text-sm">{{ $t(`${I18N}.explanation`) }}</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<UButton
					:label="$t(`${I18N}.${change}_action`)"
					:icon="
						user.isPlatformAdmin ? 'i-ph-shield-slash' : 'i-ph-shield-check'
					"
					:color="user.isPlatformAdmin ? 'error' : 'primary'"
					variant="outline"
					size="sm"
					:loading="isOpening"
					:disabled="user.isPlatformAdmin && user.isSelf"
					@click="openConfirm"
				/>
				<span
					v-if="user.isPlatformAdmin && user.isSelf"
					class="text-dimmed text-xs"
				>
					{{ $t(`${I18N}.self_demote_reason`) }}
				</span>
			</div>
		</div>
	</DmsCard>
</template>
