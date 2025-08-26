/* eslint-env node */
/** @type {import('eslint').Linter.Config} */
module.exports = {
	root: true,
	env: { browser: true, node: true, es2022: true },
	overrides: [
		{
			files: ["**/*.{ts,tsx}"],
			plugins: ["unused-imports", "import"],
			extends: [
				"plugin:@next/next/core-web-vitals",
				"eslint:recommended",
				"plugin:import/recommended",
				"plugin:import/typescript",
				"prettier",
			],
			rules: {
				"@next/next/no-html-link-for-pages": "off",
				"import/no-unresolved": "off",
				"unused-imports/no-unused-imports": "error",
				"no-console": ["warn", { allow: ["warn", "error"] }],
			},
		},
	],
};


