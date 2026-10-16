// Tic Tac Toe AI - online connection (Supabase)
//
// Everything that talks to Supabase starts here. Two rules:
//
//   1. Lazy: nothing is downloaded, no connection is made and no identity is
//      created until online play actually asks for it. Playing against the
//      computer or on the same device never touches Supabase.
//
//   2. Invisible identity: there are no accounts. The first time a person
//      plays online, ensureAnonymousSession() quietly signs them in as an
//      anonymous Supabase user. The browser remembers that identity
//      (localStorage), so a refresh keeps the same player; it is only used so
//      the server can tell the two players of a room apart.
//
// The Supabase library (supabase-js) is loaded on demand from a CDN with a
// pinned version and a Subresource Integrity hash, so the browser refuses the
// file if it was ever altered.
//
// In the browser this file defines the global TicTacToeOnlineClient object
// (and needs online-config.js loaded first). In Node it is loaded with
// require("./online-client.js"); the tests use createConnection() with a fake
// Supabase library instead of the network.

const TicTacToeOnlineClient = ((config) => {
  const SUPABASE_JS_VERSION = "2.117.2";
  const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + SUPABASE_JS_VERSION + "/dist/umd/supabase.js";
  const SUPABASE_JS_INTEGRITY = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

  // Browser session settings:
  //   - persistSession: keep the anonymous identity across refreshes;
  //   - autoRefreshToken: renew the login token in the background;
  //   - detectSessionInUrl: off, because we never use email links or OAuth
  //     redirects (and ?room=... must not be mistaken for one).
  const CLIENT_OPTIONS = Object.freeze({
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // --- Loading supabase-js in the browser (only when first needed) ---------

  let libraryPromise = null;

  function loadSupabaseLibrary() {
    if (typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function") {
      return Promise.resolve(window.supabase);
    }
    if (typeof document === "undefined") {
      return Promise.reject(new Error("SUPABASE_LIBRARY_UNAVAILABLE"));
    }
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SUPABASE_JS_URL;
        script.integrity = SUPABASE_JS_INTEGRITY;
        script.crossOrigin = "anonymous";
        script.async = true;
        script.onload = () => {
          if (window.supabase && typeof window.supabase.createClient === "function") {
            resolve(window.supabase);
          } else {
            reject(new Error("SUPABASE_LIBRARY_UNAVAILABLE"));
          }
        };
        script.onerror = () => {
          // Offline, blocked, or the file did not match its integrity hash.
          // Forget the failed attempt so a later try can load it again.
          script.remove();
          libraryPromise = null;
          reject(new Error("SUPABASE_LIBRARY_UNAVAILABLE"));
        };
        document.head.appendChild(script);
      });
    }
    return libraryPromise;
  }

  // An auth error that means "this saved identity is no longer valid" (for
  // example the anonymous user was deleted), as opposed to "the network is
  // down". Only the first kind should lead to a fresh identity.
  function isRejectedIdentity(error) {
    return Boolean(error) && (error.status === 401 || error.status === 403);
  }

  // --- The connection ---------------------------------------------------------

  // Build a connection. options:
  //   config       { supabaseUrl, supabasePublishableKey }
  //   loadLibrary  () => Promise of an object with createClient(url, key, options)
  function createConnection(options) {
    const settings = options.config;
    const loadLibrary = options.loadLibrary;
    let clientPromise = null;
    let sessionInFlight = null;

    // The one Supabase client for this page, created the first time it is
    // needed and then reused.
    function getSupabaseClient() {
      if (!clientPromise) {
        clientPromise = Promise.resolve()
          .then(() => loadLibrary())
          .then((library) => library.createClient(settings.supabaseUrl, settings.supabasePublishableKey, CLIENT_OPTIONS));
        // If loading failed, allow a later call to try again.
        clientPromise.catch(() => {
          clientPromise = null;
        });
      }
      return clientPromise;
    }

    async function findOrCreateSession() {
      const client = await getSupabaseClient();

      // 1. An identity saved by this browser earlier? (No network needed.)
      const saved = await client.auth.getSession();
      if (saved.error) {
        throw saved.error;
      }
      const session = saved.data && saved.data.session;

      if (session) {
        // 2. Confirm with the server that it is still valid.
        const check = await client.auth.getUser();
        if (!check.error && check.data && check.data.user) {
          return { client, user: check.data.user, session, created: false };
        }
        if (!isRejectedIdentity(check.error)) {
          // Probably offline: do NOT create a new identity, just fail.
          throw check.error || new Error("SESSION_CHECK_FAILED");
        }
        // The saved identity was rejected: forget it (on this device only).
        await client.auth.signOut({ scope: "local" });
      }

      // 3. No usable identity: quietly create an anonymous one.
      const created = await client.auth.signInAnonymously();
      if (created.error) {
        throw created.error;
      }
      return { client, user: created.data.user, session: created.data.session, created: true };
    }

    // Make sure this browser has its (invisible) player identity and return
    // { client, user, session, created }. Reuses the saved identity when there
    // is one. Calls made at the same moment share one attempt, so a double
    // click can never create two anonymous users.
    function ensureAnonymousSession() {
      if (!sessionInFlight) {
        sessionInFlight = findOrCreateSession().finally(() => {
          sessionInFlight = null;
        });
      }
      return sessionInFlight;
    }

    return { getSupabaseClient, ensureAnonymousSession };
  }

  // --- The page's own connection ------------------------------------------

  // Created on first use, so merely loading this file does nothing.
  let defaultConnection = null;

  function getDefaultConnection() {
    if (!defaultConnection) {
      defaultConnection = createConnection({ config, loadLibrary: loadSupabaseLibrary });
    }
    return defaultConnection;
  }

  return {
    SUPABASE_JS_VERSION,
    SUPABASE_JS_URL,
    SUPABASE_JS_INTEGRITY,
    CLIENT_OPTIONS,
    createConnection,
    getSupabaseClient: () => getDefaultConnection().getSupabaseClient(),
    ensureAnonymousSession: () => getDefaultConnection().ensureAnonymousSession(),
  };
})(typeof module !== "undefined" && module.exports ? require("./online-config.js") : TicTacToeOnlineConfig);

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeOnlineClient;
}
