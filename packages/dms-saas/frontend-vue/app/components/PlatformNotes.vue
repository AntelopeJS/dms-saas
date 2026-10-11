<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * Internal notes operators keep on a workspace or a user (`targetType`),
 * never shown to the customer: newest first, the older ones behind
 * "Show all", each deletable after a confirmation.
 */
type TargetType = 'user' | 'workspace'

interface PlatformNote {
	_id: string
	authorId: string
	authorName: string | null
	authorEmail: string | null
	content: string
	createdAt: string
}

interface NotesPage {
	items: PlatformNote[]
	total: number
}

const props = defineProps<{
	targetType: TargetType
	routeParams?: Record<string, string>
}>()

const N = 'saas.notes'
const MAX_CONTENT_LENGTH = 4000
const PREVIEW_COUNT = 2
const ALL_COUNT = 50
const MAX_INITIALS = 2

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { resolveApiError } = useApiErrorMessage()

const targetId = computed(() => props.routeParams?.id ?? '')
const baseUrl = computed(
	() => `/api/saas/platform-notes/${props.targetType}/${targetId.value}`,
)

const notes = ref<PlatformNote[]>([])
const total = ref(0)
const isExpanded = ref(false)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const isSubmitting = ref(false)
const draft = ref('')

const trimmed = computed(() => draft.value.trim())
const canSubmit = computed(
	() =>
		!isSubmitting.value &&
		trimmed.value.length > 0 &&
		trimmed.value.length <= MAX_CONTENT_LENGTH,
)
const olderCount = computed(() => Math.max(0, total.value - notes.value.length))

function authorOf(note: PlatformNote): string {
	return note.authorName || note.authorEmail || note.authorId
}

function initialsOf(note: PlatformNote): string {
	return authorOf(note)
		.split(/[\s.@_-]+/)
		.filter(Boolean)
		.slice(0, MAX_INITIALS)
		.map((word) => word[0]!.toLocaleUpperCase())
		.join('')
}

function when(note: PlatformNote): string {
	return (
		formatDate(note.createdAt, locale.value, {
			dateStyle: 'medium',
			timeStyle: 'short',
		}) ?? ''
	)
}

async function load(): Promise<void> {
	if (!targetId.value) return
	isLoading.value = true
	loadError.value = null
	try {
		const page = await $authFetch<NotesPage>(baseUrl.value, {
			query: {
				page: 1,
				pageSize: isExpanded.value ? ALL_COUNT : PREVIEW_COUNT,
			},
		})
		notes.value = page.items
		total.value = page.total
	} catch (error) {
		loadError.value = resolveApiError(error, `${N}.error.load`)
	} finally {
		isLoading.value = false
	}
}

function showAll(): void {
	isExpanded.value = true
	void load()
}

async function submit(): Promise<void> {
	if (!canSubmit.value) return
	isSubmitting.value = true
	try {
		await $authFetch(baseUrl.value, {
			method: 'POST',
			body: { content: trimmed.value },
		})
		draft.value = ''
		await load()
	} catch (error) {
		toast.add({
			color: 'error',
			icon: 'i-ph-warning',
			title: resolveApiError(error, `${N}.error.create`),
		})
	} finally {
		isSubmitting.value = false
	}
}

async function remove(note: PlatformNote): Promise<void> {
	const isConfirmed = await confirm({
		title: t(`${N}.delete_confirm.title`),
		description: t(`${N}.delete_confirm.description`),
		color: 'error',
		icon: 'i-ph-trash',
		confirmLabel: t(`${N}.delete_confirm.confirm`),
		onConfirm: async () => {
			await $authFetch(`/api/saas/platform-notes/${note._id}`, {
				method: 'DELETE',
			})
		},
	})
	if (isConfirmed) await load()
}

onMounted(load)
</script>

<template>
	<DmsCard :title="$t(`${N}.title`)" :count="total || undefined">
		<div class="flex flex-col gap-3">
			<p class="text-muted text-xs">{{ $t(`${N}.operators_only`) }}</p>
			<UTextarea
				v-model="draft"
				:placeholder="$t(`${N}.placeholder`)"
				:rows="3"
				:maxlength="MAX_CONTENT_LENGTH"
				autoresize
				class="w-full"
			/>
			<div class="flex items-center justify-between gap-2">
				<span class="text-dimmed text-xs">{{ $t(`${N}.never_shown`) }}</span>
				<UButton
					size="sm"
					color="primary"
					icon="i-ph-plus"
					:loading="isSubmitting"
					:disabled="!canSubmit"
					@click="submit"
				>
					{{ $t(`${N}.add`) }}
				</UButton>
			</div>
			<USeparator />
			<div v-if="isLoading && notes.length === 0" class="flex flex-col gap-2">
				<USkeleton
					v-for="index in PREVIEW_COUNT"
					:key="index"
					class="h-14 w-full"
				/>
			</div>
			<DmsEmptyState
				v-else-if="loadError"
				variant="error"
				size="sm"
				:title="$t(`${N}.error.load`)"
				:description="loadError"
				:actions="[{ label: $t('saas.workspace_detail.retry'), onClick: load }]"
			/>
			<DmsEmptyState
				v-else-if="total === 0"
				size="sm"
				icon="i-ph-note-pencil"
				:title="$t(`${N}.empty`)"
				:description="$t(`${N}.empty_description`)"
			/>
			<template v-else>
				<ul class="flex flex-col gap-3">
					<li v-for="note in notes" :key="note._id" class="flex gap-2.5">
						<UAvatar
							:text="initialsOf(note)"
							:alt="authorOf(note)"
							size="xs"
							class="mt-0.5"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<p class="text-muted text-xs">
									<span class="text-default font-medium">
										{{ authorOf(note) }}
									</span>
									· {{ when(note) }}
								</p>
								<UButton
									icon="i-ph-trash"
									color="neutral"
									variant="ghost"
									size="xs"
									:aria-label="$t(`${N}.delete`)"
									@click="remove(note)"
								/>
							</div>
							<p class="whitespace-pre-wrap break-words text-sm">
								{{ note.content }}
							</p>
						</div>
					</li>
				</ul>
				<UButton
					v-if="olderCount > 0"
					color="neutral"
					variant="link"
					size="sm"
					class="self-start"
					:loading="isLoading"
					@click="showAll"
				>
					{{ $t(`${N}.show_all`, { count: olderCount }, olderCount) }}
				</UButton>
			</template>
		</div>
	</DmsCard>
</template>
