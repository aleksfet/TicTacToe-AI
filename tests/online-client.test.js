// Tests for the lazy Supabase connection in src/online-client.js and the
// public settings in src/online-config.js. No network: a fake Supabase
// library stands in for supabase-js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const OnlineClient = require("../src/online-client.js");
const config = require("../src/online-config.js");

const TEST_CONFIG = { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "sb_publishable_test" };

// supabase-js auth errors are Error objects with an HTTP status
// (AuthApiError, AuthRetryableFetchError).
function authError(status, message) {
  return Object.assign(new Error(message), { status });
}

// A stand-in for supabase-js that records what it was asked to do.
//   savedUser: an identity already stored in the browser (or null)
//   getUserError: what the server says when that identity is checked
function fakeSupabase({ savedUser = null, getUserError = null, signInError = null } = {}) {
  const calls = { loadLibrary: 0, createClient: [], getSession: 0, getUser: 0, signInAnonymously: 0, signOut: [] };
  let stored = savedUser ? { user: savedUser, access_token: "saved-token" } : null;
  let created = 0;

  const auth = {
    async getSession() {
      calls.getSession++;
      return { data: { session: stored }, error: null };
    },
    async getUser() {
      calls.getUser++;
      if (getUserError) {
        return { data: { user: null }, error: getUserError };
      }
      return { data: { user: stored.user }, error: null };
    },
    async signInAnonymously() {
      calls.signInAnonymously++;
      await new Promise((resolve) => setTimeout(resolve, 10)); // like a real request
      if (signInError) {
        return { data: { user: null, session: null }, error: signInError };
      }
      created++;
      const user = { id: `anon-user-${created}`, is_anonymous: true };
      stored = { user, access_token: `token-${created}` }; // supabase-js saves it
      getUserError = null;
      return { data: { user, session: stored }, error: null };
    },
    async signOut(options) {
      calls.signOut.push(options);
      stored = null;
      return { error: null };
    },
  };

  const library = {
    createClient(url, key, options) {
      calls.createClient.push({ url, key, options });
      return { auth };
    },
  };
  const loadLibrary = async () => {
    calls.loadLibrary++;
    return library;
  };
  return { calls, loadLibrary };
}

// --- Lazy client --------------------------------------------------------------

test("creating a connection does nothing until the client is asked for", () => {
  const fake = fakeSupabase();
  OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  assert.equal(fake.calls.loadLibrary, 0);
  assert.equal(fake.calls.createClient.length, 0);
});

test("getSupabaseClient loads the library once and reuses one client", async () => {
  const fake = fakeSupabase();
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const [a, b] = await Promise.all([connection.getSupabaseClient(), connection.getSupabaseClient()]);
  const c = await connection.getSupabaseClient();
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(fake.calls.loadLibrary, 1);
  assert.equal(fake.calls.createClient.length, 1);
});

test("the client uses the project URL, the publishable key and browser session settings", async () => {
  const fake = fakeSupabase();
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  await connection.getSupabaseClient();
  const { url, key, options } = fake.calls.createClient[0];
  assert.equal(url, TEST_CONFIG.supabaseUrl);
  assert.equal(key, TEST_CONFIG.supabasePublishableKey);
  assert.deepEqual(options, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
});

test("if loading the library fails, a later call tries again", async () => {
  const fake = fakeSupabase();
  let failNext = true;
  const loadLibrary = async () => {
    if (failNext) {
      failNext = false;
      throw new Error("SUPABASE_LIBRARY_UNAVAILABLE");
    }
    return fake.loadLibrary();
  };
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary });
  await assert.rejects(connection.getSupabaseClient(), /SUPABASE_LIBRARY_UNAVAILABLE/);
  const client = await connection.getSupabaseClient();
  assert.ok(client.auth);
});

// --- Anonymous session -------------------------------------------------------------

test("first time: signs in anonymously once", async () => {
  const fake = fakeSupabase();
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const result = await connection.ensureAnonymousSession();
  assert.equal(result.created, true);
  assert.equal(result.user.id, "anon-user-1");
  assert.ok(result.session);
  assert.ok(result.client);
  assert.equal(fake.calls.signInAnonymously, 1);
});

test("an identity saved earlier is reused, not replaced", async () => {
  const fake = fakeSupabase({ savedUser: { id: "returning-player", is_anonymous: true } });
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const result = await connection.ensureAnonymousSession();
  assert.equal(result.created, false);
  assert.equal(result.user.id, "returning-player");
  assert.equal(fake.calls.getUser, 1, "the saved identity is checked with the server");
  assert.equal(fake.calls.signInAnonymously, 0);
});

test("later calls reuse the identity created by the first call", async () => {
  const fake = fakeSupabase();
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const first = await connection.ensureAnonymousSession();
  const second = await connection.ensureAnonymousSession();
  assert.equal(second.created, false);
  assert.equal(second.user.id, first.user.id);
  assert.equal(fake.calls.signInAnonymously, 1);
});

test("calls made at the same moment create only one anonymous user", async () => {
  const fake = fakeSupabase();
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const results = await Promise.all([
    connection.ensureAnonymousSession(),
    connection.ensureAnonymousSession(),
    connection.ensureAnonymousSession(),
  ]);
  assert.equal(fake.calls.signInAnonymously, 1);
  assert.equal(new Set(results.map((r) => r.user.id)).size, 1);
});

test("a saved identity the server rejects is replaced with a new one", async () => {
  const fake = fakeSupabase({
    savedUser: { id: "deleted-player" },
    getUserError: authError(403, "User from sub claim in JWT does not exist"),
  });
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  const result = await connection.ensureAnonymousSession();
  assert.equal(result.created, true);
  assert.equal(result.user.id, "anon-user-1");
  assert.deepEqual(fake.calls.signOut, [{ scope: "local" }], "only this device forgets the old identity");
});

test("when the identity cannot be checked (offline), no new user is created", async () => {
  const fake = fakeSupabase({
    savedUser: { id: "returning-player" },
    getUserError: authError(0, "Failed to fetch"),
  });
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  await assert.rejects(connection.ensureAnonymousSession(), /Failed to fetch/);
  assert.equal(fake.calls.signInAnonymously, 0);
  assert.equal(fake.calls.signOut.length, 0);
});

test("a failed anonymous sign-in is reported, and a later call can try again", async () => {
  const fake = fakeSupabase({ signInError: authError(429, "Request rate limit reached") });
  const connection = OnlineClient.createConnection({ config: TEST_CONFIG, loadLibrary: fake.loadLibrary });
  await assert.rejects(connection.ensureAnonymousSession(), /rate limit/);
  await assert.rejects(connection.ensureAnonymousSession(), /rate limit/);
  assert.equal(fake.calls.signInAnonymously, 2, "the failed attempt is not cached");
});

// --- The page's default connection and the public settings ------------------------------

test("loading the module in Node does not connect; the default connection fails cleanly without a browser", async () => {
  await assert.rejects(OnlineClient.getSupabaseClient(), /SUPABASE_LIBRARY_UNAVAILABLE/);
});

test("supabase-js is pinned to an exact version with an integrity hash", () => {
  assert.match(OnlineClient.SUPABASE_JS_VERSION, /^2\.\d+\.\d+$/);
  assert.ok(OnlineClient.SUPABASE_JS_URL.startsWith("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + OnlineClient.SUPABASE_JS_VERSION + "/"));
  assert.match(OnlineClient.SUPABASE_JS_INTEGRITY, /^sha384-[A-Za-z0-9+/]{64}$/);
});

test("the browser config holds only the public project URL and publishable key", () => {
  assert.deepEqual(Object.keys(config).sort(), ["supabasePublishableKey", "supabaseUrl"]);
  assert.match(config.supabaseUrl, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.match(config.supabasePublishableKey, /^sb_publishable_[A-Za-z0-9_-]+$/);
  assert.ok(Object.isFrozen(config));
});

test("no browser file contains a secret Supabase key or server-only credential", () => {
  const root = path.join(__dirname, "..");
  const files = ["index.html", "script.js", ...fs.readdirSync(path.join(root, "src")).map((f) => path.join("src", f))];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9]/, `${file} contains a secret key`);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, `${file} contains a JWT`);
    assert.doesNotMatch(text, /postgres(ql)?:\/\/[^\s"']+/, `${file} contains a database connection string`);
  }
});
