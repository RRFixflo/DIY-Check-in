/* DIY Inventory floor plans: the editor, the drawing and the exports, shared by the app (public/index.html,
   the optional "Floor plan" step) and the standalone tool (/floor-plan/create). Plain JS, no build, no framework.
   Also loaded by the server (require('./public/floorplan')) to draw the sample plan on /floor-plan.

   A plan is plain JSON, sizes in metres:
     { v:1, unit:'m'|'ft', north:false, address:'', floors:['Ground floor', …],
       rooms:[{ id, name, floor, w, l, x, y, stairs, openings:[{ id, type:'door'|'window', wall:'n'|'e'|'s'|'w', pos, width, flip }] }] }
   w is the room's size across the page, l down the page; x, y its top-left corner (null until placed);
   an opening's pos is the distance of its centre from the start of its wall (the left or the top end).

   The guided way through is three steps: 1 Rooms (tick rooms, type width × length), 2 Plan (laid out for
   you straight away; dragging, turning, doors and windows are optional), 3 Finish (download). */
(function (root) {
  'use strict';
  var PRICE = 9.55, PRICE_TEXT = '£9.55';
  var PRESETS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'WC', 'Hallway', 'Dining room', 'Utility', 'Study', 'Landing', 'Stairs', 'Garage', 'Conservatory', 'Other'];
  var FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor'];
  var T = 0.12;          // wall thickness (m)
  var GRID = 0.1;        // snap (m)
  var M2FT2 = 10.7639;
  var NOTE = 'Not to scale. For illustration only. Measurements are approximate and must not be relied on.';

  var uid = function (p) { return p + Math.random().toString(36).slice(2, 9); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var snap = function (v) { return Math.round(v / GRID) * GRID; };
  var round2 = function (v) { return Math.round(v * 100) / 100; };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ------------------------------------------------------------------ model */
  function blank(o) {
    o = o || {};
    return { v: 1, unit: 'm', north: false, address: o.address || '', floors: ['Ground floor'], rooms: [], updatedAt: '' };
  }
  function newRoom(name, floor) {
    return { id: uid('fr'), name: name || 'Room', floor: floor || 0, w: 0, l: 0, x: null, y: null, stairs: /stair/i.test(name || ''), openings: [] };
  }
  function fromNames(names, o) {
    var p = blank(o);
    (names || []).forEach(function (n) { if (String(n || '').trim()) p.rooms.push(newRoom(String(n).trim().slice(0, 40), 0)); });
    return p;
  }
  function normalize(p) {
    p = p && typeof p === 'object' ? clone(p) : blank();
    var out = blank();
    out.unit = p.unit === 'ft' ? 'ft' : 'm';
    out.north = !!p.north;
    out.address = String(p.address || '').slice(0, 200);
    out.updatedAt = String(p.updatedAt || '');
    out.floors = Array.isArray(p.floors) && p.floors.length ? p.floors.slice(0, 8).map(function (f, i) { return String(f || FLOOR_NAMES[i] || 'Floor ' + i).slice(0, 30); }) : ['Ground floor'];
    out.rooms = (Array.isArray(p.rooms) ? p.rooms : []).slice(0, 80).map(function (r) {
      var x = r.x == null || !isFinite(+r.x) ? null : +r.x, y = r.y == null || !isFinite(+r.y) ? null : +r.y;
      return {
        id: String(r.id || uid('fr')).slice(0, 20), name: String(r.name || 'Room').slice(0, 40), floor: clamp(parseInt(r.floor, 10) || 0, 0, out.floors.length - 1),
        w: clamp(num(r.w), 0, 60), l: clamp(num(r.l), 0, 60), x: x, y: y, stairs: !!r.stairs,
        openings: (Array.isArray(r.openings) ? r.openings : []).slice(0, 12).map(function (o) {
          return { id: String(o.id || uid('fo')).slice(0, 20), type: o.type === 'window' ? 'window' : 'door', wall: 'nesw'.indexOf(o.wall) >= 0 && o.wall ? o.wall : 's', pos: num(o.pos), width: clamp(num(o.width) || 0.8, 0.3, 6), flip: !!o.flip };
        })
      };
    });
    return out;
  }
  var sized = function (r) { return r.w >= 0.3 && r.l >= 0.3; };
  function floorRooms(p, fi) { return p.rooms.filter(function (r) { return (r.floor || 0) === fi && sized(r); }); }
  function hasPlan(p) { return !!(p && Array.isArray(p.rooms) && p.rooms.some(sized)); }
  function bounds(rooms) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    rooms.forEach(function (r) { if (r.x == null) return; b.x0 = Math.min(b.x0, r.x); b.y0 = Math.min(b.y0, r.y); b.x1 = Math.max(b.x1, r.x + r.w); b.y1 = Math.max(b.y1, r.y + r.l); });
    if (!isFinite(b.x0)) b = { x0: 0, y0: 0, x1: 6, y1: 4 };
    return b;
  }
  function stats(p) {
    var floors = p.floors.map(function (name, fi) {
      var rs = floorRooms(p, fi), area = rs.reduce(function (a, r) { return a + r.w * r.l; }, 0);
      return { name: name, rooms: rs.length, area: area };
    });
    var total = floors.reduce(function (a, f) { return a + f.area; }, 0);
    return { floors: floors, total: total, rooms: floors.reduce(function (a, f) { return a + f.rooms; }, 0) };
  }

  // A sensible starting layout: the biggest rooms first, in rows about as wide as the floor is deep, all touching.
  function arrange(p, fi) {
    var rs = floorRooms(p, fi).slice().sort(function (a, b) { return b.w * b.l - a.w * a.l; });
    if (!rs.length) return;
    var area = rs.reduce(function (a, r) { return a + r.w * r.l; }, 0);
    var widest = Math.max.apply(null, rs.map(function (r) { return r.w; }));
    var rowW = Math.max(widest, Math.sqrt(area) * 1.35);
    var x = 0, y = 0, rowH = 0;
    rs.forEach(function (r) {
      if (x > 0 && x + r.w > rowW + 0.01) { x = 0; y = round2(y + rowH); rowH = 0; }
      r.x = round2(x); r.y = round2(y); x += r.w; rowH = Math.max(rowH, r.l);
    });
  }
  // Rooms that have a size but no place yet: a floor with nothing placed is laid out; otherwise each new room goes on the right.
  function place(p) {
    p.floors.forEach(function (f, fi) {
      var rs = floorRooms(p, fi), placed = rs.filter(function (r) { return r.x != null; }), todo = rs.filter(function (r) { return r.x == null; });
      if (!todo.length) return;
      if (!placed.length) { arrange(p, fi); return; }
      var b = bounds(placed), x = b.x1, y = b.y0;
      todo.forEach(function (r) { r.x = round2(x); r.y = round2(y); y += r.l; if (y - b.y0 > (b.y1 - b.y0) + 0.01) { y = b.y0; x = round2(x + r.w); } });
    });
  }
  function prepare(plan) { var p = normalize(plan); place(p); return p; }

  // Turn a room a quarter turn clockwise, about its centre, with its doors and windows.
  function rotate(r) {
    var cx = r.x + r.w / 2, cy = r.y + r.l / 2, ow = r.w, ol = r.l;
    r.w = ol; r.l = ow;
    r.x = round2(snap(cx - r.w / 2)); r.y = round2(snap(cy - r.l / 2));
    r.openings.forEach(function (o) {
      if (o.wall === 'n') o.wall = 'e';
      else if (o.wall === 'e') { o.wall = 's'; o.pos = r.w - o.pos; o.flip = !o.flip; }
      else if (o.wall === 's') o.wall = 'w';
      else { o.wall = 'n'; o.pos = r.w - o.pos; o.flip = !o.flip; }
    });
  }

  /* ------------------------------------------------------------- formatting */
  function ftIn(m) { var t = Math.round(m / 0.0254), ft = Math.floor(t / 12), inch = t % 12; return { ft: ft, inch: inch }; }
  function fmtFt(m) { var f = ftIn(m); return f.ft + "' " + f.inch + '"'; }
  function fmtM(m) { return m.toFixed(2) + ' m'; }
  function fmtLen(m, unit) { return unit === 'ft' ? fmtFt(m) : fmtM(m); }
  function dimM(r) { return fmtM(r.w) + ' × ' + fmtM(r.l); }
  function dimFt(r) { return fmtFt(r.w) + ' × ' + fmtFt(r.l); }
  function areaText(a) { return a.toFixed(1) + ' m²'; }
  function areaFt(a) { return Math.round(a * M2FT2).toLocaleString('en-GB') + ' ft²'; }
  function labelLines(r, unit) {
    var a = r.w * r.l, dims = unit === 'ft' ? [dimFt(r), dimM(r)] : [dimM(r), dimFt(r)];
    var out = [{ t: r.name, b: true }, { t: dims[0] }, { t: dims[1] }];
    if (!r.stairs) out.push({ t: areaText(a) + ' · ' + areaFt(a) });
    return out;
  }
  // Fit the label inside the room: as large as it can be (at most 0.3 m high), across or, for a long thin room, along it.
  function fitLabel(r, unit) {
    var all = labelLines(r, unit);
    function tryFit(lines, rot) {
      var along = (rot ? r.l : r.w) * 0.86, across = (rot ? r.w : r.l) * 0.8;
      var fs = Math.min(0.3, across / (lines.length * 1.28));
      lines.forEach(function (ln) { fs = Math.min(fs, along / Math.max(1, ln.t.length * (ln.b ? 0.6 : 0.54))); });
      return fs;
    }
    for (var n = all.length; n >= 1; n--) {
      var lines = all.slice(0, n);
      var h = tryFit(lines, false), v = tryFit(lines, true);
      var rot = v > h * 1.3, fs = rot ? v : h;
      if (fs >= 0.105 || n === 1) return { lines: lines, fs: Math.max(fs, 0.07), rot: rot };
    }
  }

  /* --------------------------------------------------------------- geometry */
  function wallOf(r, wall) {
    if (wall === 'n') return { x: r.x, y: r.y, ax: 1, ay: 0, nx: 0, ny: 1, len: r.w };
    if (wall === 's') return { x: r.x, y: r.y + r.l, ax: 1, ay: 0, nx: 0, ny: -1, len: r.w };
    if (wall === 'w') return { x: r.x, y: r.y, ax: 0, ay: 1, nx: 1, ny: 0, len: r.l };
    return { x: r.x + r.w, y: r.y, ax: 0, ay: 1, nx: -1, ny: 0, len: r.l };
  }
  function openingGeom(r, o) {
    var w = wallOf(r, o.wall), wd = Math.min(o.width, Math.max(0.3, w.len - 0.1)), pos = clamp(o.pos, wd / 2, w.len - wd / 2);
    var a = { x: w.x + w.ax * (pos - wd / 2), y: w.y + w.ay * (pos - wd / 2) }, b = { x: w.x + w.ax * (pos + wd / 2), y: w.y + w.ay * (pos + wd / 2) };
    var hinge = o.flip ? b : a, other = o.flip ? a : b;
    return { w: w, wd: wd, pos: pos, a: a, b: b, hinge: hinge, other: other, tip: { x: hinge.x + w.nx * wd, y: hinge.y + w.ny * wd } };
  }
  // The edges of rooms on the same floor that a moved room should line up with.
  function snapEdges(r, x, y, others, tol) {
    var bx = null, by = null, dx = tol, dy = tol;
    others.forEach(function (o) {
      var nearY = y < o.y + o.l + tol && y + r.l > o.y - tol, nearX = x < o.x + o.w + tol && x + r.w > o.x - tol;
      var cx = [], cy = [];
      if (nearY) cx.push([x, o.x + o.w], [x + r.w, o.x]);
      if (nearX) cx.push([x, o.x], [x + r.w, o.x + o.w]);
      if (nearX) cy.push([y, o.y + o.l], [y + r.l, o.y]);
      if (nearY) cy.push([y, o.y], [y + r.l, o.y + o.l]);
      cx.forEach(function (c) { var d = Math.abs(c[0] - c[1]); if (d < dx) { dx = d; bx = x + c[1] - c[0]; } });
      cy.forEach(function (c) { var d = Math.abs(c[0] - c[1]); if (d < dy) { dy = d; by = y + c[1] - c[0]; } });
    });
    return { x: bx != null ? round2(bx) : round2(snap(x)), y: by != null ? round2(by) : round2(snap(y)) };
  }

  /* ---------------------------------------------------------------- drawing */
  var LIGHT = { bg: '#FBF8F2', grid: '#EFE7D9', grid2: '#E2D5BF', room: '#F5EFE4', roomSel: '#EEE0C6', wall: '#1B2E4B', paper: '#FFFFFF', text: '#13213A', soft: '#4A5568', sel: '#C49A6C' };
  var DARK = { bg: '#0F1A2D', grid: '#17243B', grid2: '#203250', room: '#1C2C49', roomSel: '#2B4066', wall: '#E8D5B5', paper: '#0F1A2D', text: '#F1EADF', soft: '#B9B2A5', sel: '#D9B37C' };
  var FONT = "Helvetica, Arial, 'Segoe UI', sans-serif";
  function f3(v) { return Math.round(v * 1000) / 1000; }

  // The inside of an SVG for one floor, in metres. o: { pal, unit, sel:{room, open}, hit:true for the editor }
  function floorSVG(p, fi, o) {
    o = o || {};
    var pal = o.pal || LIGHT, rs = floorRooms(p, fi).filter(function (r) { return r.x != null; }), sel = o.sel || {}, out = [];
    rs.forEach(function (r) {
      out.push('<g' + (o.hit ? ' data-room="' + esc(r.id) + '" style="cursor:move"' : '') + '><rect x="' + f3(r.x) + '" y="' + f3(r.y) + '" width="' + f3(r.w) + '" height="' + f3(r.l) + '" fill="' + (sel.room === r.id && !sel.open ? pal.roomSel : pal.room) + '"/></g>');
    });
    rs.forEach(function (r) { if (r.stairs) out.push(stairsSVG(r, pal)); });
    rs.forEach(function (r) { out.push('<rect x="' + f3(r.x) + '" y="' + f3(r.y) + '" width="' + f3(r.w) + '" height="' + f3(r.l) + '" fill="none" stroke="' + pal.wall + '" stroke-width="' + T + '" stroke-linejoin="miter" pointer-events="none"/>'); });
    rs.forEach(function (r) {
      r.openings.forEach(function (op) {
        var g = openingGeom(r, op), w = g.w, half = (T + 0.03) / 2, gx, gy, gw, gh;
        if (w.ax) { gx = g.a.x; gy = w.y - half; gw = g.wd; gh = half * 2; } else { gx = w.x - half; gy = g.a.y; gw = half * 2; gh = g.wd; }
        var s = ['<g pointer-events="none">', '<rect x="' + f3(gx) + '" y="' + f3(gy) + '" width="' + f3(gw) + '" height="' + f3(gh) + '" fill="' + pal.paper + '"/>'];
        if (op.type === 'door') {
          var ax = g.other.x - g.hinge.x, ay = g.other.y - g.hinge.y, cross = w.nx * ay - w.ny * ax;
          s.push('<line x1="' + f3(g.hinge.x) + '" y1="' + f3(g.hinge.y) + '" x2="' + f3(g.tip.x) + '" y2="' + f3(g.tip.y) + '" stroke="' + pal.wall + '" stroke-width="0.04"/>');
          s.push('<path d="M' + f3(g.tip.x) + ' ' + f3(g.tip.y) + ' A' + f3(g.wd) + ' ' + f3(g.wd) + ' 0 0 ' + (cross > 0 ? 1 : 0) + ' ' + f3(g.other.x) + ' ' + f3(g.other.y) + '" fill="none" stroke="' + pal.wall + '" stroke-width="0.02" stroke-dasharray="0.06 0.04"/>');
        } else {
          [-T / 2, 0, T / 2].forEach(function (d) {
            s.push('<line x1="' + f3(g.a.x + w.nx * d) + '" y1="' + f3(g.a.y + w.ny * d) + '" x2="' + f3(g.b.x + w.nx * d) + '" y2="' + f3(g.b.y + w.ny * d) + '" stroke="' + pal.wall + '" stroke-width="' + (d ? 0.025 : 0.018) + '"/>');
          });
          [g.a, g.b].forEach(function (pt) { s.push('<line x1="' + f3(pt.x - w.nx * T / 2) + '" y1="' + f3(pt.y - w.ny * T / 2) + '" x2="' + f3(pt.x + w.nx * T / 2) + '" y2="' + f3(pt.y + w.ny * T / 2) + '" stroke="' + pal.wall + '" stroke-width="0.025"/>'); });
        }
        s.push('</g>');
        out.push(s.join(''));
        if (o.hit) {
          var cx = (g.a.x + g.b.x) / 2, cy = (g.a.y + g.b.y) / 2, on = sel.room === r.id && sel.open === op.id, hw = w.ax ? g.wd : 0.6, hh = w.ax ? 0.6 : g.wd;
          out.push('<g data-open="' + esc(r.id + ':' + op.id) + '" style="cursor:pointer"><rect x="' + f3(cx - hw / 2) + '" y="' + f3(cy - hh / 2) + '" width="' + f3(hw) + '" height="' + f3(hh) + '" fill="transparent"/>' +
            (on ? '<rect x="' + f3(cx - hw / 2) + '" y="' + f3(cy - hh / 2) + '" width="' + f3(hw) + '" height="' + f3(hh) + '" rx="0.08" fill="none" stroke="' + pal.sel + '" stroke-width="0.05"/>' : '') + '</g>');
        }
      });
    });
    rs.forEach(function (r) {
      var L = fitLabel(r, p.unit), fs = L.fs, lh = fs * 1.28, cx = r.x + r.w / 2, cy = r.y + r.l / 2, top = -((L.lines.length - 1) * lh) / 2;
      var t = L.lines.map(function (ln, i) {
        return '<text x="0" y="' + f3((top + i * lh) * 100) + '" font-size="' + f3((ln.b ? fs * 1.05 : fs * 0.88) * 100) + '" font-weight="' + (ln.b ? 700 : 400) + '" fill="' + (ln.b ? pal.text : pal.soft) + '" text-anchor="middle" dominant-baseline="central"' + (r.stairs ? ' stroke="' + pal.room + '" stroke-width="' + f3(fs * 0.3) + '" paint-order="stroke"' : '') + '>' + esc(ln.t) + '</text>';
      }).join('');
      // Drawn at 100× and scaled down: iPhone Safari leaves out SVG text with a very small font size.
      out.push('<g transform="translate(' + f3(cx) + ' ' + f3(cy) + ') scale(0.01)' + (L.rot ? ' rotate(-90)' : '') + '" font-family="' + FONT + '" text-rendering="geometricPrecision" pointer-events="none">' + t + '</g>');
    });
    var s2 = rs.filter(function (r) { return r.id === sel.room && !sel.open; })[0];
    // While editing, the selected room shows the length of every wall, and a selected door or window its width and distance to each corner.
    var s3 = o.hit && rs.filter(function (r) { return r.id === sel.room; })[0];
    if (s3) {
      var sop = sel.open && s3.openings.filter(function (q) { return q.id === sel.open; })[0];
      if (sop) {
        var g3 = openingGeom(s3, sop), w3 = g3.w, st3 = g3.pos - g3.wd / 2, en3 = g3.pos + g3.wd / 2;
        if (st3 > 0.05) out.push(dimSVG(w3, 0, st3, p.unit, pal));
        out.push(dimSVG(w3, st3, en3, p.unit, pal, true));
        if (w3.len - en3 > 0.05) out.push(dimSVG(w3, en3, w3.len, p.unit, pal));
      } else ['n', 'e', 's', 'w'].forEach(function (k) { var w4 = wallOf(s3, k); out.push(dimSVG(w4, 0, w4.len, p.unit, pal)); });
    }
    if (s2) out.push('<rect x="' + f3(s2.x + 0.1) + '" y="' + f3(s2.y + 0.1) + '" width="' + f3(Math.max(0.05, s2.w - 0.2)) + '" height="' + f3(Math.max(0.05, s2.l - 0.2)) + '" fill="none" stroke="' + pal.sel + '" stroke-width="0.06" stroke-dasharray="0.18 0.1" pointer-events="none"/>');
    return out.join('');
  }
  // A measurement along a wall, just inside the room: a line with end ticks and its length in the middle.
  function dimSVG(w, from, to, unit, pal, strong) {
    var off = 0.32, tk = 0.09, P = function (t, d) { return { x: w.x + w.ax * t + w.nx * d, y: w.y + w.ay * t + w.ny * d }; };
    var a = P(from, off), b = P(to, off), c = P((from + to) / 2, off), col = strong ? pal.sel : pal.soft, s = [];
    var ln = function (p1, p2, sw) { s.push('<line x1="' + f3(p1.x) + '" y1="' + f3(p1.y) + '" x2="' + f3(p2.x) + '" y2="' + f3(p2.y) + '" stroke="' + col + '" stroke-width="' + sw + '"/>'); };
    ln(a, b, 0.02); ln(P(from, off - tk), P(from, off + tk), 0.025); ln(P(to, off - tk), P(to, off + tk), 0.025);
    var fs = Math.min(0.19, Math.max(0.1, (to - from) / 4.2));
    s.push('<g transform="translate(' + f3(c.x) + ' ' + f3(c.y) + ') scale(0.01)' + (w.ay ? ' rotate(-90)' : '') + '"><text x="0" y="0" font-size="' + f3(fs * 100) + '" font-weight="700" fill="' + col + '" stroke="' + pal.room + '" stroke-width="' + f3(fs * 35) + '" paint-order="stroke" text-anchor="middle" dominant-baseline="central" font-family="' + FONT + '">' + esc(fmtLen(to - from, unit)) + '</text></g>');
    return '<g pointer-events="none" class="fp-dim">' + s.join('') + '</g>';
  }
  function stairsSVG(r, pal) {
    var along = r.l >= r.w, n = Math.max(2, Math.floor((along ? r.l : r.w) / 0.25)), s = [], i, step = (along ? r.l : r.w) / n;
    for (i = 1; i < n; i++) {
      if (along) s.push('<line x1="' + f3(r.x + 0.06) + '" y1="' + f3(r.y + i * step) + '" x2="' + f3(r.x + r.w - 0.06) + '" y2="' + f3(r.y + i * step) + '" stroke="' + pal.soft + '" stroke-width="0.015"/>');
      else s.push('<line x1="' + f3(r.x + i * step) + '" y1="' + f3(r.y + 0.06) + '" x2="' + f3(r.x + i * step) + '" y2="' + f3(r.y + r.l - 0.06) + '" stroke="' + pal.soft + '" stroke-width="0.015"/>');
    }
    var x1 = along ? r.x + r.w / 2 : r.x + 0.2, y1 = along ? r.y + r.l - 0.2 : r.y + r.l / 2, x2 = along ? x1 : r.x + r.w - 0.2, y2 = along ? r.y + 0.2 : y1;
    var ah = 0.16, dx = along ? 0 : 1, dy = along ? -1 : 0;
    s.push('<line x1="' + f3(x1) + '" y1="' + f3(y1) + '" x2="' + f3(x2) + '" y2="' + f3(y2) + '" stroke="' + pal.wall + '" stroke-width="0.025"/>');
    s.push('<path d="M' + f3(x2 - dx * ah - dy * ah * 0.6) + ' ' + f3(y2 - dy * ah + dx * ah * 0.6) + ' L' + f3(x2) + ' ' + f3(y2) + ' L' + f3(x2 - dx * ah + dy * ah * 0.6) + ' ' + f3(y2 - dy * ah - dx * ah * 0.6) + '" fill="none" stroke="' + pal.wall + '" stroke-width="0.025"/>');
    return '<g pointer-events="none">' + s.join('') + '</g>';
  }
  function northSVG(x, y, size, pal) {
    return '<g transform="translate(' + f3(x) + ' ' + f3(y) + ')"><circle r="' + f3(size / 2) + '" fill="none" stroke="' + pal.soft + '" stroke-width="' + f3(size * 0.04) + '"/>' +
      '<path d="M0 ' + f3(-size * 0.4) + ' L' + f3(size * 0.16) + ' ' + f3(size * 0.22) + ' L0 ' + f3(size * 0.1) + ' L' + f3(-size * 0.16) + ' ' + f3(size * 0.22) + 'Z" fill="' + pal.wall + '"/>' +
      '<text y="' + f3(-size * 62) + '" font-size="' + f3(size * 32) + '" font-weight="700" fill="' + pal.text + '" text-anchor="middle" font-family="' + FONT + '" transform="scale(0.01)">N</text></g>';
  }
  // One floor as a self-contained SVG (previews, the sample on /floor-plan).
  function floorPreview(p, fi, o) {
    o = o || {};
    var rs = floorRooms(p, fi), b = bounds(rs), m = o.margin == null ? 0.4 : o.margin;
    var vb = [b.x0 - m, b.y0 - m - (p.north ? 1 : 0), b.x1 - b.x0 + 2 * m, b.y1 - b.y0 + 2 * m + (p.north ? 1 : 0)];
    var pal = o.pal || LIGHT;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.map(f3).join(' ') + '"' + (o.width ? ' width="' + o.width + '"' : '') + ' role="img" aria-label="' + esc((p.floors[fi] || 'Floor') + ' plan') + '">' +
      (o.bg ? '<rect x="' + f3(vb[0]) + '" y="' + f3(vb[1]) + '" width="' + f3(vb[2]) + '" height="' + f3(vb[3]) + '" fill="' + pal.bg + '"/>' : '') +
      floorSVG(p, fi, { pal: pal }) + (p.north ? northSVG(b.x1 - 0.2, b.y0 - 0.75, 0.8, pal) : '') + '</svg>';
  }
  // Every floor on one picture, with the address, the floor areas and the note: the PNG download.
  function sheetSVG(plan, meta) {
    meta = meta || {};
    var p = prepare(plan), st = stats(p), pal = LIGHT, W = 1400, padX = 70, k, blocks = [], y = 150;
    var fl = p.floors.map(function (n, i) { return i; }).filter(function (i) { return st.floors[i].rooms; });
    var maxW = Math.max.apply(null, fl.map(function (i) { var b = bounds(floorRooms(p, i)); return b.x1 - b.x0; }).concat([1]));
    k = Math.min(90, (W - padX * 2) / (maxW + 0.6));
    fl.forEach(function (i) {
      var b = bounds(floorRooms(p, i)), bw = (b.x1 - b.x0) * k, bh = (b.y1 - b.y0) * k, ox = (W - bw) / 2;
      blocks.push('<text x="' + padX + '" y="' + (y + 26) + '" font-size="26" font-weight="700" fill="' + pal.text + '">' + esc(p.floors[i]) + '</text><text x="' + (W - padX) + '" y="' + (y + 26) + '" font-size="21" fill="' + pal.soft + '" text-anchor="end">' + esc(areaText(st.floors[i].area) + ' · ' + areaFt(st.floors[i].area)) + '</text>');
      blocks.push('<g transform="translate(' + f3(ox - b.x0 * k) + ' ' + f3(y + 60 - b.y0 * k) + ') scale(' + f3(k) + ')">' + floorSVG(p, i, { pal: pal }) + '</g>');
      y += 60 + bh + 70;
    });
    var H = y + 90;
    var head = '<rect width="' + W + '" height="' + H + '" fill="#FFFFFF"/><rect width="' + W + '" height="8" fill="' + pal.wall + '"/>' +
      '<text x="' + padX + '" y="64" font-size="34" font-weight="800" fill="' + pal.text + '">Floor plan</text>' +
      '<text x="' + padX + '" y="104" font-size="22" fill="' + pal.soft + '">' + esc([p.address || meta.address, meta.date || today()].filter(Boolean).join('  ·  ')) + '</text>' +
      '<text x="' + (W - padX) + '" y="64" font-size="22" font-weight="700" fill="' + pal.text + '" text-anchor="end">Total ' + esc(areaText(st.total)) + '</text>' +
      '<text x="' + (W - padX) + '" y="96" font-size="19" fill="' + pal.soft + '" text-anchor="end">' + esc(areaFt(st.total) + ' internal area') + '</text>' +
      (p.north ? northSVG(W - padX - 330, 70, 56, pal) : '');
    var foot = '<line x1="' + padX + '" y1="' + (H - 62) + '" x2="' + (W - padX) + '" y2="' + (H - 62) + '" stroke="#E4D9C6" stroke-width="2"/>' +
      '<text x="' + padX + '" y="' + (H - 30) + '" font-size="18" fill="' + pal.soft + '">' + esc(NOTE) + '</text>' +
      '<text x="' + (W - padX) + '" y="' + (H - 30) + '" font-size="18" font-weight="700" fill="' + pal.text + '" text-anchor="end">DIY Inventory</text>';
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + Math.round(H) + '" viewBox="0 0 ' + W + ' ' + Math.round(H) + '" font-family="' + FONT + '">' + head + blocks.join('') + foot + '</svg>', width: W, height: Math.round(H) };
  }
  function today() { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }

  /* -------------------------------------------------------------------- PDF */
  var PDF_PAL = { wall: [27, 46, 75], room: [245, 239, 228], paper: [255, 255, 255], text: [19, 33, 58], soft: [74, 85, 104], faint: [138, 134, 124], line: [228, 217, 198] };
  // Draws one floor into a jsPDF document (unit mm) inside box {x, y, w, h}. Used by the report (buildPdfBlob) and pdf() below.
  function drawPdf(doc, plan, fi, box, o) {
    o = o || {};
    var pal = {}, k; for (k in PDF_PAL) pal[k] = (o.pal && o.pal[k]) || PDF_PAL[k];
    var p = prepare(plan), rs = floorRooms(p, fi);
    if (!rs.length) return null;
    var b = bounds(rs), pad = T, northH = p.north ? 1.2 : 0;
    var bw = b.x1 - b.x0 + 2 * pad, bh = b.y1 - b.y0 + 2 * pad + northH;
    var s = Math.min(box.w / bw, box.h / bh, o.maxScale || 24);
    var ox = box.x + (box.w - bw * s) / 2 + (pad - b.x0) * s, oy = box.y + (box.h - bh * s) / 2 + (pad + northH - b.y0) * s;
    var X = function (v) { return ox + v * s; }, Y = function (v) { return oy + v * s; };
    var fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); }, draw = function (c) { doc.setDrawColor(c[0], c[1], c[2]); }, ink = function (c) { doc.setTextColor(c[0], c[1], c[2]); };
    rs.forEach(function (r) { fill(pal.room); doc.rect(X(r.x), Y(r.y), r.w * s, r.l * s, 'F'); });
    rs.forEach(function (r) {
      if (!r.stairs) return;
      var along = r.l >= r.w, n = Math.max(2, Math.floor((along ? r.l : r.w) / 0.25)), step = (along ? r.l : r.w) / n, i;
      draw(pal.soft); doc.setLineWidth(0.15);
      for (i = 1; i < n; i++) {
        if (along) doc.line(X(r.x + 0.06), Y(r.y + i * step), X(r.x + r.w - 0.06), Y(r.y + i * step));
        else doc.line(X(r.x + i * step), Y(r.y + 0.06), X(r.x + i * step), Y(r.y + r.l - 0.06));
      }
    });
    var wt = Math.min(T, 1.6 / s);   // walls no thicker than 1.6 mm on paper
    draw(pal.wall); doc.setLineWidth(wt * s);
    if (doc.setLineJoin) doc.setLineJoin('miter');
    rs.forEach(function (r) { doc.rect(X(r.x), Y(r.y), r.w * s, r.l * s, 'S'); });
    rs.forEach(function (r) {
      r.openings.forEach(function (op) {
        var g = openingGeom(r, op), w = g.w, half = wt / 2 + 0.3 / s;
        fill(pal.paper);
        if (w.ax) doc.rect(X(g.a.x), Y(w.y - half), g.wd * s, half * 2 * s, 'F'); else doc.rect(X(w.x - half), Y(g.a.y), half * 2 * s, g.wd * s, 'F');
        draw(pal.wall);
        if (op.type === 'door') {
          doc.setLineWidth(Math.max(0.25, 0.04 * s)); doc.line(X(g.hinge.x), Y(g.hinge.y), X(g.tip.x), Y(g.tip.y));
          var t0 = Math.atan2(w.ny, w.nx), t1 = Math.atan2(g.other.y - g.hinge.y, g.other.x - g.hinge.x), d = t1 - t0;
          while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          doc.setLineWidth(0.15);
          var prev = null, i;
          for (i = 0; i <= 16; i++) {
            var a = t0 + d * i / 16, pt = [X(g.hinge.x + Math.cos(a) * g.wd), Y(g.hinge.y + Math.sin(a) * g.wd)];
            if (prev && i % 2) doc.line(prev[0], prev[1], pt[0], pt[1]);
            prev = pt;
          }
        } else {
          [-wt / 2, 0, wt / 2].forEach(function (dd) { doc.setLineWidth(dd ? 0.22 : 0.15); doc.line(X(g.a.x + w.nx * dd), Y(g.a.y + w.ny * dd), X(g.b.x + w.nx * dd), Y(g.b.y + w.ny * dd)); });
          doc.setLineWidth(0.22);
          [g.a, g.b].forEach(function (pt) { doc.line(X(pt.x - w.nx * wt / 2), Y(pt.y - w.ny * wt / 2), X(pt.x + w.nx * wt / 2), Y(pt.y + w.ny * wt / 2)); });
        }
      });
    });
    rs.forEach(function (r) {
      var L = fitLabel(r, p.unit), lines = L.lines, fsMm = L.fs * s, cx = X(r.x + r.w / 2), cy = Y(r.y + r.l / 2);
      // Too small to read on paper: keep the name and the size only.
      var rot = L.rot;
      while (lines.length > 1 && fsMm / 0.3528 < 5.2) { lines = lines.slice(0, lines.length - 1); var L2 = fitLabelLines(r, lines); fsMm = L2.fs * s; rot = L2.rot; }
      var lh = fsMm * 1.28, top = -((lines.length - 1) * lh) / 2;
      lines.forEach(function (ln, i) {
        var pt = Math.max(4, Math.min(12, (ln.b ? fsMm * 1.05 : fsMm * 0.88) / 0.3528));
        doc.setFont('helvetica', ln.b ? 'bold' : 'normal'); doc.setFontSize(pt); ink(ln.b ? pal.text : pal.soft);
        var tw = doc.getTextWidth(ln.t), off = top + i * lh + pt * 0.3528 * 0.35;
        if (rot) doc.text(ln.t, cx + off, cy + tw / 2, { angle: 90 });
        else doc.text(ln.t, cx - tw / 2, cy + off);
      });
    });
    if (p.north) {
      var nx = X(b.x1) - 4, ny = Y(b.y0) - 0.9 * s, sz = Math.min(9, Math.max(6, 0.8 * s));
      draw(pal.soft); doc.setLineWidth(0.25); doc.circle(nx, ny, sz / 2, 'S');
      fill(pal.wall); doc.triangle(nx, ny - sz * 0.4, nx + sz * 0.16, ny + sz * 0.22, nx - sz * 0.16, ny + sz * 0.22, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(pal.text); doc.text('N', nx, ny - sz * 0.62, { align: 'center' });
    }
    doc.setLineWidth(0.2);
    return { scale: s };
  }
  function fitLabelLines(r, lines) {
    function tryFit(rot) {
      var along = (rot ? r.l : r.w) * 0.86, across = (rot ? r.w : r.l) * 0.8, fs = Math.min(0.3, across / (lines.length * 1.28));
      lines.forEach(function (ln) { fs = Math.min(fs, along / Math.max(1, ln.t.length * (ln.b ? 0.6 : 0.54))); });
      return fs;
    }
    var h = tryFit(false), v = tryFit(true);
    return v > h * 1.3 ? { fs: v, rot: true } : { fs: h, rot: false };
  }
  // The standalone PDF: one A4 landscape page per floor, then a summary of every room.
  function pdf(plan, meta) {
    meta = meta || {};
    var JsPDF = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (!JsPDF) throw new Error('pdf_library_unavailable');
    var p = prepare(plan), st = stats(p), doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    var PW = 297, PH = 210, M = 16, pal = PDF_PAL, date = meta.date || today(), addr = p.address || meta.address || '';
    var set = function (st2, size, c) { doc.setFont('helvetica', st2); doc.setFontSize(size); doc.setTextColor(c[0], c[1], c[2]); };
    var hr = function (y, c, w, x1, x2) { c = c || pal.line; doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(w || 0.2); doc.line(x1 == null ? M : x1, y, x2 == null ? PW - M : x2, y); doc.setLineWidth(0.2); };
    var floors = p.floors.map(function (n, i) { return i; }).filter(function (i) { return st.floors[i].rooms; });
    function chrome(title) {
      doc.setFillColor(pal.wall[0], pal.wall[1], pal.wall[2]); doc.roundedRect(M, 9.6, 5, 5, 1.1, 1.1, 'F');
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.3); doc.lines([[1.16, -0.93], [1.16, 0.93], [0, 1.36], [-2.32, 0], [0, -1.36]], M + 1.34, 9.6 + 2.36, [1, 1], 'S', true);
      set('bold', 8, pal.text); doc.text('DIY Inventory', M + 7, 13.3);
      set('normal', 8, pal.faint); doc.text('Floor plan', M + 7 + doc.getTextWidth('DIY Inventory') + 9, 13.3);
      set('normal', 7.6, pal.soft); doc.text(doc.splitTextToSize(addr, 150)[0] || '', PW - M, 13.3, { align: 'right' });
      hr(17.5);
      doc.setFont('times', 'normal'); doc.setFontSize(21); doc.setTextColor(pal.text[0], pal.text[1], pal.text[2]); doc.text(title, M, 30);
      hr(34.5, pal.text, 0.35);
    }
    floors.forEach(function (fi, n) {
      if (n) doc.addPage();
      chrome(floors.length > 1 || p.floors[fi] !== 'Ground floor' ? 'Floor plan – ' + p.floors[fi].toLowerCase() : 'Floor plan');
      var colW = 70, top = 42, bottom = PH - 22;
      drawPdf(doc, p, fi, { x: M, y: top, w: PW - M * 2 - colW - 12, h: bottom - top }, {});
      roomColumn(doc, p, fi, PW - M - colW, top, colW, bottom, set, hr, st);
    });
    // Summary: every room on every floor.
    doc.addPage(); chrome('Summary');
    var y = 42, cols = [['Floor', 50], ['Room', 70], ['Width', 34], ['Length', 34], ['Area (m²)', 34], ['Area (ft²)', 43]];
    function head() { set('bold', 6.6, pal.faint); var x = M; cols.forEach(function (c) { doc.text(c[0].toUpperCase(), x, y + 4.2); x += c[1]; }); y += 6; hr(y, pal.text, 0.3); y += 0.4; }
    head();
    floors.forEach(function (fi) {
      floorRooms(p, fi).forEach(function (r) {
        if (y + 8 > PH - 24) { doc.addPage(); chrome('Summary (continued)'); y = 42; head(); }
        var x = M, vals = [p.floors[fi], r.name, fmtM(r.w) + '  (' + fmtFt(r.w) + ')', fmtM(r.l) + '  (' + fmtFt(r.l) + ')', (r.w * r.l).toFixed(1), String(Math.round(r.w * r.l * M2FT2))];
        vals.forEach(function (v, i) { set(i === 1 ? 'bold' : 'normal', 8, i === 1 ? pal.text : pal.soft); doc.text(doc.splitTextToSize(v, cols[i][1] - 4)[0], x, y + 5.2); x += cols[i][1]; });
        y += 8; hr(y);
      });
    });
    y += 8;
    if (y > PH - 50) { doc.addPage(); chrome('Summary (continued)'); y = 42; }
    floors.forEach(function (fi) { set('normal', 9, pal.soft); doc.text(p.floors[fi], M, y + 4); set('bold', 9, pal.text); doc.text(areaText(st.floors[fi].area) + '   ·   ' + areaFt(st.floors[fi].area), M + 60, y + 4); y += 7; });
    y += 4; set('normal', 7.4, pal.faint); doc.text('TOTAL INTERNAL AREA', M, y + 3);
    doc.setFont('times', 'normal'); doc.setFontSize(26); doc.setTextColor(pal.text[0], pal.text[1], pal.text[2]); doc.text(areaText(st.total), M, y + 14);
    set('normal', 10, pal.soft); doc.text(areaFt(st.total) + '  ·  ' + st.rooms + ' room' + (st.rooms === 1 ? '' : 's'), M, y + 21);
    var total = doc.internal.getNumberOfPages();
    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      set('normal', 7, pal.faint); doc.text(NOTE + '   ·   ' + date, M, PH - 9);
      set('bold', 7.6, pal.text); doc.text(i + '  /  ' + total, PW - M, PH - 9, { align: 'right' });
    }
    return doc;
  }
  // The list of rooms beside a floor's drawing, with the floor's area (also used by the report).
  function roomColumn(doc, p, fi, x, y, w, bottom, set, hr, st) {
    var pal = PDF_PAL, rs = floorRooms(p, fi), rowH = rs.length > 11 ? 8.6 : 10.6;
    set('bold', 6.6, pal.faint); doc.text('ROOMS', x, y + 3); y += 5.5; hr(y, pal.text, 0.3, x, x + w);
    for (var i = 0; i < rs.length; i++) {
      if (y + rowH > bottom - 34) { set('normal', 7.4, pal.soft); doc.text('and ' + (rs.length - i) + ' more (see the summary)', x, y + 4.6); y += 7; break; }
      var r = rs[i];
      set('bold', 8, pal.text); doc.text(doc.splitTextToSize(r.name, w - 22)[0], x, y + 4.4);
      set('normal', 8, pal.soft); doc.text(areaText(r.w * r.l), x + w, y + 4.4, { align: 'right' });
      set('normal', 7, pal.soft); doc.text(dimM(r) + (rowH > 9 ? '   ' + dimFt(r) : ''), x, y + 8.3);
      y += rowH; hr(y, pal.line, 0.2, x, x + w);
    }
    y += 6;
    set('normal', 7.4, pal.faint); doc.text(p.floors[fi].toUpperCase() + ' AREA', x, y + 3);
    doc.setFont('times', 'normal'); doc.setFontSize(22); doc.setTextColor(pal.text[0], pal.text[1], pal.text[2]); doc.text(areaText(st.floors[fi].area), x, y + 12.5);
    set('normal', 8, pal.soft); doc.text(areaFt(st.floors[fi].area), x, y + 18);
    if (st.floors.filter(function (f) { return f.rooms; }).length > 1) { set('normal', 7.4, pal.faint); doc.text('Whole property: ' + areaText(st.total) + ' (' + areaFt(st.total) + ')', x, y + 24); }
  }

  /* --------------------------------------------------------------- download */
  function fileBase(p, meta) { var a = String((p && p.address) || (meta && meta.address) || '').split(',')[0].replace(/[\\/:*?"<>|]+/g, ' ').trim(); return 'Floor plan' + (a ? ' - ' + a : '') + ' - ' + new Date().toISOString().slice(0, 10); }
  function pdfBlob(plan, meta) { return pdf(plan, meta).output('blob'); }
  function pngBlob(plan, meta) {
    var sh = sheetSVG(plan, meta), scale = 1.5;
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(new Blob([sh.svg], { type: 'image/svg+xml' }));
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = Math.round(sh.width * scale); c.height = Math.round(sh.height * scale);
        var g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0, sh.width, sh.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('png_failed')); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('png_failed')); };
      img.src = url;
    });
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ----------------------------------------------------------------- editor */
  var ICON = {
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    turn: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    door: '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M6 20V6"/><path d="M6 6a14 14 0 0 1 14 14"/></svg>',
    win: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 12h18M3 15h18"/><path d="M3 7v10M21 7v10"/></svg>',
    stairs: '<svg viewBox="0 0 24 24"><path d="M3 20h5v-5h5v-5h5V5h3"/></svg>',
    bin: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    tidy: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    flip: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t === 'dark';
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // opts: { plan, container (else a full-screen overlay), address, mode:'app'|'tool', step, access:{ checking, unlocked, configured, note },
  //         onChange(plan), onClose(plan), onBuy(plan) → Promise, copy:{ buyTitle, buyText, buyBtn, unlocked, closeLabel } }
  function open(opts) {
    opts = opts || {};
    var plan = normalize(opts.plan || blank({ address: opts.address }));
    if (opts.address && !plan.address) plan.address = opts.address;
    var overlay = !opts.container, host = opts.container;
    if (overlay) { host = document.createElement('div'); host.className = 'fp-overlay'; document.body.appendChild(host); document.documentElement.classList.add('fp-lock'); }
    var el = document.createElement('div'); el.className = 'fp' + (overlay ? ' fp-full' : '');
    host.appendChild(el);
    var access = opts.access || { checking: true };
    var copy = Object.assign({
      buyTitle: 'Download your floor plan', buyText: 'Drawing it is free. Pay once to download it as a PDF and a picture.',
      buyBtn: 'Pay ' + PRICE_TEXT + ' and download', unlocked: '', closeLabel: 'Close'
    }, opts.copy || {});
    var step = opts.step || (hasPlan(plan) ? 'plan' : 'rooms'), cur = 0, sel = {}, placing = null, past = [], future = [], vb = null, svg = null, gesture = null, pointers = new Map(), inputSnap = null, toastT = null, pbT = null, built = null, closed = false;

    function save() { plan.updatedAt = new Date().toISOString(); built = null; if (step === 'finish') { clearTimeout(pbT); pbT = setTimeout(prebuild, 700); } if (opts.onChange) opts.onChange(plan); }
    function snapshot() { return JSON.stringify(plan); }
    function remember(s) { past.push(s); if (past.length > 80) past.shift(); future = []; }
    function change(fn) { var s = snapshot(); fn(); remember(s); save(); }
    function undo() { if (!past.length) return; future.push(snapshot()); plan = JSON.parse(past.pop()); sel = {}; save(); render(); }
    function redo() { if (!future.length) return; past.push(snapshot()); plan = JSON.parse(future.pop()); sel = {}; save(); render(); }
    function room(id) { return plan.rooms.filter(function (r) { return r.id === id; })[0]; }
    function toast(msg, act) {
      var t = el.querySelector('.fp-toast'); if (!t) return;
      t.innerHTML = '<span>' + esc(msg) + '</span>' + (act ? '<button type="button" data-act="' + act + '">Undo</button>' : '');
      t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 4000);
    }
    function nameFor(preset) {
      var base = preset === 'Other' ? 'Room' : preset, same = plan.rooms.filter(function (r) { return r.name === base || r.name.indexOf(base + ' ') === 0 && /^\d+$/.test(r.name.slice(base.length + 1)); });
      if (!same.length) return base;
      var plain = same.filter(function (r) { return r.name === base; })[0]; if (plain) plain.name = base + ' 1';
      return base + ' ' + (same.length + 1);
    }

    /* ---------- layout of the editor */
    function render() {
      if (closed) return;
      if (cur >= plan.floors.length) cur = plan.floors.length - 1;
      var steps = [['rooms', '1', 'Rooms'], ['plan', '2', 'Plan'], ['finish', '3', 'Finish']];
      el.innerHTML = '<div class="fp-head"><div class="fp-steps" role="tablist">' + steps.map(function (s) {
        return '<button type="button" role="tab" class="fp-step' + (s[0] === step ? ' on' : '') + '" data-act="go" data-v="' + s[0] + '"' + (s[0] !== 'rooms' && !hasPlan(plan) ? ' disabled' : '') + ' aria-selected="' + (s[0] === step) + '"><b>' + s[1] + '</b>' + s[2] + '</button>';
      }).join('') + '</div>' + (overlay ? '<button type="button" class="fp-close" data-act="close" aria-label="' + esc(copy.closeLabel) + '">' + ICON.close + '<span>' + esc(copy.closeLabel) + '</span></button>' : '') + '</div>' +
        '<div class="fp-body fp-body-' + step + '">' + (step === 'rooms' ? roomsHTML() : step === 'plan' ? planHTML() : finishHTML()) + '</div>' +
        '<div class="fp-foot">' + footHTML() + '</div><div class="fp-toast" role="status"></div>';
      svg = null;
      if (step === 'plan') initCanvas();
      if (step === 'finish') prebuild();
    }
    function floorsHTML(withAdd) {
      if (plan.floors.length < 2 && !withAdd) return '';
      return '<div class="fp-floors" role="tablist" aria-label="Floors">' + plan.floors.map(function (f, i) {
        return '<button type="button" class="fp-chip' + (i === cur ? ' on' : '') + '" data-act="floor" data-v="' + i + '">' + esc(f) + '</button>';
      }).join('') + (withAdd ? '<button type="button" class="fp-chip add" data-act="addFloor">+ Add a floor</button>' + (plan.floors.length > 1 && cur === plan.floors.length - 1 ? '<button type="button" class="fp-chip ghost" data-act="delFloor">Remove ' + esc(plan.floors[cur].toLowerCase()) + '</button>' : '') : '') + '</div>';
    }
    function roomsHTML() {
      var list = plan.rooms.filter(function (r) { return (r.floor || 0) === cur; }), ft = plan.unit === 'ft';
      var field = function (r, k, label) {
        if (!ft) return '<label class="fp-num"><span>' + label + '</span><span class="fp-in"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next" data-f="' + k + '" data-id="' + r.id + '" value="' + (r[k] ? round2(r[k]) : '') + '" placeholder="0.0" aria-label="' + esc(r.name + ' ' + label.toLowerCase() + ' in metres') + '"><em>m</em></span></label>';
        var f = r[k] ? ftIn(r[k]) : { ft: '', inch: '' };
        return '<div class="fp-num"><span>' + label + '</span><span class="fp-in ft"><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next" data-f="' + k + '_ft" data-id="' + r.id + '" value="' + f.ft + '" placeholder="0" aria-label="' + esc(r.name + ' ' + label.toLowerCase() + ' feet') + '"><em>ft</em><input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next" data-f="' + k + '_in" data-id="' + r.id + '" value="' + (r[k] ? f.inch : '') + '" placeholder="0" aria-label="' + esc(r.name + ' ' + label.toLowerCase() + ' inches') + '"><em>in</em></span></div>';
      };
      return '<div class="fp-pad">' +
        '<h2 class="fp-h">Your rooms</h2>' +
        '<p class="fp-lead">' + (plan.rooms.length ? 'Type the width and length of each room, measured wall to wall. To the nearest 10&nbsp;cm is fine.' : 'Tap each room the property has. Then type its width and length.') + '</p>' +
        '<div class="fp-units" role="group" aria-label="Units"><button type="button" class="' + (ft ? '' : 'on') + '" data-act="unit" data-v="m">Metres</button><button type="button" class="' + (ft ? 'on' : '') + '" data-act="unit" data-v="ft">Feet and inches</button></div>' +
        floorsHTML(true) +
        '<div class="fp-list">' + (list.length ? list.map(function (r) {
          return '<div class="fp-room' + (sized(r) ? ' ok' : '') + '" data-id="' + r.id + '"><div class="fp-room-top"><input class="fp-name" type="text" data-f="name" data-id="' + r.id + '" value="' + esc(r.name) + '" maxlength="40" aria-label="Room name"><button type="button" class="fp-x" data-act="delRoom" data-id="' + r.id + '" aria-label="Remove ' + esc(r.name) + '">' + ICON.close + '</button></div>' +
            '<div class="fp-dims">' + field(r, 'w', 'Width') + '<span class="fp-times" aria-hidden="true">×</span>' + field(r, 'l', 'Length') + '</div>' +
            '<div class="fp-room-foot"><span class="fp-area" data-area="' + r.id + '">' + (sized(r) ? areaText(r.w * r.l) + ' · ' + areaFt(r.w * r.l) : 'Not drawn until it has a size') + '</span>' +
            (plan.floors.length > 1 ? '<label class="fp-floorpick">On <select data-f="floor" data-id="' + r.id + '">' + plan.floors.map(function (f, i) { return '<option value="' + i + '"' + (i === r.floor ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></label>' : '') + '</div></div>';
        }).join('') : '<p class="fp-empty">No rooms on the ' + esc(plan.floors[cur].toLowerCase()) + ' yet.</p>') + '</div>' +
        '<div class="fp-add"><div class="fp-add-t">Add a room' + (plan.floors.length > 1 ? ' to the ' + esc(plan.floors[cur].toLowerCase()) : '') + '</div><div class="fp-chips">' +
        PRESETS.map(function (n) { return '<button type="button" class="fp-chip" data-act="addRoom" data-v="' + esc(n) + '">+ ' + esc(n) + '</button>'; }).join('') + '</div></div></div>';
    }
    function planHTML() {
      return '<div class="fp-stage">' + floorsHTML(false) +
        '<div class="fp-canvas"><svg class="fp-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-label="Floor plan. Drag a room to move it."><g class="fp-layer"></g></svg>' +
        '<div class="fp-tools"><button type="button" data-act="undo" aria-label="Undo"' + (past.length ? '' : ' disabled') + '>' + ICON.undo + '<span>Undo</span></button><button type="button" data-act="redo" aria-label="Redo"' + (future.length ? '' : ' disabled') + '>' + ICON.redo + '</button><button type="button" data-act="tidy">' + ICON.tidy + '<span>Tidy up</span></button></div>' +
        '<div class="fp-zoom"><button type="button" data-act="zin" aria-label="Zoom in">' + ICON.plus + '</button><button type="button" data-act="zout" aria-label="Zoom out">' + ICON.minus + '</button><button type="button" data-act="fit" aria-label="Fit to screen">' + ICON.fit + '</button></div></div>' +
        '<div class="fp-sheet">' + sheetHTML() + '</div></div>';
    }
    function sheetHTML() {
      var r = sel.room && room(sel.room);
      if (!r) {
        var st = stats(plan), f = st.floors[cur];
        if (placing) return '<div class="fp-sheet-t"><b>Tap the wall where the ' + placing + ' goes</b><button type="button" class="fp-link" data-act="cancelPlace">Cancel</button></div><p class="fp-hint">Tap on or next to any wall. You can slide it along the wall and change its width afterwards.</p>';
        return '<p class="fp-hint"><b>' + esc(plan.floors[cur]) + ': ' + areaText(f.area) + '</b> · ' + areaFt(f.area) + '</p>' +
          '<div class="fp-acts fp-add-open"><button type="button" data-act="place" data-v="door">' + ICON.door + '<span>Add a door</span></button><button type="button" data-act="place" data-v="window">' + ICON.win + '<span>Add a window</span></button></div>' +
          '<p class="fp-hint" style="margin-top:8px">Drag a room to move it. Tap a room to turn it or add stairs.</p>';
      }
      var op = sel.open && r.openings.filter(function (o) { return o.id === sel.open; })[0];
      if (op) {
        var g = openingGeom(r, op), maxW = Math.max(0.4, Math.min(op.type === 'door' ? 2 : 4, g.w.len - 0.1));
        return '<div class="fp-sheet-t"><b>' + (op.type === 'door' ? 'Door' : 'Window') + '</b> · ' + esc(r.name) +
          (op.type === 'door' ? '<button type="button" class="fp-icon" data-act="flip" aria-label="Flip the door">' + ICON.flip + '</button>' : '') +
          '<button type="button" class="fp-icon danger" data-act="delOpen" aria-label="Remove the ' + op.type + '">' + ICON.bin + '</button><button type="button" class="fp-link" data-act="unsel">Done</button></div>' +
          '<p class="fp-q">Which wall is it on? <span>Or drag it round the room.</span></p><div class="fp-seg fp-walls" role="group" aria-label="Which wall">' + [['n', 'Top'], ['e', 'Right'], ['s', 'Bottom'], ['w', 'Left']].map(function (w) { return '<button type="button" class="' + (op.wall === w[0] ? 'on' : '') + '" data-act="wall" data-v="' + w[0] + '">' + w[1] + '</button>'; }).join('') + '</div>' +
          '<p class="fp-meas">' + (g.w.ay ? 'From the top corner' : 'From the left corner') + ' <b>' + esc(fmtLen(g.pos - g.wd / 2, plan.unit)) + '</b> · ' + (op.type === 'door' ? 'Door' : 'Window') + ' <b>' + esc(fmtLen(g.wd, plan.unit)) + '</b> wide · Wall <b>' + esc(fmtLen(g.w.len, plan.unit)) + '</b></p>' +
          '<label class="fp-range"><span>Move</span><input type="range" data-f="opos" min="' + round2(g.wd / 2) + '" max="' + round2(g.w.len - g.wd / 2) + '" step="0.05" value="' + round2(g.pos) + '" aria-label="Position along the wall"></label>' +
          '<label class="fp-range"><span>Width <output>' + fmtM(op.width) + '</output></span><input type="range" data-f="owidth" min="0.4" max="' + round2(maxW) + '" step="0.05" value="' + round2(op.width) + '"></label>';
      }
      return '<div class="fp-sheet-t"><b>' + esc(r.name) + '</b> · ' + esc(dimM(r)) + '<button type="button" class="fp-link" data-act="unsel">Done</button></div>' +
        '<div class="fp-acts"><button type="button" data-act="turn">' + ICON.turn + '<span>Turn</span></button><button type="button" data-act="addDoor">' + ICON.door + '<span>Door</span></button><button type="button" data-act="addWin">' + ICON.win + '<span>Window</span></button>' +
        '<button type="button" class="' + (r.stairs ? 'on' : '') + '" data-act="stairs" aria-pressed="' + r.stairs + '">' + ICON.stairs + '<span>Stairs</span></button><button type="button" class="danger" data-act="delSel">' + ICON.bin + '<span>Remove</span></button></div>';
    }
    function finishHTML() {
      var st = stats(plan), fl = plan.floors.map(function (n, i) { return i; }).filter(function (i) { return st.floors[i].rooms; }), pal = isDark() ? DARK : LIGHT;
      return '<div class="fp-pad"><h2 class="fp-h">Your floor plan</h2>' +
        '<div class="fp-total"><div><b>' + areaText(st.total) + '</b><span>total floor area</span></div><div><b>' + areaFt(st.total) + '</b><span>in square feet</span></div><div><b>' + st.rooms + '</b><span>room' + (st.rooms === 1 ? '' : 's') + '</span></div></div>' +
        '<div class="fp-previews">' + fl.map(function (i) { return '<figure class="fp-prev"><div class="fp-prev-art">' + floorPreview(plan, i, { pal: pal }) + '</div><figcaption><b>' + esc(plan.floors[i]) + '</b> · ' + areaText(st.floors[i].area) + '</figcaption></figure>'; }).join('') + '</div>' +
        '<label class="fp-check"><input type="checkbox" data-f="north"' + (plan.north ? ' checked' : '') + '> Show a north arrow (north at the top)</label>' +
        (opts.mode === 'tool' ? '<label class="fp-field"><span>Address on the plan <em>(optional)</em></span><input type="text" data-f="address" value="' + esc(plan.address) + '" maxlength="200" autocomplete="street-address" placeholder="e.g. 12 Albion Road, London"></label>' : '') +
        '<div class="fp-buy" id="fpBuy">' + buyHTML() + '</div></div>';
    }
    function buyHTML() {
      if (access.checking) return '<p class="fp-muted">Checking…</p>';
      if (access.unlocked) {
        return (copy.unlocked ? '<p class="fp-ok">' + esc(copy.unlocked) + '</p>' : '') +
          '<div class="fp-dl">' + (overlay ? '<button type="button" class="fp-btn big" data-act="dlPdf">Download the plan (PDF)</button>' : '') + '<button type="button" class="fp-btn big" data-act="dlPng">Download picture (PNG)</button></div><p class="fp-muted" id="fpDlMsg" role="status"></p>';
      }
      return '<div class="fp-price"><div class="fp-price-amt">' + PRICE_TEXT + '</div><div><b>' + esc(copy.buyTitle) + '</b><p>' + esc(copy.buyText) + '</p></div></div>' +
        (access.configured === false
          ? '<p class="fp-warn">Card payments aren’t switched on yet. Your plan is saved here; please <a href="/contact">contact us</a> and we’ll send it to you.</p>'
          : '<p class="fp-muted" id="fpBuyMsg" role="status">Secure card payment. Your plan is saved, so you come straight back to it.</p>');
    }
    // The finish step's main button, in the foot where it is always in view: pay, or download.
    function finishCta() {
      if (access.checking) return '<button type="button" class="fp-btn primary big" disabled>Checking…</button>';
      if (access.unlocked) return overlay ? '<button type="button" class="fp-btn primary big" data-act="close">' + esc(copy.closeLabel) + '</button>' : '<button type="button" class="fp-btn primary big" data-act="dlPdf">Download PDF</button>';
      return '<button type="button" class="fp-btn primary big" data-act="buy"' + (access.configured === false ? ' disabled' : '') + '>' + esc(copy.buyBtn) + '</button>';
    }
    function footHTML() {
      if (step === 'rooms') {
        var ok = hasPlan(plan);
        return '<p class="fp-foot-note">' + (ok ? '' : 'Type the size of at least one room.') + '</p><button type="button" class="fp-btn primary big" data-act="go" data-v="plan"' + (ok ? '' : ' disabled') + '>See my plan →</button>';
      }
      if (step === 'plan') return '<button type="button" class="fp-btn" data-act="go" data-v="rooms">← Rooms</button><button type="button" class="fp-btn primary big" data-act="go" data-v="finish">Done ✓</button>';
      return '<button type="button" class="fp-btn" data-act="go" data-v="plan">← Plan</button>' + finishCta();
    }
    function updateFoot() { var f = el.querySelector('.fp-foot'); if (f) f.innerHTML = footHTML(); el.querySelectorAll('.fp-step').forEach(function (b) { if (b.getAttribute('data-v') !== 'rooms') b.disabled = !hasPlan(plan); }); }
    function updateSheet() {
      var s = el.querySelector('.fp-sheet'); if (s) s.innerHTML = sheetHTML();
      var u = el.querySelector('[data-act="undo"]'), rd = el.querySelector('[data-act="redo"]');
      if (u) u.disabled = !past.length; if (rd) rd.disabled = !future.length;
    }

    /* ---------- the canvas */
    function initCanvas() {
      svg = el.querySelector('.fp-svg');
      place(plan);
      fitView();
      draw();
      svg.addEventListener('pointerdown', onDown);
      svg.addEventListener('pointermove', onMove);
      svg.addEventListener('pointerup', onUp);
      svg.addEventListener('pointercancel', onUp);
      svg.addEventListener('wheel', onWheel, { passive: false });
    }
    function rect() { return svg.getBoundingClientRect(); }
    function fitView() {
      if (!svg) return;
      var rc = rect(), w = Math.max(1, rc.width), h = Math.max(1, rc.height), b = bounds(floorRooms(plan, cur));
      // Fit the floor below the buttons along the top and left of the zoom buttons on the right.
      var m = 0.6, padT = 64, padR = 62, bw = b.x1 - b.x0 + 2 * m, bh = b.y1 - b.y0 + 2 * m + (plan.north ? 1 : 0);
      var aw = Math.max(80, w - padR), ah = Math.max(80, h - padT), s = Math.max(bw / aw, bh / ah, 0.004);
      vb = { w: w * s, h: h * s };
      vb.x = (b.x0 + b.x1) / 2 - (aw / 2) * s; vb.y = (b.y0 + b.y1) / 2 - (plan.north ? 0.5 : 0) - (padT + ah / 2) * s;
    }
    function keepAspect() { var rc = rect(); if (rc.width && rc.height && vb) { var cy = vb.y + vb.h / 2; vb.h = vb.w * rc.height / rc.width; vb.y = cy - vb.h / 2; } }
    function draw() {
      if (!svg || !vb) return;
      keepAspect();
      var pal = isDark() ? DARK : LIGHT, gx = Math.floor(vb.x) - 2, gy = Math.floor(vb.y) - 2, gw = Math.ceil(vb.w) + 4, gh = Math.ceil(vb.h) + 4;
      svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(f3).join(' '));
      var grid = '<defs><pattern id="fpg1" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M0.5 0H0V0.5" fill="none" stroke="' + pal.grid + '" stroke-width="0.012"/></pattern>' +
        '<pattern id="fpg2" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#fpg1)"/><path d="M1 0H0V1" fill="none" stroke="' + pal.grid2 + '" stroke-width="0.02"/></pattern></defs>' +
        '<rect x="' + gx + '" y="' + gy + '" width="' + gw + '" height="' + gh + '" fill="' + pal.bg + '"/><rect x="' + gx + '" y="' + gy + '" width="' + gw + '" height="' + gh + '" fill="url(#fpg2)"/>';
      var b = bounds(floorRooms(plan, cur));
      svg.querySelector('.fp-layer').innerHTML = grid + floorSVG(plan, cur, { pal: pal, sel: sel, hit: true }) + (plan.north ? northSVG(b.x1 - 0.2, b.y0 - 0.8, 0.8, pal) : '');
    }
    function toSvg(cx, cy) { var rc = rect(); return { x: vb.x + (cx - rc.left) / rc.width * vb.w, y: vb.y + (cy - rc.top) / rc.height * vb.h }; }
    function zoom(f, cx, cy) {
      var rc = rect(); if (cx == null) { cx = rc.left + rc.width / 2; cy = rc.top + rc.height / 2; }
      var p0 = toSvg(cx, cy), nw = clamp(vb.w * f, 2, 120), k = nw / vb.w;
      vb.x = p0.x - (p0.x - vb.x) * k; vb.y = p0.y - (p0.y - vb.y) * k; vb.w = nw; vb.h *= k; draw();
    }
    function onWheel(e) { e.preventDefault(); zoom(Math.pow(1.0015, e.deltaY), e.clientX, e.clientY); }
    function pinchInfo() { var a = Array.from(pointers.values()); return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 }; }
    function onDown(e) {
      if (e.button != null && e.button > 0) return;
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
      if (pointers.size === 2) {
        if (gesture && gesture.kind === 'room' && gesture.moved) { var rr = room(gesture.id); if (rr) { rr.x = gesture.x0; rr.y = gesture.y0; } }
        var pi = pinchInfo(); gesture = { kind: 'pinch', d0: pi.d, vb0: Object.assign({}, vb), m0: toSvg(pi.mx, pi.my) }; draw(); return;
      }
      if (pointers.size > 2) return;
      var t = e.target.closest ? e.target.closest('[data-open],[data-room]') : null, p = toSvg(e.clientX, e.clientY);
      if (placing) {
        // The wall nearest the tap (within about 40 px on screen, or anywhere inside a room).
        var best = null, tol = 40 * vb.w / rect().width;
        floorRooms(plan, cur).filter(function (x) { return x.x != null; }).forEach(function (rm) {
          var inside = p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.l;
          [['n', Math.abs(p.y - rm.y), p.x >= rm.x - tol && p.x <= rm.x + rm.w + tol], ['s', Math.abs(p.y - rm.y - rm.l), p.x >= rm.x - tol && p.x <= rm.x + rm.w + tol],
           ['w', Math.abs(p.x - rm.x), p.y >= rm.y - tol && p.y <= rm.y + rm.l + tol], ['e', Math.abs(p.x - rm.x - rm.w), p.y >= rm.y - tol && p.y <= rm.y + rm.l + tol]].forEach(function (c) {
            if (!c[2] || (!inside && c[1] > tol)) return;
            if (!best || c[1] < best.d || (inside && !best.inside)) best = { rm: rm, wall: c[0], d: c[1], inside: inside };
          });
        });
        pointers.delete(e.pointerId);
        if (!best) { toast('Tap on or next to a wall of a room.'); return; }
        var W = wallOf(best.rm, best.wall), isDoor = placing === 'door', width = Math.min(isDoor ? 0.8 : 1.2, Math.max(0.4, W.len - 0.2));
        var along = W.ax ? p.x - best.rm.x : p.y - best.rm.y, o = { id: uid('fo'), type: placing, wall: best.wall, pos: round2(clamp(along, width / 2, W.len - width / 2)), width: width, flip: false };
        change(function () { best.rm.openings.push(o); });
        placing = null; svg.classList.remove('placing'); sel = { room: best.rm.id, open: o.id }; draw(); updateSheet();
        toast((isDoor ? 'Door' : 'Window') + ' added to the ' + best.rm.name.toLowerCase() + '.', 'undo');
        return;
      }
      if (t && t.getAttribute('data-open')) {
        var ids = t.getAttribute('data-open').split(':');
        gesture = { kind: 'open', rid: ids[0], oid: ids[1], snap: snapshot(), moved: false, cx: e.clientX, cy: e.clientY };
        if (sel.open !== ids[1]) { sel = { room: ids[0], open: ids[1] }; updateSheet(); }
      } else if (t && t.getAttribute('data-room')) {
        var r = room(t.getAttribute('data-room'));
        gesture = { kind: 'room', id: r.id, p0: p, x0: r.x, y0: r.y, snap: snapshot(), moved: false, cx: e.clientX, cy: e.clientY };
        if (sel.room !== r.id || sel.open) { sel = { room: r.id }; updateSheet(); }
      } else gesture = { kind: 'pan', cx: e.clientX, cy: e.clientY, vb0: Object.assign({}, vb), moved: false };
      draw();
    }
    function onMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      e.preventDefault();
      var rc = rect();
      if (gesture.kind === 'pinch') {
        if (pointers.size < 2) return;
        var pi = pinchInfo(), nw = clamp(gesture.vb0.w * gesture.d0 / pi.d, 2, 120), nh = nw * rc.height / rc.width;
        vb = { w: nw, h: nh, x: gesture.m0.x - (pi.mx - rc.left) / rc.width * nw, y: gesture.m0.y - (pi.my - rc.top) / rc.height * nh };
        draw(); return;
      }
      if (!gesture.moved && Math.hypot(e.clientX - gesture.cx, e.clientY - gesture.cy) < 5) return;
      gesture.moved = true;
      if (gesture.kind === 'pan') {
        vb.x = gesture.vb0.x - (e.clientX - gesture.cx) / rc.width * vb.w; vb.y = gesture.vb0.y - (e.clientY - gesture.cy) / rc.height * vb.h; draw(); return;
      }
      var p = toSvg(e.clientX, e.clientY);
      if (gesture.kind === 'room') {
        var r = room(gesture.id), others = floorRooms(plan, cur).filter(function (o) { return o.id !== r.id && o.x != null; });
        var s = snapEdges(r, gesture.x0 + p.x - gesture.p0.x, gesture.y0 + p.y - gesture.p0.y, others, 14 * vb.w / rc.width);
        r.x = s.x; r.y = s.y; draw(); return;
      }
      if (gesture.kind === 'open') {
        var rm = room(gesture.rid), op = rm && rm.openings.filter(function (o) { return o.id === gesture.oid; })[0]; if (!op) return;
        // Slide along the wall, or round the corner onto whichever wall of the room the finger is nearest.
        var dn = [['n', Math.abs(p.y - rm.y)], ['s', Math.abs(p.y - rm.y - rm.l)], ['w', Math.abs(p.x - rm.x)], ['e', Math.abs(p.x - rm.x - rm.w)]]
          .map(function (c) { var out = c[0] === 'n' || c[0] === 's' ? Math.max(0, rm.x - p.x, p.x - rm.x - rm.w) : Math.max(0, rm.y - p.y, p.y - rm.y - rm.l); return [c[0], Math.hypot(c[1], out)]; })
          .sort(function (a, b) { return a[1] - b[1]; })[0][0];
        if (dn !== op.wall) { var nw = wallOf(rm, dn); op.wall = dn; op.width = Math.min(op.width, Math.max(0.4, nw.len - 0.1)); }
        var w = wallOf(rm, op.wall);
        op.pos = round2(clamp(w.ax ? p.x - rm.x : p.y - rm.y, op.width / 2, w.len - op.width / 2)); draw();
      }
    }
    function onUp(e) {
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') { if (!pointers.size) gesture = null; return; }
      if ((gesture.kind === 'room' || gesture.kind === 'open') && gesture.moved) { remember(gesture.snap); save(); updateSheet(); }
      if (gesture.kind === 'pan' && !gesture.moved && (sel.room || sel.open)) { sel = {}; updateSheet(); draw(); }
      gesture = null;
    }

    /* ---------- actions */
    function act(a, v, btn) {
      var r = sel.room && room(sel.room), op = r && sel.open && r.openings.filter(function (o) { return o.id === sel.open; })[0];
      switch (a) {
        case 'go':
          if (v !== 'rooms' && !hasPlan(plan)) return;
          if (v === 'plan' && plan.rooms.some(function (x) { return sized(x) && x.x == null; })) {
            change(function () { place(plan); });
            // Start on a floor that has something to show.
            if (!floorRooms(plan, cur).length) cur = Math.max(0, plan.floors.findIndex(function (f, i) { return floorRooms(plan, i).length; }));
          }
          step = v; sel = {}; render(); scrollTop(); break;
        case 'close': close(); break;
        case 'unit': plan.unit = v === 'ft' ? 'ft' : 'm'; save(); render(); break;
        case 'floor': cur = +v; sel = {}; render(); break;
        case 'addFloor': change(function () { plan.floors.push(FLOOR_NAMES[plan.floors.length] || 'Floor ' + plan.floors.length); }); cur = plan.floors.length - 1; render(); break;
        case 'delFloor': if (plan.floors.length < 2) return; change(function () { var last = plan.floors.length - 1; plan.rooms.forEach(function (rm) { if (rm.floor === last) { rm.floor = last - 1; rm.x = rm.y = null; } }); plan.floors.pop(); }); cur = plan.floors.length - 1; render(); toast('Floor removed. Its rooms moved down a floor.', 'undo'); break;
        case 'addRoom': change(function () { plan.rooms.push(newRoom(nameFor(v), cur)); }); render(); focusLast(); break;
        case 'delRoom': { var dr = room(btn.getAttribute('data-id')); if (!dr) return; change(function () { plan.rooms = plan.rooms.filter(function (x) { return x !== dr; }); }); render(); toast(dr.name + ' removed.', 'undo'); break; }
        case 'undo': undo(); toastHide(); break;
        case 'redo': redo(); break;
        case 'tidy': change(function () { arrange(plan, cur); }); fitView(); draw(); updateSheet(); toast('Rooms tidied up.', 'undo'); break;
        case 'fit': fitView(); draw(); break;
        case 'zin': zoom(1 / 1.3); break;
        case 'zout': zoom(1.3); break;
        case 'unsel': sel = {}; updateSheet(); draw(); break;
        case 'place': placing = v === 'window' ? 'window' : 'door'; sel = {}; updateSheet(); draw(); if (svg) svg.classList.add('placing'); break;
        case 'cancelPlace': placing = null; updateSheet(); if (svg) svg.classList.remove('placing'); break;
        case 'turn': if (r) { change(function () { rotate(r); }); draw(); updateSheet(); } break;
        case 'addDoor': case 'addWin':
          if (!r) return;
          var isDoor = a === 'addDoor', used = r.openings.map(function (o) { return o.wall; }), order = isDoor ? ['s', 'w', 'e', 'n'] : ['n', 'e', 'w', 's'], wall = order.filter(function (w) { return used.indexOf(w) < 0; })[0] || order[0];
          var len = wallOf(r, wall).len, o = { id: uid('fo'), type: isDoor ? 'door' : 'window', wall: wall, pos: round2(len / 2), width: Math.min(isDoor ? 0.8 : 1.2, Math.max(0.4, len - 0.2)), flip: false };
          change(function () { r.openings.push(o); }); sel = { room: r.id, open: o.id }; draw(); updateSheet(); break;
        case 'stairs': if (r) { change(function () { r.stairs = !r.stairs; }); draw(); updateSheet(); } break;
        case 'delSel': if (r) { var nm = r.name; change(function () { plan.rooms = plan.rooms.filter(function (x) { return x !== r; }); }); sel = {}; draw(); updateSheet(); updateFoot(); toast(nm + ' removed.', 'undo'); if (!hasPlan(plan)) { step = 'rooms'; render(); } } break;
        case 'wall': if (op) { change(function () { op.wall = v; op.pos = wallOf(r, v).len / 2; }); draw(); updateSheet(); } break;
        case 'flip': if (op) { change(function () { op.flip = !op.flip; }); draw(); } break;
        case 'delOpen': if (op) { change(function () { r.openings = r.openings.filter(function (o) { return o !== op; }); }); sel = { room: r.id }; draw(); updateSheet(); } break;
        case 'buy': buy(btn); break;
        case 'dlPdf': downloadPdf(); break;
        case 'dlPng': downloadPng(); break;
      }
    }
    function toastHide() { var t = el.querySelector('.fp-toast'); if (t) t.classList.remove('on'); }
    function scrollTop() {
      var b = el.querySelector('.fp-body'); if (b) b.scrollTop = 0;
      if (!overlay) { var hd = document.querySelector('header.top'), off = hd ? hd.getBoundingClientRect().height + 8 : 0, top = el.getBoundingClientRect().top; if (top < off) window.scrollBy(0, top - off); }
    }
    function focusLast() {
      var list = el.querySelectorAll('.fp-room'), last = list[list.length - 1]; if (!last) return;
      var inp = last.querySelector('[data-f^="w"]');
      if (last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
      if (inp && root.matchMedia && root.matchMedia('(pointer: fine)').matches) inp.focus();
    }
    function onInput(e) {
      var t = e.target, f = t.getAttribute && t.getAttribute('data-f'); if (!f) return;
      var r = t.getAttribute('data-id') ? room(t.getAttribute('data-id')) : sel.room && room(sel.room);
      if (f === 'name' && r) { r.name = t.value.slice(0, 40); save(); return; }
      if (f === 'address') { plan.address = t.value.slice(0, 200); save(); return; }
      if (f === 'north') { change(function () { plan.north = t.checked; }); render(); return; }
      if (f === 'floor' && r) { change(function () { r.floor = +t.value; r.x = r.y = null; }); render(); return; }
      if ((f === 'opos' || f === 'owidth') && r) {
        var op = r.openings.filter(function (o) { return o.id === sel.open; })[0]; if (!op) return;
        if (!inputSnap) inputSnap = snapshot();
        if (f === 'opos') op.pos = +t.value; else { op.width = +t.value; var o2 = t.parentNode.querySelector('output'); if (o2) o2.textContent = fmtM(op.width); }
        save(); draw();
        var g5 = openingGeom(r, op), bs = el.querySelectorAll('.fp-sheet .fp-meas b');
        if (bs.length) { bs[0].textContent = fmtLen(g5.pos - g5.wd / 2, plan.unit); bs[1].textContent = fmtLen(g5.wd, plan.unit); }
        return;
      }
      if (!r) return;
      var m = /^(w|l)(?:_(ft|in))?$/.exec(f); if (!m) return;
      var k = m[1], v;
      if (!m[2]) v = num(t.value);
      else { var card = t.closest('.fp-room'), ftv = num(card.querySelector('[data-f="' + k + '_ft"]').value), inv = num(card.querySelector('[data-f="' + k + '_in"]').value); v = (ftv * 12 + inv) * 0.0254; }
      r[k] = clamp(round2(v), 0, 60);
      save();
      var lab = el.querySelector('[data-area="' + r.id + '"]'), card2 = t.closest('.fp-room');
      if (lab) lab.textContent = sized(r) ? areaText(r.w * r.l) + ' · ' + areaFt(r.w * r.l) : 'Not drawn until it has a size';
      if (card2) card2.classList.toggle('ok', sized(r));
      updateFoot();
    }
    function onFocusIn(e) { if (e.target.getAttribute && e.target.getAttribute('data-f')) inputSnap = snapshot(); }
    function onChangeEv(e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-f');
      if (f === 'north' || f === 'floor') return;
      if (inputSnap && inputSnap !== snapshot()) remember(inputSnap);
      inputSnap = null;
      if (f === 'opos' || f === 'owidth') updateSheet();
    }
    function onKey(e) {
      var t = e.target;
      if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type === 'text') {
        e.preventDefault();
        var all = Array.from(el.querySelectorAll('.fp-list input[type="text"]')), i = all.indexOf(t);
        if (i >= 0 && all[i + 1]) all[i + 1].focus(); else t.blur();
        return;
      }
      if (step !== 'plan' || /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      var r = sel.room && room(sel.room); if (!r || sel.open) return;
      var d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key];
      if (d) { e.preventDefault(); change(function () { r.x = round2(r.x + d[0]); r.y = round2(r.y + d[1]); }); draw(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act('delSel'); }
      if (e.key === 'r' || e.key === 'R') act('turn');
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled || !el.contains(b)) return;
      act(b.getAttribute('data-act'), b.getAttribute('data-v'), b);
    });
    el.addEventListener('input', onInput);
    el.addEventListener('change', function (e) { var f = e.target.getAttribute && e.target.getAttribute('data-f'); if (f === 'north' || f === 'floor') onInput(e); else onChangeEv(e); });
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('keydown', onKey);
    var onResize = function () { if (svg) draw(); };
    root.addEventListener('resize', onResize);
    var mq = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)'), onScheme = function () { if (step === 'plan') draw(); else if (step === 'finish') render(); };
    if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);

    /* ---------- buying and downloading */
    function buy(btn) {
      if (!opts.onBuy) return;
      var msg = el.querySelector('#fpBuyMsg');
      btn.disabled = true; btn.textContent = 'Opening the secure payment page…';
      Promise.resolve(opts.onBuy(plan)).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        if (!(r && r.redirecting)) { btn.disabled = false; btn.textContent = copy.buyBtn; }
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = copy.buyBtn;
        if (msg) { msg.textContent = (err && err.message) || 'That didn’t work. Please try again.'; msg.className = 'fp-warn'; }
      });
    }
    function prebuild() {
      if (!access.unlocked || built) return;
      var key = plan.updatedAt + '|' + plan.north + '|' + plan.address;
      built = { key: key, png: null };
      try { pngBlob(plan).then(function (b) { if (built && built.key === key) built.png = b; }).catch(function () {}); } catch (e) {}
    }
    function dlMsg(t) { var m = el.querySelector('#fpDlMsg'); if (m) m.textContent = t; }
    function downloadPdf() {
      if (!access.unlocked) return;
      try { saveBlob(pdfBlob(plan, { address: opts.address }), fileBase(plan, opts) + '.pdf'); dlMsg('Saved to your downloads.'); if (opts.onDownload) opts.onDownload('pdf'); }
      catch (e) { dlMsg(e && e.message === 'pdf_library_unavailable' ? 'The PDF maker hasn’t loaded. Check your connection and try again.' : 'The PDF couldn’t be made. Please try again.'); }
    }
    function downloadPng() {
      if (!access.unlocked) return;
      var go = function (b) { saveBlob(b, fileBase(plan, opts) + '.png'); dlMsg('Saved to your downloads.'); if (opts.onDownload) opts.onDownload('png'); };
      if (built && built.png) return go(built.png);
      dlMsg('Making the picture…');
      pngBlob(plan).then(function (b) { built = { key: '', png: b }; dlMsg('Your picture is ready. Tap Download picture again.'); var bt = el.querySelector('[data-act="dlPng"]'); if (bt) bt.textContent = 'Download picture (ready)'; }).catch(function () { dlMsg('The picture couldn’t be made. Try the PDF instead.'); });
    }

    function close() {
      if (closed) return; closed = true;
      root.removeEventListener('resize', onResize); if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme);
      if (overlay) { host.remove(); document.documentElement.classList.remove('fp-lock'); } else el.remove();
      if (opts.onClose) opts.onClose(plan);
    }
    render();
    return {
      el: el, close: close, getPlan: function () { return plan; },
      setAccess: function (a) { access = Object.assign({}, a); built = null; var b = el.querySelector('#fpBuy'); if (b) { b.innerHTML = buyHTML(); updateFoot(); prebuild(); } },
      setPlan: function (p) { plan = normalize(p); render(); },
      go: function (s) { act('go', s); }
    };
  }

  /* ---------------------------------------------------- the standalone tool */
  // /floor-plan/create: the plan is kept in this browser (localStorage) and survives the trip to the payment page.
  function standalone(container) {
    var KEY = 'diy-floorplan';
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } };
    var store = function (d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} };
    var data = load(), q = new URLSearchParams(location.search), ctrl, access = { checking: true }, step;
    if (q.get('fp')) { data.token = q.get('fp').slice(0, 64); data.pendingRef = ''; step = 'finish'; }
    if (q.get('fp_ref')) { data.pendingRef = q.get('fp_ref').slice(0, 64); step = 'finish'; }
    if (q.get('fp_cancel')) step = 'finish';
    if (q.toString()) history.replaceState(null, '', location.pathname);
    store(data);
    ctrl = open({
      container: container, mode: 'tool', plan: data.plan, step: step || (data.plan && hasPlan(normalize(data.plan)) ? 'plan' : 'rooms'), access: access,
      onChange: function (p) { data.plan = p; store(data); },
      onBuy: function (p) { return checkout('tool', p.address).then(function (r) { if (r.ref) { data.pendingRef = r.ref; store(data); } return r; }); },
      onDownload: function () {}
    });
    status(data.token, data.pendingRef).then(function (s) {
      if (s.token) { data.token = s.token; data.pendingRef = ''; store(data); }
      ctrl.setAccess({ unlocked: !!(s.free || s.paid), configured: s.configured });
      if (q.get('fp_cancel')) { var m = document.getElementById('fpBuyMsg'); if (m) m.textContent = 'Payment cancelled. Nothing was charged.'; }
      if (data.pendingRef && !s.paid && !s.free) pollPending(data, store, ctrl);
    });
    return ctrl;
  }
  function pollPending(data, store, ctrl) {
    var n = 0, tick = function () {
      if (n++ > 10 || !data.pendingRef) return;
      status(data.token, data.pendingRef).then(function (s) { if (s.paid) { data.token = s.token; data.pendingRef = ''; store(data); ctrl.setAccess({ unlocked: true, configured: true }); } else setTimeout(tick, 3000); });
    };
    setTimeout(tick, 2000);
  }
  // The server's side of paying: whether this browser may download, and starting a payment.
  function status(token, ref) {
    var u = '/api/floorplan/status?' + new URLSearchParams({ token: token || '', ref: ref || '' }).toString();
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { offline: true, configured: true }; });
  }
  function checkout(from, label) {
    return fetch('/api/floorplan/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: from, label: String(label || '').slice(0, 200) }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.d.free) return { free: true };
        if (!x.ok || !x.d.url) return { error: x.d.error || 'The payment page couldn’t be opened. Please try again.' };
        location.href = x.d.url; return { redirecting: true, ref: x.d.ref };
      }).catch(function () { return { error: navigator.onLine === false ? 'You appear to be offline. Try again when you have a connection.' : 'The payment page couldn’t be opened. Please try again.' }; });
  }

  var API = {
    PRICE: PRICE, PRICE_TEXT: PRICE_TEXT, PRESETS: PRESETS, NOTE: NOTE,
    blank: blank, fromNames: fromNames, normalize: normalize, prepare: prepare, hasPlan: hasPlan, stats: stats, floorRooms: floorRooms, arrange: arrange, place: place, rotate: rotate,
    dimM: dimM, dimFt: dimFt, areaText: areaText, areaFt: areaFt, fitLabel: fitLabel, openingGeom: openingGeom, snapEdges: snapEdges,
    floorSVG: floorSVG, floorPreview: floorPreview, sheetSVG: sheetSVG, drawPdf: drawPdf, roomColumn: roomColumn, pdf: pdf, pdfBlob: pdfBlob, pngBlob: pngBlob, saveBlob: saveBlob, fileBase: fileBase,
    open: open, standalone: standalone, status: status, checkout: checkout
  };
  if (typeof module === 'object' && module.exports) module.exports = API; else root.FloorPlan = API;
})(typeof window !== 'undefined' ? window : globalThis);
