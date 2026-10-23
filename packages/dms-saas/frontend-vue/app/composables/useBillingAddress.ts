/**
 * The value of the DMS address input (`DmsInputAddress`, the `AddressType`
 * field): the street split into its name, number and box.
 */
export interface AddressInputValue {
	streetName: string
	houseNumber?: string
	boxNumber?: string
	addressLine2?: string
	postalCode: string
	city: string
	countrySubdivision?: string
	countryCode: string
}

/** The billing address as the draft and Stripe hold it: one street line. */
export interface BillingAddressDraft {
	line1: string
	line2: string
	postalCode: string
	city: string
	state: string
	country: string
}

/** The street line split into the parts the address input edits. */
export interface StreetParts {
	streetName: string
	houseNumber: string
	boxNumber: string
}

// "Rue de l'Ermitage 41", "Rue de l'Ermitage 41/2", "Rue X, 41 bte 2": the
// number is the last word starting with a digit, a box after it either
// slashed or named as the address input itself splits it. A line written the
// other way round ("10 Downing Street") stays the street name, whole.
const NUMBER_AT_END =
	/^(.+?)[,\s]\s*(\d[^\s/]*)(?:\s*\/\s*(\S+)|\s+(?:bo[iî]te|bus|box|bte)\.?\s*(\S+))?$/i
const BOX_SEPARATOR = '/'

/** Splits a stored street line into the address input's street parts. */
export function splitStreetLine(line: string): StreetParts {
	const trimmed = line.trim()
	const match = NUMBER_AT_END.exec(trimmed)
	if (!match) return { streetName: trimmed, houseNumber: '', boxNumber: '' }
	return {
		streetName: match[1]?.trim() ?? '',
		houseNumber: match[2] ?? '',
		boxNumber: match[3] ?? match[4] ?? '',
	}
}

/** Joins street parts into one line: "Rue X 41", "Rue X 41/2". */
export function joinStreetLine(parts: StreetParts): string {
	const number = [parts.houseNumber.trim(), parts.boxNumber.trim()]
		.filter(Boolean)
		.join(BOX_SEPARATOR)
	return [parts.streetName.trim(), number].filter(Boolean).join(' ')
}

function hasSameStreet(left: StreetParts, right: StreetParts): boolean {
	return (
		left.streetName === right.streetName &&
		left.houseNumber === right.houseNumber &&
		left.boxNumber === right.boxNumber
	)
}

/** The address input's value for a stored billing address. */
export function toAddressInputValue(
	address: BillingAddressDraft,
): AddressInputValue {
	return {
		...splitStreetLine(address.line1),
		addressLine2: address.line2,
		postalCode: address.postalCode,
		city: address.city,
		countrySubdivision: address.state,
		countryCode: address.country,
	}
}

/**
 * The billing address an address input value stands for. The street line is
 * rebuilt only when its parts changed, so editing the city of a line the
 * split could not rebuild word for word ("Rue X, 41 bte 2") leaves it as
 * typed, and leaves the form clean until something really changed.
 */
export function fromAddressInputValue(
	value: AddressInputValue,
	current: BillingAddressDraft,
): BillingAddressDraft {
	const street: StreetParts = {
		streetName: value.streetName ?? '',
		houseNumber: value.houseNumber ?? '',
		boxNumber: value.boxNumber ?? '',
	}
	return {
		line1: hasSameStreet(street, splitStreetLine(current.line1))
			? current.line1
			: joinStreetLine(street),
		line2: value.addressLine2 ?? '',
		postalCode: value.postalCode ?? '',
		city: value.city ?? '',
		state: value.countrySubdivision ?? '',
		country: (value.countryCode ?? '').toUpperCase(),
	}
}
