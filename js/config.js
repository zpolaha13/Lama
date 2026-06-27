/* =========================================================================
 * config.js — App + Firebase configuration.
 *
 * LIVE SYNC SETUP (optional — app works offline without it):
 *   1. Go to https://console.firebase.google.com and create a free project.
 *   2. Add a "Web app" (</> icon). Copy the firebaseConfig object it shows.
 *   3. Paste the values below, replacing the REPLACE_ME placeholders.
 *   4. In the console, open "Realtime Database" -> Create Database
 *      (start in TEST mode for the trip; rules can be locked later).
 *   5. Commit & host (GitHub Pages works great). Everyone who opens the
 *      page with the same TRIP_ID sees live scores.
 *
 * Until a real config is provided, the app stores everything locally in the
 * browser (localStorage) so you can build out the trip immediately.
 * ========================================================================= */

window.APP_CONFIG = {
  // Shared trip id — everyone using the same id shares the same live data.
  // Change it per trip, or append ?trip=myid to the URL to override.
  TRIP_ID: 'guys-golf-trip-2026',

  // Paste your Firebase web config here to enable real-time sync.
  firebase: {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME',
    databaseURL: 'REPLACE_ME', // e.g. https://your-project-default-rtdb.firebaseio.com
    projectId: 'REPLACE_ME',
    appId: 'REPLACE_ME',
  },
};

window.APP_CONFIG.firebaseEnabled = (function () {
  const f = window.APP_CONFIG.firebase;
  return f && f.apiKey && f.apiKey !== 'REPLACE_ME' && f.databaseURL && f.databaseURL !== 'REPLACE_ME';
})();
