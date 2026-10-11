<script setup lang="ts">
/**
 * A public legal document: title, version and date, contents from its
 * headings, the related documents and a way back to where the visitor was.
 * An unpublished document reads "Content unavailable".
 */
import { computed, onMounted, ref } from 'vue'
import {
	headingAnchor,
	type LegalDocumentsPayload,
	type LegalHeading,
	legalDocumentStamp,
	readingMinutes,
	resolveLegalBackTarget,
} from '../build/public/legal'
import PublicStage from '../build/public/PublicStage.vue'
import {
	type LegalDocumentField,
	LEGAL_DOCUMENTS,
	LEGAL_FROM_PARAM,
	LOGIN_PATH,
} from '../build/public/routes'
import { usePublicFetch } from '../build/public/usePublicFetch'

interface LegalLayoutProps {
	documentField: LegalDocumentField
}

interface OutlinedDocument {
	html: string
	text: string
	headings: LegalHeading[]
}

const props = defineProps<LegalLayoutProps>()

const LEGAL_ENDPOINT = '/api/saas/legal-documents'
const HEADING_SELECTOR = 'h1, h2, h3'
const HEADING_LEVEL_OFFSET = 1

const { t, locale } = useI18n()
const route = useDmsRoute()
const publicFetch = usePublicFetch()
const { resolveApiError } = useApiErrorMessage()

const payload = ref<LegalDocumentsPayload | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const backTo = ref(LOGIN_PATH)

const current = computed(
	() => LEGAL_DOCUMENTS.find((entry) => entry.field === props.documentField)!,
)
const related = computed(() =>
	LEGAL_DOCUMENTS.filter((entry) => entry.field !== props.documentField),
)
const stamp = computed(() =>
	payload.value ? legalDocumentStamp(payload.value, props.documentField) : null,
)

/** Anchors every heading of the stored HTML so the contents can link to it. */
function outline(html: string): OutlinedDocument {
	const parsed = new DOMParser().parseFromString(html, 'text/html')
	const taken = new Set<string>()
	const headings = [...parsed.querySelectorAll(HEADING_SELECTOR)].map(
		(node) => {
			const text = node.textContent?.trim() ?? ''
			node.id = headingAnchor(text, taken)
			return {
				id: node.id,
				text,
				level: Number(node.tagName.slice(HEADING_LEVEL_OFFSET)),
			}
		},
	)
	return {
		html: parsed.body.innerHTML,
		text: parsed.body.textContent ?? '',
		headings: headings.filter((heading) => heading.text),
	}
}

const legalDocument = computed<OutlinedDocument | null>(() => {
	const html = payload.value?.[props.documentField]?.trim()
	return html ? outline(html) : null
})

const metaLine = computed(() => {
	const parts: string[] = []
	if (stamp.value?.updatedAt) {
		parts.push(
			t('saas.public.legal.last_updated', {
				date: formatDate(stamp.value.updatedAt),
			}),
		)
	}
	if (stamp.value?.version) {
		parts.push(
			t('saas.public.legal.version', { version: String(stamp.value.version) }),
		)
	}
	if (legalDocument.value) {
		const minutes = readingMinutes(legalDocument.value.text)
		parts.push(
			t(
				'saas.public.legal.reading_time',
				{ minutes: String(minutes) },
				minutes,
			),
		)
	}
	return parts.join(' · ')
})

function relatedMeta(field: LegalDocumentField): string | null {
	const updatedAt = payload.value
		? legalDocumentStamp(payload.value, field).updatedAt
		: null
	return updatedAt
		? t('saas.public.legal.updated_on', { date: formatDate(updatedAt) })
		: null
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
		new Date(value),
	)
}

function print(): void {
	window.print()
}

async function loadDocument(): Promise<void> {
	isLoading.value = true
	loadError.value = null
	try {
		payload.value = await publicFetch<LegalDocumentsPayload>(LEGAL_ENDPOINT)
	} catch (error) {
		loadError.value = resolveApiError(error, 'saas.public.legal.load_error')
	} finally {
		isLoading.value = false
	}
}

onMounted(() => {
	backTo.value = resolveLegalBackTarget(
		route.query[LEGAL_FROM_PARAM],
		window.document.referrer,
		window.location.origin,
		window.location.pathname,
	)
	void loadDocument()
})
</script>

<template>
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 py-2">
		<div class="flex items-center justify-between gap-2 print:hidden">
			<UButton
				:to="backTo"
				:label="$t('saas.public.legal.back')"
				icon="i-ph-arrow-left"
				color="neutral"
				variant="ghost"
				size="sm"
			/>
			<UButton
				v-if="legalDocument"
				:label="$t('saas.public.legal.print')"
				icon="i-ph-printer"
				color="neutral"
				variant="outline"
				size="sm"
				@click="print"
			/>
		</div>

		<div v-if="isLoading" class="flex flex-col gap-3" aria-busy="true">
			<USkeleton class="h-8 w-1/2" />
			<USkeleton class="h-4 w-1/3" />
			<USkeleton class="h-96 w-full rounded-xl" />
		</div>

		<DmsCard v-else-if="loadError">
			<DmsEmptyState
				variant="error"
				:title="$t('saas.public.legal.load_error')"
				:description="loadError"
				:actions="[
					{
						label: $t('saas.public.common.retry'),
						icon: 'i-ph-arrows-clockwise',
						onClick: loadDocument,
					},
				]"
			/>
		</DmsCard>

		<PublicStage
			v-else-if="!legalDocument"
			icon="i-ph-file-dashed"
			tone="neutral"
			:eyebrow="
				$t('saas.public.legal.eyebrow', { document: $t(current.labelKey) })
			"
			:title="$t('saas.public.legal.unavailable.title')"
			:description="$t('saas.public.legal.unavailable.description')"
		>
			<UButton
				:to="backTo"
				:label="$t('saas.public.legal.back')"
				icon="i-ph-arrow-left"
				class="mt-5 justify-center"
				block
			/>
			<p class="text-muted mt-4 text-center text-[13px]">
				{{ $t('saas.public.legal.other_documents') }}
				<template v-for="(entry, index) in related" :key="entry.field">
					<span v-if="index > 0">·</span>
					<DmsLink :to="entry.path" class="text-primary">
						{{ $t(entry.labelKey) }}
					</DmsLink>
				</template>
			</p>
		</PublicStage>

		<div v-else class="grid gap-6 lg:grid-cols-[1fr_240px]">
			<article class="flex min-w-0 flex-col gap-5">
				<header>
					<DmsEyebrow
						as="span"
						tone="primary"
						:label="$t('saas.public.legal.eyebrow_short')"
					/>
					<h1
						class="text-highlighted mt-1 text-3xl font-[650] tracking-[-0.025em]"
					>
						{{ $t(current.labelKey) }}
					</h1>
					<p v-if="metaLine" class="text-muted mt-2 text-[13px]">
						{{ metaLine }}
					</p>
				</header>
				<DmsCard>
					<!-- Written by the platform admin in Billing rules & legal. -->
					<!-- eslint-disable-next-line vue/no-v-html -->
					<div
						class="prose prose-neutral dark:prose-invert max-w-none"
						v-html="legalDocument.html"
					/>
				</DmsCard>
				<p v-if="stamp?.version && stamp.updatedAt" class="text-muted text-xs">
					{{
						$t('saas.public.legal.effective', {
							version: String(stamp.version),
							date: formatDate(stamp.updatedAt),
						})
					}}
				</p>
			</article>

			<aside
				class="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start print:hidden"
			>
				<DmsCard
					v-if="legalDocument.headings.length"
					:title="$t('saas.public.legal.contents')"
				>
					<nav :aria-label="$t('saas.public.legal.contents')">
						<ol class="flex flex-col gap-1.5 text-[13px]">
							<li
								v-for="heading in legalDocument.headings"
								:key="heading.id"
								:class="heading.level > 2 ? 'ps-3' : ''"
							>
								<a
									:href="`#${heading.id}`"
									class="text-muted hover:text-highlighted"
								>
									{{ heading.text }}
								</a>
							</li>
						</ol>
					</nav>
				</DmsCard>
				<DmsCard :title="$t('saas.public.legal.related')" :padded="false">
					<DmsListRow
						v-for="entry in related"
						:key="entry.field"
						:to="entry.path"
						icon="i-ph-file-text"
						size="sm"
						:title="$t(entry.labelKey)"
						:description="relatedMeta(entry.field) ?? $t(entry.summaryKey)"
					/>
				</DmsCard>
			</aside>
		</div>
	</div>
</template>
