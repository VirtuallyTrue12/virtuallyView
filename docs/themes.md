# Themes

A theme is a folder with two files. Bundled themes live in `themes/`; themes you import or create in the app are stored in the data folder under `custom-themes/`.

```
my-theme/
  theme.json    name, id, author, description, categories
  tokens.json   the values
```

`theme.json`:

```json
{
  "name": "Midnight",
  "id": "midnight",
  "version": "2.0.0",
  "author": "You",
  "description": "Deep navy with frosted glass panels.",
  "engine": "1.x",
  "license": "MIT",
  "categories": ["dark", "glass"]
}
```

`categories` must include `dark` or `light`. It decides which slot the theme fills when a device follows the system setting.

## tokens.json

Required groups: `colors`, `radius`, `animation`. Optional: `typography`, `density`, `effects`. Every value is a plain string. Values may not reference other variables (`var(...)`).

| Group | Keys |
| --- | --- |
| `colors` | `background`, `surface`, `surfaceElevated`, `surfaceOverlay`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `accentSoft`, `border`, `borderFocus`, `success`, `warning`, `danger` |
| `radius` | `small`, `medium`, `large` |
| `animation` | `fast`, `normal`, `slow` |
| `typography` | `fontFamily`, `headingFamily`, `headingWeight`, `bodyWeight`, `letterSpacing` |
| `density` | `xs`, `sm`, `md`, `lg`, `xl`, `xxl` (spacing) |
| `effects` | `shadowMedium`, `shadowLarge`, `glow`, `blurMedium`, `blurLarge`, `backdrop`, `buttonRadius`, `buttonTransform`, `buttonWeight`, `buttonTracking`, `cardHover` |

`effects` is what makes a theme look different beyond colour. `backdrop` is a CSS gradient painted behind the whole app, `blurMedium` and `blurLarge` control frosted panels, `buttonRadius` and `buttonTransform` set the button shape, and `cardHover` is the transform applied to a poster on hover. Effect values may not contain `url(`, `;`, braces, `@` or the word `import`.

The accent contrast colour (text on accent buttons) is worked out from `accent`; you do not set it.

## Making one

Use the Theme Creator (Appearance > Create theme). It builds a full token set from three colours plus shape, type, depth and background choices, shows a live preview, and saves it to the server. You can also download the file and import it on another server. Removing a custom theme is done from the Appearance page.

## How it is applied

The server flattens `tokens.json` into CSS custom properties (see `packages/themes/src/theme-engine.ts`). The web app sets them on the root element, so every component that reads a variable follows the theme. Each device keeps its own mode (System, Light, Dark) and the theme used for light and dark. The server only stores a default for devices that have not chosen.

## Look-alike themes

Netflix style, Apple TV style and Prime Video style copy the general look of those apps: colours, corner shapes, button style, navigation and hover behaviour. They use no logos, fonts or other assets from those companies, they fall back to common system fonts, and they are unofficial and not affiliated with anyone. A theme changes how virtuallyView looks, not how it is laid out, so the page structure stays the same.
