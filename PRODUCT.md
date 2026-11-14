# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One developer or ops engineer, alone at their own machine, working against one to a few Redis
instances at a time — usually a production instance sitting next to a local one. They keep the
tool open beside an editor for most of a working day and come back to it dozens of times: to
check whether a deploy shifted throughput, to read the value behind a slow key, to run one
`INFO`/`SCAN`/`HGETALL` and get on with the actual work.

Their expertise is the constraint that matters: they already know Redis, they know `SCAN` is not
`KEYS`, and they do not need the interface to teach them the protocol. What they need is to
reach the right key or the right number in as few steps as possible and to be sure they are
looking at the instance and database they think they are.

## Product Purpose

A desktop client for Redis: save and switch connections, browse the keyspace, read values of
every Redis type, run commands, and watch server health — without leaving the desktop and
without the tab/window shuffle of the CLI.

Success is a cheap visit: the user opens it, gets the answer, and closes it. Failures look like
mistaken context (wrong instance, wrong DB), a value they cannot read, or a metric that made
them hunt elsewhere.

## Positioning

One window that holds several Redis instances side by side, each with its own database selection,
live health, keyspace and command history — and never loses track of *which* instance the current
view belongs to. Not a protocol playground; a working surface over the instances the user already
operates.

## Operating Context

- Desktop app (Go service behind a Web frontend, packaged with MyGo). A browser-only preview mode
  (`dev:web?preview=1`) must keep working for screenshots and design iteration.
- Instances are organised in user-named groups (Production / Staging / Local), colour is available
  per connection, and read-only connections and a CLI read-only default are real safety
  affordances the user relies on against production.
- Typical sessions mix all six workflows: overview → keys → CLI → monitor, plus occasional
  connection editing and settings.
- Chinese UI copy; identifiers, keys, commands and Redis values stay in their native form.
- Window sizes range from a 1280-wide laptop up to a wide external display; keyboard path
  (⌘K palette, ⌘1–4, ⌘T, ⌘,) is used by the same people who type commands by hand.

## Capabilities and Constraints

Capabilities that must survive any redesign: connection CRUD with groups, standalone / sentinel /
cluster modes, ACL user, TLS, read-only; per-connection database selection; SCAN-based key browsing
with pattern, type filter, prefix grouping and cursor paging; typed value display for string, hash,
list, set, zset and stream; string display modes raw / JSON / Hex / HTML preview / Markdown preview;
hash field write and key delete; multi-session CLI with history, completion and read-only mode
(`KEYS` is intercepted in favour of `SCAN`); overview metrics (throughput, clients, memory, latency,
hit rate, keyspace distribution, command stats, derived advisories); monitor (slowlog, clients,
replication, INFO); ⌘K command palette; shortcuts; remembered preferences; desktop update
notification.

Constraints: no backend behaviour changes; the Web frontend has no framework (vanilla TS rendering
HTML strings); the Go bindings in `src/mygo.ts` are generated and must not be edited by hand.

## Brand Commitments

Name: Redis Manager. UI language: Chinese. No external brand identity is binding; the user has
confirmed a single visual direction — calm, restrained developer-tool character — replacing the
previous four-theme catalogue.

## Evidence on Hand

`scripts/preview-mock.js` is the fixture that makes every screen renderable without a live Redis:
four grouped connections, a realistic keyspace, hash/list/set/zset/stream values, command stats,
keyspace distribution and INFO. It is demonstration data and must stay labelled preview-only.
Real product truth lives in `README.md`, `docs/*.md`, and the Go service.

## Product Principles

1. Context first: which instance, which database, and its health are always answerable in one
   glance, and no destructive action can happen without that context being visible.
2. Reachability over ceremony: the keyboard path and the one-click path to keys, values and
   commands both stay short; nothing the user does daily should sit behind a menu.
3. Show the real data: values are shown as the server holds them (encoding, TTL, size), not
   prettified into a summary that hides the thing being debugged.
4. Quiet against a long session: density earns its place, and decoration must never compete with
   the number or the key the user is reading.
5. Reorganise, don't amputate: existing capabilities stay; their placement is what changes.

## Accessibility & Inclusion

Keyboard-operable everything that already is (palette, shortcuts, CLI, scan) must remain so.
Text/background contrast for body text and identifiers must hold in both light and dark schemes;
status must never be conveyed by colour alone.
