<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { formatRelativeTime } from '../build/users/relative-time'
import {
	type UserDetail,
	userDisplayName,
	useUserDetail,
} from '../build/users/useUserDetail'
import { formatMinorUnits } from '../composables/useMoneyFormat'

const props = defineProps<{ routeParams?: Record<string, string> }>()

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
const FACT_COUNT = 5
const MONEY_SEPARATOR = ' + '

const { t, locale } = useI18n()
const detail = useUserDetail(() => props.routeParams)
const user = computed(() => detail.data.value)

const ownedNames = computed(
	() =>
		user.value?.workspaces
			.filter((workspace) => workspace.isTenantOwner)
			.map((workspace) => workspace.name) ?? [],
)

function languageName(code: string | null): string {
	if (!code) return t('saas.users.detail_facts.no_language')
	try {
		return (
			new Intl.DisplayNames([locale.value], { type: 'language' }).of(code) ??
			code
		)
	} catch {
		return code
	}
}

function billedText(current: UserDetail): string {
	if (current.billedAsOwner.length === 0) {
		return formatMinorUnits(0, null, locale.value)
	}
	return current.billedAsOwner
		.map((total) =>
			formatMinorUnits(total.amount, total.currency, locale.value),
		)
		.join(MONEY_SEPARATOR)
}

function lastActiveDetail(current: UserDetail): string | undefined {
	const session = current.lastSession
	if (!session) return undefined
	return (
		[session.browser, session.location].filter(Boolean).join(' · ') || undefined
	)
}

const facts = computed(() => {
	const current = user.value
	if (!current) return []
	const owned = ownedNames.value.length
	const member = current.workspaces.length - owned
	return [
		{
			id: 'workspaces',
			icon: 'i-ph-buildings',
			eyebrow: t('saas.users.detail_facts.workspaces'),
			value: current.workspaces.length,
			detail: t('saas.users.detail_facts.workspaces_detail', { owned, member }),
		},
		{
			id: 'language',
			icon: 'i-ph-translate',
			eyebrow: t('saas.users.detail_facts.language'),
			value: languageName(current.language),
			detail: current.language ?? undefined,
		},
		{
			id: 'last-active',
			icon: 'i-ph-clock',
			eyebrow: t('saas.users.detail_facts.last_active'),
			value:
				formatRelativeTime(current.lastActiveAt, locale.value) ??
				t('saas.users.never_active'),
			detail: lastActiveDetail(current),
		},
		{
			id: 'created',
			icon: 'i-ph-calendar-blank',
			eyebrow: t('saas.users.detail_facts.created'),
			value: formatDate(current.createdAt, locale.value, DAY_FORMAT) ?? '—',
			detail: formatRelativeTime(current.createdAt, locale.value) ?? undefined,
		},
		{
			id: 'billed',
			icon: 'i-ph-coins',
			eyebrow: t('saas.users.detail_facts.billed'),
			value: billedText(current),
			detail: t(
				'saas.users.detail_facts.billed_detail',
				{ count: owned },
				owned,
			),
		},
	]
})

onMounted(() => void detail.refresh())
</script>

<template>
	<div class="flex flex-col gap-4">
		<DmsSaasLoadFailure
			v-if="detail.error.value && !user"
			:title="$t('saas.users.load_failed')"
			@retry="detail.refresh()"
		/>
		<template v-else>
			<div class="flex flex-wrap items-start gap-4">
				<USkeleton v-if="!user" class="size-14 rounded-full" />
				<UAvatar
					v-else
					:alt="userDisplayName(user)"
					:src="typeof user.avatar === 'string' ? user.avatar : undefined"
					size="3xl"
				/>
				<div v-if="!user" class="flex flex-1 flex-col gap-2">
					<USkeleton class="h-6 w-56" />
					<USkeleton class="h-4 w-72" />
				</div>
				<div v-else class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-highlighted truncate text-xl font-semibold">
							{{ userDisplayName(user) }}
						</h2>
						<DmsStatusPill
							:tone="user.security.isEmailVerified ? 'success' : 'warning'"
							:label="
								user.security.isEmailVerified
									? $t('saas.users.badges.email_verified')
									: $t('saas.users.badges.email_unverified')
							"
							size="sm"
						/>
						<DmsStatusPill
							:tone="
								user.security.twoFactorMethods.length ? 'success' : 'neutral'
							"
							:label="
								user.security.twoFactorMethods.length
									? $t('saas.users.badges.two_factor_on')
									: $t('saas.users.badges.two_factor_off')
							"
							size="sm"
						/>
						<UBadge
							v-if="user.isSelf"
							color="neutral"
							variant="outline"
							size="sm"
							:label="$t('saas.users.you')"
						/>
					</div>
					<div class="text-muted mt-1 flex items-center gap-1 text-sm">
						<UIcon name="i-ph-envelope-simple" class="shrink-0" />
						<span class="truncate">{{ user.email }}</span>
						<DmsCopyButton :value="user.email" />
					</div>
					<div
						class="text-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
					>
						<span
							v-if="ownedNames.length"
							class="inline-flex items-center gap-1"
						>
							<UIcon name="i-ph-crown-simple" class="text-primary" />
							{{
								$t('saas.users.owner_of', {
									workspaces: ownedNames.join(', '),
								})
							}}
						</span>
						<DmsStatusPill
							:tone="user.isPlatformAdmin ? 'primary' : 'neutral'"
							:icon="user.isPlatformAdmin ? 'i-ph-shield-check' : undefined"
							:label="
								user.isPlatformAdmin
									? $t('saas.status.platform_role.admin')
									: $t('saas.users.no_platform_role')
							"
							variant="outline"
							size="sm"
						/>
					</div>
				</div>
			</div>
			<DmsStatGroup
				:items="facts"
				:loading="!user"
				:skeleton-count="FACT_COUNT"
				:columns="FACT_COUNT"
				:label="$t('saas.users.detail_facts.label')"
			/>
		</template>
	</div>
</template>
