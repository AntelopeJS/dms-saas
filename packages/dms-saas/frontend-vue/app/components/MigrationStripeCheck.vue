<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/** The row of a migration's workspace table the drawer was opened on. */
interface MigrationWorkspaceRow {
	_id: string
	migrationId: string
}

type UncertainResolution = 'moved' | 'not_moved'

interface ReadingItem {
	id?: string
	[key: string]: unknown
}

/** `GET …/workspaces/:tenantId/stripe`: the reading and what it points to. */
interface StripeReading {
	items: ReadingItem[]
	resolution: UncertainResolution | null
	stripeUrl: string | null
}

const API = '/api/saas/plan-migrations'
const DETAIL = 'saas.catalog.migrations.detail'
const READING_ROWS = 4
const RESOLUTION_ICONS: Record<UncertainResolution, string> = {
	moved: 'i-ph-check',
	not_moved: 'i-ph-arrow-counter-clockwise',
}

const props = defineProps<{ rowData?: MigrationWorkspaceRow }>()

const KeyValueListBlock = resolveDmsComponent('dms-key-value-list-block')
const { $authFetch } = useAuthFetch()
const { t } = useI18n()
const { confirmFrom } = useConfirmFrom()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()

const reading = ref<StripeReading | null>(null)
const loadFailed = ref(false)
const isSettled = ref(false)

const workspaceApi = computed(() =>
	props.rowData
		? `${API}/${props.rowData.migrationId}/workspaces/${props.rowData._id}`
		: null,
)
// The verdict names the action to take: the drawer offers it, once.
const resolution = computed(() =>
	isSettled.value ? null : (reading.value?.resolution ?? null),
)

const stripeRead = useOnDemandRead<StripeReading>(() =>
	workspaceApi.value ? `${workspaceApi.value}/stripe` : null,
)

async function load(): Promise<void> {
	if (!workspaceApi.value) return
	loadFailed.value = false
	try {
		reading.value = await stripeRead.read()
	} catch {
		loadFailed.value = true
	}
}

async function settle(kind: UncertainResolution): Promise<void> {
	await $authFetch(`${workspaceApi.value}/resolve`, {
		method: 'POST',
		body: { resolution: kind },
	})
	isSettled.value = true
	toast.add({ color: 'success', title: t(`${DETAIL}.${kind}_done`) })
	// The dialog closes once the page shows the settlement.
	await refreshPageBlocks()
}

async function openSettlement(kind: UncertainResolution): Promise<void> {
	try {
		await confirmFrom(`${workspaceApi.value}/dialogs/${kind}`, {
			onConfirm: () => settle(kind),
		})
	} catch (error) {
		toast.add({
			color: 'error',
			title: resolveApiError(error, `${DETAIL}.settle_failed`),
		})
	}
}

onMounted(load)
</script>

<template>
	<div class="flex flex-col gap-3 p-4">
		<p class="text-muted text-sm">
			{{ $t(`${DETAIL}.uncertain_hint`) }}
		</p>
		<DmsSaasLoadFailure
			v-if="loadFailed"
			:title="$t(`${DETAIL}.stripe_unavailable`)"
			@retry="load"
		/>
		<div v-else-if="!reading" class="flex flex-col gap-2">
			<USkeleton v-for="row in READING_ROWS" :key="row" class="h-5 w-full" />
		</div>
		<component
			:is="KeyValueListBlock"
			v-else-if="KeyValueListBlock"
			:items="reading.items"
			:card="false"
			component-id="saas-migration-stripe-check"
		/>
		<div v-if="reading" class="flex flex-wrap items-center gap-2">
			<UButton
				v-if="reading.stripeUrl"
				:to="reading.stripeUrl"
				target="_blank"
				color="neutral"
				variant="outline"
				icon="i-ph-arrow-square-out"
			>
				{{ $t(`${DETAIL}.open_stripe`) }}
			</UButton>
			<UButton
				v-if="resolution"
				:icon="RESOLUTION_ICONS[resolution]"
				@click="openSettlement(resolution)"
			>
				{{ $t(`${DETAIL}.${resolution}_action`) }}
			</UButton>
		</div>
	</div>
</template>
