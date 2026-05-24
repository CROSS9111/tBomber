import TerserPlugin from 'terser-webpack-plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

      // ブラウザバンドルから Node ビルトインを除外
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        http: false,
        https: false,
      };

      // phaser3-rex-plugins は実行時に `Phaser.GameObjects.X.prototype` を拡張するため、
      // ミニファイ (特に SWC のマングリング) で名前空間参照が壊れる。
      // クライアントバンドルの JS ミニファイを Terser に差し替え、rex を minify 除外して保護する。
      // (旧 `swcMinify:false` の代替。Next15+ で swcMinify オプションは削除され SWC minify が
      //  強制されるため、webpack の minimizer を明示的に上書きする恒久対策。)
      config.optimization.minimizer = [
        new TerserPlugin({ exclude: /phaser3-rex-plugins/ }),
        // CSS のミニファイは温存する
        ...(config.optimization.minimizer ?? []).filter(
          (m) => m && m.constructor && m.constructor.name === 'CssMinimizerPlugin',
        ),
      ];
    }
    return config;
  },
};

export default nextConfig;
