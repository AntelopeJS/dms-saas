<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { planPriceLabel } from '../build/workspace-detail/planPrice'

/**
 * Creates a workspace for a customer. The operator chooses how it is paid —
 * complimentary access until a date, or by its owner at first sign-in — sees
 * whether the owner e-mail is an existing account or a new invitation, and
 * reads what will happen before anything is created. An invitation e-mail
 * that did not leave stays on screen with the link to hand over.
 */
interface PlanOption {
	_id: string
	name: string
	price: number
	currency: string
	interval: string
	billingMode: string
	isActive: boolean
	isDeleted: boolean
	paymentProviderRefs?: { stripePriceId?: string } | null
}

type AccessModel = 'complimentary' | 'owner_pays'

type OwnerLookup =
	| { kind: 'existing'; name: string; workspaces: number }
	| { kind: 'new'; invitationDays: number }

type CreatedOwner =
	| { kind: 'added'; userId: string }
	| { kind: 'invited'; inviteId: string }

interface CreatedWorkspace {
	tenantId: string
	owner: CreatedOwner
	invitationEmail: 'sent' | 'failed' | null
}

const props = defineProps<{
	onSuccessCallback?: () => void
	onCancelCallback?: () => void
}>()

const C = 'saas.workspaces.operator_create'
const PLANS_ENDPOINT = '/api/saas/plans'
const CREATE_ENDPOINT = '/api/saas/workspaces/create'
const LOOKUP_ENDPOINT = '/api/saas/workspaces/owner-lookup'
const WORKSPACES_PATH = '/modules/saas/customers/workspaces'
const LOOKUP_DELAY_MS = 400
const MS_PER_DAY = 86_400_000
const MINOR_UNITS_PER_UNIT = 100
const STICKY_TOAST_DURATION = 0
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const router = useDmsRouter()
const { resolveApiError } = useApiErrorMessage()
const { fetchAndCopy } = useInvitationLink()

const plans = ref<PlanOption[]>([])
const loadError = ref<string | null>(null)
const isLoading = ref(true)
const name = ref('')
const planId = ref<string | undefined>()
const ownerEmail = ref('')
const lookup = ref<OwnerLookup | null>(null)
const access = ref<AccessModel>('complimentary')
const freeUntil = ref('')
const isSubmitting = ref(false)
const submitError = ref<string | null>(null)
let lookupTimer: ReturnType<typeof setTimeout> | undefined

const plan = computed(() =>
	plans.value.find((option) => option._id === planId.value),
)
const isPaidPlan = computed(
	() =>
		!!plan.value &&
		plan.value.price > 0 &&
		!!plan.value.paymentProviderRefs?.stripePriceId,
)
const isEmail = computed(() => EMAIL_PATTERN.test(ownerEmail.value.trim()))
const canSubmit = computed(
	() =>
		!!name.value.trim() &&
		!!planId.value &&
		isEmail.value &&
		(access.value === 'complimentary' || isPaidPlan.value) &&
		!isSubmitting.value,
)

function priceOf(option: PlanOption): string {
	return planPriceLabel(
		{
			unitAmountMinor: Math.round(option.price * MINOR_UNITS_PER_UNIT),
			currency: option.currency,
			interval: option.interval,
			billingMode: option.billingMode,
		},
		t,
		locale.value,
	)
}

const planItems = computed(() =>
	plans.value.map((option) => ({
		value: option._id,
		label: `${option.name} · ${priceOf(option)}`,
	})),
)

const daysLeft = computed(() => {
	if (!freeUntil.value) return null
	return Math.max(
		0,
		Math.ceil((new Date(freeUntil.value).getTime() - Date.now()) / MS_PER_DAY),
	)
})

function day(value: string): string {
	return formatDate(value, locale.value, { dateStyle: 'medium' }) ?? value
}

const accessItems = computed(() => [
	{
		value: 'complimentary',
		label: t(`${C}.access.complimentary`),
		description: t(`${C}.access.complimentary_description`),
	},
	{
		value: 'owner_pays',
		label: t(`${C}.access.owner_pays`),
		description: isPaidPlan.value
			? t(`${C}.access.owner_pays_description`, {
					price: plan.value ? priceOf(plan.value) : '',
				})
			: t(`${C}.access.owner_pays_unavailable`),
		disabled: !isPaidPlan.value,
	},
])

const ownerSentence = computed(() => {
	const current = lookup.value
	if (!current) return ''
	return current.kind === 'existing'
		? t(`${C}.what_happens.owner_existing`, { owner: current.name })
		: t(`${C}.what_happens.owner_new`, {
				email: ownerEmail.value.trim(),
				days: current.invitationDays,
			})
})

const whatHappens = computed(() => {
	if (!name.value.trim() || !plan.value) return ''
	const base = { name: name.value.trim(), plan: plan.value.name }
	const created =
		access.value === 'owner_pays'
			? t(`${C}.what_happens.owner_pays`, {
					...base,
					price: priceOf(plan.value),
				})
			: freeUntil.value
				? t(`${C}.what_happens.complimentary_until`, {
						...base,
						date: day(freeUntil.value),
					})
				: t(`${C}.what_happens.complimentary`, base)
	return [created, ownerSentence.value].filter(Boolean).join(' ')
})

async function loadPlans(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		const all = await $authFetch<PlanOption[]>(PLANS_ENDPOINT)
		plans.value = all.filter((option) => option.isActive && !option.isDeleted)
	} catch (error) {
		loadError.value = resolveApiError(error, `${C}.load_error`)
	} finally {
		isLoading.value = false
	}
}

async function lookUpOwner(email: string): Promise<void> {
	try {
		lookup.value = await $authFetch<OwnerLookup>(LOOKUP_ENDPOINT, {
			query: { email },
		})
	} catch {
		lookup.value = null
	}
}

watch(ownerEmail, (email) => {
	clearTimeout(lookupTimer)
	lookup.value = null
	if (!EMAIL_PATTERN.test(email.trim())) return
	lookupTimer = setTimeout(
		() => void lookUpOwner(email.trim()),
		LOOKUP_DELAY_MS,
	)
})

watch(isPaidPlan, (isPaid) => {
	if (!isPaid) access.value = 'complimentary'
})

function openWorkspace(tenantId: string): void {
	void router.push(`${WORKSPACES_PATH}/${tenantId}`)
}

function notifyCreated(created: CreatedWorkspace): void {
	const { owner } = created
	const openAction = {
		label: t(`${C}.open_workspace`),
		icon: 'i-ph-arrow-right',
		onClick: () => openWorkspace(created.tenantId),
	}
	if (created.invitationEmail !== 'failed' || owner.kind !== 'invited') {
		toast.add({
			title: t(`${C}.success`),
			color: 'success',
			icon: 'i-ph-check-circle',
			actions: [openAction],
		})
		return
	}
	// The workspace exists but nobody told its owner: the notice stays until
	// dismissed, with the link to hand over.
	toast.add({
		title: t(`${C}.email_failed.title`),
		description: t(`${C}.email_failed.description`),
		color: 'warning',
		icon: 'i-ph-warning',
		duration: STICKY_TOAST_DURATION,
		actions: [
			{
				label: t(`${C}.email_failed.copy_link`),
				icon: 'i-ph-link',
				onClick: () =>
					void fetchAndCopy({
						tenantId: created.tenantId,
						inviteId: owner.inviteId,
					}),
			},
			openAction,
		],
	})
}

async function submit(): Promise<void> {
	if (!canSubmit.value) return
	submitError.value = null
	isSubmitting.value = true
	try {
		const created = await $authFetch<CreatedWorkspace>(CREATE_ENDPOINT, {
			method: 'POST',
			body: {
				name: name.value.trim(),
				planId: planId.value,
				ownerEmail: ownerEmail.value.trim(),
				access: access.value,
				freeUntil:
					access.value === 'complimentary' ? freeUntil.value || null : null,
			},
		})
		notifyCreated(created)
		props.onSuccessCallback?.()
	} catch (error) {
		submitError.value = resolveApiError(error, `${C}.error`)
	} finally {
		isSubmitting.value = false
	}
}

onMounted(loadPlans)
</script>

<template>
	<div v-if="isLoading" class="flex flex-col gap-3">
		<USkeleton v-for="index in 4" :key="index" class="h-10 w-full" />
	</div>
	<DmsEmptyState
		v-else-if="loadError"
		variant="error"
		size="sm"
		:title="$t(`${C}.load_error`)"
		:description="loadError"
		:actions="[
			{ label: $t('saas.workspace_detail.retry'), onClick: loadPlans },
		]"
	/>
	<form v-else class="flex flex-col gap-4" @submit.prevent="submit">
		<UFormField :label="$t(`${C}.name`)" :help="$t(`${C}.name_help`)" required>
			<UInput
				v-model="name"
				:placeholder="$t(`${C}.name_placeholder`)"
				class="w-full"
				autofocus
			/>
		</UFormField>
		<UFormField :label="$t(`${C}.plan`)" required>
			<USelect
				v-model="planId"
				:items="planItems"
				:placeholder="$t(`${C}.plan_placeholder`)"
				class="w-full"
			/>
		</UFormField>
		<UFormField :label="$t(`${C}.owner_email`)" required>
			<UInput
				v-model="ownerEmail"
				type="email"
				:placeholder="$t(`${C}.owner_email_placeholder`)"
				class="w-full"
			/>
			<template #help>
				<span
					v-if="lookup?.kind === 'existing'"
					class="flex items-center gap-1.5"
				>
					<UIcon name="i-ph-user-circle-check" class="text-success size-4" />
					{{
						$t(
							`${C}.owner_existing`,
							{ name: lookup.name, count: lookup.workspaces },
							lookup.workspaces,
						)
					}}
				</span>
				<span
					v-else-if="lookup?.kind === 'new'"
					class="flex items-center gap-1.5"
				>
					<UIcon name="i-ph-envelope-simple" class="size-4" />
					{{ $t(`${C}.owner_new`, { days: lookup.invitationDays }) }}
				</span>
			</template>
		</UFormField>
		<UFormField :label="$t(`${C}.access.label`)" required>
			<URadioGroup
				v-model="access"
				variant="card"
				:items="accessItems"
				class="w-full"
			/>
		</UFormField>
		<UFormField
			v-if="access === 'complimentary'"
			:label="$t(`${C}.free_until`)"
			:hint="$t(`${C}.optional`)"
			:help="
				daysLeft === null
					? $t(`${C}.free_until_empty`)
					: $t(`${C}.free_until_days`, { count: daysLeft }, daysLeft)
			"
		>
			<UInput v-model="freeUntil" type="date" class="w-full" />
		</UFormField>
		<DmsBanner
			v-if="whatHappens"
			size="sm"
			tone="info"
			icon="i-ph-info"
			:title="$t(`${C}.what_happens.title`)"
			:description="whatHappens"
		/>
		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="i-ph-warning-circle"
			:description="submitError"
		/>
		<div class="flex justify-end gap-2">
			<UButton
				v-if="props.onCancelCallback"
				color="neutral"
				variant="ghost"
				:disabled="isSubmitting"
				@click="props.onCancelCallback()"
			>
				{{ $t('common.cancel') }}
			</UButton>
			<UButton
				type="submit"
				color="primary"
				:loading="isSubmitting"
				:disabled="!canSubmit"
			>
				{{
					lookup?.kind === 'new' ? $t(`${C}.submit_invite`) : $t(`${C}.submit`)
				}}
			</UButton>
		</div>
	</form>
</template>
