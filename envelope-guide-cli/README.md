# Envelope Guide CLI

`cli.mjs` makes the Envelope Guide sheet as a PDF from a JSON request: an A4 page with the masthead, the sender line, the address block placed so it shows through the chosen window envelope, and an optional footer. It calls the same `makeLetterhead()` as the browser page (`static/js/envelope-guide/envelope.js`), so the sheet is the one the page would give for the same input. No browser, no server. It needs Node 22 or later.

```sh
node envelope-guide-cli/cli.mjs [--json] [--strict] [--base-dir <dir>] <request.json | -> <output>
node envelope-guide-cli/cli.mjs --schema | --version
node envelope-guide-cli/cli.mjs --help [topic]
```

It needs no packages beyond Node and the site's own files. Installed from the package it is the `envelope-guide` command (`bin` in `package.json`). It registers the small Node shim it needs (`node-compat.mjs`, which it shares with BundleTool's command line, as it does the contract helper `cli-contract.mjs`) itself, so no flags are required.

## Built-in help

`envelope-guide` documents itself, so a person or a program needs no other file to use it. `envelope-guide --help` prints a short overview: what the tool does, its options, the inputs it accepts, the exit codes, and examples. `envelope-guide --help <topic>` gives the detail (`request`, `envelopes`, `errors`, `examples`, `schema`). `envelope-guide --schema` prints the JSON Schema, and `envelope-guide --json --help [topic]` returns the same content as one JSON object. The help is generated from the tool's own tables (`envelope-guide-cli/docs.mjs`); this file's tables are generated from the same source and are kept equal to it by hand. Help can be asked for as `--help`, `-h`, `-help`, `-?`, `/?`, `--usage` or the word `help` (`help <topic>` works too); a mistyped option such as `--hewlp` is refused with the nearest real option named.

## The request

`request.schema.json` (JSON Schema, `schemaVersion` 1) is the format. One object writes one PDF at `<output>`, which must end in `.pdf`. A JSON array of objects is a batch: `<output>` is a folder (made if it does not exist) and each request writes its own PDF into it, named by its `output` (a plain name ending in `.pdf`) or else `envelope-001.pdf`, `envelope-002.pdf` and so on by position. There is one PDF per request, never a combined file. `-` reads the request from standard input.

```json
{
  "schemaVersion": 1,
  "envelope": "dl-din-5008-b",
  "firmName": "A. Solicitors",
  "strapline": "Family and children law",
  "senderLine": "A. Solicitors, 1 Example Street, London",
  "addressTo": ["Ms A Sample", "12 Example Road", "London", "E1 1AA"],
  "footerLines": ["Regulated by the SRA"],
  "showGuides": false,
  "accent": "#1a4f8c",
  "logo": { "path": "logo.png", "shape": "circle", "sizeMm": 16 }
}
```

- `envelope`: `dl-din-5008-b` (the default), `dl-din-5008-a`, `dl-uk`, `c5` or `c4`. The older ids `dl-din-a` and `dl-din-b` are accepted with a warning. Any other id is refused.
- `firmName`, `strapline` and `senderLine` are one line each. `addressTo` and `footerLines` are a string with newlines or a list of lines. The limits are the page's: 200, 200, 200, 2000 and 1000 characters. Text over a limit is cut, and a `field_truncated` warning says so.
- `accent` is `#rrggbb`. `showGuides` prints the window outline and full-width fold lines.
- `logo.path` is a PNG or a JPEG of at most 4 MB, read from the base folder (the request file's folder, the current folder for standard input, or `--base-dir`). The contents are sniffed, not the file name. A path that leaves the base folder, by `..`, an absolute path or a symbolic link, is refused. `sizeMm` runs from 8 to 30 and is set to the nearest limit with a warning. A JPEG that carries an EXIF rotation (orientations 2 to 8, mirrored or turned) is drawn upright by a transform, in the square and the circle shape alike, so it needs no canvas and matches the browser's sheet.
- The logo is embedded as it is, never resized or re-encoded, so it looks exactly as supplied. A file over 4 MB is refused (`logo_too_large`), and so is a picture of more than 40 million pixels, judged from its header before anything decodes it (`logo_too_many_pixels`). A logo prints at 30 mm at most, so one of a few hundred kilobytes is plenty; a 3 MB logo gives a sheet of about the same size. (The Envelope Guide page in the browser does shrink a large logo, on a canvas, to 600 pixels on its longest edge: with a 3.2 MB logo the sheet is 86 KB rather than 3.2 MB, with no visible difference at print size. That is the only place a picture is redrawn.)
- Keys not in the schema are refused (`unknown_key`).

Layout problems come back as warnings and, per sheet, in `layout`: `address_too_tall`, `address_too_wide`, `masthead_too_wide`, `footer_too_wide`, `footer_too_tall`, `unprintable_characters` (a character no font has is drawn as `?`), `right_to_left_text` and `logo_scaled` (a large logo made smaller so none of it shows through a high window). With `--strict` every one of these except `logo_scaled` is a failure (`layout_problems`) and nothing is written for that sheet.

Every request field (also `envelope-guide --help request`):

<!-- cli-docs:request -->
| Field | Kind and meaning |
| --- | --- |
| `schemaVersion` | number. Optional. 1. |
| `_comment` | text. Ignored. For your own notes. |
| `output` | file name. Batch only: the name of this sheet's PDF, a plain name ending in .pdf with no folder in front (the folder is the command line's <output>). Left out, sheets are named envelope-001.pdf, envelope-002.pdf and so on. |
| `envelope` | one of dl-din-5008-b, dl-din-5008-a, dl-uk, c5, c4. The window envelope the address is placed for. Default dl-din-5008-b. See --help envelopes. |
| `firmName` | one line of text. The masthead name at the top left, up to 200 characters. |
| `strapline` | one line of text. A line under the firm name, up to 200 characters. |
| `senderLine` | one line of text. The small return address above the window, up to 200 characters. |
| `addressTo` | text or a list of lines. The address for the window, one line per newline or list item, up to 2000 characters. |
| `footerLines` | text or a list of lines. Lines at the foot of the sheet, up to 1000 characters. |
| `showGuides` | true or false. true prints the window outline and full-width fold lines. Default false. |
| `accent` | colour #rrggbb. The colour of the firm name, the rule under the sender line and the guides. Default #1a4f8c. |
| `logo` | object. A logo picture: { path, shape, sizeMm }. |
| `logo.path` | file name. A PNG or JPEG of at most 4 MB and 40 million pixels, inside the base folder (the request file's folder, or --base-dir). Bytes are checked, not the name. Embedded as it is. |
| `logo.shape` | square or circle. square (default) or circle (the logo is cropped to a circle). |
| `logo.sizeMm` | number 8 to 30. The logo's height and width in millimetres. Default 16; outside the range it is clamped with a warning. |
<!-- /cli-docs:request -->

The envelope presets (also `envelope-guide --help envelopes`):

<!-- cli-docs:envelopes -->
| Envelope id | Envelope |
| --- | --- |
| `dl-din-5008-b` | DL, DIN 5008 Form B. Tri-fold (three panels). Window 85 × 45 mm, 45 mm down. The common European window envelope. Address field starts 45 mm down. |
| `dl-din-5008-a` | DL, DIN 5008 Form A. Tri-fold (three panels). Window 85 × 45 mm, 27 mm down. For a shorter letterhead. Address field starts 27 mm down. |
| `dl-uk` | DL, UK Common. Tri-fold (three panels). Window 90 × 40 mm, 47 mm down. The usual UK 110 × 220 mm window position. Not a legal standard (the UK has none), so check against your own stock. Address field starts 47 mm down. |
| `c5` | C5 (162 × 229 mm). Half-fold. Window 90 × 40 mm, 42 mm down. The window sits higher because the sheet is only halved. |
| `c4` | C4 (229 × 324 mm). Unfolded. Window 90 × 40 mm, 55 mm down. The address sits where it falls on the flat sheet. |
<!-- /cli-docs:envelopes -->

## The contract

<!-- cli-docs:exit-codes -->
| Exit code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | The input was fine and the build or the write failed (an unexpected fault). |
| 2 | The command line was wrong. |
| 3 | The input was rejected: the request or manifest, a file it names, or a place to write. |
<!-- /cli-docs:exit-codes -->

With `--json`, stdout holds exactly one JSON object, on success and on failure, and nothing else, and stderr is empty. Without it, a failure is one line on stderr.

```json
{"ok":true,"tool":"envelope-guide-cli","cliVersion":"1.0.0","schemaVersion":1,"mode":"single","output":"/path/o.pdf",
 "bytes":1958,"pages":1,"envelope":"dl-din-5008-b","layout":{"tooTall":false,"maxLines":6,"...":"..."},"warnings":[]}
```

A batch answers `mode: "batch"` with `succeeded`, `failed` and `items`: one entry per request, in order, each `{index, ok, output, bytes, pages, envelope, layout, warnings}` or `{index, ok: false, error: {code, message, path}}`. **A bad request does not stop the batch:** the others are still written, `ok` is false, `error.code` is `items_failed`, and the exit code is 3 (or 1 when only builds failed).

`error.code` is a stable lower case string:

<!-- cli-docs:errors -->
| Error code | Exit | Meaning |
| --- | --- | --- |
| `usage_missing_arguments` | 2 | A required argument is missing. |
| `usage_too_many_arguments` | 2 | More arguments were given than the tool takes. |
| `usage_unknown_option` | 2 | An option the tool does not have (a typo is never taken for a file name). |
| `usage_bad_option` | 2 | An option was given without a value, or with a value it does not take. |
| `usage_unknown_topic` | 2 | `--help` was asked for a topic the tool does not have. |
| `request_not_found` | 3 | The request file could not be read. |
| `request_too_large` | 3 | The request is over 2 MB. |
| `invalid_json` | 3 | The request is not valid JSON. |
| `invalid_request` | 3 | The request is not a JSON object (or a non-empty array of objects for a batch), or a batch has too many items. |
| `unknown_key` | 3 | The request, or its logo object, has a key this version does not know. |
| `unsupported_schema_version` | 3 | schemaVersion is present and is not 1. |
| `unknown_envelope` | 3 | The envelope id is not one of the presets (see --help envelopes). |
| `invalid_field_type` | 3 | A field has the wrong kind of value (a number where text is wanted, and so on). |
| `invalid_field_value` | 3 | A field has a value it may not have (a colour that is not #rrggbb, a logo shape that is not square or circle, a name over one line). |
| `invalid_output_name` | 3 | An output name is not a plain file name ending in .pdf. |
| `duplicate_output` | 3 | Two requests in a batch would write the same file. |
| `base_dir_not_found` | 3 | The base folder for logo paths does not exist. |
| `path_outside_base` | 3 | A logo path climbs out of the base folder, by .., an absolute path or a symbolic link. |
| `logo_not_found` | 3 | The logo file is not there, or is not a file. |
| `logo_too_large` | 3 | The logo file is over 4 MB. |
| `logo_too_many_pixels` | 3 | The logo picture has more pixels than the limit, judged from its header before anything decodes it. |
| `logo_unsupported_type` | 3 | The logo is not a PNG or a JPEG (the file's bytes are checked, not its name). |
| `logo_invalid` | 3 | The logo is damaged or cannot be embedded. |
| `output_dir_missing` | 3 | The folder the output file would go in does not exist. |
| `layout_problems` | 3 | With --strict: the layout has a problem (see the layout warnings) and nothing was written for that sheet. |
| `items_failed` | 3 | A batch: at least one request failed. The others were still written; items[] says which. |
| `build_failed` | 1 | The sheet could not be built, though the request was accepted. |
| `output_write_failed` | 1 | The finished PDF could not be written. |
| `internal_error` | 1 | An unexpected fault in the tool itself (no stack trace is printed). |
<!-- /cli-docs:errors -->

Warnings are `{code, message}` in `warnings`:

<!-- cli-docs:warnings -->
| Warning code | Meaning |
| --- | --- |
| `field_truncated` | A text field was longer than the page allows and was cut (firmName, strapline, senderLine 200; addressTo 2000; footerLines 1000 characters). |
| `legacy_envelope_id` | An old envelope id (dl-din-a, dl-din-b) was accepted and mapped to today's preset. |
| `logo_size_clamped` | logo.sizeMm was outside 8 to 30 mm and was set to the nearest limit. |
| `logo_scaled` | The logo was made smaller so none of it shows through the window. |
| `address_too_tall` | The address has more lines than the window holds. |
| `address_too_wide` | An address or sender line is wider than the window. |
| `masthead_too_wide` | The firm name or strapline runs past the right margin. |
| `footer_too_wide` | A footer line runs past the margins. |
| `footer_too_tall` | The footer has more lines than fit above the printer's dead zone. |
| `unprintable_characters` | No font can draw some characters; each is drawn as ?. |
| `right_to_left_text` | Right-to-left text is drawn left to right, so it prints reversed. |
| `engine_warning` | The PDF engine warned about something. |
<!-- /cli-docs:warnings -->

**Stability.** Within a major version of `cliVersion` these do not change: the two arguments and the options, the four exit codes, the meaning of `--json` and `--version`, the field names and types in the success object, every error code listed above, the request keys and their meaning, the envelope ids, and the naming of batch outputs. New optional request keys, new fields in the JSON, new warning codes and new error codes may appear in a minor version, so a caller matches on the codes it knows and treats the rest by exit code. The bytes of a PDF may differ between versions (the PDF library, the encoder settings); what is drawn does not: the logo's place, shape, size and upright orientation are part of the promise. A change to where the address sits on an envelope preset is a change to the browser page too, and is called out in its version notes.

## Tests

`tests/envelopeCli.test.mjs` runs the CLI as a child process: every preset, every field and its limits, logos accepted and refused, path traversal, batches with a bad item, the JSON shape and exit codes, and a parity check that draws the same input through the CLI and through `makeLetterhead()` and compares the drawing instructions (and the pixels, when poppler is installed). Tests that need `pdftotext` or `pdftoppm` skip themselves without them; poppler is never a dependency.
