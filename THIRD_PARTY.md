# Third-party notices

decision-tree is released under the MIT license (see [LICENSE](LICENSE)). It contains no code, theme files, images or
logos from any project below.

The color schemes in the picker (press `c` in the pane, or run `/decide colors`) are **sets of seven accent colors**
taken from color themes that people already know from their editors and terminals, so that the pane can be drawn in a
palette they like. Only the hex values of those seven colors are used, written into
[`lib/palettes.ts`](lib/palettes.ts). A color value is a fact about a theme rather than a creative work, and every theme
below is open source; they are credited here anyway, so that you can follow a scheme back to where it comes from.

The names of the schemes are the themes' own names, used only to say which palette a scheme follows. None of these
projects made, endorses or is affiliated with decision-tree. The names and marks belong to their owners.

| Scheme in the picker | Colors follow | License of that project |
| --- | --- | --- |
| One Dark, One Light | The One Dark and One Light syntax themes of the Atom editor ([atom/atom](https://github.com/atom/atom), `packages/one-dark-syntax` and `packages/one-light-syntax`), by GitHub | MIT |
| Nord | The [Nord](https://www.nordtheme.com/docs/colors-and-palettes) palette (`nord8` to `nord15`), © 2016-present Sven Greb (Arctic Ice Studio) | MIT |
| Gruvbox Dark, Gruvbox Light | [Gruvbox](https://github.com/morhetz/gruvbox), by morhetz: the bright accents for dark, the faded accents for light | MIT/X11 |
| Dracula | The [Dracula](https://draculatheme.com/spec) palette, by Zeno Rocha and the Dracula Theme contributors | MIT |
| Tokyo Night, Tokyo Night Day | The *night* and *day* styles of [tokyonight.nvim](https://github.com/folke/tokyonight.nvim) by Folke Lemaitre, which follow the [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) theme for VS Code by enkia | Apache-2.0 (tokyonight.nvim), MIT (Tokyo Night for VS Code) |
| Catppuccin Mocha, Catppuccin Latte | The [Catppuccin](https://github.com/catppuccin/catppuccin) palette, flavors *Mocha* and *Latte*, © 2022-present Catppuccin Org | MIT |
| Solarized | [Solarized](https://ethanschoonover.com/solarized/) by Ethan Schoonover (one set of accents for dark and light) | MIT |
| Monokai | The *Monokai* scheme of the [Base16](https://github.com/tinted-theming/schemes) collection, after the Monokai theme by Wimer Hazenberg (monokai.nl) | MIT |
| GitHub Dark, GitHub Light | The colors of GitHub's [Primer](https://primer.style/) system as used by the [GitHub themes for VS Code](https://github.com/primer/github-vscode-theme), published by GitHub | MIT |
| Terminal, Theme | No colors of their own: *Terminal* leaves the 16 colors to your terminal's own theme, and *Theme* follows the theme of Claude Code | — |

The seven colors of each scheme, in the order red, orange, yellow, green, cyan, blue, purple, are listed in
`lib/palettes.ts`. Where a theme has no color for a slot, the nearest color of the theme is used; for example Dracula's
purple is the scheme's blue and its pink the scheme's purple. The colors follow the ones the themes publish (rounded to a
hex value where a theme gives them as hue, saturation and lightness); a scheme is a reading of a theme, not the theme
itself. If a value is off from the theme it names, please open an issue and it will be corrected.

## The licenses

Every project above except tokyonight.nvim publishes the colors under the **MIT license**, whose text is:

```
MIT License

Copyright (c) the authors named above

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**tokyonight.nvim** is licensed under the Apache License, Version 2.0, © Folke Lemaitre. You may obtain a copy of the
license at <https://www.apache.org/licenses/LICENSE-2.0>. Nothing of the project is included here but seven color
values per style, and no file of it has been changed because none is present.

The licenses are those the projects state on their own pages; if you find one that has changed or a notice that is
missing, please open an issue and it will be put right.
