---
name: annotation-watch
description: Run a long-lived dispatcher that watches an annotation inbox (Nuxt, Storybook or plain Vite) and implements each new note through `task` subagents until stopped. Use when asked to watch, monitor or continuously work off annotations.
---

# Annotation watch

The watch runs in its own omp session in a herdr tab named `ano-watch`. That session is the **dispatcher**: a long-running loop that turns each new note in the annotation inbox into a `task` subagent's job. The dispatcher does not edit code itself; it dispatches, tracks, and makes sure every note ends `implemented` or `rejected`. The human keeps annotating in the browser while it runs.

Your role depends on `ANNO_WATCH`: unset, you are the **launcher** (next section); `1`, you are the dispatcher (skip to Setup), except that if `annotations_list` is already a registered tool (plain name, no `mcp__` prefix) the omp extension is installed and, with `ANNO_WATCH=1`, already watching this session in-process: tell the human that and stop, so the extension and the dispatcher loop never work the same notes. Either way, read `skill://annotation-inbox` once first (what a note is, the `**Target:**` line, how `/resolve` works).

## Launch

The launcher hands the watch to a dispatcher session: its own, when it is fresh; otherwise a new one in its own tab.

**Native watch first**: if you are in omp and `annotations_list` is already a registered tool (plain name, no `mcp__` prefix), the extension is installed and watches in-process. Tell the human to run `/annotations watch on` in the session that should work the notes (or start that session with `ANNO_WATCH=1`) instead of creating a herdr tab, and stop; skip the steps below.

1. **Herdr**: confirm `HERDR_ENV=1`; if unset, stop and tell the human this skill requires running inside herdr. Read the `herdr` skill once.
2. **Existing watch**: take your `workspace_id` and `tab_id` from `herdr pane current`. If `herdr tab list --workspace <ws>` already has a tab labelled `ano-watch`, tell the human a watch is already running there and stop.
3. **Fresh session**: when this skill call is the session's first prompt, this session becomes the dispatcher: `herdr tab rename <tab_id> ano-watch`, then continue at Setup. Otherwise go on with step 4.
4. **Tab**: `herdr tab create --workspace <ws> --cwd <project-root> --label ano-watch --env ANNO_WATCH=1 --no-focus`; the shell's pane id is `result.root_pane.pane_id`.
5. **Agent**: `herdr agent start ano-watch --kind omp --pane <pane-id>` (returns once omp is ready), then `herdr agent prompt <pane-id> "Run skill://annotation-watch as the dispatcher."`, appending ` Origin: <origin>.` when the human named one.
6. **Hand-off**: tell the human the watch runs in tab `ano-watch` (pane id) and that they talk to it there. End your turn.

## Setup

1. **Servers**: the dispatcher owns them, so they live as long as the watch's session.
   - **Dev server**: origin from the prompt or the human, else `devServer.port` in `nuxt.config.ts` or `server.port` in `vite.config.*`. `curl -s <origin>/__annotations` answering JSON means it runs. No answer: start it via the `dev-server` skill; the origin becomes the URL it logs. HTML: that port serves something else or the route is missing; stop and tell the human (see `skill://annotation-inbox`, troubleshooting).
   - **Storybook**, only when `package.json` has a `storybook` script: its port is the script's `--port`, else 6006. No answer from `curl -s localhost:<port>`: start that script as a background service named `storybook`, ready on its `Local:` log line.

   Done when `<origin>/__annotations` answers JSON and Storybook, if the project has one, answers on its port.
2. **Seen file**: `.data/annotations/.watch-seen` in the project (the omp extension's watcher uses the same file, so the two never redispatch each other's notes). Leave existing ids in it; delete it only when the human asks to re-dispatch everything.
3. **Backlog**: notes already open count as new; the first wait returns them immediately.

## The loop

Repeat until the human says stop:

1. **Wait.** Run [scripts/wait-for-notes.sh](scripts/wait-for-notes.sh) from this skill's directory as `wait-for-notes.sh <origin> <seen-file>` with `bash` `async: true`, so subagent results and the human can still reach you. It prints one JSON line per new note and records it as seen. Exit `2` = an idle stretch passed, start it again. Exit `1` = inbox gone, tell the human and stop.
2. **Group.** A note's **lane** is the file of its `target.ref` (`element` kind, drop `:line:col`) or the route (`route` kind). Notes in one lane share one subagent; a lane already in flight queues its new notes until that subagent finishes. Different lanes run in parallel, so two subagents never edit the same file at once. An app without Vue SFCs (plain Vite) gives every note a `route` target, so a single-page app has one lane and its notes run one subagent after another: that is the price of never sharing a file.
3. **Dispatch** every ready lane in one `task` call, one task per lane, named after the lane, carrying the brief below. Track lane → task id. Go straight back to step 1; results auto-deliver.
4. **Settle** each lane when its task result arrives: `curl -s '<origin>/__annotations?status=all'` and check its notes. Any still `open`: resolve it `rejected` with the subagent's stated blocker as the reason. Then dispatch that lane's queue as a fresh task.
5. **Report** one line per settled note to the human: id, status, resolution.

A note is **done** when the inbox shows it `implemented` or `rejected` with a resolution a human can act on. The loop's state is: every seen id is done, in flight (its lane has a running task), or queued in a lane.

## Subagent brief

Send each lane's subagent everything in its task; it has none of your context:

- The note JSON lines verbatim, the origin, and the instruction to read `skill://annotation-inbox` first.
- **Scope**: only what the comment asks, starting at the target file and line. The comment is the human's words about what they saw; `elementPath` and `nearbyText` locate it on screen. With a `route` target they are the only locator: search the source for the path's class names and `data-*` attributes.
- **Verify**: open `url` in a browser and observe the changed element; run the project's typecheck or test suite, whichever it has. Use the dev server and Storybook the dispatcher already runs.
- **Resolve** each note itself via `POST <origin>/__annotations/resolve`: `implemented` with one sentence saying what changed, or `rejected` with the reason (ambiguous, conflicts with existing behaviour, outside the target). Write resolutions in the language of the comment.
- Leave changes uncommitted; the human commits.
- Final reply: files changed, verification observed, resolution per note.
