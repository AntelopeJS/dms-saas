<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { findSegmentNode } from '../build/segments/tree'
import { useSegmentCatalog } from '../build/segments/useSegmentCatalog'
import { useSegmentPreview } from '../build/segments/useSegmentPreview'
import { useSegmentWords } from '../build/segments/useSegmentWords'
import type { SegmentWordToken } from '../build/segments/types'

const props = defineProps<{ routeParams?: Record<string, string> }>()

const TICK_MS = 5000
const PERCENT = 100
const MS_PER_SECOND = 1000
const DATE_TIME: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
}

const { t, locale } = useI18n()
const catalog = useSegmentCatalog()
const words = useSegmentWords(catalog)
const segmentId = () => props.routeParams?.id
const {
	preview,
	isRecounting,
	conditions,
	hasRules,
	hasFailed,
	recountedAt,
	recount,
} = useSegmentPreview(segmentId)

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
	ticker = setInterval(() => (now.value = Date.now()), TICK_MS)
})
onBeforeUnmount(() => {
	if (ticker) clearInterval(ticker)
})

const numberFormat = computed(() => new Intl.NumberFormat(locale.value))
const signedFormat = computed(
	() => new Intl.NumberFormat(locale.value, { signDisplay: 'exceptZero' }),
)

const delta = computed(() => {
	const current = preview.value
	if (!current || current.savedCount === null) return null
	return current.matchCount - current.savedCount
})

const deltaTone = computed(() => {
	if (!delta.value) return 'text-dimmed'
	return delta.value > 0 ? 'text-success' : 'text-error'
})

const share = computed(() => {
	const current = preview.value
	if (!current?.totalUsers) return '0'
	return new Intl.NumberFormat(locale.value, {
		maximumFractionDigits: 1,
	}).format((current.matchCount / current.totalUsers) * PERCENT)
})

const everyoneMatches = computed(
	() =>
		!!preview.value &&
		preview.value.totalUsers > 0 &&
		preview.value.matchCount === preview.value.totalUsers,
)

function tokensAt(path: string): SegmentWordToken[] {
	const group = conditions.value
	const placed = group ? findSegmentNode(group, path) : null
	if (!placed || 'logical' in placed.node || 'kind' in placed.node) {
		return [{ text: t('saas.segments.preview.nested_rules') }]
	}
	return words.conditionTokens(placed.node, placed.scope)
}

const universalRule = computed(() => {
	const path = preview.value?.universalPaths[0]
	return path === undefined ? null : tokensAt(path)
})

const recountedText = computed(() => {
	if (!recountedAt.value) return ''
	const seconds = Math.max(
		0,
		Math.round((now.value - recountedAt.value.getTime()) / MS_PER_SECOND),
	)
	return new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }).format(
		-seconds,
		'second',
	)
})

const savedEvaluatedText = computed(() => {
	const date = preview.value?.savedEvaluatedAt
	return date ? formatDate(date, locale.value, DATE_TIME) : null
})
</script>

<template>
	<DmsCard
		:title="$t('saas.segments.preview.title')"
		class="lg:sticky lg:top-4"
	>
		<template #actions>
			<DmsStatusPill
				:tone="isRecounting ? 'info' : 'success'"
				:dot="isRecounting ? 'live' : 'static'"
				:label="
					isRecounting
						? $t('saas.segments.preview.recounting')
						: $t('saas.segments.preview.live')
				"
				size="sm"
			/>
		</template>

		<DmsEmptyState
			v-if="!hasRules"
			icon="i-ph-funnel-simple"
			size="sm"
			:title="$t('saas.segments.preview.empty_title')"
			:description="$t('saas.segments.preview.empty_description')"
		/>
		<div v-else-if="hasFailed && !preview" class="flex flex-col gap-3">
			<DmsSaasLoadFailure
				:title="$t('saas.segments.preview.failed')"
				@retry="recount()"
			/>
		</div>
		<div v-else-if="!preview" class="flex flex-col gap-3">
			<USkeleton class="h-9 w-40" />
			<USkeleton class="h-4 w-56" />
			<USkeleton v-for="row in 3" :key="row" class="h-8 w-full" />
		</div>
		<div
			v-else
			class="flex flex-col gap-5"
			:class="{ 'opacity-70': isRecounting }"
		>
			<div>
				<p class="text-highlighted text-3xl font-semibold tabular-nums">
					{{
						$t(
							'saas.segments.preview.match_count',
							{ count: numberFormat.format(preview.matchCount) },
							preview.matchCount,
						)
					}}
				</p>
				<p class="text-muted mt-1 text-sm">
					<template v-if="delta !== null">
						<span :class="deltaTone" class="font-mono font-semibold">
							{{ delta > 0 ? '▲' : delta < 0 ? '▼' : '—' }}
							{{ signedFormat.format(delta) }}
						</span>
						{{
							$t('saas.segments.preview.vs_saved', {
								saved: numberFormat.format(preview.savedCount ?? 0),
							})
						}}
						·
					</template>
					{{
						$t('saas.segments.preview.share', {
							share,
							total: numberFormat.format(preview.totalUsers),
						})
					}}
				</p>
				<p v-if="delta !== null" class="text-muted mt-1 text-xs">
					{{
						$t('saas.segments.preview.breakdown', {
							kept: numberFormat.format(
								preview.matchCount - preview.addedCount,
							),
							added: numberFormat.format(preview.addedCount),
							removed: numberFormat.format(preview.removedCount),
						})
					}}
				</p>
				<p class="text-dimmed mt-1 text-xs">
					{{
						$t('saas.segments.preview.recounted', {
							when: recountedText,
							duration: preview.durationMs,
						})
					}}
				</p>
			</div>

			<UAlert
				v-if="everyoneMatches"
				color="warning"
				variant="subtle"
				icon="i-ph-warning"
				:title="$t('saas.segments.preview.everyone_title')"
			>
				<template #description>
					<template v-if="universalRule">
						<DmsSaasSegmentWords :tokens="universalRule" />
						{{ $t('saas.segments.preview.everyone_rule') }}
					</template>
					<template v-else>
						{{ $t('saas.segments.preview.everyone_description') }}
					</template>
				</template>
			</UAlert>
			<UAlert
				v-else-if="hasFailed"
				color="warning"
				variant="subtle"
				icon="i-ph-warning-circle"
				:title="$t('saas.segments.preview.stale')"
			/>

			<section v-if="preview.signals.length" class="flex flex-col gap-2">
				<DmsEyebrow :label="$t('saas.segments.preview.signals')" tone="muted" />
				<ul class="flex flex-col gap-1.5 text-sm">
					<li
						v-for="signal in preview.signals"
						:key="signal.path"
						class="flex items-start justify-between gap-3"
					>
						<DmsSaasSegmentWords
							:tokens="tokensAt(signal.path)"
							class="text-toned"
						/>
						<span class="text-highlighted font-mono text-xs tabular-nums">
							{{ numberFormat.format(signal.count) }}
						</span>
					</li>
				</ul>
			</section>

			<section class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<DmsEyebrow
						:label="$t('saas.segments.preview.sample')"
						tone="muted"
					/>
					<span class="text-dimmed font-mono text-[11px]">
						{{
							$t('saas.segments.preview.sample_count', {
								shown: preview.sample.length,
								total: numberFormat.format(preview.matchCount),
							})
						}}
					</span>
				</div>
				<p v-if="preview.sample.length === 0" class="text-dimmed text-sm">
					{{ $t('saas.segments.preview.no_match') }}
				</p>
				<ul v-else class="flex flex-col gap-2">
					<li
						v-for="user in preview.sample"
						:key="user._id"
						class="flex items-center gap-2.5"
					>
						<UAvatar :alt="user.name || user.email" size="sm" />
						<div class="min-w-0 flex-1">
							<p class="text-highlighted truncate text-sm font-medium">
								{{ user.name || user.email }}
							</p>
							<p class="text-dimmed truncate text-xs">
								{{ user.email }}
								<template v-if="user.workspaceName">
									· {{ user.workspaceName }}
								</template>
							</p>
						</div>
						<UBadge
							v-if="user.isAdded"
							color="success"
							variant="soft"
							size="sm"
							:label="$t('saas.segments.preview.added')"
						/>
					</li>
				</ul>
			</section>
		</div>

		<template v-if="savedEvaluatedText" #footer>
			<p class="text-dimmed px-[18px] py-2.5 text-xs">
				{{
					$t('saas.segments.preview.saved_evaluated', {
						date: savedEvaluatedText,
					})
				}}
			</p>
		</template>
	</DmsCard>
</template>
