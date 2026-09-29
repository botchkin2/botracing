/* @ds-bundle: {"format":4,"namespace":"DesignSystem_6954cc","components":[{"name":"ChartHeader","sourcePath":"components/charts/ChartHeader/ChartHeader.jsx"},{"name":"DotStrip","sourcePath":"components/charts/DotStrip/DotStrip.jsx"},{"name":"LapTimeBars","sourcePath":"components/charts/LapTimeBars/LapTimeBars.jsx"},{"name":"TimeGrid","sourcePath":"components/charts/TimeGrid/TimeGrid.jsx"},{"name":"TraceChart","sourcePath":"components/charts/TraceChart/TraceChart.jsx"},{"name":"TrackMap","sourcePath":"components/charts/TrackMap/TrackMap.jsx"},{"name":"Transport","sourcePath":"components/charts/Transport/Transport.jsx"},{"name":"Button","sourcePath":"components/controls/Button/Button.jsx"},{"name":"Checkbox","sourcePath":"components/controls/Checkbox/Checkbox.jsx"},{"name":"SegmentedControl","sourcePath":"components/controls/SegmentedControl/SegmentedControl.jsx"},{"name":"Stepper","sourcePath":"components/controls/Stepper/Stepper.jsx"},{"name":"Switch","sourcePath":"components/controls/Switch/Switch.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState/EmptyState.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton/Skeleton.jsx"},{"name":"StatusBanner","sourcePath":"components/feedback/StatusBanner/StatusBanner.jsx"},{"name":"StatusDot","sourcePath":"components/feedback/StatusDot/StatusDot.jsx"},{"name":"CompareTray","sourcePath":"components/laps/CompareTray/CompareTray.jsx"},{"name":"LapChip","sourcePath":"components/laps/LapChip/LapChip.jsx"},{"name":"LapDetail","sourcePath":"components/laps/LapDetail/LapDetail.jsx"},{"name":"LapRow","sourcePath":"components/laps/LapRow/LapRow.jsx"},{"name":"LapTag","sourcePath":"components/laps/LapTag/LapTag.jsx"},{"name":"LAP_TAG_PRIORITY","sourcePath":"components/laps/LapTag/LapTag.jsx"},{"name":"SessionRow","sourcePath":"components/laps/SessionRow/SessionRow.jsx"},{"name":"StintHeader","sourcePath":"components/laps/StintHeader/StintHeader.jsx"}],"sourceHashes":{"components/charts/ChartHeader/ChartHeader.jsx":"82fb07f28513","components/charts/DotStrip/DotStrip.jsx":"de1915c66966","components/charts/LapTimeBars/LapTimeBars.jsx":"b2aa222ec91c","components/charts/TimeGrid/TimeGrid.jsx":"cfbc563dcfa6","components/charts/TraceChart/TraceChart.jsx":"358820cf4775","components/charts/TrackMap/TrackMap.jsx":"0836b26978eb","components/charts/Transport/Transport.jsx":"b2b818c7e6e1","components/controls/Button/Button.jsx":"fc6f9874cd91","components/controls/Checkbox/Checkbox.jsx":"6b75402eecf9","components/controls/SegmentedControl/SegmentedControl.jsx":"400acbf3f3cb","components/controls/Stepper/Stepper.jsx":"b3e39e1c33a8","components/controls/Switch/Switch.jsx":"37087245e04d","components/feedback/EmptyState/EmptyState.jsx":"858f7d065661","components/feedback/Skeleton/Skeleton.jsx":"ddd7c2b99912","components/feedback/StatusBanner/StatusBanner.jsx":"028c3f56f9b7","components/feedback/StatusDot/StatusDot.jsx":"f69f18a23305","components/laps/CompareTray/CompareTray.jsx":"ba72cf59a4f4","components/laps/LapChip/LapChip.jsx":"75d79eac22dd","components/laps/LapDetail/LapDetail.jsx":"5f70be7a4939","components/laps/LapRow/LapRow.jsx":"955a7f538966","components/laps/LapTag/LapTag.jsx":"421900f85ffd","components/laps/SessionRow/SessionRow.jsx":"7615f111c03a","components/laps/StintHeader/StintHeader.jsx":"c6f9722c56f0","ui_kits/lap-analysis/App.jsx":"64f6ad003c89","ui_kits/lap-analysis/Screens.jsx":"7e784c8f7a69","ui_kits/lap-analysis/data.jsx":"b7c2c9f44beb"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_6954cc = window.DesignSystem_6954cc || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/charts/ChartHeader/ChartHeader.jsx
try { (() => {
function ChartHeader({
  label,
  unit,
  description,
  values = [],
  channels,
  onRemove
}) {
  const val = v => /*#__PURE__*/React.createElement("span", {
    key: v.key || v.text + v.color,
    onClick: v.onPress,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      font: '500 11px/1 var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      opacity: v.hidden ? 0.3 : 1,
      cursor: v.onPress ? 'pointer' : 'default',
      whiteSpace: 'nowrap',
      color: 'var(--text)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 1,
      background: v.color
    }
  }), v.text);
  const x = onRemove && /*#__PURE__*/React.createElement("span", {
    onClick: onRemove,
    style: {
      color: 'var(--text-faint)',
      font: '500 13px/1 var(--font-mono)',
      cursor: 'pointer'
    }
  }, "\xD7");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 'none',
      whiteSpace: 'nowrap',
      font: 'var(--type-label)',
      letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase',
      color: 'var(--text)'
    }
  }, label), unit && !channels && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 'none',
      font: '400 10px/1 var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, unit), !channels && /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 8
    }
  }, values.map(val)), channels && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }), x), channels && channels.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 17
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "8",
    style: {
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    x2: "18",
    y1: "4",
    y2: "4",
    stroke: "var(--text)",
    strokeWidth: "1.6",
    strokeDasharray: c.dash || ''
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 10.5px/1 var(--font-mono)',
      color: 'var(--text-secondary)'
    }
  }, c.name), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 10px/1 var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, c.unit), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 8
    }
  }, (c.values || []).map(val)))), description && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 11px/1.3 var(--font-sans)',
      color: 'var(--text-faint)',
      margin: '1px 0 3px'
    }
  }, description));
}
Object.assign(__ds_scope, { ChartHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/ChartHeader/ChartHeader.jsx", error: String((e && e.message) || e) }); }

// components/charts/DotStrip/DotStrip.jsx
try { (() => {
function DotStrip({
  label,
  unit,
  values = [],
  flip = false,
  width = 300,
  format = v => String(Math.round(v)),
  onSelect
}) {
  const vs = values.map(o => o.v).sort((a, b) => a - b);
  if (!vs.length) return null;
  const q = p => vs[Math.min(vs.length - 1, Math.round(p * (vs.length - 1)))],
    pad = (vs[vs.length - 1] - vs[0]) * 0.06 || 1,
    lo = vs[0] - pad,
    hi = vs[vs.length - 1] + pad;
  const X = v => {
      let t = (v - lo) / (hi - lo);
      if (flip) t = 1 - t;
      return 4 + t * (width - 8);
    },
    cnt = {};
  const dots = values.map(o => {
    const x = X(o.v),
      k = Math.round(x / 4);
    cnt[k] = (cnt[k] || 0) + 1;
    const n = cnt[k] - 1,
      key = o.kind === 'ref' || o.kind === 'highlight';
    return {
      ...o,
      x,
      y: 22 - (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 5,
      key
    };
  }).sort((a, b) => a.key - b.key);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 10.5px/1 var(--font-mono)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--text)',
      whiteSpace: 'nowrap'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 10px/1 var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, unit), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      font: '500 11px/1 var(--font-mono)',
      color: 'var(--text)',
      whiteSpace: 'nowrap'
    }
  }, "med ", format(q(.5)), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "\xB7 p10\u201390 ", format(q(.1)), "\u2013", format(q(.9))))), /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: "44",
    style: {
      display: 'block',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    x2: width,
    y1: "22",
    y2: "22",
    stroke: "var(--line-strong)"
  }), dots.map((d, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: d.x,
    cy: d.y,
    r: d.key ? 4.2 : 2.8,
    fill: d.kind === 'ref' ? 'var(--lap-ref)' : d.kind === 'highlight' ? 'var(--lap-1)' : 'var(--text-faint)',
    stroke: d.key ? 'var(--bg)' : 'none',
    strokeWidth: "1.2",
    onClick: () => onSelect && onSelect(d.id),
    style: {
      cursor: 'pointer'
    }
  }))));
}
Object.assign(__ds_scope, { DotStrip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/DotStrip/DotStrip.jsx", error: String((e && e.message) || e) }); }

// components/charts/LapTimeBars/LapTimeBars.jsx
try { (() => {
function LapTimeBars({
  width = 358,
  height = 150,
  laps = [],
  clamp = 1.5,
  pits = [],
  stints = [],
  highlight,
  onSelect
}) {
  const mid = height / 2,
    bw = width / Math.max(1, laps.length),
    ty = d => mid - Math.max(-clamp, Math.min(clamp, d)) / clamp * (mid - 14);
  return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: 'block',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    x2: width,
    y1: mid,
    y2: mid,
    stroke: "var(--chart-zero)"
  }), stints.map((s, i) => /*#__PURE__*/React.createElement("g", {
    key: 's' + i
  }, /*#__PURE__*/React.createElement("line", {
    x1: s.index * bw,
    x2: s.index * bw,
    y1: "14",
    y2: height,
    stroke: "var(--line)"
  }), /*#__PURE__*/React.createElement("text", {
    x: s.index * bw + 3,
    y: "10",
    fill: "var(--text-faint)",
    style: {
      font: 'var(--type-axis)'
    }
  }, s.label))), pits.map((p, i) => /*#__PURE__*/React.createElement("line", {
    key: 'p' + i,
    x1: (p + 1) * bw,
    x2: (p + 1) * bw,
    y1: "14",
    y2: height,
    stroke: "var(--accent)",
    strokeDasharray: "2 2"
  })), laps.map((l, i) => {
    const x = i * bw + 0.8,
      w = Math.max(1.5, bw - 1.6),
      hl = i === highlight,
      on = () => onSelect && onSelect(i);
    if (l.delta == null) return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: x,
      y: height - 12,
      width: w,
      height: "9",
      fill: l.color || 'var(--bg)',
      stroke: hl ? 'var(--accent)' : l.color || 'var(--text-muted)',
      onClick: on,
      style: {
        cursor: 'pointer'
      }
    });
    const y = ty(l.delta);
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: x,
      y: Math.min(y, mid),
      width: w,
      height: Math.max(1.5, Math.abs(y - mid)),
      fill: l.color || (l.best ? 'var(--best)' : 'var(--lap-muted)'),
      stroke: hl ? 'var(--accent)' : 'none',
      strokeWidth: "1.5",
      onClick: on,
      style: {
        cursor: 'pointer'
      }
    });
  }));
}
Object.assign(__ds_scope, { LapTimeBars });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/LapTimeBars/LapTimeBars.jsx", error: String((e && e.message) || e) }); }

// components/charts/TimeGrid/TimeGrid.jsx
try { (() => {
function TimeGrid({
  columns = [],
  rows = [],
  active,
  onSelect,
  cellHeight = 26
}) {
  const cell = d => {
    const a = Math.abs(d);
    if (a < 0.1) return {
      bg: 'var(--grid-neutral)',
      fg: 'var(--grid-neutral-fg)'
    };
    const t = Math.round((0.5 + 0.5 * Math.min(1, (a - 0.1) / 0.2)) * 100);
    return d > 0 ? {
      bg: 'color-mix(in oklch, var(--grid-slower) ' + t + '%, transparent)',
      fg: 'var(--grid-slower-fg)'
    } : {
      bg: 'color-mix(in oklch, var(--grid-faster) ' + t + '%, transparent)',
      fg: 'var(--grid-faster-fg)'
    };
  };
  const fm = d => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2).replace(/^0/, '');
  const tmpl = '38px repeat(' + columns.length + ',minmax(0,1fr))';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: tmpl,
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", null), columns.map((c, j) => /*#__PURE__*/React.createElement("span", {
    key: j,
    onClick: () => onSelect && onSelect(j),
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      font: '600 10px/1.2 var(--font-mono)',
      color: j === active ? 'var(--text)' : 'var(--text-muted)',
      cursor: 'pointer'
    }
  }, c.label, c.sub && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 9px/1.2 var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, c.sub)))), rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: tmpl,
      gap: 2,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      font: '600 10.5px/1 var(--font-mono)',
      color: 'var(--text)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 14,
      background: r.color
    }
  }), r.label), r.values.map((d, j) => {
    const c = cell(d);
    return /*#__PURE__*/React.createElement("span", {
      key: j,
      onClick: () => onSelect && onSelect(j),
      style: {
        height: cellHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: c.bg,
        color: c.fg,
        outline: j === active ? '1px solid var(--text)' : 'none',
        borderRadius: 'var(--radius-xs)',
        font: '500 10.5px/1 var(--font-mono)',
        cursor: 'pointer'
      }
    }, fm(d));
  }))));
}
Object.assign(__ds_scope, { TimeGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/TimeGrid/TimeGrid.jsx", error: String((e && e.message) || e) }); }

// components/charts/TraceChart/TraceChart.jsx
try { (() => {
function TraceChart({
  width = 358,
  height = 104,
  traces = [],
  yMin,
  yMax,
  band,
  gridlines = [],
  zero,
  cursor,
  hover,
  onScrub
}) {
  const all = traces.flatMap(t => t.values),
    lo = yMin != null ? yMin : Math.min(...all),
    hi = yMax != null ? yMax : Math.max(...all),
    n = Math.max(1, ...traces.map(t => t.values.length)) - 1;
  const X = i => (i / n * width).toFixed(1),
    Y = v => (height - 2 - (v - lo) / (hi - lo || 1) * (height - 4)).toFixed(1);
  const path = vs => vs.map((v, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(v)).join('');
  const bandD = band ? path(band.hi) + band.lo.map((v, i) => i).reverse().map(i => 'L' + X(i) + ' ' + Y(band.lo[i])).join('') + 'Z' : null;
  const scrub = e => {
    if (!onScrub) return;
    const r = e.currentTarget.getBoundingClientRect();
    onScrub(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    onPointerDown: scrub,
    onPointerMove: e => {
      if (e.buttons) scrub(e);
    },
    style: {
      display: 'block',
      overflow: 'visible',
      touchAction: 'none',
      cursor: onScrub ? 'ew-resize' : 'default'
    }
  }, gridlines.map((g, i) => /*#__PURE__*/React.createElement("line", {
    key: i,
    x1: g * width,
    x2: g * width,
    y1: "0",
    y2: height,
    stroke: "var(--chart-gridline)"
  })), bandD && /*#__PURE__*/React.createElement("path", {
    d: bandD,
    fill: "var(--chart-band)"
  }), zero != null && /*#__PURE__*/React.createElement("line", {
    x1: "0",
    x2: width,
    y1: Y(zero),
    y2: Y(zero),
    stroke: "var(--chart-zero)"
  }), [...traces].sort((a, b) => (a.width || 1.5) - (b.width || 1.5)).map((t, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: path(t.values),
    fill: "none",
    stroke: t.color,
    strokeWidth: t.width || 1.5,
    strokeOpacity: t.opacity == null ? 1 : t.opacity,
    strokeDasharray: t.dash || '',
    strokeLinejoin: "round"
  })), cursor != null && /*#__PURE__*/React.createElement("line", {
    x1: cursor * width,
    x2: cursor * width,
    y1: "0",
    y2: height,
    stroke: "var(--chart-cursor)"
  }), hover != null && /*#__PURE__*/React.createElement("line", {
    x1: hover * width,
    x2: hover * width,
    y1: "0",
    y2: height,
    stroke: "var(--chart-hover)",
    strokeDasharray: "2 2"
  }));
}
Object.assign(__ds_scope, { TraceChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/TraceChart/TraceChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/TrackMap/TrackMap.jsx
try { (() => {
function TrackMap({
  width = 358,
  height = 240,
  outline,
  pit,
  laps = [],
  cars = [],
  sectionTicks = [],
  sectionLabels = [],
  cornerLabels = [],
  quality = 'good',
  mode = 'track',
  onModeChange,
  note,
  satellite = false
}) {
  const osm = quality !== 'poor';
  const seg = [['follow', 'Follow'], ['track', 'Track']].concat(osm ? [['sat', 'Satellite']] : []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width,
      height,
      background: 'var(--surface)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: 'block'
    }
  }, osm ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: outline,
    fill: "none",
    stroke: "var(--chart-track-edge)",
    strokeWidth: "10",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: outline,
    fill: "none",
    stroke: "var(--chart-track-fill)",
    strokeWidth: "7.5",
    strokeLinejoin: "round"
  }), pit && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: pit,
    fill: "none",
    stroke: "var(--chart-track-edge)",
    strokeWidth: "4.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: pit,
    fill: "none",
    stroke: "var(--chart-track-fill)",
    strokeWidth: "2.5"
  }))) : /*#__PURE__*/React.createElement("path", {
    d: outline,
    fill: "none",
    stroke: "var(--chart-track)",
    strokeWidth: "6",
    strokeLinejoin: "round"
  }), osm && sectionTicks.map((t, i) => /*#__PURE__*/React.createElement("line", {
    key: i,
    x1: t.x1,
    y1: t.y1,
    x2: t.x2,
    y2: t.y2,
    stroke: "var(--text-muted)",
    strokeWidth: "1.3"
  })), laps.map((l, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: l.d,
    fill: "none",
    stroke: l.color,
    strokeWidth: l.width || 1.4,
    strokeOpacity: l.opacity == null ? 1 : l.opacity,
    strokeLinejoin: "round"
  })), sectionLabels.map((t, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: t.x,
    y: t.y,
    dy: "3.5",
    textAnchor: "middle",
    fill: "var(--map-label)",
    style: {
      font: '600 10px var(--font-mono)'
    }
  }, t.label)), osm && cornerLabels.map((t, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: t.x,
    y: t.y,
    dy: "3",
    textAnchor: "middle",
    fill: "var(--map-corner-label)",
    style: {
      font: '500 8.5px var(--font-mono)'
    }
  }, t.label)), cars.map((c, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: c.x,
    cy: c.y,
    r: c.r || 4.5,
    fill: c.color,
    stroke: "var(--bg)",
    strokeWidth: "1.5"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 8,
      top: 8,
      display: 'flex',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden'
    }
  }, seg.map(([k, l]) => {
    const on = k === mode,
      dis = k === 'sat' && !satellite;
    return /*#__PURE__*/React.createElement("span", {
      key: k,
      onClick: () => !dis && onModeChange && onModeChange(k),
      style: {
        padding: '3px 8px',
        font: '500 11px/1.2 var(--font-sans)',
        background: on ? 'var(--text)' : 'color-mix(in oklch, var(--bg) 85%, transparent)',
        color: on ? 'var(--bg)' : dis ? 'var(--text-faint)' : 'var(--text-secondary)',
        cursor: dis ? 'default' : 'pointer'
      }
    }, l);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 8,
      top: 9,
      padding: '2px 6px',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      background: 'color-mix(in oklch, var(--bg) 85%, transparent)',
      font: '500 10px/1.2 var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, osm ? 'OSM outline · ' + quality : 'Driven line'), osm && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 8,
      bottom: 6,
      font: '400 9px/1 var(--font-sans)',
      color: 'var(--text-faint)'
    }
  }, "\xA9 OpenStreetMap contributors"), !osm && note !== false && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: 8,
      padding: '6px 9px',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-md)',
      font: '400 11.5px/1.35 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, note || 'No reliable track outline for this layout, so this shows your driven line instead. Laps line up by distance, not by position on the track.'));
}
Object.assign(__ds_scope, { TrackMap });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/TrackMap/TrackMap.jsx", error: String((e && e.message) || e) }); }

// components/controls/Button/Button.jsx
try { (() => {
const V = {
  primary: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: '1px solid var(--accent)'
  },
  secondary: {
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--accent)'
  },
  tertiary: {
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--control-border)'
  },
  quiet: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid transparent',
    textDecoration: 'underline',
    textUnderlineOffset: 3
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  onPress,
  children,
  style
}) {
  const sm = size === 'sm';
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: onPress,
    style: {
      ...V[variant],
      padding: sm ? '4px 9px' : '7px 13px',
      borderRadius: 'var(--radius-sm)',
      font: (sm ? '500 12px' : '600 13px') + '/1.2 var(--font-sans)',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/controls/Checkbox/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  color,
  onChange,
  size = 16
}) {
  const c = color || 'var(--lap-1)';
  return /*#__PURE__*/React.createElement("span", {
    role: "checkbox",
    "aria-checked": checked,
    onClick: e => {
      e.stopPropagation();
      onChange && onChange(!checked);
    },
    style: {
      width: size,
      height: size,
      flex: 'none',
      boxSizing: 'border-box',
      borderRadius: 'var(--radius-sm)',
      border: '1.5px solid ' + (checked ? c : 'var(--control-border)'),
      background: checked ? c : 'transparent',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '700 ' + Math.round(size * .6) + 'px/1 var(--font-mono)',
      color: 'var(--bg)',
      cursor: 'pointer'
    }
  }, checked ? '✓' : '');
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Checkbox/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/controls/SegmentedControl/SegmentedControl.jsx
try { (() => {
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  mono = false
}) {
  const sm = size === 'sm';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      flex: 'none'
    }
  }, options.map(o => {
    const v = typeof o === 'string' ? o : o.value,
      l = typeof o === 'string' ? o : o.label,
      dis = typeof o === 'object' && o.disabled,
      on = v === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      type: "button",
      disabled: dis,
      onClick: () => onChange && onChange(v),
      style: {
        border: 0,
        padding: sm ? '3px 8px' : '5px 10px',
        background: on ? 'var(--text)' : 'transparent',
        color: on ? 'var(--bg)' : dis ? 'var(--text-faint)' : 'var(--text-muted)',
        font: '500 ' + (sm ? 11 : 12) + 'px/1.2 ' + (mono ? 'var(--font-mono)' : 'var(--font-sans)'),
        cursor: dis ? 'default' : 'pointer',
        whiteSpace: 'nowrap'
      }
    }, l);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SegmentedControl/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/controls/Stepper/Stepper.jsx
try { (() => {
function Stepper({
  value,
  onDecrement,
  onIncrement,
  unit
}) {
  const b = {
    border: 0,
    background: 'transparent',
    color: 'var(--text)',
    padding: '5px 10px',
    font: '500 14px/1 var(--font-mono)',
    cursor: 'pointer'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-sm)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: b,
    onClick: onDecrement
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 30,
      textAlign: 'center',
      font: '500 11px/1 var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, value, unit || ''), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: b,
    onClick: onIncrement
  }, "+"));
}
Object.assign(__ds_scope, { Stepper });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Stepper/Stepper.jsx", error: String((e && e.message) || e) }); }

// components/charts/Transport/Transport.jsx
try { (() => {
function Transport({
  playing = false,
  onPlay,
  rates = ['0.25×', '0.5×', '1×', '2×'],
  rate = '1×',
  onRate,
  windowLabel,
  onWindowIn,
  onWindowOut
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      background: 'var(--surface-raised)',
      borderTop: '1px solid var(--line-strong)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onPlay,
    "aria-label": playing ? 'Pause' : 'Play',
    style: {
      width: 'var(--control-lg)',
      height: 'var(--control-lg)',
      flex: 'none',
      border: 0,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--accent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, playing ? /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "1",
    width: "3.5",
    height: "12",
    fill: "var(--on-accent)"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "8.5",
    y: "1",
    width: "3.5",
    height: "12",
    fill: "var(--on-accent)"
  })) : /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14"
  }, /*#__PURE__*/React.createElement("polygon", {
    points: "3,1 13,7 3,13",
    fill: "var(--on-accent)"
  }))), /*#__PURE__*/React.createElement(__ds_scope.SegmentedControl, {
    mono: true,
    size: "sm",
    options: rates,
    value: rate,
    onChange: onRate
  }), windowLabel && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Stepper, {
    value: windowLabel,
    onDecrement: onWindowIn,
    onIncrement: onWindowOut
  })));
}
Object.assign(__ds_scope, { Transport });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/Transport/Transport.jsx", error: String((e && e.message) || e) }); }

// components/controls/Switch/Switch.jsx
try { (() => {
function Switch({
  checked = false,
  onChange,
  label
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      cursor: 'pointer',
      font: 'var(--type-body)',
      color: 'var(--text)'
    }
  }, label, /*#__PURE__*/React.createElement("span", {
    onClick: () => onChange && onChange(!checked),
    style: {
      marginLeft: 'auto',
      width: 36,
      height: 20,
      borderRadius: 10,
      background: checked ? 'var(--accent)' : 'var(--line-strong)',
      position: 'relative',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: checked ? 'var(--on-accent)' : 'var(--text-muted)'
    }
  })));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Switch/Switch.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState/EmptyState.jsx
try { (() => {
function EmptyState({
  title,
  body,
  detail,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '24px 28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 19px/1.2 var(--font-sans)',
      color: 'var(--text)'
    }
  }, title), body && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 14px/1.45 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, body), detail && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '7px 9px',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-sm)',
      font: '400 11px/1.3 var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, detail), children && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 4
    }
  }, children));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton/Skeleton.jsx
try { (() => {
function Skeleton({
  width = '100%',
  height = 10,
  radius = 2,
  strong = false
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      width,
      height,
      borderRadius: radius,
      background: strong ? 'var(--grid-neutral)' : 'var(--surface-raised)'
    }
  });
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusBanner/StatusBanner.jsx
try { (() => {
function StatusBanner({
  text,
  actionLabel,
  onAction,
  dot = 'idle'
}) {
  const c = {
    idle: 'var(--status-idle)',
    ok: 'var(--status-ok)',
    waiting: 'var(--status-waiting)',
    none: 'transparent'
  }[dot];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 10px',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, dot !== 'none' && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: c,
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: '400 12.5px/1.35 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, text), actionLabel && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    style: {
      flex: 'none',
      padding: '3px 8px',
      border: '1px solid var(--control-border)',
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      color: 'var(--text)',
      font: '500 11.5px/1.2 var(--font-sans)',
      cursor: 'pointer'
    }
  }, actionLabel));
}
Object.assign(__ds_scope, { StatusBanner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusBanner/StatusBanner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusDot/StatusDot.jsx
try { (() => {
function StatusDot({
  status = 'ok',
  label,
  detail
}) {
  const c = {
    ok: 'var(--status-ok)',
    idle: 'var(--status-idle)',
    waiting: 'var(--status-waiting)'
  }[status];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: c,
      flex: 'none'
    }
  }), label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 14px/1.2 var(--font-sans)',
      color: 'var(--text)'
    }
  }, label), detail && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 11px/1.2 var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, detail));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusDot/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/laps/CompareTray/CompareTray.jsx
try { (() => {
function CompareTray({
  colors = [],
  label,
  count,
  onClear,
  onCompare,
  floating = true
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius-md)',
      boxShadow: floating ? 'var(--shadow-float)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 3,
      flex: 'none'
    }
  }, colors.slice(0, 6).map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: c
    }
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 12px/1.2 var(--font-mono)',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      minWidth: 0
    }
  }, label), onClear && /*#__PURE__*/React.createElement("span", {
    onClick: onClear,
    style: {
      flex: 'none',
      font: '500 11px/1 var(--font-mono)',
      color: 'var(--text-muted)',
      cursor: 'pointer'
    }
  }, "Clear"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onCompare,
    style: {
      marginLeft: 'auto',
      flex: 'none',
      border: 0,
      font: '600 13px/1.2 var(--font-sans)',
      color: 'var(--on-accent)',
      background: 'var(--accent)',
      padding: '6px 12px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, "Compare ", count, " \u2192"));
}
Object.assign(__ds_scope, { CompareTray });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/CompareTray/CompareTray.jsx", error: String((e && e.message) || e) }); }

// components/laps/LapChip/LapChip.jsx
try { (() => {
function LapChip({
  label,
  color,
  delta,
  deltaTone = 'neutral',
  isRef = false,
  status = 'ready',
  progress = 0,
  onPress,
  onRemove,
  onRetry
}) {
  const tone = {
    faster: 'var(--faster)',
    slower: 'var(--slower)',
    neutral: 'var(--text-muted)'
  }[deltaTone];
  const failed = status === 'failed',
    queued = status === 'queued',
    loading = status === 'loading';
  return /*#__PURE__*/React.createElement("div", {
    onClick: onPress,
    style: {
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 3,
      padding: '5px 8px',
      background: queued ? 'transparent' : 'var(--surface-raised)',
      border: (queued ? '1px dashed ' : '1px solid ') + (failed ? 'var(--text-faint)' : 'var(--line-strong)'),
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      font: '600 12px/1.2 var(--font-mono)',
      color: failed ? 'var(--text-secondary)' : 'var(--text)'
    }
  }, failed ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 13,
      height: 13,
      borderRadius: '50%',
      border: '1.5px solid var(--text-secondary)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '700 8px/1 var(--font-mono)'
    }
  }, "!") : /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 3,
      background: color,
      opacity: queued ? .5 : 1
    }
  }), label, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 11px/1 var(--font-mono)',
      color: isRef || loading || queued ? 'var(--text-muted)' : tone
    }
  }, isRef ? 'REF' : loading ? Math.round(progress * 100) + '%' : queued ? 'queued' : failed ? '' : delta), failed && /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onRetry && onRetry();
    },
    style: {
      font: '500 11px/1 var(--font-mono)',
      textDecoration: 'underline',
      textUnderlineOffset: 2
    }
  }, "Retry"), !isRef && onRemove && !failed && /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onRemove();
    },
    style: {
      color: 'var(--text-faint)',
      font: '500 13px/1 var(--font-mono)'
    }
  }, "\xD7")), loading && /*#__PURE__*/React.createElement("span", {
    style: {
      height: 2,
      background: 'var(--chart-track)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: 2,
      width: progress * 100 + '%',
      background: 'var(--accent)'
    }
  })));
}
Object.assign(__ds_scope, { LapChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/LapChip/LapChip.jsx", error: String((e && e.message) || e) }); }

// components/laps/LapDetail/LapDetail.jsx
try { (() => {
function LapDetail({
  title,
  status,
  excluded = false,
  tags = [],
  reason,
  actionLabel,
  actionPrimary = true,
  onAction
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      background: 'var(--surface-overlay)',
      border: '1px solid color-mix(in oklch, var(--accent) 50%, transparent)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 14px/1.2 var(--font-mono)',
      color: 'var(--text)'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 11px/1.2 var(--font-mono)',
      color: excluded ? 'var(--accent-ink)' : 'var(--text-secondary)'
    }
  }, status)), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      font: '500 10.5px/1.2 var(--font-mono)',
      color: 'var(--text-secondary)'
    }
  }, tags.map(t => /*#__PURE__*/React.createElement("span", {
    key: t
  }, t))), reason && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 12.5px/1.4 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, reason), actionLabel && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    style: {
      alignSelf: 'flex-start',
      marginTop: 2,
      padding: '5px 10px',
      border: '1px solid var(--accent)',
      borderRadius: 'var(--radius-sm)',
      background: actionPrimary ? 'var(--accent)' : 'transparent',
      color: actionPrimary ? 'var(--on-accent)' : 'var(--text)',
      font: '600 12px/1.2 var(--font-sans)',
      cursor: 'pointer'
    }
  }, actionLabel));
}
Object.assign(__ds_scope, { LapDetail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/LapDetail/LapDetail.jsx", error: String((e && e.message) || e) }); }

// components/laps/LapRow/LapRow.jsx
try { (() => {
function LapRow({
  label,
  time,
  gap,
  gapTone = 'neutral',
  sectors = [],
  tags = [],
  compact = false,
  selectedColor,
  highlighted = false,
  excluded = false,
  onPress,
  onToggle
}) {
  const op = excluded ? 0.5 : 1,
    cols = compact ? '16px 28px 60px 42px 34px 34px 34px minmax(0,1fr)' : '16px 30px 62px 44px 38px 38px 38px minmax(0,1fr)';
  const tagTxt = compact && tags.length ? tags[0] : tags.join(' '),
    more = compact && tags.length > 1 ? ' +' + (tags.length - 1) : '',
    isBest = tags[0] === 'BEST' || tags.includes('BEST');
  return /*#__PURE__*/React.createElement("div", {
    onClick: onPress,
    style: {
      display: 'grid',
      gridTemplateColumns: cols,
      gap: '0 4px',
      alignItems: 'center',
      height: 'var(--row-lap)',
      padding: '0 16px',
      borderBottom: '1px solid var(--line)',
      background: highlighted ? 'var(--accent-tint)' : 'transparent',
      boxShadow: highlighted ? 'inset 3px 0 0 var(--accent)' : 'none',
      font: '400 11.5px/1 var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--text)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: !!selectedColor,
    color: selectedColor,
    onChange: onToggle
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: op,
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: op
    }
  }, time), /*#__PURE__*/React.createElement("span", {
    style: {
      color: gapTone === 'faster' ? 'var(--faster)' : 'var(--text-secondary)'
    }
  }, excluded ? '' : gap), sectors.slice(0, 3).map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      color: s.best ? 'var(--best)' : excluded ? 'var(--text-faint)' : 'var(--text-secondary)'
    }
  }, s.value)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 10px/1.2 var(--font-mono)',
      color: isBest && tagTxt === 'BEST' ? 'var(--best)' : 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden'
    }
  }, tagTxt, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, more)));
}
Object.assign(__ds_scope, { LapRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/LapRow/LapRow.jsx", error: String((e && e.message) || e) }); }

// components/laps/LapTag/LapTag.jsx
try { (() => {
const LBL = {
  best: 'BEST',
  out: 'OUT',
  in: 'IN',
  part: 'PART',
  slow: 'SLOW',
  off: 'OFF',
  hit: 'HIT'
};
function LapTag({
  kind,
  value
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 10px/1.2 var(--font-mono)',
      color: kind === 'best' ? 'var(--best)' : 'var(--text-secondary)',
      whiteSpace: 'nowrap'
    }
  }, LBL[kind], value != null ? ' ' + value : '');
}
/** Tag priority for one-tag rows: exclusion reason > BEST > OFF > HIT. */
const LAP_TAG_PRIORITY = ['out', 'in', 'part', 'slow', 'best', 'off', 'hit'];
Object.assign(__ds_scope, { LapTag, LAP_TAG_PRIORITY });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/LapTag/LapTag.jsx", error: String((e && e.message) || e) }); }

// components/laps/SessionRow/SessionRow.jsx
try { (() => {
function SessionRow({
  type = 'R',
  track,
  car,
  time,
  laps,
  best,
  median,
  selected = false,
  onPress
}) {
  const n = {
    textAlign: 'right',
    font: '500 12px/1 var(--font-mono)',
    fontVariantNumeric: 'tabular-nums'
  };
  return /*#__PURE__*/React.createElement("div", {
    onClick: onPress,
    style: {
      display: 'grid',
      gridTemplateColumns: '22px minmax(0,1fr) 28px 62px 62px',
      gap: 8,
      alignItems: 'center',
      minHeight: 'var(--row-session)',
      boxSizing: 'border-box',
      padding: '8px 16px',
      borderBottom: '1px solid var(--line)',
      background: selected ? 'var(--surface-overlay)' : 'transparent',
      boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : 'none',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      height: 22,
      boxSizing: 'border-box',
      border: '1px solid var(--control-border)',
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '600 11px/1 var(--font-mono)',
      color: 'var(--text)'
    }
  }, type), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-strong)',
      color: 'var(--text)'
    }
  }, track), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 11px/1.3 var(--font-mono)',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, car, " \xB7 ", time)), /*#__PURE__*/React.createElement("span", {
    style: {
      ...n,
      color: 'var(--text)'
    }
  }, laps), /*#__PURE__*/React.createElement("span", {
    style: {
      ...n,
      color: 'var(--text)'
    }
  }, best), /*#__PURE__*/React.createElement("span", {
    style: {
      ...n,
      fontWeight: 400,
      color: 'var(--text-secondary)'
    }
  }, median));
}
Object.assign(__ds_scope, { SessionRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/SessionRow/SessionRow.jsx", error: String((e && e.message) || e) }); }

// components/laps/StintHeader/StintHeader.jsx
try { (() => {
function StintHeader({
  title,
  stats,
  onSelect,
  selectLabel = 'Select stint'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 16px 5px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      font: '600 10px/1.4 var(--font-mono)',
      letterSpacing: '.04em',
      color: 'var(--text-secondary)'
    }
  }, title, stats && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontWeight: 500
    }
  }, stats))), onSelect && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onSelect,
    style: {
      flex: 'none',
      padding: '3px 7px',
      border: '1px solid var(--control-border)',
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      color: 'var(--text)',
      font: '500 10.5px/1.2 var(--font-sans)',
      cursor: 'pointer'
    }
  }, selectLabel));
}
Object.assign(__ds_scope, { StintHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/laps/StintHeader/StintHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lap-analysis/App.jsx
try { (() => {
function App() {
  const [scr, setScr] = React.useState('sessions'),
    [sel, setSel] = React.useState([16, 12, 31]),
    [hl, setHl] = React.useState(9);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 390,
      height: 844,
      borderRadius: 34,
      overflow: 'hidden',
      background: 'var(--bg)',
      boxShadow: '0 0 0 8px #1b1d20,0 30px 80px rgba(0,0,0,.5)',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 46,
      flex: 'none',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      padding: '0 26px 6px',
      font: '500 13px var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "21:58"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "5G 82%")), scr === 'sessions' && /*#__PURE__*/React.createElement(SessionsScreen, {
    onOpen: () => setScr('session')
  }), scr === 'session' && /*#__PURE__*/React.createElement(SessionScreen, {
    sel: sel,
    setSel: setSel,
    hl: hl,
    setHl: setHl,
    onBack: () => setScr('sessions'),
    onCompare: () => setScr('compare')
  }), scr === 'compare' && /*#__PURE__*/React.createElement(CompareScreen, {
    sel: sel,
    setSel: setSel,
    onBack: () => setScr('session')
  })));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lap-analysis/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lap-analysis/Screens.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  SessionRow,
  LapRow,
  StintHeader,
  LapDetail,
  CompareTray,
  LapTimeBars,
  LapChip,
  TimeGrid,
  ChartHeader,
  TraceChart,
  Transport,
  TrackMap,
  Button
} = window.DS;
const COL = ['var(--lap-ref)', 'var(--lap-1)', 'var(--lap-2)', 'var(--lap-3)', 'var(--lap-4)', 'var(--lap-5)'];
const Lbl = ({
  children,
  sub
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '14px 16px 4px'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    font: 'var(--type-label)',
    letterSpacing: 'var(--tracking-label)',
    textTransform: 'uppercase'
  }
}, children), sub && /*#__PURE__*/React.createElement("div", {
  style: {
    font: 'var(--type-explainer)',
    color: 'var(--text-muted)',
    marginTop: 2
  }
}, sub));
function SessionsScreen({
  onOpen
}) {
  const S = window.SAMPLE;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 16px 10px',
      font: 'var(--type-display)'
    }
  }, "Sessions"), S.sessions.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.day
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px 4px',
      font: '600 14px var(--font-sans)'
    }
  }, d.day, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 11px var(--font-mono)',
      color: 'var(--text-faint)'
    }
  }, d.date)), d.rows.map(r => /*#__PURE__*/React.createElement(SessionRow, _extends({
    key: r.id
  }, r, {
    onPress: () => r.id === 'race' && onOpen()
  }))))));
}
function SessionScreen({
  sel,
  setSel,
  hl,
  setHl,
  onBack,
  onCompare
}) {
  const S = window.SAMPLE;
  const colOf = n => {
    const j = sel.indexOf(n);
    return j < 0 ? undefined : COL[j];
  };
  const bars = S.laps.map(l => ({
    delta: l.excluded ? null : l.t - S.med,
    best: l.n === 16,
    color: colOf(l.n)
  }));
  const toggle = n => setSel(s => s.includes(n) ? s.length > 1 && s[0] !== n ? s.filter(x => x !== n) : s : [...s, n].slice(0, 6));
  const H = S.laps.find(l => l.n === hl);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      paddingBottom: 80,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onBack,
    style: {
      font: '500 13px var(--font-sans)',
      color: 'var(--text-muted)',
      cursor: 'pointer'
    }
  }, "\u2039 Sessions"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 22px/1.15 var(--font-sans)',
      marginTop: 4
    }
  }, "Race \xB7 Portim\xE3o"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 13px var(--font-sans)'
    }
  }, "Porsche 911 GT3 R ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontWeight: 400
    }
  }, "\xB7 Manthey #91")), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 11.5px var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, "Today 21:40 \xB7 LMU")), /*#__PURE__*/React.createElement(Lbl, {
    sub: 'Each bar is one lap. Up = faster than the median (' + S.fmt(S.med) + '). Outlined stubs are excluded laps.'
  }, "Lap times"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 16px 0'
    }
  }, /*#__PURE__*/React.createElement(LapTimeBars, {
    laps: bars,
    pits: [21],
    stints: [{
      index: 0,
      label: 'STINT 1'
    }, {
      index: 22,
      label: 'STINT 2'
    }],
    highlight: hl ? hl - 1 : undefined,
    onSelect: i => setHl(i + 1)
  })), H && /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '10px 12px 0'
    }
  }, /*#__PURE__*/React.createElement(LapDetail, {
    title: 'L' + H.n + ' · ' + H.time,
    status: H.excluded ? 'Excluded · ' + H.tags[0] : 'Comparable · ' + (H.t - S.med >= 0 ? '+' : '−') + Math.abs(H.t - S.med).toFixed(3) + ' s vs median',
    excluded: H.excluded,
    tags: H.tags,
    reason: H.excluded ? H.tags[0] === 'SLOW' ? 'More than 1.12 s slower than the stint median (median + 3 robust σ).' : 'Includes pit lane time.' : 'Clean lap.',
    actionLabel: sel.includes(H.n) ? 'Remove from compare' : 'Add to compare',
    actionPrimary: !sel.includes(H.n),
    onAction: () => toggle(H.n)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      borderTop: '1px solid var(--line-strong)'
    }
  }), [1, 2].map(st => /*#__PURE__*/React.createElement("div", {
    key: st
  }, /*#__PURE__*/React.createElement(StintHeader, {
    title: st === 1 ? 'Stint 1 · L1–L22' : 'Stint 2 · L23–L44',
    stats: st === 1 ? 'median 1:41.123 · spread 0.38 s' : 'median 1:41.004 · spread 0.31 s',
    onSelect: () => setSel(s => [s[0], ...S.laps.filter(l => l.st === st && !l.excluded && l.n !== s[0]).map(l => l.n)].slice(0, 6))
  }), S.laps.filter(l => l.st === st).map(l => /*#__PURE__*/React.createElement(LapRow, {
    key: l.n,
    compact: true,
    label: 'L' + l.n,
    time: l.time,
    gap: (l.t - S.med >= 0 ? '+' : '−') + Math.abs(l.t - S.med).toFixed(3),
    gapTone: l.t < S.med ? 'faster' : 'neutral',
    excluded: l.excluded,
    sectors: l.sec.map((v, j) => ({
      value: v.toFixed(1),
      best: l.n === 16 && j === 0
    })),
    tags: l.tags,
    selectedColor: colOf(l.n),
    highlighted: hl === l.n,
    onPress: () => setHl(l.n),
    onToggle: () => toggle(l.n)
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      bottom: 12,
      margin: '0 12px'
    }
  }, /*#__PURE__*/React.createElement(CompareTray, {
    colors: sel.map((_, j) => COL[j]),
    label: sel.map(n => 'L' + n).join(' · '),
    count: sel.length,
    onClear: () => setSel([16]),
    onCompare: onCompare
  })));
}
function CompareScreen({
  sel,
  setSel,
  onBack
}) {
  const S = window.SAMPLE;
  const [c, setC] = React.useState(.42),
    [play, setPlay] = React.useState(false),
    [mode, setMode] = React.useState('track');
  React.useEffect(() => {
    if (!play) return;
    let raf,
      last = performance.now();
    const f = now => {
      setC(x => (x + (now - last) / 40000) % 1);
      last = now;
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [play]);
  const ref = S.laps.find(l => l.n === sel[0]),
    ws = sel.map((n, j) => S.wave(n * .7, j ? 1 : .5, j ? (n % 5 - 2) * 2 : 0));
  const at = v => Math.round(v[Math.round(c * (S.N - 1))]);
  const td = sel.map((n, j) => Array.from({
    length: S.N
  }, (_, i) => j ? (S.laps[n - 1].t - ref.t) * (i / S.N) + Math.sin(i / 9 + n) * .04 : 0));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px 4px',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onBack,
    style: {
      font: '500 13px var(--font-sans)',
      color: 'var(--text-muted)',
      cursor: 'pointer'
    }
  }, "\u2039 Session"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-title)'
    }
  }, "Compare")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '2px 16px 6px',
      font: '600 12.5px var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 9.5px var(--font-mono)',
      letterSpacing: '.08em',
      color: 'var(--text-muted)',
      marginRight: 8
    }
  }, "REFERENCE"), "L", ref.n, " \xB7 ", ref.time, " \xB7 Race best"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      padding: '0 16px 8px',
      overflowX: 'auto'
    }
  }, sel.map((n, j) => {
    const l = S.laps[n - 1],
      d = l.t - ref.t;
    return /*#__PURE__*/React.createElement(LapChip, {
      key: n,
      label: 'L' + n,
      color: COL[j],
      isRef: j === 0,
      delta: (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3),
      deltaTone: d < 0 ? 'faster' : 'slower',
      onPress: () => setSel(s => [n, ...s.filter(x => x !== n)]),
      onRemove: () => setSel(s => s.filter(x => x !== n))
    });
  })), /*#__PURE__*/React.createElement(TrackMap, {
    width: 390,
    height: 230,
    outline: S.track,
    quality: "good",
    mode: mode,
    onModeChange: setMode,
    cars: sel.map((n, j) => ({
      ...S.pos((c + j * .004) % 1),
      color: COL[j]
    })).reverse(),
    sectionLabels: [0, .2, .4, .6, .8].map((f, i) => {
      const p = S.pos(f + .1);
      return {
        x: 179 + (p.x - 179) * .72,
        y: 115 + (p.y - 115) * .72,
        label: 'S' + (i + 1)
      };
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Lbl, {
    sub: 'Seconds vs L' + ref.n + '. Grey = within ±0.10 s.'
  }, "Time per section"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 16px 8px'
    }
  }, /*#__PURE__*/React.createElement(TimeGrid, {
    columns: [{
      label: 'S1',
      sub: 'C1–2'
    }, {
      label: 'S2',
      sub: 'C3–4'
    }, {
      label: 'S3',
      sub: 'C5–6'
    }, {
      label: 'S4',
      sub: 'C7–9'
    }, {
      label: 'S5',
      sub: 'C10–11'
    }],
    rows: sel.slice(1).map((n, j) => {
      const d = S.laps[n - 1].t - ref.t;
      return {
        label: 'L' + n,
        color: COL[j + 1],
        values: [.2, .35, .1, .25, .1].map((w, k) => +(d * w + Math.sin(n + k) * .08).toFixed(2))
      };
    })
  })), [['Time diff', 's vs ref', td, 62, 'Running gap to the reference. Line rising = losing time there.', 0], ['Speed', 'km/h', ws, 104, 'Grey band = where your race laps usually are (10th–90th percentile).', null]].map(([lab, u, series, h, desc, z]) => /*#__PURE__*/React.createElement("div", {
    key: lab,
    style: {
      padding: '8px 16px 6px',
      borderTop: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement(ChartHeader, {
    label: lab,
    unit: u,
    description: desc,
    values: sel.map((n, j) => ({
      color: COL[j],
      text: lab === 'Speed' ? String(at(series[j])) : (series[j][Math.round(c * (S.N - 1))] >= 0 ? '+' : '−') + Math.abs(series[j][Math.round(c * (S.N - 1))]).toFixed(3)
    }))
  }), /*#__PURE__*/React.createElement(TraceChart, {
    height: h,
    zero: z == null ? undefined : z,
    band: lab === 'Speed' ? {
      lo: ws[0].map(v => v - 9),
      hi: ws[0].map(v => v + 7)
    } : undefined,
    cursor: c,
    onScrub: v => {
      setPlay(false);
      setC(v);
    },
    traces: series.map((v, j) => ({
      values: v,
      color: COL[j],
      width: j ? 1.5 : 2.3
    }))
  })))), /*#__PURE__*/React.createElement(Transport, {
    playing: play,
    onPlay: () => setPlay(p => !p),
    rate: "1\xD7",
    windowLabel: "2 s"
  }));
}
Object.assign(window, {
  SessionsScreen,
  SessionScreen,
  CompareScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lap-analysis/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lap-analysis/data.jsx
try { (() => {
// Synthetic sample session: Portimão, 911 GT3 R, 44-lap race in 2 stints.
(function () {
  let s = 11;
  const r = () => {
    s = s * 16807 % 2147483647;
    return s / 2147483647;
  };
  const fmt = t => {
    const m = Math.floor(t / 60),
      x = t - m * 60;
    return m + ':' + (x < 10 ? '0' : '') + x.toFixed(3);
  };
  const ex = {
    1: 'OUT',
    22: 'IN',
    23: 'OUT',
    9: 'SLOW',
    30: 'SLOW'
  };
  const laps = Array.from({
    length: 44
  }, (_, i) => {
    const n = i + 1,
      st = n <= 22 ? 1 : 2,
      base = 101.1 + (st === 1 ? n / 22 * .25 : (n - 23) / 21 * .2) + (r() - .5) * .8,
      add = ex[n] === 'OUT' ? 11 : ex[n] === 'IN' ? 24 : ex[n] === 'SLOW' ? 3.4 : 0,
      t = base + add;
    const s1 = 34.2 + (r() - .5) * .4,
      s2 = 31.8 + (r() - .5) * .4;
    return {
      n,
      st,
      t,
      time: fmt(t),
      excluded: !!ex[n],
      tags: [ex[n], n === 16 ? 'BEST' : null, n === 6 ? 'OFF 1.6' : null, n === 30 ? 'HIT' : null].filter(Boolean),
      sec: [s1, s2, t - s1 - s2]
    };
  });
  laps[15].t = 99.733;
  laps[15].time = fmt(99.733);
  const comp = laps.filter(l => !l.excluded).map(l => l.t).sort((a, b) => a - b),
    med = comp[comp.length >> 1];
  const N = 160,
    wave = (ph, a, o) => Array.from({
      length: N
    }, (_, i) => {
      const t = i / N;
      return 150 + 62 * Math.sin(t * Math.PI * 2.4 + .4) + 9 * Math.sin(t * 22 + ph) * a + o;
    });
  const track = (() => {
    let d = '';
    for (let i = 0; i <= 200; i++) {
      const a = i / 200 * Math.PI * 2,
        x = 179 + 140 * Math.cos(a) + 26 * Math.cos(3 * a),
        y = 115 + 80 * Math.sin(a) + 18 * Math.sin(2 * a);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  })();
  const pos = f => {
    const a = f * Math.PI * 2;
    return {
      x: 179 + 140 * Math.cos(a) + 26 * Math.cos(3 * a),
      y: 115 + 80 * Math.sin(a) + 18 * Math.sin(2 * a)
    };
  };
  window.SAMPLE = {
    laps,
    med,
    fmt,
    wave,
    N,
    track,
    pos,
    sessions: [{
      day: 'Today',
      date: 'Sat 27 Sep',
      rows: [{
        id: 'race',
        type: 'R',
        track: 'Portimão',
        car: '911 GT3 R',
        time: '21:40',
        laps: 44,
        best: '1:39.733',
        median: fmt(med)
      }, {
        id: 'q',
        type: 'Q',
        track: 'Portimão',
        car: '911 GT3 R',
        time: '20:10',
        laps: 7,
        best: '1:40.729',
        median: '1:40.932'
      }]
    }, {
      day: 'Thursday',
      date: '25 Sep',
      rows: [{
        id: 'p',
        type: 'P',
        track: 'Portimão',
        car: '911 GT3 R',
        time: '19:05',
        laps: 18,
        best: '1:40.214',
        median: '1:41.402'
      }]
    }, {
      day: 'Monday',
      date: '22 Sep',
      rows: [{
        id: 'spa',
        type: 'P',
        track: 'Spa',
        car: 'Mercedes-AMG GT3 Evo',
        time: '20:30',
        laps: 26,
        best: '2:18.412',
        median: '2:19.630'
      }]
    }]
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lap-analysis/data.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ChartHeader = __ds_scope.ChartHeader;

__ds_ns.DotStrip = __ds_scope.DotStrip;

__ds_ns.LapTimeBars = __ds_scope.LapTimeBars;

__ds_ns.TimeGrid = __ds_scope.TimeGrid;

__ds_ns.TraceChart = __ds_scope.TraceChart;

__ds_ns.TrackMap = __ds_scope.TrackMap;

__ds_ns.Transport = __ds_scope.Transport;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Stepper = __ds_scope.Stepper;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.StatusBanner = __ds_scope.StatusBanner;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.CompareTray = __ds_scope.CompareTray;

__ds_ns.LapChip = __ds_scope.LapChip;

__ds_ns.LapDetail = __ds_scope.LapDetail;

__ds_ns.LapRow = __ds_scope.LapRow;

__ds_ns.LapTag = __ds_scope.LapTag;

__ds_ns.LAP_TAG_PRIORITY = __ds_scope.LAP_TAG_PRIORITY;

__ds_ns.SessionRow = __ds_scope.SessionRow;

__ds_ns.StintHeader = __ds_scope.StintHeader;

})();
