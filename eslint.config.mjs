import javascript from "@eslint/js";
import globals from "globals";
import typescript from "typescript-eslint";

export default typescript.config(
    { ignores: ["**/dist/**", "node_modules/**", "coverage/**"] },
    javascript.configs.recommended,
    ...typescript.configs.recommended,
    {
        files: ["**/*.mjs", "**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            }
        },
        rules: {
            "no-trailing-spaces": "error",
            "eol-last": ["error", "always"],
            "no-multiple-empty-lines": ["error", { max: 1 }],
        },
    },
);
