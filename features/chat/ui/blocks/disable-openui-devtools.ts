/**
 * @openuidev/react-lang auto-mounts a development inspector by importing its
 * browser bundle from jsDelivr. Keep chat rendering self-contained: generated
 * answers and parser events stay inside BetterShape, with renderer
 * observability explicitly disabled in OpenUIBlock.
 *
 * The flag is read by react-lang's web entry during module evaluation, so this
 * side effect must run before that package is imported.
 */
const runtimeProcess = Reflect.get(globalThis, "process");
if (runtimeProcess && typeof runtimeProcess === "object") {
    const runtimeEnv = Reflect.get(runtimeProcess, "env");
    if (runtimeEnv && typeof runtimeEnv === "object") {
        Reflect.set(runtimeEnv, "OPENUI_TELEMETRY_DISABLED", "1");
    }
}
Reflect.set(globalThis, Symbol.for("openui.devtools.autoMount"), true);
