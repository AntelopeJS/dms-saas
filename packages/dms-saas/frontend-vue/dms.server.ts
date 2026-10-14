import { defineDmsServer } from '#dms/server'
import { LEGAL_DOCUMENTS } from './app/build/public/routes'

// The legal pages hold no visitor data and load their text in the browser:
// a shared cache in front of the frontend server may keep them a few minutes
// for visitors without any cookie. Every other request stays private.
const LEGAL_PAGE_CACHE = {
	public: true,
	maxAge: 300,
	staleWhileRevalidate: 3600,
} as const

export default defineDmsServer((server) => {
	server.registerRouteRules(
		Object.fromEntries(
			LEGAL_DOCUMENTS.map((document) => [
				document.path,
				{ cache: LEGAL_PAGE_CACHE },
			]),
		),
	)
})
