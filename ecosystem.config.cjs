// PM2 process config for running the app on a VPS.
// Single instance, fork mode (not cluster) — one Node process, predictable.
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (to survive reboots)
module.exports = {
  apps: [
    {
      name: 'lcasaoui',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Other env vars (DATABASE_URL, SESSION_SECRET, PORT, SEED_ADMIN_*) come from
      // the project .env via src/lib/loadenv.js. On a VPS you do NOT need
      // UV_THREADPOOL_SIZE / connection_limit (those were shared-hosting workarounds).
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
