/* =========================================================================
 * config.js — Firebase config for live multi-phone sync (optional).
 *
 * The app works fully offline using this device's storage. To let everyone
 * score on their own phone against ONE shared live leaderboard:
 *
 *   1. Create a free project at https://console.firebase.google.com
 *   2. Add a Web app (</>) and copy its firebaseConfig values below.
 *   3. In the console: Build → Realtime Database → Create Database
 *      (start in TEST mode for the trip).
 *   4. Commit & host (GitHub Pages). Everyone who opens the link with the
 *      same trip id shares live scores.
 *
 * Until real values are filled in, the app stays local-only on each device.
 * The Firebase web config is NOT a secret — it's safe to commit.
 * ========================================================================= */

export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  databaseURL: 'REPLACE_ME', // e.g. https://your-project-default-rtdb.firebaseio.com
  projectId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

// Shared trip id — everyone on the same id shares the same live data.
// Override per device/trip by adding ?trip=some-id to the URL.
export const DEFAULT_TRIP_ID = 'guys-golf-trip-2026';

export function isFirebaseConfigured() {
  return !!firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes('REPLACE_ME');
}
