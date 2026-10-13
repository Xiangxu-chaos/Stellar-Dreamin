/**
 * icons.js —— 线性图标集
 * 统一 24x24 viewBox、stroke=currentColor，由 dom.svgIcon 包裹渲染。
 * 新增图标只需在这里加一条路径，组件通过 icon(name) 取用。
 */

const P = {
  // 品牌 / 领域
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  tower: '<path d="M8 21V7l4-3 4 3v14"/><path d="M8 7h8"/><path d="M4 21h16"/><path d="M10 21v-5h4v5"/><path d="M9.5 3.5L12 1l2.5 2.5"/>',
  mask: '<path d="M4 8.5c0-1.7 1.4-3 3.1-3h9.8c1.7 0 3.1 1.3 3.1 3v3.2c0 4-3.3 7.3-7.4 7.3h-1.2C7.3 18.9 4 15.7 4 11.7z"/><path d="M9 10.5h.01"/><path d="M15 10.5h.01"/><path d="M9.8 14.2c1.4.9 3 .9 4.4 0"/>',
  domain: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5h17"/><path d="M3.5 14.5h17"/><path d="M12 3c2.6 3 2.6 15 0 18"/><path d="M12 3c-2.6 3-2.6 15 0 18"/>',

  // 操作
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  close: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  refresh: '<path d="M21 12a9 9 0 11-3.1-6.8"/><path d="M21 4v5h-5"/>',
  flip: '<path d="M12 4v13"/><path d="M8 8L4 12l4 4"/><path d="M16 8l4 4-4 4"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4L16 9.5"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.7"/>',
  eyeOff: '<path d="M10.6 6.2A9.9 9.9 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.6"/><path d="M6.6 6.7A17 17 0 002 12s3.5 6.5 10 6.5a10 10 0 004.5-1"/><path d="M2 2l20 20"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.8 1.8"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12.3 19"/>',
  bolt: '<path d="M13 2L4.5 14H11l-1 8 8.5-12H12z"/>',
  brain: '<path d="M9.5 4.5A3 3 0 006.7 9a3 3 0 00-1.2 5.6A3 3 0 008.7 20c.9 0 1.7-.4 2.3-1V5.6a3 3 0 00-1.5-1.1z"/><path d="M14.5 4.5A3 3 0 0117.3 9a3 3 0 011.2 5.6A3 3 0 0115.3 20c-.9 0-1.7-.4-2.3-1V5.6a3 3 0 011.5-1.1z"/>',
  book: '<path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v16l-8-4-8 4z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 3l3 3"/><path d="M15 5l2.5 2.5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  sort: '<path d="M7 4v16"/><path d="M3.5 8L7 4.5 10.5 8"/><path d="M17 20V4"/><path d="M13.5 16l3.5 3.5 3.5-3.5"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
  arrowUpRight: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>',
  alert: '<path d="M10.3 3.9L2.6 17.4A2 2 0 004.3 20.4h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4"/><path d="M12 16.6h.01"/>',
  wand: '<path d="M15 4V2"/><path d="M15 10V8"/><path d="M12 7h-2"/><path d="M20 7h-2"/><path d="M17.6 4.4l1.4-1.4"/><path d="M17.6 9.6l1.4 1.4"/><path d="M12.4 4.4L11 3"/><path d="M3 21l9-9"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0115 0"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 5.2a3.4 3.4 0 010 6.6"/><path d="M18 14.4a6.5 6.5 0 013.5 5.6"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>',
  palette: '<path d="M12 3a9 9 0 000 18c1.4 0 2-.9 2-1.8 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.3 0-1 .8-1.8 1.8-1.8H16a5 5 0 005-5c0-3.9-4-7.7-9-7.7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
  swords: '<path d="M14.5 14.5L20 20"/><path d="M20 4l-9 9"/><path d="M17 4h3v3"/><path d="M4 4l9 9"/><path d="M4 7V4h3"/>',
  quill: '<path d="M20 4c-5 0-9 3-11 8l-3 6 6-3c5-2 8-6 8-11z"/><path d="M4 20l5-5"/>',
  scroll: '<path d="M6 4h11a2 2 0 012 2v12a2 2 0 002 2H7a2 2 0 01-2-2V6a2 2 0 011-2z"/><path d="M9 8h7"/><path d="M9 12h7"/>',
  leaf: '<path d="M4 20c0-8 6-14 16-15 1 10-5 16-13 16"/><path d="M4 20c2-5 5.5-8 10-9.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  hash: '<path d="M5 9h14"/><path d="M5 15h14"/><path d="M10 4l-2 16"/><path d="M16 4l-2 16"/>',
  star: '<path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 17.3 6.7 20.2l1.1-6.1L3.4 9.9l6-.8z"/>',
  network: '<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><path d="M12 7.4v4.2"/><path d="M10.2 13.2L6.6 16"/><path d="M13.8 13.2l3.6 2.8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  flame: '<path d="M12 3c3 4 6 6 6 10a6 6 0 11-12 0c0-2 1-3.5 2-5 .5 1 1.2 1.6 2 1.6C10.5 7.5 11 5 12 3z"/>',
  drop: '<path d="M12 3c3.5 4.5 6 7.6 6 10.6A6 6 0 016 13.6C6 10.6 8.5 7.5 12 3z"/>',
  mountain: '<path d="M3 19l6-11 4 7 3-4 5 8z"/><circle cx="8" cy="6.5" r="1.6"/>',
  compassRose: '<path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2l-3 5h6z"/><path d="M12 22l-3-5h6z"/>',

  // 收藏 / 配图 / 做题（本轮新增）
  starFill: '<path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 17.3 6.7 20.2l1.1-6.1L3.4 9.9l6-.8z" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3.5 17l4.8-4.4a2 2 0 012.7 0l3.2 3"/><path d="M14 14.5l1.8-1.6a2 2 0 012.7 0L21 15.6"/>',
  imageOff: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 3l18 18"/><circle cx="8.5" cy="9.5" r="1.6"/>',
  checkSquare: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  square: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>',
  quiz: '<path d="M9.5 9a2.6 2.6 0 115.1.9c0 1.7-2.6 2-2.6 3.6"/><path d="M12 17.5h.01"/><circle cx="12" cy="12" r="9"/>',
  flag: '<path d="M5 21V4"/><path d="M5 5h11l-1.6 3.5L16 12H5z"/>',
  verified: '<path d="M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.7 2.6.7 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5-2.3-1.4.7-2.6-.7-2.6 2.3-1.4 1-2.5 2.7.2z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 115.1.9c0 1.7-2.6 2-2.6 3.6"/><path d="M12 17.3h.01"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 6H4.5v1.5A3.5 3.5 0 007 10.8"/><path d="M17 6h2.5v1.5A3.5 3.5 0 0117 10.8"/><path d="M12 14v3"/><path d="M8.5 21h7"/><path d="M10 17h4l.6 4h-5.2z"/>',
  castle: '<path d="M4 21V8l2.5-2L9 8l3-2.5L15 8l2.5-2L20 8v13z"/><path d="M4 11h16"/><path d="M10 21v-5h4v5"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0112 8a3.9 3.9 0 017 2.7C19 15.6 12 20 12 20z"/>',
  crown: '<path d="M3 18h18"/><path d="M4 18l-1-9 5 3.5L12 5l4 7.5L21 9l-1 9z"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5"/><path d="M12 17v5"/><path d="M2 12h5"/><path d="M17 12h5"/>',
};

/** 取图标 innerHTML，未知名称回退到 info */
export function iconPath(name) {
  return P[name] || P.info;
}

export function hasIcon(name) {
  return Boolean(P[name]);
}

export const ICON_NAMES = Object.keys(P);
export default P;
