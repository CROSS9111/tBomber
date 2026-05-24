import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';

// Next.js 16 で `next lint` が廃止されたため ESLint CLI + flat config へ移行。
// eslint-config-next@16 はネイティブ flat config を直接エクスポートする
// (FlatCompat 経由は循環参照で動かない)。旧 .eslintrc.json の構成を踏襲し、
// next/core-web-vitals + prettier のみ (next/typescript は旧構成に無いので含めない)。
const eslintConfig = [
  {
    ignores: ['.next/', 'dist/', 'node_modules/', 'public/'],
  },
  // 旧構成 (ESLint 8) は未使用の eslint-disable を報告しなかった。
  // ESLint 9 は既定で warn にするため、挙動を合わせて off にする。
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  ...nextCoreWebVitals,
  prettier,
  {
    rules: {
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default eslintConfig;
