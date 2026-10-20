# Room Card

A compact, highly configurable Home Assistant dashboard card that summarises a room (or several rooms) at a glance: temperature and humidity, lights, security, blinds, media players, vacuum, smart sockets and cameras. Generated with Claude. Please review all code before using!

- Visual editor with every option, no YAML required
- Auto-discovers entities from one or more **areas**, or pick them by hand
- Horizontal and vertical layouts, with an optional condensed single panel
- Per-panel tap actions, icon colours, show/hide and drag-to-reorder
- Optional room image as a faded background, with hover effect
- Fixed card height, room icon watermark, adjustable title size and panel opacity

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=brianq-prog&repository=lovelace-room-card&category=plugin)

1. In Home Assistant open **HACS**, choose the three-dot menu, then **Custom repositories**.
2. Paste `https://github.com/brianq-prog/lovelace-room-card`, set the category to **Dashboard**, and select **Add**.
3. Find **Room Card** in HACS and select **Download**.
4. Hard-refresh your browser (Ctrl+Shift+R) or fully restart the mobile app.

HACS adds the dashboard resource for you. If you previously added `/local/room-card.js` by hand, remove that resource.

### Manual

1. Copy `dist/room-card.js` to `/config/www/room-card.js`.
2. Add a resource: **Settings → Dashboards → ⋮ → Resources**, URL `/local/room-card.js`, type **JavaScript module**.

## Usage

Add the card from the card picker ("Room Card") and use the visual editor, or use YAML:

```yaml
type: custom:room-card
name: Living Room
areas: [living_room, kitchen]
layout: vertical
condense: true
condense_lines: 2
panel_order: [lights, temperature, security, media, blinds, vacuum, sockets, camera]
temperature_min: 17
temperature_max: 26
warn_when_open: true
background_image: true
image: /local/rooms/living.jpg
background_opacity: 25
background_hover_boost: 10
lights_tap_action:
  action: toggle
thumbnail_tap_action:
  action: navigate
  navigation_path: /lovelace/living-room
```

## Options

### Room and appearance

| Option | Default | Description |
| --- | --- | --- |
| `name` | area name(s) | Room title. |
| `areas` | none | One or more areas. Their entities are discovered automatically. The older single `area` still works. |
| `image` | area picture | Image URL, for example `/local/rooms/living.jpg`. |
| `icon` | area icon, then sofa | Room icon. Used for the corner watermark and as the thumbnail when there's no image. |
| `layout` | `horizontal` | `horizontal` (panels below) or `vertical` (title above thumbnail, panels stacked on the right). |
| `condense` | `false` | Combine all info panels into one panel. |
| `condense_lines` | `1` horizontal, `2` vertical | Rows (horizontal) or columns (vertical) in the condensed panel. |
| `card_height` | `0` | Exact card height in px. `0` sizes automatically. Content that doesn't fit is clipped. |
| `title_size` | `18` | Room title font size in px. |
| `panel_opacity` | `100` | Opacity of the info panel backgrounds, 0 to 100. |
| `panel_order` | see below | List of panel keys in display order. Missing panels follow in the default order. |
| `show_thumbnail` | `true` | Show or hide the thumbnail. |
| `background_image` | `false` | Fade the room image into the card background. |
| `background_opacity` | `25` | Background image opacity, 0 to 100. |
| `background_hover_boost` | `10` | Percentage points added to the background opacity on mouse hover. `0` disables. |
| `show_room_icon` | `true` | Show the room icon watermark in the bottom left. |
| `room_icon_opacity` | `15` | Watermark opacity, 0 to 100. |
| `room_icon_size` | `80` | Watermark size in px. |
| `status_ok_text` | none | Text shown under the title when all is well. Empty shows nothing. |

Default panel order: `temperature`, `lights`, `security`, `blinds`, `media`, `vacuum`, `sockets`, `camera`.

### Entities

Anything you set here overrides auto-discovery for that panel.

| Option | Description |
| --- | --- |
| `temperature_entity`, `humidity_entity` | One or more sensors. Several are averaged. With several areas, one sensor per area is used. |
| `lights` | Light entities. Shows how many are on. |
| `doors`, `windows` | Binary sensors. |
| `alarm_entities` | Alarm panels and safety sensors (smoke, CO, gas, moisture). A triggered one turns the status red. |
| `blinds` | Cover entities. Shows how many are open. |
| `media_player`, `media_name` | One or more media players, and the label shown (for example `TV`). |
| `vacuums` | Vacuum entities. |
| `sockets` | Switch entities (auto-discovery only finds switches with the `outlet` device class). |
| `cameras` | Camera entities. |
| `exclude_entities` | Entities to ignore during auto-discovery. |
| `temperature_min`, `temperature_max` | Turn the status amber when a reading crosses a limit. |
| `temperature_decimals` | Decimal places for temperature (default `1`). |
| `warn_when_open` | Turn the status amber when a door or window is open. |

### Show or hide a panel

`show_temperature`, `show_lights`, `show_security`, `show_blinds`, `show_media`, `show_vacuum`, `show_sockets`, `show_camera` (all default `true`). A hidden panel still feeds the status line, so alarms aren't missed.

### Icon colours

`temperature_color`, `lights_color`, `security_color`, `blinds_color`, `media_color`, `vacuum_color`, `sockets_color`, `camera_color`. Each accepts `[r, g, b]`, a hex value, or a Home Assistant theme colour name such as `amber`. The colour applies while the panel is active. Warnings (amber) and alarms (red) override it.

### Tap actions

`thumbnail_tap_action`, `temperature_tap_action`, `lights_tap_action`, `security_tap_action`, `blinds_tap_action`, `media_tap_action`, `vacuum_tap_action`, `sockets_tap_action`, `camera_tap_action`.

They accept the standard action options: `more-info`, `toggle`, `navigate`, `url`, `perform-action` and `none`. Panels default to `more-info`, and the thumbnail defaults to `none`.

`toggle` switches every entity in the panel (all lights, all blinds open or closed, all sockets, start or return for vacuums).

### Theme variables

Set these in a theme to restyle every card:

`--room-card-temperature-color`, `--room-card-lights-color`, `--room-card-security-color`, `--room-card-blinds-color`, `--room-card-media-color`, `--room-card-vacuum-color`, `--room-card-sockets-color`, `--room-card-camera-color`, `--room-card-off-color`, `--room-card-icon-size` (default `15px`), `--room-card-thumb-size` (default `64px`), `--room-card-thumb-size-vertical` (default `104px`), `--room-card-room-icon-color`.

## License

MIT
