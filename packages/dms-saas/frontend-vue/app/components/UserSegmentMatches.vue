<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SegmentConditionGroup } from '../build/segments/types'

const props = defineProps<{ routeParams?: Record<string, string> }>()

interface SegmentMatch {
	_id: string
	name: string
	description: string
	evaluatedAt: string
	explanation: SegmentConditionGroup
	matchesNow: boolean
}

const SEGMENTS_PAGE_URL = '/modules/saas/customers/segments'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
const SKELETON_ROWS = 2

const { locale } = useI18n()
const { $authFetch } = useAuthFetch()
const userId = computed(() => props.routeParams?.id ?? '')
const matches = ref<SegmentMatch[] | null>(null)
const hasFailed = ref(false)

async function load(): Promise<void> {
	hasFailed.value = false
	try {
		const response = await $authFetch<{ items: SegmentMatch[] }>(
			`/api/saas/users/${userId.value}/segments`,
		)
		matches.value = response.items
	} catch {
		hasFailed.value = true
	}
}

onMounted(load)
</script>

<template>
	<DmsCard :padded="false">
		<DmsSaasLoadFailure
			v-if="hasFailed"
			class="m-4"
			:title="$t('saas.users.segments.load_failed')"
			@retry="load"
		/>
		<div v-else-if="!matches" class="flex flex-col gap-3 p-4">
			<USkeleton v-for="row in SKELETON_ROWS" :key="row" class="h-10 w-full" />
		</div>
		<DmsEmptyState
			v-else-if="matches.length === 0"
			icon="i-ph-funnel"
			:title="$t('saas.users.segments.empty_title')"
			:description="$t('saas.users.segments.empty_description')"
			:actions="[
				{
					label: $t('saas.users.segments.open_segments'),
					to: SEGMENTS_PAGE_URL,
					variant: 'outline',
					color: 'neutral',
				},
			]"
		/>
		<table v-else class="w-full text-sm">
			<thead>
				<tr
					class="border-default text-dimmed border-b text-left font-mono text-[10.5px] uppercase tracking-wider"
				>
					<th class="px-4 py-2 font-semibold">
						{{ $t('saas.users.segments.column.segment') }}
					</th>
					<th class="px-4 py-2 font-semibold">
						{{ $t('saas.users.segments.column.why') }}
					</th>
					<th class="px-4 py-2 font-semibold">
						{{ $t('saas.users.segments.column.evaluated') }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="match in matches"
					:key="match._id"
					class="border-default border-b align-top last:border-b-0"
				>
					<td class="px-4 py-3">
						<DmsLink
							:to="`${SEGMENTS_PAGE_URL}/${match._id}/edit`"
							class="text-highlighted font-semibold hover:underline"
						>
							{{ match.name }}
						</DmsLink>
						<p v-if="match.description" class="text-dimmed text-xs">
							{{ match.description }}
						</p>
					</td>
					<td class="px-4 py-3">
						<DmsSaasSegmentRulesText
							:conditions="match.explanation"
							mode="full"
						/>
						<DmsStatusPill
							v-if="!match.matchesNow"
							class="mt-1"
							tone="warning"
							size="sm"
							:label="$t('saas.users.segments.no_longer_matches')"
						/>
					</td>
					<td class="text-muted whitespace-nowrap px-4 py-3">
						{{ formatDate(match.evaluatedAt, locale, DAY_FORMAT) }}
					</td>
				</tr>
			</tbody>
		</table>
	</DmsCard>
</template>
