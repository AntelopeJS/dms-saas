import { isSegmentGroup, isSegmentWorkspaceRef } from './tree'
import type { SegmentCatalog } from './useSegmentCatalog'
import { useSegmentWords } from './useSegmentWords'
import type {
	SegmentConditionGroup,
	SegmentNode,
	SegmentScope,
	SegmentWordToken,
} from './types'

const I18N = 'saas.segments.sentence'

/**
 * The rules as one sentence ("Users where Email verified is Yes, they own
 * at least one workspace where Paying is Yes and …"), tokens in bold for
 * the fields read.
 */
export function useSegmentSentence(catalog: SegmentCatalog) {
	const { t } = useI18n()
	const words = useSegmentWords(catalog)

	function clause(node: SegmentNode, scope: SegmentScope): SegmentWordToken[] {
		if (isSegmentWorkspaceRef(node)) {
			const role = node.role === 'owner' ? 'owner' : 'member'
			return [
				{ text: t(`${I18N}.ref.${role}.${node.quantifier}`) },
				...clauses(node.conditions, 'workspace'),
			]
		}
		if (isSegmentGroup(node)) {
			return [{ text: '(' }, ...clauses(node, scope), { text: ')' }]
		}
		return words.conditionTokens(node, scope)
	}

	function clauses(
		group: SegmentConditionGroup,
		scope: SegmentScope,
	): SegmentWordToken[] {
		const last = group.conditions.length - 1
		const conjunction = t(`${I18N}.${group.logical}`)
		return group.conditions.flatMap((node, index) => {
			const separator =
				index === 0 ? [] : [{ text: index === last ? conjunction : ',' }]
			return [...separator, ...clause(node, scope)]
		})
	}

	/** The rules of a segment as tokens of one sentence. */
	function sentence(group: SegmentConditionGroup): SegmentWordToken[] {
		if (group.conditions.length === 0) return [{ text: t(`${I18N}.empty`) }]
		return [
			{ text: t(`${I18N}.lead`) },
			...clauses(group, 'user'),
			{ text: '.' },
		]
	}

	return { sentence }
}
