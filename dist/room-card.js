/*!
 * Room Card for Home Assistant  (v2)
 * Header (thumbnail + title + status) with compact panels below:
 * Temperature/Humidity, Lights, Security, Blinds, Media Player.
 *
 * No dependencies. Includes a visual editor. Supports auto-discovery by Area.
 */

const ROOM_CARD_VERSION = "2.6.0";

/* ------------------------------------------------------------------ helpers */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const toArray = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const domainOf = (id) => id.split(".")[0];
const UNAVAILABLE = ["unavailable", "unknown"];
// Default "active" icon colours (as RGB, so the editor's colour picker can show them)
const COLOR_DEFAULTS = {
  temperature_color: [61, 155, 255],
  lights_color: [255, 200, 61],
  security_color: [74, 144, 255],
  blinds_color: [46, 196, 182],
  media_color: [74, 144, 255],
  vacuum_color: [167, 139, 250],
  sockets_color: [52, 211, 153],
  camera_color: [244, 114, 182],
};
const PANELS = ["temperature", "lights", "security", "blinds", "media", "vacuum", "sockets", "camera"];
const PANEL_LABELS = {
  temperature: "Temperature & humidity", lights: "Lights", security: "Security", blinds: "Blinds",
  media: "Media players", vacuum: "Vacuum", sockets: "Smart sockets", camera: "Cameras",
};
/** Saved order first; any panel missing from it follows in the default order. */
const completeOrder = (v) => {
  const o = [...new Set(toArray(v).filter((k) => PANELS.includes(k)))];
  return [...o, ...PANELS.filter((k) => !o.includes(k))];
};
const SHOW_DEFAULTS = Object.fromEntries(PANELS.map((p) => [`show_${p}`, true]));
const DEFAULTS = {
  layout: "horizontal",
  condense: false,
  show_thumbnail: true,
  background_image: false,
  background_opacity: 25,
  background_hover_boost: 10,
  panel_order: PANELS,
  panel_opacity: 100,
  title_size: 18,
  card_height: 0, // 0 = automatic
  show_room_icon: true,
  room_icon_opacity: 15,
  room_icon_size: 80,
  ...SHOW_DEFAULTS,
  ...COLOR_DEFAULTS,
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Rooms the card covers: supports the old single `area` and the new `areas` list. */
const areaIdsOf = (c) => [...new Set([...toArray(c.area), ...toArray(c.areas)])];
/** Default condensed lines: 2 columns when vertical, 1 row when horizontal. */
const condenseDefault = (layout) => (layout === "vertical" ? "2" : "1");

const THEME_COLORS = new Set([
  "primary", "accent", "disabled", "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue",
  "cyan", "teal", "green", "light-green", "lime", "yellow", "amber", "orange", "deep-orange", "brown",
  "light-grey", "grey", "dark-grey", "blue-grey", "black", "white",
]);

/** Accepts [r,g,b], "#hex" / any CSS colour, or an HA theme colour name such as "amber". */
const cssColor = (v) => {
  if (Array.isArray(v) && v.length === 3) return `rgb(${v.map((n) => Math.round(Number(n) || 0)).join(",")})`;
  if (typeof v === "string" && v) return THEME_COLORS.has(v) ? `var(--${v}-color)` : v;
  return null;
};

const alarmActive = (s) =>
  domainOf(s.entity_id) === "alarm_control_panel" ? s.state === "triggered" : s.state === "on";

/* ---------------------------------------------------------------- the card */

class RoomCard extends HTMLElement {
  static async getConfigElement() {
    // Make sure HA has loaded ha-form, entity pickers and the action editor.
    const helpers = await window.loadCardHelpers?.().catch(() => null);
    if (helpers) {
      await Promise.allSettled(
        [
          { type: "entities", entities: [] },
          { type: "tile", entity: "sun.sun" },
        ].map(async (cfg) => {
          const el = await helpers.createCardElement(cfg);
          await el.constructor.getConfigElement?.();
        })
      );
    }
    return document.createElement("room-card-editor");
  }

  static getStubConfig(hass) {
    const area = Object.values(hass?.areas || {})[0];
    return area ? { name: area.name, areas: [area.area_id] } : { name: "Living Room" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${RoomCard.styles}</style>
      <ha-card id="card">
        <div class="bg" id="bg"></div>
        <div class="ri" id="ri"><ha-icon id="rii"></ha-icon></div>
        <div class="wrap" id="wrap"></div>
      </ha-card>`;
    this._wrap = this.shadowRoot.getElementById("wrap");
    this._bg = this.shadowRoot.getElementById("bg");
    this._ri = this.shadowRoot.getElementById("ri");
    this._rii = this.shadowRoot.getElementById("rii");
    this._card = this.shadowRoot.getElementById("card");
    this._wrap.addEventListener("click", (e) => this._onActivate(e));
    this._wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._onActivate(e);
      }
    });
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...config };
    this._res = null;
    this._lastSig = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const res = this._resolve();
    // Only repaint when a relevant entity changed.
    const sig = res.all.map((id) => hass.states[id]);
    const prev = this._lastSig;
    if (!prev || prev.length !== sig.length || sig.some((s, i) => s !== prev[i])) {
      this._lastSig = sig;
      this._render();
    }
  }

  get _vertical() {
    return this._config?.layout === "vertical";
  }

  get _condenseLines() {
    const n = Number(this._config?.condense_lines);
    return n === 1 || n === 2 ? n : Number(condenseDefault(this._config?.layout));
  }

  get _tall() {
    return this._vertical && !(this._config?.condense && this._condenseLines === 2);
  }

  get _fixedHeight() {
    const h = Number(this._config?.card_height);
    return h > 0 ? h : 0;
  }

  getCardSize() {
    return this._fixedHeight ? Math.max(1, Math.round(this._fixedHeight / 50)) : this._tall ? 4 : 3;
  }

  getGridOptions() {
    // With an exact pixel height, let the card size itself instead of snapping to grid rows.
    if (this._fixedHeight) return { columns: 12, rows: "auto", min_columns: 6 };
    return { columns: 12, rows: this._tall ? 4 : 3, min_columns: 6, min_rows: 2 };
  }

  /* ------------------------------------------------------- entity resolving */

  _resolve() {
    const hass = this._hass;
    const c = this._config;
    const regKey = [hass.entities, hass.devices, c];
    if (this._res && this._regKey.every((v, i) => v === regKey[i])) return this._res;
    this._regKey = regKey;

    const states = hass.states;
    const exclude = new Set(toArray(c.exclude_entities));
    const discovered = [];
    const areaOf = {};
    const areaIds = areaIdsOf(c);

    if (areaIds.length && hass.entities) {
      const devices = hass.devices || {};
      for (const [id, ent] of Object.entries(hass.entities)) {
        if (ent.hidden || ent.entity_category || exclude.has(id) || !states[id]) continue;
        const areaId = ent.area_id ?? devices[ent.device_id]?.area_id;
        if (areaId && areaIds.includes(areaId)) {
          discovered.push(id);
          areaOf[id] = areaId;
        }
      }
    }

    const dc = (id) => states[id]?.attributes?.device_class;
    const find = (pred) => discovered.filter(pred);
    const pick = (key, auto) => (c[key] !== undefined ? toArray(c[key]) : auto);
    const bs = (id) => domainOf(id) === "binary_sensor";
    // one sensor per selected room (so several rooms are averaged, not several sensors in one room)
    const firstPerArea = (pred) => areaIds.map((a) => discovered.find((i) => areaOf[i] === a && pred(i))).filter(Boolean);

    const res = {
      temperatures: pick("temperature_entity", firstPerArea((i) => domainOf(i) === "sensor" && dc(i) === "temperature")),
      humidities: pick("humidity_entity", firstPerArea((i) => domainOf(i) === "sensor" && dc(i) === "humidity")),
      lights: pick("lights", find((i) => domainOf(i) === "light")),
      doors: pick("doors", find((i) => bs(i) && ["door", "garage_door"].includes(dc(i)))),
      windows: pick("windows", find((i) => bs(i) && dc(i) === "window")),
      alarms: toArray(
        c.alarm_entities ?? c.alert_entities ??
          find(
            (i) =>
              domainOf(i) === "alarm_control_panel" ||
              (bs(i) && ["smoke", "carbon_monoxide", "gas", "moisture"].includes(dc(i)))
          )
      ),
      blinds: pick(
        "blinds",
        find(
          (i) =>
            domainOf(i) === "cover" &&
            [undefined, "blind", "shade", "shutter", "curtain", "awning", "window"].includes(dc(i))
        )
      ),
      media: pick("media_player", find((i) => domainOf(i) === "media_player")),
      vacuums: pick("vacuums", find((i) => domainOf(i) === "vacuum")),
      sockets: pick("sockets", find((i) => domainOf(i) === "switch" && dc(i) === "outlet")),
      cameras: pick("cameras", find((i) => domainOf(i) === "camera")),
    };
    res.temperature = res.temperatures[0];
    res.humidity = res.humidities[0];
    res.all = [
      ...res.temperatures, ...res.humidities, ...res.media,
      ...res.lights, ...res.doors, ...res.windows, ...res.alarms, ...res.blinds, ...res.vacuums, ...res.sockets, ...res.cameras,
    ].filter(Boolean);
    this._res = res;
    return res;
  }

  /* -------------------------------------------------------------- rendering */

  _render() {
    if (!this._hass || !this._config) return;
    const hass = this._hass;
    const c = this._config;
    const r = this._resolve();
    const S = (id) => hass.states[id];
    const live = (ids) => ids.map(S).filter(Boolean);

    const stats = [];
    const warnings = [];
    const alarmMsgs = [];

    /* 1. Temperature & humidity (averaged when several rooms/sensors) */
    const tSts = live(r.temperatures);
    const hSts = live(r.humidities);
    if (tSts.length || hSts.length) {
      const unitSep = (u) => (u.startsWith("°") || u === "%" ? u : ` ${u}`);
      const stat = (sts) => {
        const v = sts.map((x) => parseFloat(x.state)).filter((n) => !isNaN(n));
        return { v, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN };
      };
      let value, subHtml, tip, cls = "";
      if (tSts.length) {
        const t = stat(tSts);
        const unit = tSts[0].attributes.unit_of_measurement || "°C";
        value = isNaN(t.avg) ? "—" : `${t.avg.toFixed(c.temperature_decimals ?? 1)}${unitSep(unit)}`;
        if (c.temperature_max != null && t.v.some((n) => n > Number(c.temperature_max))) {
          cls = "warn";
          warnings.push("Too warm");
        } else if (c.temperature_min != null && t.v.some((n) => n < Number(c.temperature_min))) {
          cls = "warn";
          warnings.push("Too cold");
        }
        tip = tSts.length > 1 ? `Average temperature ${value} (${tSts.length} sensors)` : `Temperature ${value}`;
        if (hSts.length) {
          const h = stat(hSts);
          const hv = isNaN(h.avg) ? "—" : `${h.avg.toFixed(0)}${unitSep(hSts[0].attributes.unit_of_measurement || "%")}`;
          subHtml = `<ha-icon class="mini" icon="mdi:water-outline"></ha-icon>${esc(hv)}`;
          tip += `, humidity ${hv}`;
        }
      } else {
        const h = stat(hSts);
        value = isNaN(h.avg) ? "—" : `${h.avg.toFixed(0)}${unitSep(hSts[0].attributes.unit_of_measurement || "%")}`;
        tip = hSts.length > 1 ? `Average humidity ${value}` : `Humidity ${value}`;
      }
      stats.push({ key: "temperature", cls, icon: "mdi:thermometer", value, subHtml, tip });
    }

    /* 2. Lights */
    const lights = live(r.lights);
    if (lights.length) {
      const on = lights.filter((s) => s.state === "on").length;
      stats.push({
        key: "lights", cls: on ? "" : "off",
        icon: on ? "mdi:lightbulb-on-outline" : "mdi:lightbulb-outline",
        valueHtml: `${on}<span class="dim">/${lights.length}</span>`,
        tip: `Lights: ${on} of ${lights.length} on`,
      });
    }

    /* 3. Security (doors, windows, alarms) */
    const doors = live(r.doors);
    const wins = live(r.windows);
    const alarms = live(r.alarms);
    if (doors.length || wins.length || alarms.length) {
      const open = [...doors, ...wins].filter((s) => s.state === "on").length;
      const active = alarms.filter(alarmActive);
      active.forEach((s) => alarmMsgs.push(s.attributes.friendly_name || s.entity_id));
      const parts = [];
      if (wins.length) parts.push(`${wins.length}W`);
      if (doors.length) parts.push(`${doors.length}D`);

      let value = parts.join(" ");
      if (!value) {
        const panel = alarms.find((s) => domainOf(s.entity_id) === "alarm_control_panel");
        value = panel
          ? panel.state.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase())
          : "Alarm";
      }
      let cls = "", tip;
      if (active.length) {
        cls = "alarm";
        tip = "Alarm triggered";
      } else if (open) {
        tip = `${open} open`;
        if (c.warn_when_open) {
          cls = "warn";
          warnings.push(open === 1 ? "Door or window open" : `${open} doors/windows open`);
        }
      } else tip = doors.length || wins.length ? "Closed" : "Clear";

      stats.push({
        key: "security", cls, value, tip,
        icon: active.length ? "mdi:shield-alert" : open ? "mdi:shield-off-outline" : "mdi:shield-check-outline",
      });
    }

    /* 4. Blinds */
    const blinds = live(r.blinds);
    if (blinds.length) {
      const open = blinds.filter((s) => ["open", "opening"].includes(s.state)).length;
      stats.push({
        key: "blinds", cls: open ? "" : "off",
        icon: open ? "mdi:blinds-open" : "mdi:blinds",
        valueHtml: `${open}<span class="dim">/${blinds.length}</span>`,
        tip: `Blinds: ${open} of ${blinds.length} open`,
      });
    }

    /* 5. Media players (one or several) */
    const mps = live(r.media);
    if (mps.length) {
      const isOn = (x) => ![...UNAVAILABLE, "off", "standby"].includes(x.state);
      const onList = mps.filter(isOn);
      const on = onList.length > 0;
      const single = mps.length === 1;
      const allSpeakers = mps.every((x) => x.attributes.device_class === "speaker");
      const name = c.media_name || (single ? (allSpeakers ? "Sp." : "TV") : "Media");
      const base = allSpeakers ? "mdi:speaker" : "mdi:television";
      const detail = (x) => x.attributes.source || x.attributes.app_name || x.attributes.media_title;
      stats.push({
        key: "media", cls: on ? "" : "off",
        icon: on ? base : `${base}-off`,
        valueHtml: single
          ? `${esc(name)} ${on ? "On" : "Off"}`
          : `${esc(name)} ${onList.length}<span class="dim">/${mps.length}</span>`,
        tip: !on
          ? single ? `${name} off` : `${name}: all off`
          : single
          ? `${name} on${detail(mps[0]) ? " — " + detail(mps[0]) : ""}`
          : `${name}: ` + onList.map((x) => (x.attributes.friendly_name || x.entity_id) + (detail(x) ? ` (${detail(x)})` : "")).join(", "),
      });
    }

    /* 6. Vacuum */
    const vacs = live(r.vacuums);
    if (vacs.length) {
      const running = vacs.filter((s) => ["cleaning", "returning"].includes(s.state));
      const errors = vacs.filter((s) => s.state === "error");
      const nice = (t) => t.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());
      const entry = { key: "vacuum", cls: errors.length ? "warn" : running.length ? "" : "off" };
      if (vacs.length === 1) {
        entry.value = UNAVAILABLE.includes(vacs[0].state) ? "—" : nice(vacs[0].state);
        entry.tip = `Vacuum: ${entry.value}`;
      } else {
        entry.valueHtml = `${running.length}<span class="dim">/${vacs.length}</span>`;
        entry.tip = `Vacuums: ${running.length} of ${vacs.length} running`;
      }
      entry.icon = errors.length ? "mdi:robot-vacuum-alert" : "mdi:robot-vacuum";
      if (errors.length) warnings.push("Vacuum error");
      stats.push(entry);
    }

    /* 7. Smart sockets */
    const socks = live(r.sockets);
    if (socks.length) {
      const on = socks.filter((s) => s.state === "on").length;
      const entry = { key: "sockets", cls: on ? "" : "off", icon: "mdi:power-socket-uk" };
      if (socks.length === 1) {
        entry.value = on ? "On" : "Off";
        entry.tip = `Socket: ${entry.value}`;
      } else {
        entry.valueHtml = `${on}<span class="dim">/${socks.length}</span>`;
        entry.tip = `Sockets: ${on} of ${socks.length} on`;
      }
      stats.push(entry);
    }

    /* 8. Cameras */
    const cams = live(r.cameras);
    if (cams.length) {
      const active = cams.filter((x) => ["recording", "streaming"].includes(x.state));
      const offline = cams.filter((x) => UNAVAILABLE.includes(x.state));
      const entry = {
        key: "camera",
        cls: offline.length ? "warn" : active.length ? "" : "off",
        icon: offline.length ? "mdi:cctv-off" : "mdi:cctv",
      };
      if (cams.length === 1) {
        const st = cams[0].state;
        entry.value = UNAVAILABLE.includes(st) ? "Offline" : st.replace(/^./, (m) => m.toUpperCase());
        entry.tip = `Camera: ${entry.value}`;
      } else {
        entry.valueHtml = `${active.length}<span class="dim">/${cams.length}</span>`;
        entry.tip = `Cameras: ${active.length} of ${cams.length} recording or streaming${offline.length ? `, ${offline.length} offline` : ""}`;
      }
      if (offline.length) warnings.push(offline.length === 1 ? "Camera offline" : `${offline.length} cameras offline`);
      stats.push(entry);
    }

    /* Panels the user has switched off (status/alerts still account for them), in the chosen order */
    const order = completeOrder(c.panel_order);
    const shown = stats
      .filter((s) => c[`show_${s.key}`] !== false)
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    /* Status line */
    const messages = [...alarmMsgs, ...warnings];
    const level = alarmMsgs.length ? "alarm" : warnings.length ? "warn" : "ok";
    const statusText = !messages.length
      ? c.status_ok_text || ""
      : messages.length === 1
      ? messages[0]
      : `${messages.length} things need attention`;

    /* Header */
    const areaObjs = areaIdsOf(c).map((id) => hass.areas?.[id]).filter(Boolean);
    const name = c.name || areaObjs.map((a) => a.name).join(", ") || "Room";
    const image = c.image || areaObjs.find((a) => a.picture)?.picture;
    const roomIcon = c.icon || areaObjs.find((a) => a.icon)?.icon || "mdi:sofa-outline";
    const showThumb = c.show_thumbnail !== false;
    const thumb = !showThumb
      ? ""
      : image
      ? `<img class="thumb" src="${esc(image)}" alt="" loading="lazy">`
      : `<div class="thumb placeholder"><ha-icon icon="${esc(roomIcon)}"></ha-icon></div>`;
    const headerClickable = this._actionFor("thumbnail").action !== "none";

    /* Background image */
    const bgOn = !!(c.background_image && image);
    this._bg.classList.toggle("on", bgOn);
    if (bgOn) {
      this._bg.style.backgroundImage = `url("${String(image).replace(/"/g, "%22")}")`;
      const op = Math.min(100, Math.max(0, Number(c.background_opacity ?? DEFAULTS.background_opacity) || 0));
      const boost = Math.max(0, Number(c.background_hover_boost ?? DEFAULTS.background_hover_boost) || 0);
      this._bg.style.setProperty("--bg-op", String(op / 100));
      this._bg.style.setProperty("--bg-op-hover", String(Math.min(100, op + boost) / 100));
    }
    this._wrap.classList.toggle("has-bg", bgOn);
    this._wrap.classList.toggle("vertical", this._vertical);
    const clamp = (n, lo, hi, d) => (isNaN(Number(n)) ? d : Math.min(hi, Math.max(lo, Number(n))));
    this._wrap.style.setProperty("--po", String(clamp(c.panel_opacity ?? 100, 0, 100, 100) / 100));
    this._wrap.style.setProperty("--title-size", `${clamp(c.title_size ?? 18, 8, 60, 18)}px`);

    /* Room icon watermark (bottom left) */
    const riOn = c.show_room_icon !== false;
    this._ri.classList.toggle("on", riOn);
    if (riOn) {
      this._rii.setAttribute("icon", roomIcon);
      this._ri.style.setProperty("--mdc-icon-size", `${clamp(c.room_icon_size ?? 80, 16, 400, 80)}px`);
      this._ri.style.opacity = String(clamp(c.room_icon_opacity ?? 15, 0, 100, 15) / 100);
    }

    /* Exact card height */
    this._card.style.height = this._fixedHeight ? `${this._fixedHeight}px` : "";

    this._wrap.innerHTML = `
      <div class="room${headerClickable ? " clickable" : ""}" data-room="1" ${headerClickable ? `role="button" tabindex="0"` : ""}>
        ${thumb}
        <div class="meta">
          <div class="name">${esc(name)}</div>
          ${
            statusText
              ? `<div class="status ${level}" title="${esc(messages.join(", "))}">
            <span class="dot"></span><span class="text">${esc(statusText)}</span>
          </div>`
              : ""
          }
        </div>
      </div>
      ${
        shown.length
          ? `<div class="stats${c.condense ? " condensed" : ""}" data-lines="${this._condenseLines}" style="--cols:${Math.max(1, Math.ceil(shown.length / 2))}">${shown
              .map((s) => {
                const col = cssColor(c[`${s.key}_color`]);
                return `
        <div class="stat ${s.key} ${s.cls || ""}" data-key="${s.key}" role="button" tabindex="0"
             title="${esc(s.tip || "")}"${col ? ` style="--active:${esc(col)}"` : ""}>
          <ha-icon icon="${s.icon}"></ha-icon>
          <div class="value">${s.valueHtml ?? esc(s.value)}</div>
          ${s.subHtml ? `<div class="sub">${s.subHtml}</div>` : ""}
        </div>`;
              })
              .join("")}</div>`
          : ""
      }`;
  }

  /* ---------------------------------------------------------------- actions */

  /** The configured action for a panel (or "thumbnail"), falling back to the defaults. */
  _actionFor(key) {
    const c = this._config;
    const a = c[`${key}_tap_action`];
    if (a && a.action) return a;
    // Defaults (and support for options from the earlier version)
    if (key === "thumbnail") {
      return c.navigation_path
        ? { action: "navigate", navigation_path: c.navigation_path }
        : { action: "none" };
    }
    if (key === "lights" && c.light_tap_action === "toggle") return { action: "toggle" };
    return { action: "more-info" };
  }

  /** The entity that "more-info" / "toggle" should use by default for a panel. */
  _defaultEntity(key) {
    const r = this._resolve();
    const st = this._hass.states;
    const firstWhere = (ids, pred) => ids.find((i) => st[i] && pred(st[i]));
    const firstLive = (ids) => ids.find((i) => st[i]);
    switch (key) {
      case "temperature":
        return r.temperature || r.humidity;
      case "lights":
        return firstWhere(r.lights, (s) => s.state === "on") || firstLive(r.lights);
      case "security":
        return (
          firstWhere(r.alarms, alarmActive) ||
          firstWhere([...r.doors, ...r.windows], (s) => s.state === "on") ||
          firstLive([...r.doors, ...r.windows, ...r.alarms])
        );
      case "blinds":
        return firstWhere(r.blinds, (s) => ["open", "opening"].includes(s.state)) || firstLive(r.blinds);
      case "media":
        return firstWhere(r.media, (s) => ![...UNAVAILABLE, "off", "standby"].includes(s.state)) || firstLive(r.media);
      case "vacuum":
        return firstWhere(r.vacuums, (s) => ["cleaning", "returning"].includes(s.state)) || firstLive(r.vacuums);
      case "sockets":
        return firstWhere(r.sockets, (s) => s.state === "on") || firstLive(r.sockets);
      case "camera":
        return firstWhere(r.cameras, (s) => ["recording", "streaming"].includes(s.state)) || firstLive(r.cameras);
      default:
        return r.all[0];
    }
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _toggle(key) {
    const hass = this._hass;
    const r = this._resolve();
    const st = hass.states;
    if (key === "lights" && r.lights.length) {
      const anyOn = r.lights.some((i) => st[i]?.state === "on");
      hass.callService("light", anyOn ? "turn_off" : "turn_on", { entity_id: r.lights });
    } else if (key === "blinds" && r.blinds.length) {
      const anyOpen = r.blinds.some((i) => ["open", "opening"].includes(st[i]?.state));
      hass.callService("cover", anyOpen ? "close_cover" : "open_cover", { entity_id: r.blinds });
    } else if (key === "vacuum" && r.vacuums.length) {
      const running = r.vacuums.some((i) => ["cleaning", "returning"].includes(st[i]?.state));
      hass.callService("vacuum", running ? "return_to_base" : "start", { entity_id: r.vacuums });
    } else if (key === "sockets" && r.sockets.length) {
      const anyOn = r.sockets.some((i) => st[i]?.state === "on");
      hass.callService("switch", anyOn ? "turn_off" : "turn_on", { entity_id: r.sockets });
    } else {
      const id = this._defaultEntity(key);
      if (id) hass.callService("homeassistant", "toggle", { entity_id: id });
    }
  }

  _runAction(key) {
    const a = this._actionFor(key);
    switch (a.action) {
      case "none":
        return;
      case "toggle":
        return this._toggle(key);
      case "navigate": {
        if (!a.navigation_path) return;
        history[a.navigation_replace ? "replaceState" : "pushState"](null, "", a.navigation_path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: !!a.navigation_replace } }));
        return;
      }
      case "url":
        if (a.url_path) window.open(a.url_path, "_blank", "noopener");
        return;
      case "perform-action":
      case "call-service": {
        const svc = a.perform_action || a.service;
        if (!svc || !svc.includes(".")) return;
        const [domain, service] = svc.split(".");
        this._hass.callService(domain, service, a.data || a.service_data || {}, a.target);
        return;
      }
      default:
        return this._moreInfo(a.entity || this._defaultEntity(key));
    }
  }

  _onActivate(ev) {
    const stat = ev.target.closest(".stat");
    if (stat) return this._runAction(stat.dataset.key);
    if (ev.target.closest("[data-room]")) this._runAction("thumbnail");
  }

  /* ----------------------------------------------------------------- styles */

  static get styles() {
    return `
      :host { display: block; }
      ha-card { position: relative; overflow: hidden; padding: 14px; box-sizing: border-box; }
      .bg {
        display: none; position: absolute; inset: 0; z-index: 0; pointer-events: none;
        background-size: cover; background-position: center;
        opacity: var(--bg-op, .25); transition: opacity .25s ease;
      }
      .bg.on { display: block; }
      @media (hover: hover) { ha-card:hover .bg { opacity: var(--bg-op-hover, var(--bg-op, .25)); } }
      @media (prefers-reduced-motion: reduce) { .bg { transition: none; } }
      .ri {
        display: none; position: absolute; left: 8px; bottom: 8px; z-index: 0; pointer-events: none;
        color: var(--room-card-room-icon-color, var(--primary-text-color)); line-height: 0;
      }
      .ri.on { display: block; }
      .ri ha-icon { display: flex; }
      .wrap { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; }

      /* ---- header: thumbnail + title ---- */
      .room { display: flex; align-items: center; gap: 14px; align-self: flex-start; max-width: 100%; border-radius: 14px; outline: none; }
      .room.clickable { cursor: pointer; }
      .room:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
      .thumb {
        width: var(--room-card-thumb-size, 64px); height: var(--room-card-thumb-size, 64px);
        border-radius: 14px; object-fit: cover; flex: none;
        background: var(--secondary-background-color);
      }
      .thumb.placeholder { display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); --mdc-icon-size: 32px; }
      .meta { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .name { font-size: var(--title-size, 18px); font-weight: 600; line-height: 1.15; color: var(--primary-text-color); }
      .status { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--secondary-text-color); }
      .status .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--success-color, #43a047); }
      .status.warn .dot { background: var(--warning-color, #ffa726); }
      .status.alarm .dot { background: var(--error-color, #e53935); animation: pulse 1.6s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .35; } }
      @media (prefers-reduced-motion: reduce) { .status.alarm .dot { animation: none; } }

      /* ---- panels ---- */
      .stats { display: flex; flex-wrap: wrap; gap: 8px; }
      .stat {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        flex: 0 0 auto; padding: 9px 10px 8px; border-radius: 12px; cursor: pointer; outline: none;
        position: relative; isolation: isolate;
        --c: var(--active, var(--primary-color));
      }
      /* Panel background lives on a pseudo-element so --po fades the panel, not its contents */
      .stat::before, .stats.condensed::before {
        content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none;
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        opacity: var(--po, 1); transition: background-color .15s;
      }
      .stat:hover::before { background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
      .stat:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
      .stat > ha-icon { --mdc-icon-size: var(--room-card-icon-size, 15px); color: var(--c); margin-bottom: 3px; display: flex; }
      .stat .value { font-size: 14px; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; line-height: 1.2; }
      .stat .value .dim { color: var(--secondary-text-color); font-weight: 400; }
      .stat .sub {
        display: flex; align-items: center; justify-content: center; gap: 2px;
        font-size: 11px; color: var(--secondary-text-color); white-space: nowrap;
      }
      .stat .sub .mini { --mdc-icon-size: 12px; display: inline-flex; }

      /* default active colours (override per card in the editor, or globally with theme variables) */
      .stat.temperature { --active: var(--room-card-temperature-color, #3d9bff); }
      .stat.lights      { --active: var(--room-card-lights-color, #ffc83d); }
      .stat.security    { --active: var(--room-card-security-color, #4a90ff); }
      .stat.blinds      { --active: var(--room-card-blinds-color, #2ec4b6); }
      .stat.media       { --active: var(--room-card-media-color, #4a90ff); }
      .stat.vacuum      { --active: var(--room-card-vacuum-color, #a78bfa); }
      .stat.sockets     { --active: var(--room-card-sockets-color, #34d399); }
      .stat.camera      { --active: var(--room-card-camera-color, #f472b6); }
      .stat.off         { --c: var(--room-card-off-color, var(--state-inactive-color, var(--disabled-text-color))); }
      .stat.warn        { --c: var(--warning-color, #ffa726); }
      .stat.alarm       { --c: var(--error-color, #e53935); }

      /* ---- vertical layout: title above thumbnail on the left, panels stacked on the right ---- */
      .wrap.vertical { flex-direction: row; align-items: flex-start; gap: 16px; }
      .vertical .room { flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
      .vertical .meta { order: -1; gap: 3px; }
      .vertical .thumb { width: var(--room-card-thumb-size-vertical, 104px); height: var(--room-card-thumb-size-vertical, 104px); }
      .vertical .stats { flex-direction: column; flex-wrap: nowrap; gap: 6px; margin-left: auto; }
      .vertical .stat { flex-direction: row; justify-content: flex-start; gap: 7px; padding: 7px 12px; white-space: nowrap; }
      .vertical .stat > ha-icon { margin-bottom: 0; }

      /* ---- condensed: every item shares ONE panel ---- */
      .stats.condensed { position: relative; isolation: isolate; border-radius: 12px; padding: 6px 10px; gap: 2px 14px; align-items: center; }
      .stats.condensed .stat {
        flex-direction: row; justify-content: flex-start; gap: 6px; padding: 4px 4px; border-radius: 8px; white-space: nowrap;
      }
      .stats.condensed .stat::before { display: none; }
      .stats.condensed .stat:hover { background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
      .stats.condensed .stat > ha-icon { margin-bottom: 0; }
      /* vertical + condensed: 1 or 2 columns */
      .vertical .stats.condensed { align-items: flex-start; gap: 2px; }
      .vertical .stats.condensed[data-lines="2"] { display: grid; align-items: center; grid-template-columns: repeat(2, max-content); gap: 2px 14px; }
      /* horizontal + condensed: 1 or 2 rows */
      .wrap:not(.vertical) .stats.condensed[data-lines="2"] { display: grid; grid-template-columns: repeat(var(--cols, 4), max-content); gap: 2px 14px; }

      /* readable panels over a background image */
      .has-bg .stat::before, .has-bg .stats.condensed::before {
        background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 55%, transparent);
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      }
      .has-bg .stats.condensed .stat::before { display: none; }
    `;
  }
}

/* ------------------------------------------------------------- the editor */

const LABELS = {
  name: "Room name",
  areas: "Rooms / areas (auto-discovers entities)",
  image: "Image URL",
  icon: "Room icon",
  card_height: "Card height (0 = automatic)",
  show_room_icon: "Show room icon (bottom left)",
  room_icon_opacity: "Room icon opacity",
  room_icon_size: "Room icon size",
  layout: "Layout",
  condense: "Condense panels into a single panel",
  condense_lines: "Condensed panel lines",
  panel_opacity: "Info panel opacity",
  title_size: "Room title font size",
  show_thumbnail: "Show thumbnail",
  background_image: "Fade room image into card background",
  background_opacity: "Background image opacity",
  temperature_entity: "Temperature sensor(s)",
  humidity_entity: "Humidity sensor(s)",
  lights: "Lights",
  doors: "Door sensors",
  windows: "Window sensors",
  alarm_entities: "Alarm / safety entities",
  warn_when_open: "Warn when a door or window is open",
  blinds: "Blinds (covers)",
  media_player: "Media players",
  media_name: "Media player label",
  temperature_min: "Alert below (temperature)",
  temperature_max: "Alert above (temperature)",
  status_ok_text: "“All good” text (optional)",
  show_temperature: "Show temperature panel",
  show_lights: "Show lights panel",
  show_security: "Show security panel",
  show_blinds: "Show blinds panel",
  show_media: "Show media player panel",
  show_vacuum: "Show vacuum panel",
  show_sockets: "Show smart socket panel",
  show_camera: "Show camera panel",
  cameras: "Cameras",
  camera_color: "Camera icon colour (when recording or streaming)",
  camera_tap_action: "Tap on cameras",
  panel_order: "Order of info panels",
  background_hover_boost: "Background opacity increase on hover",
  vacuums: "Vacuum cleaners",
  sockets: "Smart sockets (switches)",
  vacuum_color: "Vacuum icon colour (when running)",
  sockets_color: "Socket icon colour (when on)",
  vacuum_tap_action: "Tap on vacuum",
  sockets_tap_action: "Tap on sockets",
  temperature_color: "Temperature icon colour",
  lights_color: "Lights icon colour (when on)",
  security_color: "Security icon colour (when secure)",
  blinds_color: "Blinds icon colour (when open)",
  media_color: "Media player icon colour (when on)",
  thumbnail_tap_action: "Tap on thumbnail / title",
  temperature_tap_action: "Tap on temperature",
  lights_tap_action: "Tap on lights",
  security_tap_action: "Tap on security",
  blinds_tap_action: "Tap on blinds",
  media_tap_action: "Tap on media player",
  exclude_entities: "Exclude from auto-discovery",
};

const HELPERS = {
  areas: "Choose one or more rooms. The card picks up their lights, sensors, blinds, media players and more, and averages the temperature. Anything you set below overrides it.",
  temperature_entity: "With several sensors the card shows their average.",
  image: "e.g. /local/rooms/living.jpg. Falls back to the area picture.",
  icon: "Shown faintly in the bottom-left corner, and as the thumbnail when there's no image. Defaults to the area's icon.",
  card_height: "Fixes the card at an exact height in pixels. Content that doesn't fit is clipped, so leave at 0 to size automatically.",
  media_name: "Shown as “TV On”. Defaults to TV (or Speaker).",
  alarm_entities: "Alarm panels and safety sensors. The status turns red if one is triggered.",
  blinds: "Cover entities. Shows how many are open.",
  vacuums: "Vacuum entities. Shows the state, e.g. Docked or Cleaning.",
  sockets: "Switch entities. Shows how many are on.",
  cameras: "Camera entities. Tapping opens the live view.",
  panel_order: "Drag to reorder. Use the “Show … panel” switch in each section to hide a panel.",
  background_hover_boost: "Extra opacity (in percentage points) added to the background image while the mouse is over the card. 0 turns the effect off.",
  condense: "Puts every info panel into one compact panel to save space.",
  panel_opacity: "Fades the info panel backgrounds. Applies to all panels on the card.",
  status_ok_text: "Leave empty to show nothing under the room name when everything is fine.",
  temperature_color: "Icons turn amber or red for warnings and alarms regardless of these colours.",
};

const entityOne = (domain, device_class) => ({
  entity: { multiple: false, filter: { domain, ...(device_class ? { device_class } : {}) } },
});
const entityMany = (domain, device_class) => ({
  entity: { multiple: true, filter: { domain, ...(device_class ? { device_class } : {}) } },
});
const action = (def = "more-info") => ({
  ui_action: {
    default_action: def,
    actions: ["more-info", "toggle", "navigate", "url", "perform-action", "call-service", "none"],
  },
});

const buildSchema = (cfg) => [
  {
    type: "expandable", name: "", title: "Room", icon: "mdi:sofa-outline", expanded: true,
    schema: [
      { name: "name", selector: { text: {} } },
      { name: "areas", selector: { area: { multiple: true } } },
      { name: "image", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ],
  },
  {
    type: "expandable", name: "", title: "Appearance", icon: "mdi:palette-outline",
    schema: [
      {
        name: "layout",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "horizontal", label: "Horizontal (panels below)" },
              { value: "vertical", label: "Vertical (panels stacked on the right)" },
            ],
          },
        },
      },
      { name: "condense", selector: { boolean: {} } },
      ...(cfg.condense
        ? [{
            name: "condense_lines",
            selector: { select: { mode: "dropdown", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }] } },
          }]
        : []),
      { name: "title_size", selector: { number: { min: 12, max: 36, step: 1, mode: "slider", unit_of_measurement: "px" } } },
      { name: "panel_opacity", selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } },
      { name: "card_height", selector: { number: { min: 0, max: 600, step: 1, mode: "slider", unit_of_measurement: "px" } } },
      { name: "show_room_icon", selector: { boolean: {} } },
      ...(cfg.show_room_icon !== false
        ? [
            { name: "room_icon_opacity", selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } },
            { name: "room_icon_size", selector: { number: { min: 24, max: 240, step: 2, mode: "slider", unit_of_measurement: "px" } } },
          ]
        : []),
      { name: "show_thumbnail", selector: { boolean: {} } },
      { name: "background_image", selector: { boolean: {} } },
      ...(cfg.background_image
        ? [
            {
              name: "background_opacity",
              selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } },
            },
            {
              name: "background_hover_boost",
              selector: { number: { min: 0, max: 50, step: 1, mode: "slider", unit_of_measurement: "%" } },
            },
          ]
        : []),
    ],
  },
  {
    type: "expandable", name: "", title: "Panel order", icon: "mdi:sort",
    schema: [
      {
        name: "panel_order",
        selector: {
          select: {
            multiple: true,
            reorder: true,
            options: PANELS.map((k) => ({ value: k, label: PANEL_LABELS[k] })),
          },
        },
      },
    ],
  },
  {
    type: "expandable", name: "", title: "Temperature & humidity", icon: "mdi:thermometer",
    schema: [
      { name: "show_temperature", selector: { boolean: {} } },
      { name: "temperature_entity", selector: entityMany("sensor", "temperature") },
      { name: "humidity_entity", selector: entityMany("sensor", "humidity") },
      { name: "temperature_min", selector: { number: { mode: "box", step: 0.5 } } },
      { name: "temperature_max", selector: { number: { mode: "box", step: 0.5 } } },
    ],
  },
  {
    type: "expandable", name: "", title: "Lights", icon: "mdi:lightbulb-outline",
    schema: [
      { name: "show_lights", selector: { boolean: {} } },
      { name: "lights", selector: entityMany("light") },
    ],
  },
  {
    type: "expandable", name: "", title: "Security", icon: "mdi:door-closed",
    schema: [
      { name: "show_security", selector: { boolean: {} } },
      { name: "doors", selector: entityMany("binary_sensor", ["door", "garage_door"]) },
      { name: "windows", selector: entityMany("binary_sensor", "window") },
      {
        name: "alarm_entities",
        selector: { entity: { multiple: true, filter: [{ domain: "alarm_control_panel" }, { domain: "binary_sensor" }] } },
      },
      { name: "warn_when_open", selector: { boolean: {} } },
    ],
  },
  {
    type: "expandable", name: "", title: "Blinds", icon: "mdi:window-closed-variant",
    schema: [
      { name: "show_blinds", selector: { boolean: {} } },
      { name: "blinds", selector: entityMany("cover") },
    ],
  },
  {
    type: "expandable", name: "", title: "Media player", icon: "mdi:television",
    schema: [
      { name: "show_media", selector: { boolean: {} } },
      { name: "media_player", selector: entityMany("media_player") },
      { name: "media_name", selector: { text: {} } },
    ],
  },
  {
    type: "expandable", name: "", title: "Vacuum cleaner", icon: "mdi:robot-vacuum",
    schema: [
      { name: "show_vacuum", selector: { boolean: {} } },
      { name: "vacuums", selector: entityMany("vacuum") },
    ],
  },
  {
    type: "expandable", name: "", title: "Smart sockets", icon: "mdi:power-socket-uk",
    schema: [
      { name: "show_sockets", selector: { boolean: {} } },
      { name: "sockets", selector: entityMany("switch") },
    ],
  },
  {
    type: "expandable", name: "", title: "Cameras", icon: "mdi:cctv",
    schema: [
      { name: "show_camera", selector: { boolean: {} } },
      { name: "cameras", selector: entityMany("camera") },
    ],
  },
  {
    type: "expandable", name: "", title: "Icon colours", icon: "mdi:palette",
    schema: [
      { name: "temperature_color", selector: { color_rgb: {} } },
      { name: "lights_color", selector: { color_rgb: {} } },
      { name: "security_color", selector: { color_rgb: {} } },
      { name: "blinds_color", selector: { color_rgb: {} } },
      { name: "media_color", selector: { color_rgb: {} } },
      { name: "vacuum_color", selector: { color_rgb: {} } },
      { name: "sockets_color", selector: { color_rgb: {} } },
      { name: "camera_color", selector: { color_rgb: {} } },
    ],
  },
  {
    type: "expandable", name: "", title: "Tap actions", icon: "mdi:gesture-tap",
    schema: [
      { name: "thumbnail_tap_action", selector: action("none") },
      { name: "temperature_tap_action", selector: action() },
      { name: "lights_tap_action", selector: action() },
      { name: "security_tap_action", selector: action() },
      { name: "blinds_tap_action", selector: action() },
      { name: "media_tap_action", selector: action() },
      { name: "vacuum_tap_action", selector: action() },
      { name: "sockets_tap_action", selector: action() },
      { name: "camera_tap_action", selector: action() },
    ],
  },
  {
    type: "expandable", name: "", title: "Advanced", icon: "mdi:cog-outline",
    schema: [
      { name: "status_ok_text", selector: { text: {} } },
      { name: "exclude_entities", selector: { entity: { multiple: true } } },
    ],
  },
];

class RoomCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      const vertical = () => this._config?.layout === "vertical";
      this._form.computeLabel = (s) =>
        s.name === "condense_lines"
          ? vertical() ? "Condensed panel columns" : "Condensed panel rows"
          : LABELS[s.name] ?? s.title ?? s.name;
      this._form.computeHelper = (s) =>
        s.name === "condense_lines"
          ? vertical() ? "1 = one tall column, 2 = two columns (shorter card)." : "1 = a single row, 2 = two rows (narrower card)."
          : HELPERS[s.name];
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._changed(ev.detail.value);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = buildSchema(this._config);
    const data = { ...DEFAULTS, ...this._config };
    data.areas = areaIdsOf(this._config); // old single `area` is shown as a one-item list
    delete data.area;
    for (const k of ["temperature_entity", "humidity_entity", "media_player"]) {
      if (data[k] !== undefined) data[k] = toArray(data[k]);
    }
    data.panel_order = completeOrder(this._config.panel_order);
    data.condense_lines = data.condense_lines !== undefined ? String(data.condense_lines) : condenseDefault(data.layout);
    this._form.data = data;
  }

  _changed(value) {
    const config = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "panel_order") {
        const o = completeOrder(v); // removing a chip can't hide a panel; it just returns to the end
        if (!same(o, PANELS)) config[k] = o;
        continue;
      }
      if (k in DEFAULTS && same(v, DEFAULTS[k])) continue; // don't write defaults
      if (k === "condense_lines" && String(v) === condenseDefault(value.layout)) continue;
      const empty =
        v === undefined || v === null || v === "" ||
        (Array.isArray(v) && !v.length) ||
        (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
      if (!empty) config[k] = v;
    }
    config.type = this._config.type;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

/* ------------------------------------------------------------ registration */

// Guarded so the card still loads if the file is accidentally registered twice
// (for example a manual resource plus the one HACS adds).
if (!customElements.get("room-card")) customElements.define("room-card", RoomCard);
if (!customElements.get("room-card-editor")) customElements.define("room-card-editor", RoomCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "room-card")) {
  window.customCards.push({
    type: "room-card",
    name: "Room Card",
    description: "At-a-glance summary of a room: climate, lights, security, blinds, media, cameras and more.",
    preview: true,
  });
}

console.info(
  `%c ROOM-CARD %c v${ROOM_CARD_VERSION} `,
  "background:#3d9bff;color:#fff;border-radius:3px 0 0 3px",
  "background:#333;color:#fff;border-radius:0 3px 3px 0"
);
