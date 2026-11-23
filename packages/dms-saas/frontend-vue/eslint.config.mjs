import { antelopeNuxtConfig } from '@antelopejs/tooling-configs/eslint'

export default antelopeNuxtConfig({
	typeAware: { tsconfigRootDir: import.meta.dirname },
})
