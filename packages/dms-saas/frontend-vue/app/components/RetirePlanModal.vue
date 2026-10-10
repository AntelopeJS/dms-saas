<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import FormFieldRow from '../build/components/FormFieldRow.vue'
import FormRows from '../build/components/FormRows.vue'
import {
	type CatalogFeature,
	formatPlanAmount,
	isFeatureIncluded,
	type PlanCatalog,
	PLANS_ENDPOINT,
} from '../build/plan-catalog'
import {
	changedFeatures,
	MIGRATIONS_PAGE_URL,
	type PlanChangeKind,
	RETIRE_ENDPOINT,
	type RetireFeatureChange,
	type RetireImpact,
	type RetirePlanSummary,
	type RetirePreparation,
	unchangedFeatureIds,
} from '../build/plan-retire'

interface PlanRowData {
	_id?: string
	name?: string
}

interface RetireResponse {
	migrationId: string
}

type Step = 1 | 2 | 3

const ROWS_PREVIEW = 4
const UNLIMITED = -1
const CONFIRM_TEXT_FIELD = 'confirmText'

const KIND_ICONS: Record<PlanChangeKind, string> = {
	lost: 'i-ph-minus-circle',
	gained: 'i-ph-plus-circle',
	changed: 'i-ph-arrows-left-right',
	same: 'i-ph-equals',
}

const KIND_CLASSES: Record<PlanChangeKind, string> = {
	lost: 'text-error',
	gained: 'text-success',
	changed: 'text-info',
	same: 'text-muted',
}

const props = defineProps<{
	rowData?: PlanRowData
	onSuccessCallback?: () => void
}>()
const emit = defineEmits<{ success: [] }>()

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { processApiMessage } = useTranslation()
const { formatFeatureValue } = usePlanFeatureFormat()
const { statusView } = useSaasStatus()

const planId = computed(() => props.rowData?._id ?? '')
const step = ref<Step>(1)
const impact = ref<RetireImpact | null>(null)
const features = ref<CatalogFeature[]>([])
const loadError = ref<string | null>(null)
const isLoading = ref(true)
const showAllRows = ref(false)
const targetPlanId = ref<string | undefined>(undefined)
const preparation = ref<RetirePreparation | null>(null)
const isPreparing = ref(false)
const prepareError = ref<string | null>(null)
const notifyOwners = ref(true)
const typed = ref('')
const isSubmitting = ref(false)
const submitError = ref<string | null>(null)
const typedError = ref<string | null>(null)

const plan = computed(() => impact.value?.plan)
const planName = computed(() => plan.value?.name ?? props.rowData?.name ?? '')
const featuresById = computed(
	() => new Map(features.value.map((feature) => [feature._id, feature])),
)
const shownRows = computed(() => {
	const rows = impact.value?.rows ?? []
	return showAllRows.value ? rows : rows.slice(0, ROWS_PREVIEW)
})
const hiddenRows = computed(
	() => (impact.value?.rows.length ?? 0) - shownRows.value.length,
)
const target = computed(() =>
	impact.value?.targets.find(
		(candidate) => candidate._id === targetPlanId.value,
	),
)
const canChooseTarget = computed(
	() =>
		!!impact.value &&
		impact.value.targets.length > 0 &&
		!impact.value.hasOpenMigration,
)
const isTypedMatch = computed(() => typed.value.trim() === plan.value?.slug)
const changes = computed(() =>
	changedFeatures(preparation.value?.features ?? []),
)
const unchanged = computed(() =>
	unchangedFeatureIds(preparation.value?.features ?? [])
		.map((id) => featuresById.value.get(id)?.displayName)
		.filter((name): name is string => !!name),
)

const steps = computed(() =>
	[1, 2, 3].map((index) => ({
		index,
		label: t(`saas.catalog.retire.step_${index}`),
		isDone: step.value > index,
		isCurrent: step.value === index,
	})),
)

function money(amount: number, currency: string): string {
	return formatPlanAmount(amount, currency, locale.value)
}

function formatDay(value: string | null): string {
	return value
		? new Date(value).toLocaleDateString(locale.value, {
				month: 'short',
				day: 'numeric',
			})
		: '—'
}

function planOption(candidate: RetirePlanSummary): string {
	const cap =
		candidate.maxMembers === UNLIMITED
			? t('saas.catalog.plans.card.members_unlimited')
			: t(
					'saas.catalog.plans.card.members',
					{ count: candidate.maxMembers },
					candidate.maxMembers,
				)
	return t('saas.catalog.retire.target_option', {
		name: candidate.name,
		price: money(candidate.price, candidate.currency),
		interval: t(`saas.catalog.plans.interval.${candidate.interval}`),
		mode: t(`saas.catalog.plans.billing_mode.${candidate.billingMode}`),
		cap,
	})
}

const targetItems = computed(() =>
	(impact.value?.targets ?? []).map((candidate) => ({
		value: candidate._id,
		label: planOption(candidate),
	})),
)

function readValue(change: RetireFeatureChange, value: unknown): string {
	const feature = featuresById.value.get(change.featureId)
	if (
		!feature ||
		feature.valueType === 'boolean' ||
		!isFeatureIncluded(value)
	) {
		return isFeatureIncluded(value)
			? t('saas.catalog.retire.included')
			: t('saas.catalog.retire.not_included')
	}
	return formatFeatureValue({ ...feature, featureId: feature._id }, value)
}

function featureName(featureId: string): string {
	return featuresById.value.get(featureId)?.displayName ?? featureId
}

function memberCap(value: number): string {
	return value === UNLIMITED ? t('saas.catalog.plans.unlimited') : String(value)
}

async function loadImpact(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		const [loaded, catalog] = await Promise.all([
			$authFetch<RetireImpact>(`${RETIRE_ENDPOINT}/${planId.value}/impact`),
			$authFetch<PlanCatalog>(`${PLANS_ENDPOINT}/catalog`),
		])
		impact.value = loaded
		features.value = catalog.features
	} catch (error) {
		loadError.value = processApiMessage(readError(error))
	} finally {
		isLoading.value = false
	}
}

function readError(error: unknown): string {
	const data = (error as { data?: unknown }).data
	if (typeof data === 'string') return data
	const message = (data as { message?: unknown } | undefined)?.message
	return typeof message === 'string' ? message : 'saas.catalog.retire.failed'
}

async function prepare(): Promise<void> {
	if (!targetPlanId.value) return
	isPreparing.value = true
	prepareError.value = null
	try {
		preparation.value = await $authFetch<RetirePreparation>(
			`${RETIRE_ENDPOINT}/${planId.value}/prepare/${targetPlanId.value}`,
		)
	} catch (error) {
		preparation.value = null
		prepareError.value = processApiMessage(readError(error))
	} finally {
		isPreparing.value = false
	}
}

function isTypedRefusal(error: unknown): boolean {
	const data = (error as { data?: { field?: unknown } }).data
	return typeof data === 'object' && data?.field === CONFIRM_TEXT_FIELD
}

async function retire(): Promise<void> {
	if (!isTypedMatch.value || !targetPlanId.value) return
	isSubmitting.value = true
	submitError.value = null
	typedError.value = null
	try {
		const response = await $authFetch<RetireResponse>(
			`${RETIRE_ENDPOINT}/${planId.value}/migrate-and-delete`,
			{
				method: 'POST',
				body: {
					targetPlanId: targetPlanId.value,
					notifyMembers: notifyOwners.value,
					confirmText: typed.value.trim(),
				},
			},
		)
		toast.add({
			color: 'success',
			icon: 'i-ph-arrows-clockwise',
			title: t('saas.catalog.retire.started', { name: planName.value }),
		})
		props.onSuccessCallback?.()
		await navigateDms(`${MIGRATIONS_PAGE_URL}/${response.migrationId}`)
	} catch (error) {
		const message = processApiMessage(readError(error))
		if (isTypedRefusal(error)) typedError.value = message
		else submitError.value = message
	} finally {
		isSubmitting.value = false
	}
}

function close(): void {
	emit('success')
}

watch(targetPlanId, () => {
	preparation.value = null
	void prepare()
})

onMounted(loadImpact)
</script>

<template>
	<div class="flex flex-col gap-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex items-start gap-3">
				<DmsIconWell
					icon="i-ph-archive"
					:tone="step === 3 ? 'error' : 'warning'"
				/>
				<div>
					<h3 class="text-highlighted font-semibold">
						{{ $t('saas.catalog.retire.title', { name: planName }) }}
					</h3>
					<p class="text-muted text-sm">
						{{
							$t(`saas.catalog.retire.subtitle_${step}`, {
								name: planName,
								count: impact?.workspaces ?? 0,
							})
						}}
					</p>
				</div>
			</div>
			<ol
				class="flex items-center gap-2 text-xs"
				:aria-label="$t('saas.catalog.retire.steps')"
			>
				<li
					v-for="item in steps"
					:key="item.index"
					class="flex items-center gap-1.5"
					:class="
						item.isCurrent ? 'text-highlighted font-semibold' : 'text-muted'
					"
					:aria-current="item.isCurrent ? 'step' : undefined"
				>
					<span
						class="grid size-5 place-items-center rounded-full border text-[11px]"
						:class="
							item.isDone || item.isCurrent
								? 'border-primary bg-primary text-inverted'
								: 'border-default'
						"
					>
						<UIcon v-if="item.isDone" name="i-ph-check" class="size-3" />
						<template v-else>{{ item.index }}</template>
					</span>
					{{ item.label }}
				</li>
			</ol>
		</div>

		<div v-if="isLoading" class="flex flex-col gap-3">
			<USkeleton class="h-20 w-full" />
			<USkeleton class="h-40 w-full" />
		</div>

		<DmsSaasLoadFailure
			v-else-if="loadError"
			:title="loadError"
			@retry="loadImpact"
		/>

		<template v-else-if="impact && plan">
			<!-- Step 1: impact -->
			<template v-if="step === 1">
				<div class="grid gap-3 sm:grid-cols-3">
					<div class="bg-elevated/50 rounded-lg p-3">
						<p class="text-muted text-xs uppercase">
							{{ $t('saas.catalog.retire.workspaces') }}
						</p>
						<p class="text-highlighted text-xl font-semibold tabular-nums">
							{{ impact.workspaces }}
						</p>
						<p class="text-muted text-xs">
							{{
								$t('saas.catalog.retire.workspaces_detail', {
									paying: impact.paying,
									past_due: impact.pastDue,
								})
							}}
						</p>
					</div>
					<div class="bg-elevated/50 rounded-lg p-3">
						<p class="text-muted text-xs uppercase">
							{{ $t('saas.catalog.retire.members') }}
						</p>
						<p class="text-highlighted text-xl font-semibold tabular-nums">
							{{ impact.members }}
						</p>
						<p v-if="impact.rows[0]" class="text-muted text-xs">
							{{
								$t('saas.catalog.retire.largest', {
									name: impact.rows[0].name,
									count: impact.rows[0].members,
								})
							}}
						</p>
					</div>
					<div class="bg-elevated/50 rounded-lg p-3">
						<p class="text-muted text-xs uppercase">
							{{ $t('saas.catalog.retire.mrr') }}
						</p>
						<p class="text-highlighted text-xl font-semibold tabular-nums">
							{{ money(impact.mrr, plan.currency) }}
						</p>
						<p v-if="impact.firstRenewal" class="text-muted text-xs">
							{{
								$t('saas.catalog.retire.renewals', {
									first: formatDay(impact.firstRenewal),
									last: formatDay(impact.lastRenewal),
								})
							}}
						</p>
					</div>
				</div>

				<DmsCard :padded="false">
					<div
						class="border-default flex items-center justify-between border-b px-4 py-2.5"
					>
						<span class="text-muted text-xs font-semibold uppercase">
							{{ $t('saas.catalog.retire.list_title', { name: plan.name }) }}
						</span>
						<span class="text-dimmed text-xs">
							{{
								$t('saas.catalog.retire.list_hint', {
									count: impact.workspaces,
								})
							}}
						</span>
					</div>
					<p
						v-if="impact.rows.length === 0"
						class="text-muted px-4 py-6 text-center text-sm"
					>
						{{ $t('saas.catalog.retire.no_workspace') }}
					</p>
					<ul v-else class="divide-default divide-y">
						<li
							v-for="row in shownRows"
							:key="row.tenantId"
							class="flex items-center gap-3 px-4 py-2.5 text-sm"
						>
							<span
								class="text-highlighted min-w-0 flex-1 truncate font-medium"
							>
								{{ row.name }}
							</span>
							<span class="text-muted text-xs">
								{{
									$t(
										'saas.catalog.retire.member_count',
										{ count: row.members },
										row.members,
									)
								}}
							</span>
							<DmsStatusPill
								size="sm"
								:tone="statusView('workspace', row.status).tone"
								:label="statusView('workspace', row.status).label"
							/>
							<span class="text-dimmed w-28 text-right text-xs tabular-nums">
								{{
									row.renewsAt
										? $t('saas.catalog.retire.renews', {
												date: formatDay(row.renewsAt),
											})
										: '—'
								}}
							</span>
						</li>
					</ul>
					<div
						v-if="hiddenRows > 0"
						class="border-default border-t px-4 py-2 text-xs"
					>
						<UButton size="xs" variant="link" @click="showAllRows = true">
							{{ $t('saas.catalog.retire.show_all', { count: hiddenRows }) }}
						</UButton>
					</div>
				</DmsCard>

				<UAlert
					v-if="impact.hasOpenMigration"
					color="warning"
					variant="subtle"
					icon="i-ph-warning"
					:title="$t('saas.catalog.retire.open_migration')"
				/>
				<UAlert
					v-else-if="impact.targets.length === 0"
					color="warning"
					variant="subtle"
					icon="i-ph-warning"
					:title="$t('saas.catalog.retire.no_target')"
				/>
				<p v-else class="text-muted flex items-start gap-2 text-sm">
					<UIcon name="i-ph-info" class="mt-0.5 size-4 shrink-0" />
					{{ $t('saas.catalog.retire.closed_note', { name: plan.name }) }}
				</p>

				<div class="flex items-center justify-end gap-2">
					<span class="text-dimmed mr-auto flex items-center gap-1 text-xs">
						<UIcon name="i-ph-lock-simple" class="size-3.5" />
						{{ $t('saas.catalog.retire.nothing_changes') }}
					</span>
					<UButton color="neutral" variant="outline" @click="close">
						{{ $t('saas.catalog.common.cancel') }}
					</UButton>
					<UButton
						trailing-icon="i-ph-arrow-right"
						:disabled="!canChooseTarget"
						@click="step = 2"
					>
						{{ $t('saas.catalog.retire.choose_target') }}
					</UButton>
				</div>
			</template>

			<!-- Step 2: target plan and notification -->
			<template v-else-if="step === 2">
				<div class="grid gap-5 lg:grid-cols-[1fr_280px]">
					<div class="flex flex-col gap-4">
						<FormRows>
							<FormFieldRow
								:label="$t('saas.catalog.retire.move_to')"
								:help="
									preparation
										? $t(`saas.catalog.retire.price_${preparation.price.kind}`)
										: undefined
								"
							>
								<template #default="{ id }">
									<DmsSelect
										:id="id"
										v-model="targetPlanId"
										:items="targetItems"
										:deselectable="false"
										:placeholder="$t('saas.catalog.retire.move_to_placeholder')"
										class="w-full"
									/>
								</template>
							</FormFieldRow>
						</FormRows>

						<div v-if="isPreparing" class="flex flex-col gap-2">
							<USkeleton v-for="index in 3" :key="index" class="h-8 w-full" />
						</div>
						<DmsSaasLoadFailure
							v-else-if="prepareError"
							:title="prepareError"
							@retry="prepare"
						/>
						<DmsCard v-else-if="preparation && target" :padded="false">
							<div
								class="border-default flex items-center justify-between border-b px-4 py-2.5"
							>
								<span class="text-muted text-xs font-semibold uppercase">
									{{ $t('saas.catalog.retire.diff_title') }}
								</span>
								<span class="text-dimmed text-xs">
									{{ plan.name }} → {{ target.name }}
								</span>
							</div>
							<ul class="divide-default divide-y text-sm">
								<li
									v-for="change in changes"
									:key="change.featureId"
									class="flex items-center gap-2 px-4 py-2"
								>
									<UIcon
										:name="KIND_ICONS[change.kind]"
										class="size-4 shrink-0"
										:class="KIND_CLASSES[change.kind]"
									/>
									<span class="min-w-0 flex-1 truncate">
										{{ featureName(change.featureId) }}
									</span>
									<span class="text-muted text-xs">
										{{ readValue(change, change.from) }} →
										<b class="text-default">
											{{ readValue(change, change.to) }}
										</b>
									</span>
								</li>
								<li
									v-if="preparation.members.kind !== 'same'"
									class="flex flex-wrap items-center gap-2 px-4 py-2"
								>
									<UIcon
										:name="KIND_ICONS[preparation.members.kind]"
										class="size-4 shrink-0"
										:class="KIND_CLASSES[preparation.members.kind]"
									/>
									<span class="flex-1">
										{{ $t('saas.catalog.retire.members') }}
									</span>
									<span class="text-muted text-xs tabular-nums">
										{{ memberCap(preparation.members.from) }} →
										<b class="text-default">
											{{ memberCap(preparation.members.to) }}
										</b>
									</span>
									<small
										v-if="preparation.members.above > 0"
										class="text-warning w-full pl-6 text-xs"
									>
										{{
											$t(
												'saas.catalog.retire.above_cap',
												{
													count: preparation.members.above,
													cap: preparation.members.to,
												},
												preparation.members.above,
											)
										}}
									</small>
								</li>
								<li
									v-if="preparation.permissions.length > 0"
									class="flex items-center gap-2 px-4 py-2"
								>
									<UIcon name="i-ph-key" class="text-info size-4 shrink-0" />
									<span class="flex-1">
										{{
											$t('saas.catalog.retire.permissions_changed', {
												added: preparation.permissions.filter(
													(row) => row.kind === 'gained',
												).length,
												removed: preparation.permissions.filter(
													(row) => row.kind === 'lost',
												).length,
											})
										}}
									</span>
								</li>
								<li
									v-if="unchanged.length > 0"
									class="text-muted flex items-center gap-2 px-4 py-2"
								>
									<UIcon :name="KIND_ICONS.same" class="size-4 shrink-0" />
									<span class="flex-1">
										{{
											$t('saas.catalog.retire.unchanged', {
												names: unchanged.join(', '),
											})
										}}
									</span>
								</li>
							</ul>
						</DmsCard>
						<p v-else class="text-muted text-sm">
							{{ $t('saas.catalog.retire.pick_target') }}
						</p>
					</div>

					<div class="flex flex-col gap-3">
						<DmsSwitch
							v-model="notifyOwners"
							:label="$t('saas.catalog.retire.notify')"
							:description="
								preparation
									? $t(
											'saas.catalog.retire.notify_hint',
											{ count: preparation.recipients },
											preparation.recipients,
										)
									: undefined
							"
						/>
						<DmsCard v-if="notifyOwners && target" class="text-sm">
							<p class="text-muted text-xs uppercase">
								{{ $t('saas.catalog.retire.preview') }}
							</p>
							<p class="text-highlighted mt-2 font-semibold">
								{{ $t('saas.notifications.payload.plan_migrated.title') }}
							</p>
							<p class="text-muted mt-1">
								{{
									$t('saas.notifications.payload.plan_migrated.description', {
										plan: target.name,
									})
								}}
							</p>
							<p v-if="preparation?.sample" class="text-dimmed mt-2 text-xs">
								{{
									$t('saas.catalog.retire.preview_sample', {
										workspace: preparation.sample.workspaceName,
									})
								}}
							</p>
						</DmsCard>
					</div>
				</div>

				<div class="flex items-center justify-end gap-2">
					<UButton
						class="mr-auto"
						color="neutral"
						variant="ghost"
						icon="i-ph-arrow-left"
						@click="step = 1"
					>
						{{ $t('saas.catalog.common.back') }}
					</UButton>
					<UButton color="neutral" variant="outline" @click="close">
						{{ $t('saas.catalog.common.cancel') }}
					</UButton>
					<UButton
						trailing-icon="i-ph-arrow-right"
						:disabled="!preparation"
						@click="step = 3"
					>
						{{ $t('saas.catalog.retire.review') }}
					</UButton>
				</div>
			</template>

			<!-- Step 3: typed confirmation -->
			<template v-else>
				<p class="text-highlighted font-semibold">
					{{
						$t(
							'saas.catalog.retire.confirm_title',
							{
								name: plan.name,
								count: impact.workspaces,
								target: target?.name ?? '',
							},
							impact.workspaces,
						)
					}}
				</p>
				<ul
					class="border-default divide-default divide-y rounded-lg border text-sm"
				>
					<li class="flex items-center gap-2 px-3 py-2">
						<UIcon name="i-ph-buildings" class="text-muted size-4" />
						<span class="flex-1">
							{{
								$t('saas.catalog.retire.impact_moved', {
									target: target?.name ?? '',
								})
							}}
						</span>
						<b class="tabular-nums">{{ impact.workspaces }}</b>
					</li>
					<li class="flex items-center gap-2 px-3 py-2">
						<UIcon name="i-ph-users" class="text-muted size-4" />
						<span class="flex-1">
							{{ $t('saas.catalog.retire.impact_members') }}
						</span>
						<b class="tabular-nums">{{ impact.members }}</b>
					</li>
					<li class="flex items-center gap-2 px-3 py-2">
						<UIcon
							name="i-ph-currency-circle-dollar"
							class="text-muted size-4"
						/>
						<span class="flex-1">
							{{ $t('saas.catalog.retire.impact_mrr') }}
						</span>
						<b class="tabular-nums">{{ money(impact.mrr, plan.currency) }}</b>
					</li>
					<li v-if="notifyOwners" class="flex items-center gap-2 px-3 py-2">
						<UIcon name="i-ph-bell" class="text-muted size-4" />
						<span class="flex-1">
							{{ $t('saas.catalog.retire.impact_notified') }}
						</span>
						<b class="tabular-nums">{{ preparation?.recipients ?? 0 }}</b>
					</li>
				</ul>
				<p class="text-muted text-sm">
					{{
						$t('saas.catalog.retire.confirm_description', { name: plan.name })
					}}
				</p>
				<FormRows>
					<FormFieldRow
						:label="
							$t('saas.catalog.retire.type_to_confirm', { slug: plan.slug })
						"
						:error="typedError"
					>
						<template #default="{ id }">
							<DmsInputText
								:id="id"
								v-model="typed"
								autocomplete="off"
								spellcheck="false"
								class="w-full font-mono"
								:trailing-icon="isTypedMatch ? 'i-ph-check-circle' : undefined"
								:ui="{ trailingIcon: 'text-success' }"
								@keydown.enter="retire"
							/>
						</template>
					</FormFieldRow>
				</FormRows>
				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="i-ph-warning-circle"
					:title="$t('saas.catalog.retire.failed')"
					:description="submitError"
				/>
				<div class="flex items-center justify-end gap-2">
					<UButton
						class="mr-auto"
						color="neutral"
						variant="ghost"
						@click="step = 2"
					>
						{{ $t('saas.catalog.common.back') }}
					</UButton>
					<UButton
						color="error"
						icon="i-ph-archive"
						:loading="isSubmitting"
						:disabled="!isTypedMatch"
						@click="retire"
					>
						{{
							$t(
								'saas.catalog.retire.confirm',
								{ count: impact.workspaces },
								impact.workspaces,
							)
						}}
					</UButton>
				</div>
			</template>
		</template>
	</div>
</template>
