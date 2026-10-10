<script setup lang="ts">
import { computed } from 'vue'

/** The row of a migration's workspace table the drawer was opened on. */
interface MigrationWorkspaceRow {
	_id: string
	migrationId: string
}

// The one reading no stock block can take from a table row: the drawer hands
// the row, not the page URL, so the stock key-value block is fed the row's
// ids as the route parameters its `fetchUrl` names.
const STRIPE_READING_URL =
	'/api/saas/plan-migrations/{{params.migrationId}}/workspaces/{{params.tenantId}}/stripe'
const READING_ROWS = 4

const props = defineProps<{ rowData?: MigrationWorkspaceRow }>()

const KeyValueListBlock = resolveDmsComponent('dms-key-value-list-block')

const routeParams = computed(() =>
	props.rowData
		? { migrationId: props.rowData.migrationId, tenantId: props.rowData._id }
		: undefined,
)
</script>

<template>
	<div class="flex flex-col gap-3 p-4">
		<p class="text-muted text-sm">
			{{ $t('saas.catalog.migrations.detail.uncertain_hint') }}
		</p>
		<component
			:is="KeyValueListBlock"
			v-if="KeyValueListBlock && routeParams"
			:fetch-url="STRIPE_READING_URL"
			:route-params="routeParams"
			:skeleton-count="READING_ROWS"
			:card="false"
			component-id="saas-migration-stripe-check"
		/>
	</div>
</template>
