import { REGISTRATION_CARD_REQUIRED_KEY } from '../build/public/registration-errors'
import { isRecord } from '../build/type-guards'
import type { DmsSaasPublicRuntimeConfig } from '../types/runtime-config'

/** A value of the consumer's capture: what survives a JSON round trip. */
export type RegistrationExtraValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| RegistrationExtraValue[]
	| { [key: string]: RegistrationExtraValue }

/** The consumer's capture, keyed by the names its form gives its fields. */
export type RegistrationExtras = Record<string, RegistrationExtraValue>

/** Everything the submit guard looks at, independent of how it is bound. */
export interface RegistrationRequirements {
	isPaymentRequired: boolean
	isPaymentReady: boolean
	hasAcceptedLegal: boolean
}

/** The account fields on top of the requirements, for field-level errors. */
export interface RegistrationFieldState extends RegistrationRequirements {
	name: string
	email: string
	isPasswordValid: boolean
}

/** A field of the registration form an error can be attached to. */
export type RegistrationField = 'name' | 'email' | 'password' | 'card' | 'legal'

/** Translation key of each field's error, for the fields that have one. */
export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>

interface RegistrationRule {
	field: RegistrationField
	errorKey: string
	isMet: (state: RegistrationFieldState) => boolean
}

const INVITATION_ONLY = 'invitation-only'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.(?:[^\s@.]+|[^\s@.]*\.)$/
const PASSWORD_POLICY_ERROR_KEY = 'saas.errors.registration.password_policy'

/**
 * Checked in the order the visitor can act on them: the card field comes
 * before the legal checkbox on every screen.
 */
const REGISTRATION_REQUIREMENTS: RegistrationRule[] = [
	{
		field: 'card',
		errorKey: REGISTRATION_CARD_REQUIRED_KEY,
		isMet: (state) => !state.isPaymentRequired || state.isPaymentReady,
	},
	{
		field: 'legal',
		errorKey: 'saas.public.register.error.legal_required',
		isMet: (state) => state.hasAcceptedLegal,
	},
]

/** The account fields, in form order, ahead of the requirements. */
const ACCOUNT_RULES: RegistrationRule[] = [
	{
		field: 'name',
		errorKey: 'saas.public.register.error.name_required',
		isMet: (state) => state.name.trim().length > 0,
	},
	{
		field: 'email',
		errorKey: 'saas.public.register.error.email_invalid',
		isMet: (state) => EMAIL_PATTERN.test(state.email.trim()),
	},
	{
		field: 'password',
		errorKey: PASSWORD_POLICY_ERROR_KEY,
		isMet: (state) => state.isPasswordValid,
	},
]

/**
 * The server's refusals that are about one field: shown next to it rather
 * than above the form.
 */
const API_ERROR_FIELDS = new Map<string, RegistrationField>([
	['saas.errors.user.email_in_use', 'email'],
	['saas.errors.registration.password_policy', 'password'],
	['saas.errors.registration.payment_method_required', 'card'],
	['saas.errors.workspace.free_card_limit_reached', 'card'],
])

/**
 * The one guard a consumer cannot get wrong on its own: the first requirement
 * the visitor has not met yet, in the order they can act on them.
 *
 * @param requirements Current state of the registration form
 * @returns Translation key of the first unmet requirement, or null
 */
export function firstMissingRegistrationRequirement(
	requirements: RegistrationRequirements,
): string | null {
	const state = { ...requirements, name: '', email: '', isPasswordValid: true }
	const missing = REGISTRATION_REQUIREMENTS.find((rule) => !rule.isMet(state))
	return missing?.errorKey ?? null
}

/**
 * Every field the visitor still has to fix, each with its error key, so the
 * form can mark them all at once and count them in its summary.
 *
 * @param state Current state of the registration form
 */
export function missingRegistrationFields(
	state: RegistrationFieldState,
): RegistrationFieldErrors {
	return Object.fromEntries(
		[...ACCOUNT_RULES, ...REGISTRATION_REQUIREMENTS]
			.filter((rule) => !rule.isMet(state))
			.map((rule) => [rule.field, rule.errorKey]),
	)
}

/** The field a server refusal is about, or null for a form-wide failure. */
export function registrationFieldOf(
	errorKey: string | undefined,
): RegistrationField | null {
	return (errorKey && API_ERROR_FIELDS.get(errorKey)) || null
}

function isExtraValue(value: unknown): value is RegistrationExtraValue {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return true
	}
	if (Array.isArray(value)) return value.every(isExtraValue)
	return isRegistrationExtras(value)
}

function isRegistrationExtras(value: unknown): value is RegistrationExtras {
	return isRecord(value) && Object.values(value).every(isExtraValue)
}

/**
 * Whether the deployment has closed public registration to invitations.
 *
 * @param config dms-saas public runtime config
 * @returns True when only invited accounts may sign up
 */
export function isRegistrationClosedBy(
	config: DmsSaasPublicRuntimeConfig | undefined,
): boolean {
	return config?.admissionMode === INVITATION_ONLY
}

/**
 * The consumer's capture, detached from the consumer.
 *
 * An empty capture is no capture, and a live one is not a capture at all: the
 * object is frozen as it will be serialised, so a consumer whose own form is
 * still editable while the card is being confirmed cannot change what was
 * submitted — or make it too large to accept once the card has gone through.
 *
 * @param extras Whatever the consumer handed over, possibly reactive
 * @returns A detached copy, or undefined when there is nothing to send
 */
export function snapshotRegistrationExtras(
	extras: RegistrationExtras | undefined,
): RegistrationExtras | undefined {
	if (!extras || Object.keys(extras).length === 0) return undefined
	const detached: unknown = JSON.parse(JSON.stringify(extras))
	return isRegistrationExtras(detached) ? detached : undefined
}
