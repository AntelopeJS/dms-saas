import { RegisterDataType } from "@antelopejs/interface-dms/base/data-types";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

/**
 * Monetary amount stored the way payment providers store it — in minor units.
 * Rendering divides by the currency exponent, so tables show `59.35` where the
 * mirror holds `5935`.
 */
@RegisterDataType("money_cents")
export class MoneyCentsType extends DefaultDataTypes.NumberType {}
