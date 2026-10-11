/** The header of a workspace's detail page (`GET …/:id/overview`). */
export interface WorkspaceOverview {
	_id: string
	name: string
	createdAt: string
	status: string
	planName: string | null
	isComplimentary: boolean
	freeUntil: string | null
	ownerName: string | null
	ownerEmail: string | null
	ownerStatus: string
	joinedAt: string | null
	stripeCustomerId: string | null
	stripeCustomerUrl: string | null
	hasStripeSubscription: boolean
	members: number
	platformSupport: number
	pendingInvitations: number
	seats: number
	maxMembers: number | null
}

/** The next invoice of a workspace, as Stripe previews it. */
export interface NextInvoiceRef {
	amountMinor: number
	currency: string
	date: string
}

/** A plan an immediate upgrade may move to. */
export interface EligibleUpgradePlan {
	id: string
	name: string
	price: number
	currency: string
	interval: string
	maxMembers: number
}

/** `GET …/:id/operator-options`. */
export interface OperatorOptions {
	currentPlanId: string | null
	currentPlanName: string | null
	currency: string | null
	customerBalanceCents: number | null
	hasStripeCustomer: boolean
	hasStripeSubscription: boolean
	eligibleUpgradePlans: EligibleUpgradePlan[]
	creditCeilingMinor: number
	nextInvoice: NextInvoiceRef | null
}

/** The workspace owner as an operator dialog names them. */
export interface OwnerRef {
	name: string | null
	email: string | null
}

/** `GET …/:id/suspension-impact`. */
export interface SuspensionImpact {
	workspaceName: string
	status: string
	members: number
	stripeSubscriptionId: string | null
	nextInvoice: NextInvoiceRef | null
	owner: OwnerRef | null
	suspendedSince: string | null
	suspendedBy: string | null
}

/** A plan complimentary access can be granted on. */
export interface ComplimentaryPlanOption {
	id: string
	name: string
	unitAmountMinor: number
	currency: string
	interval: string
	billingMode: string
	maxMembers: number
	fits: boolean
}

/** `GET …/:id/complimentary-impact`. */
export interface ComplimentaryImpact {
	workspaceName: string
	currentPlanId: string | null
	isComplimentary: boolean
	freeUntil: string | null
	stripeSubscriptionId: string | null
	mrrMinor: number
	currency: string | null
	nextInvoice: NextInvoiceRef | null
	seats: number
	owner: OwnerRef | null
	plans: ComplimentaryPlanOption[]
}

/** A plan as the upgrade preview shows it. */
export interface UpgradePlanTerms {
	id: string
	name: string
	unitAmountMinor: number
	currency: string
	interval: string
	billingMode: string
}

/** One line of the invoice Stripe previews for an upgrade. */
export interface UpgradePreviewLine {
	description: string | null
	amountMinor: number
	isProration: boolean
}

/** `GET …/:id/upgrade-preview?planId=`. */
export interface UpgradePreview {
	current: UpgradePlanTerms
	target: UpgradePlanTerms
	seats: number
	currency: string
	lines: UpgradePreviewLine[]
	subtotalMinor: number
	taxMinor: number
	taxRatePercent: number | null
	taxCountry: string | null
	isReverseCharge: boolean
	totalMinor: number
	amountDueMinor: number
	isChargedNow: boolean
	billingDate: string
	renewalAmountMinor: number
	mrrBeforeMinor: number
	mrrAfterMinor: number
}

/** The dialogs an operator opens on a workspace. */
export type WorkspaceDialog = 'upgrade' | 'credit' | 'complimentary'
