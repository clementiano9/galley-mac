# Third-party notices

Galley is MIT licensed (see [LICENSE](LICENSE)). It ships the following third-party
code, each under its own license.

## Vendored in `app/js/vendor/`

| Library | Version | License | Copyright |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT | (c) 2018-2026 MarkedJS; (c) 2011-2018 Christopher Jeffrey |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | Apache-2.0 or MPL-2.0 | (c) Cure53 and other contributors |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 11.15.0 | MIT | (c) 2014-2022 Knut Sveidqvist |

The full license texts are in each project's repository, linked above. marked and
DOMPurify keep their license headers in the vendored files. The Mermaid bundle includes
its own dependencies, such as DOMPurify 3.4.0, with their license headers intact.

## Rust crates in the native app

The macOS binary statically links about 240 crates, chiefly
[Tauri](https://github.com/tauri-apps/tauri) (Apache-2.0 or MIT). All are under
permissive or file-level licenses: MIT, Apache-2.0, Zlib, BSD-3-Clause, Unicode-3.0,
Unlicense, CC0-1.0, 0BSD, and MPL-2.0 for five crates used unmodified (`selectors`,
`cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`). The complete list, with
each crate's license, comes from:

```bash
cd tauri-app/src-tauri && cargo metadata --format-version 1
```
