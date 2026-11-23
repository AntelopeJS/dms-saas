import { defineComponent, h, resolveComponent } from 'vue'

const RULES_COMPONENT = 'DmsSaasSegmentRulesText'

/** The rules of a segment in words, read-only, wherever a form shows them. */
const SegmentConditionsDisplay = defineComponent({
	name: 'SegmentConditionsDisplay',
	props: {
		modelValue: {
			type: [Object, String],
			default: null,
		},
		fieldsCatalogUrl: { type: String, default: undefined },
	},
	setup(props) {
		const rules = resolveComponent(RULES_COMPONENT)
		return () =>
			h(rules, {
				conditions: props.modelValue,
				mode: 'full',
				fieldsCatalogUrl: props.fieldsCatalogUrl,
			})
	},
})

interface SegmentConditionsOptions {
	fieldsCatalogUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isSegmentConditionsOptions(
	value: unknown,
): value is SegmentConditionsOptions {
	return (
		isRecord(value) &&
		(value.fieldsCatalogUrl === undefined ||
			typeof value.fieldsCatalogUrl === 'string')
	)
}

export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	registerDataType({
		id: 'segment_conditions',
		displayComponent: SegmentConditionsDisplay,
		formatter: {
			default: (value, _locale, options) =>
				h(resolveComponent(RULES_COMPONENT), {
					conditions: value,
					mode: 'compact',
					fieldsCatalogUrl: isSegmentConditionsOptions(options)
						? options.fieldsCatalogUrl
						: undefined,
				}),
		},
	})
})
