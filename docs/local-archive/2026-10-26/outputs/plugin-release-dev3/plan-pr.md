Pin the pending dev plugin publication to source `5c44877c13618905cc85b820e21a8fd51a1d3684` and publishing PR #69. The immutable `dev.3` plan selects all nine core and 45 optional packages, explicitly excluding `sesame/kurumi-replay`.

Both archives were built from the committed full source locks with the existing deterministic builder. Core bytes match dev.2; the optional archive contains seven updated packages and three new packages. The final dev-to-main head still requires the completed separate-agent review and trusted pre-merge semantic gate before publication.
