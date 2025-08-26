/* eslint-env node */
/** @type {import('eslint').Linter.Config} */
module.exports = {
	root: true,
	env: { browser: true, node: true, es2022: true },
	parser: "@typescript-eslint/parser",
	plugins: ["@typescript-eslint", "import"],
	extends: [
		"next/core-web-vitals",
		"eslint:recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:import/recommended",
		"plugin:import/typescript",
		"prettier",
	],
	rules: {
		"@next/next/no-html-link-for-pages": "off",
		"import/no-unresolved": "off",
		"no-undef": "off",
		"no-unused-vars": "off",
		"@typescript-eslint/no-unused-vars": [
			"warn",
			{ args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true },
		],
		"@typescript-eslint/no-explicit-any": "off",
		"@typescript-eslint/no-namespace": "off",
		"react/no-unescaped-entities": "off",
		"no-console": ["warn", { allow: ["warn", "error"] }],
	},
};


