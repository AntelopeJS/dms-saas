<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { userDisplayName, useUserDetail } from '../build/users/useUserDetail'

// The identity header of the user page: who the user is and how their
// account stands. The figures under it are a StatGroup the page mounts.
const props = defineProps<{ routeParams?: Record<string, string> }>()

const detail = useUserDetail(() => props.routeParams)
const user = computed(() => detail.data.value)

const ownedNames = computed(
	() =>
		user.value?.workspaces
			.filter((workspace) => workspace.isTenantOwner)
			.map((workspace) => workspace.name) ?? [],
)

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
		</template>
	</div>
</template>
