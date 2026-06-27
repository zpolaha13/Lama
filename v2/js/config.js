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
  apiKey: 'AIzaSyDFtQFRlDgWxmHcMzepngW6iPbYXrlpwKA',
  authDomain: 'lama-df58d.firebaseapp.com',
  // Standard US default URL for this project. If your Realtime Database is in a
  // different region, it will look like:
  //   https://lama-df58d-default-rtdb.<region>.firebasedatabase.app
  // Confirm the exact URL on the Realtime Database page and update if needed.
  databaseURL: 'https://lama-df58d-default-rtdb.firebaseio.com',
  projectId: 'lama-df58d',
  storageBucket: 'lama-df58d.firebasestorage.app',
  messagingSenderId: '183025731838',
  appId: '1:183025731838:web:a11cdb3fc80ed6a8befdaf',
};

// Shared trip id — everyone on the same id shares the same live data.
// Override per device/trip by adding ?trip=some-id to the URL.
export const DEFAULT_TRIP_ID = 'guys-golf-trip-2026';

export function isFirebaseConfigured() {
  return !!firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes('REPLACE_ME');
}
