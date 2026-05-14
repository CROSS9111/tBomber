/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint は別 step (`pnpm lint`) で実施するのでビルド中の lint はスキップ。
  eslint: { ignoreDuringBuilds: true },
  // Phaser / rex プラグインはランタイムで `Phaser.GameObjects.X.prototype` を
  // 拡張するため、SWC のスコープホイスト/ミニファイで構造が壊れる。
  // ミニファイを無効化することで本番ビルドでも動作させる (バンドルサイズは増える)。
  swcMinify: false,
  webpack: (config, { isServer }) => {
    // timesync の dist 版は require('promise') を含むが、
    // モダン環境では window.Promise を使うので解決を抑止する。
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      promise: false,
    };

    if (!isServer) {
      // Phaser は CDN から window.Phaser として読み込むので webpack バンドルから除外する
      config.externals = config.externals || [];
      config.externals.push({ phaser: 'Phaser' });
    }

    if (!isServer) {
      // ブラウザバンドルから Node ビルトインを除外
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        http: false,
        https: false,
      };
    }
    return config;
  },
};

export default nextConfig;
