// 旧 backend/src/index.ts はカスタムサーバー (apps/web/server.ts) に移動。
// ここでは既存コードが import する設定値だけを再エクスポートする。

export const IS_BACKEND_DEBUG = process.env.NODE_ENV !== 'production';
