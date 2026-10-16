// Tic Tac Toe AI - online multiplayer configuration
//
// These two values identify our Supabase project to the browser. They are
// PUBLIC by design: Supabase "publishable" keys are meant to be shipped in
// browser code, just like a website's address.
//
// They are safe to expose because they grant no special power. What a
// browser can actually do is decided on the server:
//   - Row Level Security lets each player read only the rooms they play in;
//   - browsers cannot write to the games table at all;
//   - every change goes through database functions (RPCs) that check the
//     player and the game rules (supabase/migrations/).
//
// NEVER put a secret key (sb_secret_...), the service_role key, the database
// password or the JWT secret in this file or anywhere in the browser code.
//
// In the browser this file defines the global TicTacToeOnlineConfig object.
// In Node it is loaded with require("./online-config.js").

const TicTacToeOnlineConfig = Object.freeze({
  supabaseUrl: "https://xzsenyfevvpwgdlucgel.supabase.co",
  supabasePublishableKey: "sb_publishable_6MgSSTK-DcUvgGApg1S__A_h97M0L6S",
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = TicTacToeOnlineConfig;
}
