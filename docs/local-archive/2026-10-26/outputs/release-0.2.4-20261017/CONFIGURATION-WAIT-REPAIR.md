# Configuration integration wait repair

The Windows CI failure occurs in configuration.ask's fixed 20-second completed-only poll. It has no final-state evidence and does not prove a configuration behavior failure. Do not remove configuration coverage or change runtime behavior.

Initialize the SDK session before sending the configuration request, then observe completed/interrupted/canceled with a local 60-second integration timeout. A real non-completed terminal state must fail immediately with status/stage/error context. Wait for pending configuration cleanup separately. Preserve all language, dialog, deferred model update and lock assertions.

The two request-based tests have a 180-second whole-test deadlock guard and use test.after disposal so a timeout also releases their fixture. Keep the global eventually timeout and CI platform selection unchanged. Directly invoking pump was rejected on review because the store removes its entry before configuration flushing finishes.

Run the complete configuration test file on Windows and inspect the exact diff. Independent review verifies terminal-state handling and cleanup behavior before the next native release build.
