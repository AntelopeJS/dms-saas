<script setup lang="ts">
import { computed, resolveComponent, useSlots } from 'vue'

/**
 * A DMS block whose route names the record of the page: the `{param}`
 * placeholders of its URL options are filled from the page URL (`{id}` on a
 * detail page), which a block's own `fetchUrl` and `badgesUrl` do not do.
 * Loading, error and empty states stay the block's own. The block is drawn
 * again when an operator action on the page changes the record.
 */
type ScopedBlock = 'stat-group' | 'key-value-list' | 'activity-feed' | 'tab'

const props = defineProps<{
	block: ScopedBlock
	props?: Record<string, unknown>
	routeParams?: Record<string, string>
	componentId?: string
	pageId?: string
}>()

const BLOCK_COMPONENTS: Record<
	ScopedBlock,
	ReturnType<typeof resolveComponent>
> = {
	'stat-group': resolveComponent('DmsStatGroupBlock'),
	'key-value-list': resolveComponent('DmsKeyValueListBlock'),
	'activity-feed': resolveComponent('DmsActivityFeed'),
	tab: resolveComponent('DmsTab'),
}

const URL_OPTIONS = ['fetchUrl', 'badgesUrl']
const PLACEHOLDER = /\{(\w+)\}/g

const slots = useSlots()
const recordId = computed(() => props.routeParams?.id ?? '')
const { triggerRef } = useDetailRefresh(recordId.value)

const component = computed(() => BLOCK_COMPONENTS[props.block])

function fillPlaceholders(url: string): string {
	return url.replace(
		PLACEHOLDER,
		(match, name: string) =>
			encodeURIComponent(props.routeParams?.[name] ?? '') || match,
	)
}

const blockProps = computed(() =>
	Object.fromEntries(
		Object.entries(props.props ?? {}).map(([key, value]) => [
			key,
			URL_OPTIONS.includes(key) && typeof value === 'string'
				? fillPlaceholders(value)
				: value,
		]),
	),
)

const slotNames = computed(() => Object.keys(slots))
</script>

<template>
	<component
		:is="component"
		:key="triggerRef"
		v-bind="blockProps"
		:component-id="props.componentId"
		:page-id="props.pageId"
		:route-params="props.routeParams"
	>
		<template v-for="name in slotNames" :key="name" #[name]>
			<slot :name="name" />
		</template>
	</component>
</template>
