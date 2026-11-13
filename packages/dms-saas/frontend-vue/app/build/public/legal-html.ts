import { h, type VNodeChild } from 'vue'

type ElementProps = Record<string, string | number | Record<string, string>>

/** Reads one attribute of an allowed element into props, or leaves it out. */
type AttributeReader = (element: Element, props: ElementProps) => void

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const RELATIVE_BASE = 'https://relative.invalid/'
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])
const NEW_TAB = '_blank'
const NEW_TAB_REL = 'noopener noreferrer'
const LIST_START = /^-?\d+$/

function hasAllowedScheme(href: string): boolean {
	try {
		return ALLOWED_SCHEMES.has(new URL(href, RELATIVE_BASE).protocol)
	} catch {
		return false
	}
}

/**
 * Whether a link target is safe to follow: a relative address or one of the
 * allowed schemes. The scheme is read by the URL parser the browser follows
 * the link with, from the value the page carries and from that value with
 * every leading and trailing space removed, so no space hides a scheme.
 */
function isSafeHref(href: string): boolean {
	return hasAllowedScheme(href) && hasAllowedScheme(href.trim())
}

const readHref: AttributeReader = (element, props) => {
	const href = element.getAttribute('href')
	if (href !== null && isSafeHref(href)) props.href = href
}

const readTarget: AttributeReader = (element, props) => {
	if (element.getAttribute('target') !== NEW_TAB) return
	props.target = NEW_TAB
	props.rel = NEW_TAB_REL
}

const readStart: AttributeReader = (element, props) => {
	const start = element.getAttribute('start')
	if (start !== null && LIST_START.test(start)) props.start = Number(start)
}

const readTextAlign: AttributeReader = (element, props) => {
	const textAlign =
		element instanceof HTMLElement ? element.style.textAlign : ''
	if (TEXT_ALIGNMENTS.has(textAlign)) props.style = { textAlign }
}

const readId: AttributeReader = (element, props) => {
	if (element.id) props.id = element.id
}

/** Headings the contents link to keep the anchor id the outline gives them. */
const ANCHORED_HEADING_READERS = [readTextAlign, readId]

/**
 * The elements a legal document may render, each with the attributes it
 * keeps: what the DMS rich text editor writes. Any other attribute, event
 * handlers and inline styles included, is dropped.
 */
const ALLOWED_ELEMENTS = new Map<string, readonly AttributeReader[]>([
	['p', [readTextAlign]],
	['h1', ANCHORED_HEADING_READERS],
	['h2', ANCHORED_HEADING_READERS],
	['h3', ANCHORED_HEADING_READERS],
	['h4', [readTextAlign]],
	['h5', [readTextAlign]],
	['h6', [readTextAlign]],
	['strong', []],
	['b', []],
	['em', []],
	['i', []],
	['u', []],
	['s', []],
	['code', []],
	['pre', []],
	['blockquote', []],
	['ul', []],
	['ol', [readStart]],
	['li', []],
	['br', []],
	['hr', []],
	['a', [readHref, readTarget]],
])

/**
 * Elements dropped with everything inside them. Any other element not
 * allowed is unwrapped: its text and allowed children still render.
 */
const DROPPED_ELEMENTS = new Set([
	'script',
	'style',
	'template',
	'noscript',
	'iframe',
	'object',
	'embed',
	'svg',
	'math',
])

/**
 * Parses a stored legal document, without the elements dropped with their
 * content, so the headings found in it are the ones the page shows.
 *
 * @param html Stored document
 */
export function parseLegalDocument(html: string): HTMLElement {
	const { body } = new DOMParser().parseFromString(html, 'text/html')
	for (const dropped of body.querySelectorAll(
		[...DROPPED_ELEMENTS].join(','),
	)) {
		dropped.remove()
	}
	return body
}

function renderNode(node: Node): VNodeChild[] {
	if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? '']
	if (!(node instanceof Element)) return []
	const tag = node.localName
	if (DROPPED_ELEMENTS.has(tag)) return []
	const children = renderAllowedHtml(node)
	const readers = ALLOWED_ELEMENTS.get(tag)
	if (!readers) return children
	const props: ElementProps = {}
	for (const read of readers) read(node, props)
	return [h(tag, props, children)]
}

/**
 * Renders the children of a parsed HTML document as Vue nodes, keeping only
 * the allowed elements and attributes: no markup reaches the page as HTML,
 * so a script, an event handler or a `javascript:` link never runs.
 *
 * @param parent Parsed node whose children to render
 */
export function renderAllowedHtml(parent: ParentNode): VNodeChild[] {
	return [...parent.childNodes].flatMap(renderNode)
}
