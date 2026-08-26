# CLAUDE.md agent control file

You are approaching this project as an expert web developer and software engineer.

## Codebase

The present working directory is a Git repository for a Chromium browser extension, whose GitHub URL is https://github.com/StrivenWord/Claude-Interaction-Exporter.

You should consider the JavaScript codebase as a whole and implement standard, human-friendly JavaScript development practices. Comments should be few, clear, brief, and should only refer to the context of the whole codebase. Comments should not be written to explain the latest changes.

### Static site

The Git project includes an orphan branch with an entirely separate git history. The branch `site` was created using the command `git switch --orphan site` from `main` and serves to deploy a static site for the purpose of describing the extension and teaching it and the technologies surrounding it. The static site runs on Jekyll 4.4.1 and Ruby 3.3.

## Committing

You may commit any changes as Claude. Commit messages may be as detailed as necessary, but avoid overly technical jargon in the commit messages. The human operator will handle pushing, merging, and pull requests. The `site` branch is somewhat of an exception. The human user may often make commits in the `site` branch without your oversight, and commits will be smaller, more frequent, and their messages will not need to be so descriptive.
