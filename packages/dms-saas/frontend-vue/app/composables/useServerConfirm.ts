/**
 * Asks a confirmation the server words (what a DMS action's `confirm: { from }`
 * fetches) for a button the DMS does not draw itself: the dialog's texts are
 * worded with its params and `onConfirm` runs from inside it. Resolves whether
 * the user confirmed; a dialog that cannot be fetched rejects.
 */
export function useServerConfirm() {
	const { $authFetch } = useAuthFetch()
	const { processI18n } = useTranslation()
	const { confirm } = useConfirm()

	function word(
		text: string | undefined,
		params: Record<string, unknown>,
	): string | undefined {
		return text ? processI18n(text, params) : undefined
	}

	async function confirmFrom(
		url: string,
		onConfirm: () => Promise<unknown>,
	): Promise<boolean> {
		const dialog = await $authFetch<ConfirmDialog>(url)
		const params = dialog.params ?? {}
		return confirm({
			title: processI18n(dialog.title, params),
			description: word(dialog.description, params),
			icon: dialog.icon,
			color: dialog.color,
			confirmLabel: word(dialog.confirmLabel, params),
			cancelLabel: word(dialog.cancelLabel, params),
			blocked: dialog.blocked,
			impact: dialog.impact?.map((entry) => ({
				...entry,
				label: processI18n(entry.label, params),
			})),
			onConfirm: async () => {
				await onConfirm()
			},
		})
	}

	return { confirmFrom }
}
