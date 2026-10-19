#!/bin/sh
# Install the pre-commit hook that runs the gate.
cd "$(dirname "$0")/.." || exit 1
printf '#!/bin/sh\nexec bun run gate\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
