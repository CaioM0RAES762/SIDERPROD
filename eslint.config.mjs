import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // A base de interface veio de um sistema escrito antes do React Compiler.
      // As regras abaixo apontam padrões legítimos de melhoria (setState dentro
      // de efeito, componentes declarados em render, memoização manual), mas
      // corrigi-las exigiria reescrever telas inteiras — fora do escopo desta
      // versão pública. Ficam como aviso, visíveis no `npm run lint`, em vez de
      // erro que trava o build.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/exhaustive-deps": "warn",

      // Os adaptadores de API herdados usam `any` em vários pontos de fronteira.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // A camada de demonstração é código novo: aqui as regras valem por inteiro.
    files: ["lib/demo/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
]

export default config
