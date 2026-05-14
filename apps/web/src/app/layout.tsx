import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'ボムボムパニック',
  description: '無料でボン○ーマン風なゲームをマルチプレイで遊ぼう！',
  openGraph: {
    title: 'ボムボムパニック',
    description: '無料でボン○ーマン風なゲームをマルチプレイで遊ぼう！',
    type: 'website',
  },
  icons: {
    icon: '/favicon/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#18181b',
          fontFamily: "'PressStart2P'",
        }}
      >
        {/* Phaser を CDN からグローバルロードする。webpack に Phaser をバンドルさせると
            Next.js のプロダクション最適化で phaser3-rex-plugins の名前空間参照が壊れるため。
            strategy="beforeInteractive" でゲームコード (CSR) より前に確実にロード。 */}
        <Script
          src="https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
