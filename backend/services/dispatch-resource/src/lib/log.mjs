export function log(level, message, meta = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...meta }));
}
