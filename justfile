sync-fork:
    git fetch upstream
    git checkout feat/non-interactive
    git rebase upstream/main
    git push --force-with-lease origin feat/non-interactive
