<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { type UserSecurity, useUserDetail } from '../build/users/useUserDetail'

const props = defineProps<{ routeParams?: Record<string, string> }>()

const I18N = 'saas.users.security'
const LIST_SEPARATOR = ' · '
const ROW_COUNT = 4
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
const KNOWN_TWO_FACTOR_METHODS = new Set(['totp', 'email'])

const { t, te, locale } = useI18n()
const detail = useUserDetail(() => props.routeParams)
const security = computed(() => detail.data.value?.security ?? null)

function methodLabel(method: string): string {
	const key = `${I18N}.method.${method}`
	return te(key) ? t(key) : method.charAt(0).toUpperCase() + method.slice(1)
}

function twoFactorLabel(method: string): string {
	return KNOWN_TWO_FACTOR_METHODS.has(method)
		? t(`${I18N}.two_factor_method.${method}`)
		: method
}

function twoFactorDetail(current: UserSecurity): string | undefined {
	if (current.backupCodesLeft === null) return undefined
	return t(
		`${I18N}.backup_codes_left`,
		{ count: current.backupCodesLeft },
		current.backupCodesLeft,
	)
}

function verificationDetail(current: UserSecurity): string | undefined {
	if (current.isEmailVerified || !current.verificationRequestedAt)
		return undefined
	return t(`${I18N}.verification_requested`, {
		date: formatDate(current.verificationRequestedAt, locale.value, DAY_FORMAT),
	})
}

const items = computed(() => {
	const current = security.value
	if (!current) return []
	const hasTwoFactor = current.twoFactorMethods.length > 0
	return [
		{
			id: 'sign-in',
			label: t(`${I18N}.sign_in_methods`),
			value:
				current.signInMethods.map(methodLabel).join(LIST_SEPARATOR) ||
				t(`${I18N}.no_method`),
		},
		{
			id: 'two-factor',
			label: t(`${I18N}.two_factor`),
			value: hasTwoFactor
				? current.twoFactorMethods.map(twoFactorLabel).join(LIST_SEPARATOR)
				: t(`${I18N}.off`),
			tone: hasTwoFactor ? undefined : ('warning' as const),
			detail: hasTwoFactor ? twoFactorDetail(current) : undefined,
		},
		{
			id: 'sessions',
			label: t(`${I18N}.active_sessions`),
			value: current.activeSessions
				? String(current.activeSessions)
				: t(`${I18N}.no_session`),
			detail: current.sessionLocations.join(', ') || undefined,
		},
		{
			id: 'email-verified',
			label: t(`${I18N}.email_verified`),
			type: 'status' as const,
			value: current.isEmailVerified ? t(`${I18N}.yes`) : t(`${I18N}.not_yet`),
			tone: current.isEmailVerified
				? ('success' as const)
				: ('warning' as const),
			detail: verificationDetail(current),
		},
	]
})

onMounted(() => void detail.load())
</script>

<template>
	<DmsCard :title="$t(`${I18N}.title`)">
		<DmsSaasLoadFailure
			v-if="detail.error.value && !security"
			@retry="detail.refresh()"
		/>
		<DmsKeyValueList
			v-else
			:items="items"
			:loading="!security"
			:skeleton-count="ROW_COUNT"
			dense
		/>
	</DmsCard>
</template>
