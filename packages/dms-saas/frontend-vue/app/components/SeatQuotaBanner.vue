<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
	BILLING_PATH,
	INVITES_PATH,
	MEMBERS_PATH,
} from '../build/workspace-paths'

const KEYS = 'saas.workspace.seats'
const WARN_AT_PERCENT = 80
const ERROR_AT_PERCENT = 100

/** Where the seats stand against the plan's cap. */
type SeatState = 'unlimited' | 'room' | 'full' | 'over'

const { data: quota, error, refresh } = useSeatQuota()
const { t } = useI18n()

const seatState = computed<SeatState>(() => {
	const view = quota.value
	if (!view || view.maxMembers === null) return 'unlimited'
	if (view.occupied > view.maxMembers) return 'over'
	return view.occupied >= view.maxMembers ? 'full' : 'room'
})

const segments = computed(() => {
	const view = quota.value
	if (!view) return []
	return [
		{
			value: view.members,
			tone: 'primary' as const,
			label: t(`${KEYS}.members_count`, view.members),
		},
		{
			value: view.pendingInvites,
			tone: 'soft' as const,
			label: t(`${KEYS}.invites_count`, view.pendingInvites),
		},
	]
})

const meterMax = computed(() => {
	const view = quota.value
	return view?.maxMembers ?? Math.max(view?.occupied ?? 0, 1)
})

const seatsLeftLabel = computed(() => {
	const view = quota.value
	if (!view || view.maxMembers === null) return t(`${KEYS}.unlimited`)
	const left = Math.max(view.maxMembers - view.occupied, 0)
	return left > 0 ? t(`${KEYS}.seats_left`, left) : t(`${KEYS}.no_seat_left`)
})

const meterHint = computed(() => {
	const plan = quota.value?.planName
	const parts = plan
		? [t(`${KEYS}.plan`, { plan }), seatsLeftLabel.value]
		: [seatsLeftLabel.value]
	return parts.join(' · ')
})

const valueLabel = computed(() =>
	quota.value?.maxMembers === null
		? t(`${KEYS}.value_unlimited`, { occupied: quota.value?.occupied ?? 0 })
		: undefined,
)

const ownerToAsk = computed(() => quota.value?.owners[0] ?? null)

const fullDescription = computed(() => {
	const view = quota.value
	if (!view?.isTenantOwner) {
		return t(`${KEYS}.full.member`, {
			owner: ownerToAsk.value?.name ?? t(`${KEYS}.full.an_owner`),
		})
	}
	return view.upgradePlanName
		? t(`${KEYS}.full.owner_upgrade`, { plan: view.upgradePlanName })
		: t(`${KEYS}.full.owner_free`)
})

const overTitle = computed(() =>
	t(`${KEYS}.over.title`, {
		occupied: quota.value?.occupied ?? 0,
		plan: quota.value?.planName ?? '',
		max: quota.value?.maxMembers ?? 0,
	}),
)

const overDescription = computed(() => {
	const view = quota.value
	if (!view) return ''
	const excess = view.occupied - (view.maxMembers ?? view.occupied)
	return t(`${KEYS}.over.description`, {
		members: t(`${KEYS}.members_count`, view.members),
		invites: t(`${KEYS}.invites_count`, view.pendingInvites),
		excess: t(`${KEYS}.seats_count`, excess),
	})
})

function initialsOf(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? '')
		.join('')
}

// Refetch rather than serve the shared cache: adding a member or an invite
// lands back on this page, and a stale count would contradict the table right
// above the block.
onMounted(refresh)
</script>

<template>
	<DmsSection
		:title="$t(`${KEYS}.title`)"
		:description="$t(`${KEYS}.description`)"
	>
		<div class="p-4.5 flex flex-col gap-4">
			<div v-if="!quota && !error" class="grid gap-1.5" aria-busy="true">
				<USkeleton class="h-4 w-1/3" />
				<USkeleton class="h-1.5 w-full rounded-full" />
				<USkeleton class="h-3 w-40" />
			</div>
			<DmsSaasLoadFailure
				v-else-if="error && !quota"
				:title="$t(`${KEYS}.load_failed`)"
				@retry="refresh"
			/>
			<template v-else-if="quota">
				<DmsMeter
					:label="$t(`${KEYS}.meter_label`)"
					:hint="meterHint"
					:max="meterMax"
					:segments="segments"
					:value-label="valueLabel"
					format="fraction"
					legend
					:warn-at="seatState === 'unlimited' ? undefined : WARN_AT_PERCENT"
					:error-at="seatState === 'unlimited' ? undefined : ERROR_AT_PERCENT"
				>
					<template v-if="quota.isTenantOwner" #legend-end>
						<UButton
							:to="BILLING_PATH"
							color="neutral"
							variant="link"
							size="xs"
						>
							{{ $t(`${KEYS}.manage`) }}
						</UButton>
					</template>
				</DmsMeter>

				<DmsBanner
					v-if="seatState === 'full'"
					tone="error"
					size="sm"
					icon="i-ph-users-three"
					:title="$t(`${KEYS}.full.title`)"
					:description="fullDescription"
				>
					<template #actions>
						<template v-if="quota.isTenantOwner">
							<UButton
								:to="INVITES_PATH"
								color="neutral"
								variant="outline"
								size="xs"
							>
								{{ $t(`${KEYS}.review_invites`) }}
							</UButton>
							<UButton
								:to="BILLING_PATH"
								color="primary"
								size="xs"
								icon="i-ph-arrow-circle-up"
							>
								{{ $t(`${KEYS}.upgrade`) }}
							</UButton>
						</template>
						<UButton
							v-else-if="ownerToAsk"
							:to="`mailto:${ownerToAsk.email}`"
							color="neutral"
							variant="outline"
							size="xs"
							icon="i-ph-envelope-simple"
						>
							{{ $t(`${KEYS}.full.email_owner`, { owner: ownerToAsk.name }) }}
						</UButton>
					</template>
				</DmsBanner>

				<DmsBanner
					v-else-if="seatState === 'over'"
					tone="warning"
					size="sm"
					:title="overTitle"
					:description="overDescription"
				>
					<template v-if="quota.isTenantOwner" #actions>
						<UButton
							:to="MEMBERS_PATH"
							color="neutral"
							variant="outline"
							size="xs"
						>
							{{ $t(`${KEYS}.over.review_members`) }}
						</UButton>
						<UButton
							:to="BILLING_PATH"
							color="primary"
							size="xs"
							icon="i-ph-arrow-circle-up"
						>
							{{ $t(`${KEYS}.upgrade`) }}
						</UButton>
					</template>
				</DmsBanner>

				<div
					v-if="quota.platformSupport.length"
					class="border-default flex flex-col gap-2 border-t pt-4"
				>
					<div class="flex flex-col gap-0.5">
						<h4 class="text-highlighted text-sm font-semibold">
							{{ $t(`${KEYS}.platform_support.title`) }}
						</h4>
						<p class="text-muted text-[12.5px]">
							{{ $t(`${KEYS}.platform_support.description`) }}
						</p>
					</div>
					<ul class="flex flex-col gap-2">
						<li
							v-for="member in quota.platformSupport"
							:key="member.userId"
							class="flex flex-wrap items-center gap-2.5 text-sm"
						>
							<DmsIconWell size="xs" tone="muted">
								<span class="text-[11px] font-semibold">
									{{ initialsOf(member.name) }}
								</span>
							</DmsIconWell>
							<span class="text-highlighted font-medium">
								{{ member.name }}
							</span>
							<span class="text-muted">{{ member.email }}</span>
							<DmsStatusPill
								class="ms-auto"
								size="sm"
								tone="info"
								icon="i-ph-lifebuoy"
								:label="$t(`${KEYS}.platform_support.badge`)"
							/>
						</li>
					</ul>
				</div>
			</template>
		</div>
	</DmsSection>
</template>
