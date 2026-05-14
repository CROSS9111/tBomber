'use client';

import { useEffect, useRef } from 'react';

export default function PhaserMount() {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    // Phaser は layout.tsx の <Script strategy="beforeInteractive"> で
    // CDN ロード済み。ゲームコードはここで CSR でのみ動的読み込み。
    void import('@game/PhaserGame');
  }, []);

  return <div id="phaser-game" />;
}
