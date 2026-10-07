<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserDetail } from '../build/users/useUserDetail'

const props = defineProps<{ routeParams?: Record<string, string> }>()

const I18N = 'saas.users.platform_role'
const API = '/api/saas/platform-owners'

type RoleChange = 'promote' | 'demote'

interface ServerImpact {
	icon: string
	label: string
	count?: number | string
}

/** A confirmation the server words (`ConfirmDialogSerialized`). */
interface ServerConfirm {
	title: string
	description?: string
	params?: Record<string, unknown>
	icon?: string
	color?: string
	confirmLabel?: string
	cancelLabel?: string
	impact?: ServerImpact[]
	blocked?: boolean
}

const { t } = useI18n()
const { processI18n } = useTranslation()
const { $authFetch } = useAuthFetch()
const { confirm } = useConfirm()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()
const detail = useUserDetail(() => props.routeParams)
const user = computed(() => detail.data.value)
const isOpening = ref(false)

const change = computed<RoleChange>(() =>
	user.value?.isPlatformAdmin ? 'demote' : 'promote',
)

function resolved(text: string | undefined, params: Record<string, unknown>) {
	return text ? processI18n(text, params) : undefined
}

async function runChange(kind: RoleChange): Promise<void> {
	await $authFetch(`${API}/${detail.userId.value}/${kind}`, { method: 'POST' })
	toast.add({ color: 'success', title: t(`${I18N}.${kind}d`) })
	await detail.refresh()
}

async function openConfirm(): Promise<void> {
	const kind = change.value
	isOpening.value = true
	try {
		const dialog = await $authFetch<ServerConfirm>(
			`${API}/${detail.userId.value}/${kind}-confirm`,
		)
		const params = dialog.params ?? {}
		await confirm({
			title: processI18n(dialog.title, params),
			description: resolved(dialog.description, params),
			icon: dialog.icon,
			color: dialog.color as 'primary',
			confirmLabel: resolved(dialog.confirmLabel, params),
			cancelLabel: resolved(dialog.cancelLabel, params),
			blocked: dialog.blocked,
			impact: dialog.impact?.map((entry) => ({
				...entry,
				label: processI18n(entry.label, params),
			})),
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

onMounted(() => void detail.load())
</script>

<template>
	<DmsCard :title="$t(`${I18N}.title`)">
		<DmsSaasLoadFailure
			v-if="detail.error.value && !user"
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
