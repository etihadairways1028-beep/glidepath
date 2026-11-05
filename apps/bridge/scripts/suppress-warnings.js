// Injected at the very top of the bundled Bridge (before node:sqlite loads):
// hides Node's one-line "SQLite is an experimental feature" notice, which is
// expected and only confuses users. All other warnings still print.
const __gpEmit = process.emitWarning.bind(process);
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === "string" ? w : w && w.message;
  if (msg && msg.includes("SQLite is an experimental feature")) return;
  return __gpEmit(w, ...rest);
};
