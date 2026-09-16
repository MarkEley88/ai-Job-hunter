// Dedicated live route so the frontend uses a freshly deployed Vercel function.
// Keep the implementation in jobs.js to avoid maintaining two search engines.
module.exports = require('./jobs.js');
