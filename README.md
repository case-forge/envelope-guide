# Envelope Guide

Puts the address block of a letter where a window envelope expects it. It is a web page with a live preview that makes the sheet as a PDF (or prints it), and a command line tool that makes the same sheet from a JSON request. Everything is drawn on your own device: the page sends nothing anywhere, and the command line tool needs no network.

This repository is refreshed as a whole with each release, so a pull request here is applied by hand rather than merged. The tool is live at https://caseforge.uk/envelope-guide/.

## The envelope presets

An A4 sheet with the masthead, the sender line, the addressee placed so it shows through the window, and optional fold and window guides. Envelope makers vary by a few millimetres, so the only reliable check is the envelope in your hand.

| Id | Envelope | Fold | Window |
| --- | --- | --- | --- |
| `dl-din-5008-b` | DL, DIN 5008 Form B | Tri-fold (three panels) | 20 mm across, 45 mm down, 85 × 45 mm |
| `dl-din-5008-a` | DL, DIN 5008 Form A | Tri-fold (three panels) | 20 mm across, 27 mm down, 85 × 45 mm |
| `dl-uk` | DL, UK Common | Tri-fold (three panels) | 20 mm across, 47 mm down, 90 × 40 mm |
| `c5` | C5 (162 × 229 mm) | Half-fold | 20 mm across, 42 mm down, 90 × 40 mm |
| `c4` | C4 (229 × 324 mm) | Unfolded | 20 mm across, 55 mm down, 90 × 40 mm |

The default is `dl-din-5008-b`. DIN 5008 has two address field positions, and the standard's own names for them are the other way round from how many templates label them: Form B puts the field 45 mm down (the common one, and this tool's default), Form A puts it 27 mm down for a shorter letterhead. The UK and ISO presets have no standard behind them (the UK has none), so the addressee sits 9.5 mm into the window, which leaves room for a sheet that rides a little high. The sender line sits inside the window above the address with a rule under it.

Text that Helvetica cannot draw (Welsh, Polish, Turkish and similar letters) is drawn in Liberation Sans (SIL Open Font License), fetched only when needed. A character no font has is replaced by `?` and reported, never dropped silently.

## Running the site

You need Hugo (extended, 0.165 or later) and Node 22 or later.

```sh
npm ci            # the one dev dependency the tests use
hugo server       # the site at http://localhost:1313/
npm run build     # hugo, then the offline service worker: the site is in public/
```

The site must be served at the root of its own host name, because it addresses its scripts and styles as `/js/...`, `/css/...` and `/vendor/...`. Set the address with `--baseURL` when you build. `static/_headers` carries the Content-Security-Policy the tool is built for (no inline script or style, nothing from another host); Cloudflare Pages and Netlify read it as it is, and any other host should send the same headers.

Offline mode: the service worker `sw.js` stores the page, its scripts, the libraries and the fonts on first visit, so the tool opens and works with the network off. It updates when the site does and never reloads on its own. `?nosw=1` on the address removes the worker and its caches in that browser; setting `enabled = false` under `[params.offline]` in `hugo.toml` removes it for everyone on the next deploy.

## The command line tool

```sh
node envelope-guide-cli/cli.mjs --help
node envelope-guide-cli/cli.mjs request.json sheet.pdf
node envelope-guide-cli/cli.mjs --json batch.json ./sheets/      # a JSON array: one PDF per request
cat request.json | node envelope-guide-cli/cli.mjs --json - sheet.pdf
```

A request is a small JSON object: the envelope id, the firm name, strapline, sender line, addressee, footer, an accent colour, an optional logo, and whether to draw the guides. `--help` lists every field with its limits, `--help envelopes` the presets, `--help errors` every error code, and `--schema` prints the JSON Schema (`envelope-guide-cli/request.schema.json`). With `--json` the standard output is exactly one JSON object and nothing else.

Exit codes: 0 done, 1 the build failed, 2 wrong command line, 3 the input was rejected. In a batch each request is reported on its own, a bad one does not stop the others, and the exit code is 3 if any failed. Installed as a package the command is `envelope-guide` (`bin` in `package.json`).

**Stability.** Within a major version of the tool these do not change: the arguments, the four exit codes, the meaning of `--json`, `--version` and `--schema`, the field names and types in the success and error objects, the request fields and their limits, and the error `code` strings. New fields, new codes and new presets may appear. The PDF bytes may differ between versions; the drawn sheet (the place, size and text of every element) does not. The full contract is in `envelope-guide-cli/README.md`.

## Tests

`npm test` runs the browser modules and the command line tool under Node. The tests that read PDF text or pixels use `pdftotext` and `pdftoppm` when they are installed and skip themselves when they are not.

## Licence

The code is under the Mozilla Public License 2.0 (`LICENSE`). Third party components are listed in `NOTICE`, with the full text of each licence in `THIRD-PARTY-LICENSES/`. The CaseForge name and mark are not covered by that licence.
