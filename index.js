// qs_box_takeoff_multi.js
// Multi-box QS takeoff POC with:
// - Draw MULTIPLE boxes (click start -> click finish)
// - Select / multi-select (click = select, Ctrl/Cmd+click = toggle, click empty = clear)
// - Click-drag-release to MOVE selected boxes on the ground plane
// - Push/Pull on ANY FACE of the active/selected box (enable checkbox)
// - Face hover highlight in Push/Pull mode
// - Axis lock while push/pulling: press X / Y / Z (press again to clear)
// - Delete selected objects: Delete / Backspace (ignored while typing in inputs)
//
// Requires your HTML to include an importmap for "three" + "three/addons/"
// and these UI element IDs: len, wid, hgt, baseY, snap, snapSize, pp, apply, clear, out

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// -----------------------------
// Scene / Camera / Renderer
// -----------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c10);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 400000);
camera.position.set(8000, 6500, 8000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.style.touchAction = "none"; // avoid gesture stealing
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(6000, 9000, 3000);
scene.add(dir);

scene.add(new THREE.GridHelper(50000, 100, 0x2b2f3a, 0x1a1d24));

// Make origin obvious (axes + dot)
const axes = new THREE.AxesHelper(6000);
axes.position.set(0, 5, 0);
scene.add(axes);

const originDot = new THREE.Mesh(
  new THREE.SphereGeometry(60, 18, 18),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
originDot.position.set(0, 20, 0);
scene.add(originDot);

// Raycast ground plane (keep visible=true; opacity=0 for invisibility)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400000, 400000),
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide
  })
);
ground.rotation.x = -Math.PI / 2;
ground.visible = true;
scene.add(ground);

// -----------------------------
// UI elements
// -----------------------------
const lenEl = document.getElementById("len");
const widEl = document.getElementById("wid");
const hgtEl = document.getElementById("hgt");
const baseYEl = document.getElementById("baseY");
const snapEl = document.getElementById("snap");
const snapSizeEl = document.getElementById("snapSize");
const ppEl = document.getElementById("pp");
const outEl = document.getElementById("out");
const applyBtn = document.getElementById("apply");
const clearBtn = document.getElementById("clear");

// -----------------------------
// Dimension Modal (HTML/CSS based)
// -----------------------------
const dimModal = document.getElementById("dimModal");
const dlL = document.getElementById("dl_L");
const dlW = document.getElementById("dl_W");
const dlH = document.getElementById("dl_H");
const dlBaseY = document.getElementById("dl_baseY");
const dlApply = document.getElementById("dl_apply");
const dlClear = document.getElementById("dl_clear");

// drawing locks
const drawLock = { active: false, L: null, W: null, H: null, baseY: null };
// Live display in modal inputs (only when user hasn't manually typed)
const dlManual = { L: false, W: false, H: false };
let suppressModalAuto = false;

dlL?.addEventListener("input", () => { 
  if (suppressModalAuto) return;
  dlManual.L = dlL.value !== ""; 
});
dlW?.addEventListener("input", () => { 
  if (suppressModalAuto) return;
  dlManual.W = dlW.value !== ""; 
});
dlH?.addEventListener("input", () => { 
  if (suppressModalAuto) return;
  dlManual.H = dlH.value !== ""; 
});
// Update modal fields with relative deltas from start point to current mouse point.
// Length shows |ΔX|, Width shows |ΔZ|. Height shows current UI height (hgtEl) unless user overrides.

// Sidebar/manual overrides (len/wid) while drawing:
// - If user types a value, it overrides the mouse delta
// - If user clears the field, it reverts to mouse delta
const sbManual = { L: false, W: false };
let suppressSidebarAuto = false;

function setSidebarLenWid(L, W) {
  if (!lenEl || !widEl) return;
  suppressSidebarAuto = true;
  try {
    if (!sbManual.L) lenEl.value = String(Math.round(L));
    if (!sbManual.W) widEl.value = String(Math.round(W));
  } finally {
    suppressSidebarAuto = false;
  }
}

lenEl?.addEventListener("input", () => {
  if (suppressSidebarAuto) return;
  sbManual.L = lenEl.value !== "";
  // if drawing, update preview immediately
  if (drawing && startPt && lastGroundPoint) {
    currentPt = computeEndpoint(startPt, lastGroundPoint);
    updatePreviewRect(startPt, currentPt);
  }
});

widEl?.addEventListener("input", () => {
  if (suppressSidebarAuto) return;
  sbManual.W = widEl.value !== "";
  if (drawing && startPt && lastGroundPoint) {
    currentPt = computeEndpoint(startPt, lastGroundPoint);
    updatePreviewRect(startPt, currentPt);
  }
});

// When modal L/W inputs change, update preview immediately
dlL?.addEventListener("input", () => {
  if (drawing && startPt && lastGroundPoint) {
    currentPt = computeEndpoint(startPt, lastGroundPoint);
    updatePreviewRect(startPt, currentPt);
  }
});
dlW?.addEventListener("input", () => {
  if (drawing && startPt && lastGroundPoint) {
    currentPt = computeEndpoint(startPt, lastGroundPoint);
    updatePreviewRect(startPt, currentPt);
  }
});

function getOverrideAbsNumber(el) {
  if (!el) return null;
  const v = el.value;
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n);
}

function updateSidebarLive(mousePointOnGround) {
  if (!drawing || !startPt || !mousePointOnGround) return;
  const dx = mousePointOnGround.x - startPt.x;
  const dz = mousePointOnGround.z - startPt.z;
  setSidebarLenWid(Math.abs(dx), Math.abs(dz));
}
function updateDimModalLive(mousePointOnGround) {
  if (!dimModal) return;
  const visible = !dimModal.classList.contains("hidden") && dimModal.style.display !== "none";
  if (!visible) return;
  if (!drawing || !startPt || !mousePointOnGround) return;

  const dx = mousePointOnGround.x - startPt.x;
  const dz = mousePointOnGround.z - startPt.z;

  // If the field is empty, it is always "mouse-driven" (reverts automatically when cleared)
  if (dlL && dlL.value === "" && dlL !== document.activeElement) dlL.value = String(Math.round(Math.abs(dx)));
  if (dlW && dlW.value === "" && dlW !== document.activeElement) dlW.value = String(Math.round(Math.abs(dz)));

  // If user hasn't manually typed, keep mirroring mouse
  if (!dlManual.L && dlL && dlL !== document.activeElement) dlL.value = String(Math.round(Math.abs(dx)));
  if (!dlManual.W && dlW && dlW !== document.activeElement) dlW.value = String(Math.round(Math.abs(dz)));

  // Height mirrors sidebar height unless user overrides
  if (!dlManual.H && dlH && dlH !== document.activeElement && hgtEl) {
    dlH.value = String(Math.round(Number(hgtEl.value) || 0));
  }
}

function showDimModal() {
  if (!dimModal) return;
  dimModal.classList.remove("hidden");
  dimModal.style.display = "block";
  dimModal.setAttribute("aria-hidden", "false");

  // Focus LENGTH field reliably after display change
  requestAnimationFrame(() => {
    dlL?.focus({ preventScroll: true });
    // Select existing value so typing overwrites
    if (typeof dlL?.select === "function") dlL.select();
  });
}

function hideDimModal() {
  if (!dimModal) return;
  dimModal.classList.add("hidden");
  dimModal.style.display = "none";
  dimModal.setAttribute("aria-hidden", "true");
}
function clearDimModal() {
  suppressModalAuto = true;
  try {
    dlL.value = "";
    dlW.value = "";
    dlH.value = "";
    dlBaseY.value = "";
  } finally {
    suppressModalAuto = false;
  }
  drawLock.active = false;
  drawLock.L = drawLock.W = drawLock.H = drawLock.baseY = null;
  // Reset manual typing flags for next shape
  dlManual.L = false;
  dlManual.W = false;
  dlManual.H = false;
  sbManual.L = false;
  sbManual.W = false;
}

function applyDimModal() {
  // If not currently drawing, do nothing
  if (!drawing || !startPt) return;
  
  // Apply dimension locks
  drawLock.active = true;
  drawLock.L = (dlL.value === "") ? null : Math.max(1, Number(dlL.value));
  drawLock.W = (dlW.value === "") ? null : Math.max(1, Number(dlW.value));
  drawLock.H = (dlH.value === "") ? null : Math.max(0, Number(dlH.value));
  drawLock.baseY = (dlBaseY.value === "") ? null : Number(dlBaseY.value);

  // sync UI if user typed H/baseY
  if (drawLock.H != null && hgtEl) hgtEl.value = String(Math.round(drawLock.H));
  if (drawLock.baseY != null && baseYEl) baseYEl.value = String(Math.round(drawLock.baseY));
  
  // Complete the shape (same logic as second mouse click)
  if (lastGroundPoint) {
    currentPt = computeEndpoint(startPt, lastGroundPoint);
  } else if (currentPt) {
    // Use existing currentPt if no ground point available
  } else {
    // Fallback: use start point
    currentPt = startPt.clone();
  }
  
  updatePreviewRect(startPt, currentPt);
  createBoxFromFootprint(startPt, currentPt);
  drawing = false;
  startPt = null;
  currentPt = null;
  clearPreview();
  exportQuantities({ drawing: "finished" });
  hideDimModal();
  clearDimModal();
}

dlApply?.addEventListener("click", applyDimModal);
dlClear?.addEventListener("click", () => { clearDimModal(); dlManual.L = dlManual.W = dlManual.H = false; });

// Modal ENTER/ESC key handler (uses capture to run before other handlers)
window.addEventListener("keydown", (e) => {
  if (!dimModal) return;
  const isOpen = dimModal.getAttribute("aria-hidden") === "false";
  if (!isOpen) return;

  // ENTER / NUMPAD ENTER => Click the Apply button
  if (e.key === "Enter" || e.code === "NumpadEnter") {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    dlApply?.click();
    return;
  }

  // ESC => cancel drawing
  if (e.key === "Escape") {
    e.preventDefault();
    cancelDrawing();
  }
}, { capture: true });

// -----------------------------
// State
// -----------------------------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

let drawing = false;
let startPt = null;
let currentPt = null;
let lastGroundPoint = null; // latest ground point under mouse (for live preview + overrides)


let drag = {
  active: false,
  pointerId: null,
  plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  offset: new THREE.Vector3(),
  before: null
};

let pushPull = {
  active: false,
  pointerId: null,
  face: null,          // { id, clickedFaceN, dragPlane, startPoint, startDims, startCenter }
  lockAxis: null,       // 'x' | 'y' | 'z' | null
  before: null
};

let nextId = 1;

// Box registry
/** @type {Array<{id:string, mesh:THREE.Mesh, meta:{baseY:number,height:number}}>} */
const objects = [];

// Selection set (IDs)
const selected = new Set();

// Materials / colors
const NORMAL_COLOR = 0x9aa4b2;
const SELECT_COLOR = 0xffd166;

// -----------------------------
// Preview rectangle (drawing)
// -----------------------------
const previewLineMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.95 });
const previewLineGeom = new THREE.BufferGeometry();
const previewLine = new THREE.Line(previewLineGeom, previewLineMat);
previewLine.visible = false;
scene.add(previewLine);

function clearPreview() {
  previewLine.visible = false;
  previewLineGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
}

// -----------------------------
// Push/Pull hover face highlight
// -----------------------------
const hoverFaceMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide
});
const hoverFaceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hoverFaceMat);
hoverFaceMesh.visible = false;
scene.add(hoverFaceMesh);

// -----------------------------
// Helpers
// -----------------------------
function setMouseFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
}

function snapValue(v, step) {
  return Math.round(v / step) * step;
}

function raycastGround(e) {
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(ground, false);
  if (!hits.length) return null;
  const p = hits[0].point.clone();
  p.y = 0;

  // Grid snap first
  if (snapEl?.checked) {
    const s = Math.max(1, Number(snapSizeEl?.value) || 10);
    p.x = snapValue(p.x, s);
    p.z = snapValue(p.z, s);
  }

  // Object snap second (corners/mids)
  const res = snapToNearestObjectPoint(p.x, p.z);
  p.x = res.x;
  p.z = res.z;

  return p;
}

function raycastObjects(e) {
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);
  const meshes = objects.map(o => o.mesh);
  return raycaster.intersectObjects(meshes, false);
}

function dimsFromStartEnd(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return {
    dx, dz,
    len: Math.abs(dx),
    wid: Math.abs(dz),
    sx: Math.sign(dx) || 1,
    sz: Math.sign(dz) || 1
  };
}

function updatePreviewRect(a, b) {
  const { dx, dz } = dimsFromStartEnd(a, b);
  const p1 = new THREE.Vector3(a.x, 0, a.z);
  const p2 = new THREE.Vector3(a.x + dx, 0, a.z);
  const p3 = new THREE.Vector3(a.x + dx, 0, a.z + dz);
  const p4 = new THREE.Vector3(a.x, 0, a.z + dz);

  const verts = [
    p1.x, p1.y, p1.z,
    p2.x, p2.y, p2.z,
    p3.x, p3.y, p3.z,
    p4.x, p4.y, p4.z,
    p1.x, p1.y, p1.z
  ];
  previewLineGeom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  previewLineGeom.computeBoundingSphere();
  previewLine.visible = true;

  if (lenEl) lenEl.value = String(Math.round(Math.abs(dx)));
  if (widEl) widEl.value = String(Math.round(Math.abs(dz)));
}

function getObjectById(id) {
  return objects.find(o => o.id === id) || null;
}

function selectedObjects() {
  return objects.filter(o => selected.has(o.id));
}

function refreshSelectionVisuals() {
  for (const o of objects) {
    o.mesh.material.color.setHex(selected.has(o.id) ? SELECT_COLOR : NORMAL_COLOR);
  }
}

function clearSelection() {
  selected.clear();
  refreshSelectionVisuals();
  exportQuantities();
}

function toggleSelection(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  refreshSelectionVisuals();
  exportQuantities();
}

function setSingleSelection(id) {
  selected.clear();
  selected.add(id);
  refreshSelectionVisuals();
  exportQuantities();
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

function cancelDrawing() {
  drawing = false;
  startPt = null;
  currentPt = null;
  clearPreview();
  hideDimModal();
  clearDimModal();
  exportQuantities({ cancelled: true });
}

function computeEndpoint(start, mousePoint) {
  const d = new THREE.Vector3().subVectors(mousePoint, start);

  const sx = (Math.abs(d.x) < 1e-6) ? 1 : Math.sign(d.x);
  const sz = (Math.abs(d.z) < 1e-6) ? 1 : Math.sign(d.z);

  // Override precedence:
  // 1) Modal L/W if non-empty
  // 2) Sidebar len/wid if user manually typed (non-empty)
  // 3) Mouse delta
  const modalL = getOverrideAbsNumber(dlL);
  const modalW = getOverrideAbsNumber(dlW);

  const sideL = (typeof sbManual !== "undefined" && sbManual.L) ? getOverrideAbsNumber(lenEl) : null;
  const sideW = (typeof sbManual !== "undefined" && sbManual.W) ? getOverrideAbsNumber(widEl) : null;

  const L = modalL ?? sideL ?? Math.abs(d.x);
  const W = modalW ?? sideW ?? Math.abs(d.z);

  return new THREE.Vector3(start.x + sx * L, 0, start.z + sz * W);
}

// -----------------------------
// Undo / Redo (Cmd/Ctrl+Z)
// -----------------------------
const undoStack = [];
const redoStack = [];
let isReplaying = false;

function pushAction(action) {
  if (isReplaying) return;
  undoStack.push(action);
  redoStack.length = 0;
}

function doUndo() {
  const a = undoStack.pop();
  if (!a) return;
  isReplaying = true;
  try { a.undo(); } finally { isReplaying = false; }
  redoStack.push(a);
  exportQuantities({ undo: true });
}

function doRedo() {
  const a = redoStack.pop();
  if (!a) return;
  isReplaying = true;
  try { a.redo(); } finally { isReplaying = false; }
  undoStack.push(a);
  exportQuantities({ redo: true });
}

function snapshotBox(o) {
  const p = o.mesh.geometry.parameters;
  return {
    id: o.id,
    meta: { baseY: o.meta.baseY, height: o.meta.height },
    geom: { L: p.width, H: p.height, W: p.depth },
    pos: { x: o.mesh.position.x, y: o.mesh.position.y, z: o.mesh.position.z }
  };
}

function restoreBoxFromSnapshot(snap) {
  let o = getObjectById(snap.id);

  if (!o) {
    const geom = new THREE.BoxGeometry(snap.geom.L, snap.geom.H, snap.geom.W);
    const mat = new THREE.MeshStandardMaterial({ color: NORMAL_COLOR, roughness: 0.65, metalness: 0.05 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.kind = "qs_box";
    mesh.userData.id = snap.id;
    mesh.position.set(snap.pos.x, snap.pos.y, snap.pos.z);
    scene.add(mesh);

    o = { id: snap.id, mesh, meta: { baseY: snap.meta.baseY, height: snap.meta.height } };
    objects.push(o);

    // keep nextId ahead of restored ids (box_12 etc)
    const n = Number(String(snap.id).split("_")[1]);
    if (!Number.isNaN(n)) nextId = Math.max(nextId, n + 1);
  } else {
    o.mesh.geometry.dispose();
    o.mesh.geometry = new THREE.BoxGeometry(snap.geom.L, snap.geom.H, snap.geom.W);
    o.mesh.position.set(snap.pos.x, snap.pos.y, snap.pos.z);
    o.meta.baseY = snap.meta.baseY;
    o.meta.height = snap.meta.height;
    o.mesh.updateMatrixWorld(true);
  }

  return o;
}

function removeBoxById(id) {
  const idx = objects.findIndex(x => x.id === id);
  if (idx === -1) return;
  const o = objects[idx];
  scene.remove(o.mesh);
  o.mesh.geometry.dispose();
  o.mesh.material.dispose();
  objects.splice(idx, 1);
  selected.delete(id);
}


// --- Snap-to-objects settings ---
const SNAP_TO_OBJECTS = true;     // set false to disable quickly
const SNAP_RADIUS_MM = 150;       // how close you need to be to snap (mm)

// Return snap points (XZ) for all boxes: 4 base corners + 4 top corners + center + edge midpoints (base)
function collectSnapPoints() {
  const pts = [];

  for (const o of objects) {
    const m = o.mesh;
    const p = m.position;
    const { width: L, height: H, depth: W } = m.geometry.parameters;

    const halfL = L / 2;
    const halfW = W / 2;

    const baseY = o.meta.baseY;
    const topY = baseY + H;

    // Base corners (XZ important)
    const baseCorners = [
      new THREE.Vector3(p.x - halfL, baseY, p.z - halfW),
      new THREE.Vector3(p.x + halfL, baseY, p.z - halfW),
      new THREE.Vector3(p.x + halfL, baseY, p.z + halfW),
      new THREE.Vector3(p.x - halfL, baseY, p.z + halfW),
    ];

    // Base edge midpoints (nice for snapping walls, etc.)
    const baseMids = [
      new THREE.Vector3(p.x, baseY, p.z - halfW),
      new THREE.Vector3(p.x + halfL, baseY, p.z),
      new THREE.Vector3(p.x, baseY, p.z + halfW),
      new THREE.Vector3(p.x - halfL, baseY, p.z),
    ];

    // Center
    const center = new THREE.Vector3(p.x, baseY, p.z);

    // Top corners (optional — same XZ as base; still useful if later you add stacked snapping)
    const topCorners = baseCorners.map(v => v.clone().setY(topY));

    pts.push(...baseCorners, ...baseMids, center, ...topCorners);
  }

  return pts;
}

function snapToNearestObjectPoint(x, z) {
  if (!SNAP_TO_OBJECTS || objects.length === 0) return { x, z, snapped: false };

  const pts = collectSnapPoints();
  let best = null;
  let bestD2 = SNAP_RADIUS_MM * SNAP_RADIUS_MM;

  for (const p of pts) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }

  if (!best) return { x, z, snapped: false };
  return { x: best.x, z: best.z, snapped: true };
}
// -----------------------------
// Create box from footprint
// -----------------------------
function createBoxFromFootprint(a, b) {
  const baseY = Number(baseYEl?.value) || 0;
  const height = Math.max(0, Number(hgtEl?.value) || 0);

  const { len, wid, sx, sz } = dimsFromStartEnd(a, b);
  const L = Math.max(1, len);
  const W = Math.max(1, wid);

  const cx = a.x + (sx * L) / 2;
  const cz = a.z + (sz * W) / 2;
  const cy = baseY + height / 2;

  const geom = new THREE.BoxGeometry(L, height, W);
  const mat = new THREE.MeshStandardMaterial({ color: NORMAL_COLOR, roughness: 0.65, metalness: 0.05 });
  const mesh = new THREE.Mesh(geom, mat);

  mesh.position.set(cx, cy, cz);
  mesh.userData.kind = "qs_box";
  mesh.userData.id = `box_${nextId++}`;

  scene.add(mesh);

  objects.push({
    id: mesh.userData.id,
    mesh,
    meta: { baseY, height }
  });

  // Auto-select newly created box
  selected.clear();
  selected.add(mesh.userData.id);
  refreshSelectionVisuals();
  exportQuantities();

// Undo record: create
const createdId = mesh.userData.id;
pushAction({
  undo: () => removeBoxById(createdId),
  redo: () => restoreBoxFromSnapshot({
    id: createdId,
    meta: { baseY, height },
    geom: { L, H: height, W },
    pos: { x: cx, y: cy, z: cz }
  })
});

  return mesh;
}

// -----------------------------
// Apply inputs to selected boxes
// -----------------------------
function applyInputsToSelection() {
  const sels = selectedObjects();
  if (!sels.length) return;

  const L = Math.max(1, Number(lenEl?.value) || 1);
  const W = Math.max(1, Number(widEl?.value) || 1);
  const H = Math.max(0, Number(hgtEl?.value) || 0);
  const baseY = Number(baseYEl?.value) || 0;

  for (const o of sels) {
    o.mesh.geometry.dispose();
    o.mesh.geometry = new THREE.BoxGeometry(L, H, W);

    o.meta.baseY = baseY;
    o.meta.height = H;

    o.mesh.position.y = baseY + H / 2;
    o.mesh.updateMatrixWorld(true);
  }

  exportQuantities();
}

// -----------------------------
// Quantities
// -----------------------------
function round(n) {
  return Math.round(n * 10) / 10;
}

function computeBoxQuantities(o) {
  const params = o.mesh.geometry.parameters;
  const L = params.width;   // x
  const H = params.height;  // y
  const W = params.depth;   // z

  const areaTop = L * W;
  const areaBottom = L * W;
  const areaPosX = W * H;
  const areaNegX = W * H;
  const areaPosZ = L * H;
  const areaNegZ = L * H;

  const volume = L * W * H;
  const totalSurfaceArea = 2 * (L * W + L * H + W * H);

  return {
    id: o.id,
    baseY: o.meta.baseY,
    lengthX: L,
    widthZ: W,
    heightY: H,
    position: { x: round(o.mesh.position.x), y: round(o.mesh.position.y), z: round(o.mesh.position.z) },
    areas: {
      top: areaTop,
      bottom: areaBottom,
      posX: areaPosX,
      negX: areaNegX,
      posZ: areaPosZ,
      negZ: areaNegZ,
      total_surface_area: totalSurfaceArea
    },
    perimeter_base: 2 * (L + W),
    volume
  };
}

function exportQuantities(extra = null) {
  const all = objects.map(computeBoxQuantities);
  const sel = selectedObjects().map(computeBoxQuantities);

  const totalsAll = {
    volume: all.reduce((s, b) => s + b.volume, 0),
    top: all.reduce((s, b) => s + b.areas.top, 0),
    bottom: all.reduce((s, b) => s + b.areas.bottom, 0),
    posX: all.reduce((s, b) => s + b.areas.posX, 0),
    negX: all.reduce((s, b) => s + b.areas.negX, 0),
    posZ: all.reduce((s, b) => s + b.areas.posZ, 0),
    negZ: all.reduce((s, b) => s + b.areas.negZ, 0),
    total_surface_area: all.reduce((s, b) => s + b.areas.total_surface_area, 0)
  };

  const payload = {
    units: "mm",
    kind: "qs_box_takeoff_multi",
    count: objects.length,
    selected_count: selected.size,
    selected_ids: [...selected],
    objects: all,
    selected_objects: sel,
    totals_all: totalsAll,
    push_pull: {
      enabled: !!ppEl?.checked,
      active: pushPull.active,
      axis_lock: pushPull.lockAxis
    }
  };

  if (extra) Object.assign(payload, extra);
  if (outEl) outEl.textContent = JSON.stringify(payload, null, 2);
  return payload;
}

// -----------------------------
// Drag move (click-drag-release)
// -----------------------------
function startDrag(e, pickedObj) {
  drag.active = true;
  drag.pointerId = e.pointerId;

  // Drag plane at base elevation of picked object
  const baseY = pickedObj.meta.baseY;
  drag.plane.set(new THREE.Vector3(0, 1, 0), -baseY);

  setMouseFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);
  const p = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(drag.plane, p);
  if (!ok) {
    drag.active = false;
    drag.pointerId = null;
    return;
  }

  // Offset from hit point to picked object's XZ
  drag.offset.set(pickedObj.mesh.position.x - p.x, 0, pickedObj.mesh.position.z - p.z);

  // Undo record: move (capture "before")
  drag.before = selectedObjects().map(o => snapshotBox(o));

  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}

function updateDrag(e) {
  if (!drag.active) return;

  setMouseFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);

  const p = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(drag.plane, p);
  if (!ok) return;

  // target position for anchor
  let tx = p.x + drag.offset.x;
  let tz = p.z + drag.offset.z;

  // grid snap (optional)
  if (snapEl?.checked) {
    const s = Math.max(1, Number(snapSizeEl?.value) || 10);
    tx = snapValue(tx, s);
    tz = snapValue(tz, s);
  }

  // ✅ object snap (corners/mids)
  const res = snapToNearestObjectPoint(tx, tz);
  tx = res.x;
  tz = res.z;

  const sels = selectedObjects();
  if (!sels.length) return;

  const anchor = sels[0].mesh;
  const dx = tx - anchor.position.x;
  const dz = tz - anchor.position.z;

  for (const o of sels) {
    o.mesh.position.x += dx;
    o.mesh.position.z += dz;

    const H = o.mesh.geometry.parameters.height;
    o.mesh.position.y = o.meta.baseY + H / 2;
    o.mesh.updateMatrixWorld(true);
  }

  exportQuantities({ dragging: true });
}
function endDrag(e) {
  if (!drag.active) return;

  // Undo record: move (capture "after")
  const before = drag.before || [];
  const after = selectedObjects().map(o => snapshotBox(o));

  if (before.length || after.length) {
    pushAction({
      undo: () => { before.forEach(s => restoreBoxFromSnapshot(s)); refreshSelectionVisuals(); },
      redo: () => { after.forEach(s => restoreBoxFromSnapshot(s)); refreshSelectionVisuals(); }
    });
  }
  drag.before = null;

  drag.active = false;
  drag.pointerId = null;
  controls.enabled = true;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
  exportQuantities({ dragging: false });
}


// -----------------------------
// Push / Pull (ANY FACE) + Hover highlight + Axis lock
// -----------------------------
function axisNormalFromHit(hit) {
  // Face normal to world space
  const nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();

  // Snap to principal axis (±X/±Y/±Z)
  const ax = Math.abs(nWorld.x), ay = Math.abs(nWorld.y), az = Math.abs(nWorld.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(nWorld.x) || 1, 0, 0);
  if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(nWorld.y) || 1, 0);
  return new THREE.Vector3(0, 0, Math.sign(nWorld.z) || 1);
}

function lockedAxisVector(locked, clickedFaceN) {
  if (!locked) return clickedFaceN.clone();

  if (locked === "x") return new THREE.Vector3(clickedFaceN.x !== 0 ? Math.sign(clickedFaceN.x) : 1, 0, 0);
  if (locked === "y") return new THREE.Vector3(0, clickedFaceN.y !== 0 ? Math.sign(clickedFaceN.y) : 1, 0);
  return new THREE.Vector3(0, 0, clickedFaceN.z !== 0 ? Math.sign(clickedFaceN.z) : 1);
}

function startPushPull(e) {
  if (!ppEl?.checked) return false;

  const hits = raycastObjects(e);
  const hit = hits[0];
  if (!hit) return false;

  const id = hit.object.userData.id;

  // Make it active selection
  if (!selected.has(id) || selected.size !== 1) setSingleSelection(id);

  const o = getObjectById(id);
  if (!o) return false;

  // Undo record: push/pull (capture "before")
  pushPull.before = snapshotBox(o);

  const clickedFaceN = axisNormalFromHit(hit); // axis unit vector

  // Cache starting dims/center
  const params = o.mesh.geometry.parameters;
  const startDims = { L: params.width, H: params.height, W: params.depth };
  const startCenter = o.mesh.position.clone();

  // Drag plane: camera-facing through hit point (stable for any face)
  const camN = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camN, hit.point);

  pushPull.active = true;
  pushPull.pointerId = e.pointerId;
  pushPull.face = {
    id,
    clickedFaceN,
    dragPlane,
    startPoint: hit.point.clone(),
    startDims,
    startCenter
  };

  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);

  exportQuantities({ pushPull: { active: true, id, face: { x: clickedFaceN.x, y: clickedFaceN.y, z: clickedFaceN.z } } });
  return true;
}

function updatePushPull(e) {
  if (!pushPull.active || !pushPull.face) return;

  const { id, clickedFaceN, dragPlane, startPoint, startDims, startCenter } = pushPull.face;
  const o = getObjectById(id);
  if (!o) return;

  // Determine active axis (locked or clicked)
  const faceN = lockedAxisVector(pushPull.lockAxis, clickedFaceN);

  // Ray -> plane
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);

  const p = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(dragPlane, p);
  if (!ok) return;

  // Movement along face normal
  let delta = p.clone().sub(startPoint).dot(faceN);

  if (e.shiftKey) delta *= 0.25;

  if (snapEl?.checked) {
    const s = Math.max(1, Number(snapSizeEl?.value) || 10);
    delta = snapValue(delta, s);
  }

  // New dims
  let newL = startDims.L, newH = startDims.H, newW = startDims.W;

  if (faceN.x !== 0) newL = Math.max(1, startDims.L + delta);
  if (faceN.y !== 0) newH = Math.max(0, startDims.H + delta);
  if (faceN.z !== 0) newW = Math.max(1, startDims.W + delta);

  // Opposite face stays fixed: opp = startCenter - faceN*(startDim/2)
  const startDim = faceN.x !== 0 ? startDims.L : (faceN.y !== 0 ? startDims.H : startDims.W);
  const opp = startCenter.clone().sub(faceN.clone().multiplyScalar(startDim / 2));

  // New center = opp + faceN*(newDim/2)
  const newDim = faceN.x !== 0 ? newL : (faceN.y !== 0 ? newH : newW);
  const newCenter = opp.clone().add(faceN.clone().multiplyScalar(newDim / 2));

  // Apply geometry + position
  o.mesh.geometry.dispose();
  o.mesh.geometry = new THREE.BoxGeometry(newL, newH, newW);
  o.mesh.position.copy(newCenter);

  // Update meta (baseY is always bottom face world Y)
  o.meta.height = newH;
  o.meta.baseY = newCenter.y - (newH / 2);

  o.mesh.updateMatrixWorld(true);

  // Sync UI (active object)
  if (lenEl) lenEl.value = String(Math.round(newL));
  if (widEl) widEl.value = String(Math.round(newW));
  if (hgtEl) hgtEl.value = String(Math.round(newH));
  if (baseYEl) baseYEl.value = String(Math.round(o.meta.baseY));

  exportQuantities({
    pushPull: {
      active: true,
      id,
      clickedFace: { x: clickedFaceN.x, y: clickedFaceN.y, z: clickedFaceN.z },
      axis: { x: faceN.x, y: faceN.y, z: faceN.z },
      axis_lock: pushPull.lockAxis,
      delta_mm: delta
    }
  });
}

function endPushPull(e) {
  if (!pushPull.active) return;

  // Undo record: push/pull (capture "after")
  const id = pushPull.face?.id;
  const o = id ? getObjectById(id) : null;
  const before = pushPull.before;
  const after = o ? snapshotBox(o) : null;

  if (before && after) {
    pushAction({
      undo: () => restoreBoxFromSnapshot(before),
      redo: () => restoreBoxFromSnapshot(after)
    });
  }
  pushPull.before = null;

  pushPull.active = false;
  pushPull.pointerId = null;
  pushPull.face = null;
  pushPull.lockAxis = null;
  controls.enabled = true;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
  exportQuantities({ pushPull: { active: false } });
}


// Hover highlight: show which face would be pulled if clicked (PP mode only)
function updateHoverFaceHighlight(e) {
  if (!ppEl?.checked || pushPull.active || drag.active || drawing) {
    hoverFaceMesh.visible = false;
    return;
  }

  const hits = objects.length ? raycastObjects(e) : [];
  const hit = hits[0];
  if (!hit) {
    hoverFaceMesh.visible = false;
    return;
  }

  const o = getObjectById(hit.object.userData.id);
  if (!o) {
    hoverFaceMesh.visible = false;
    return;
  }

  const clickedFaceN = axisNormalFromHit(hit);
  const faceN = lockedAxisVector(pushPull.lockAxis, clickedFaceN);

  const params = o.mesh.geometry.parameters;
  const L = params.width, H = params.height, W = params.depth;

  // plane size depending on face normal
  // PlaneGeometry default normal is +Z, size = (width, height) in XY.
  let pw = 1, ph = 1, offset = 0;

  if (faceN.x !== 0) { pw = W; ph = H; offset = L / 2; }
  else if (faceN.y !== 0) { pw = L; ph = W; offset = H / 2; }
  else { pw = L; ph = H; offset = W / 2; }

  // rebuild plane geometry if size changed
  const g = hoverFaceMesh.geometry;
  if (!g.parameters || g.parameters.width !== pw || g.parameters.height !== ph) {
    hoverFaceMesh.geometry.dispose();
    hoverFaceMesh.geometry = new THREE.PlaneGeometry(pw, ph);
  }

  // orientation: rotate plane normal (+Z) to faceN
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceN.clone().normalize());
  hoverFaceMesh.quaternion.copy(q);

  // position at face center + tiny epsilon to prevent z-fighting
  const eps = 2;
  const pos = o.mesh.position.clone().add(faceN.clone().multiplyScalar(offset + eps));
  hoverFaceMesh.position.copy(pos);

  // color cue: selected object face highlight stronger
  hoverFaceMat.opacity = selected.has(o.id) ? 0.32 : 0.18;

  hoverFaceMesh.visible = true;
}

// -----------------------------
// Delete selection
// -----------------------------
function deleteSelected() {
  if (!selected.size) return;

  const snaps = [...selected].map(id => {
    const o = getObjectById(id);
    return o ? snapshotBox(o) : null;
  }).filter(Boolean);

  pushAction({
    undo: () => {
      snaps.forEach(s => restoreBoxFromSnapshot(s));
      refreshSelectionVisuals();
    },
    redo: () => {
      snaps.forEach(s => removeBoxById(s.id));
      refreshSelectionVisuals();
    }
  });

  snaps.forEach(s => removeBoxById(s.id));

  selected.clear();
  refreshSelectionVisuals();
  hoverFaceMesh.visible = false;

  exportQuantities({ deleted: true });
}

// -----------------------------
// Pointer events (select / draw / drag / pushpull)
//  (select / draw / drag / pushpull)
// -----------------------------
renderer.domElement.addEventListener("pointermove", (e) => {
  if (pushPull.active) {
    updatePushPull(e);
    return;
  }
  if (drag.active) {
    updateDrag(e);
    return;
  }

  updateHoverFaceHighlight(e);

  if (drawing && startPt) {
    const p = raycastGround(e);
    if (!p) return;
    lastGroundPoint = p.clone();
    updateDimModalLive(p);
    updateSidebarLive(p);
    currentPt = computeEndpoint(startPt, p);
    updatePreviewRect(startPt, currentPt);
  }
});

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (pushPull.active || drag.active) return;
  if (e.button !== 0) return;

  // If push/pull enabled, try start push/pull first (unless Alt held = MOVE override)
if (ppEl?.checked && objects.length && !e.altKey) {
  const started = startPushPull(e);
  if (started) return;
}

  // Hit test objects for selection/drag
  const hits = objects.length ? raycastObjects(e) : [];
  const hit = hits[0];

  if (hit) {
    const id = hit.object.userData.id;

    const multi = e.ctrlKey || e.metaKey;
    if (multi) toggleSelection(id);
    else if (!selected.has(id) || selected.size !== 1) setSingleSelection(id);

    const o = getObjectById(id);
    if (o && selected.has(id)) startDrag(e, o);

    return;
  }

  // Empty click: clear selection unless ctrl/cmd held
  if (!(e.ctrlKey || e.metaKey)) clearSelection();

  // Draw start/finish
  const p = raycastGround(e);
  if (!p) return;

  if (!drawing) {
    drawing = true;
    startPt = p;
    currentPt = p.clone();
    clearPreview();
    showDimModal();
    exportQuantities({ drawing: "started" });
  } else {
    currentPt = computeEndpoint(startPt, p);
    updatePreviewRect(startPt, currentPt);
    createBoxFromFootprint(startPt, currentPt);
    drawing = false;
    startPt = null;
    currentPt = null;
    clearPreview();
    exportQuantities({ drawing: "finished" });
    hideDimModal();
    clearDimModal();
  }
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (pushPull.active && e.pointerId === pushPull.pointerId) {
    endPushPull(e);
    return;
  }
  if (drag.active && e.pointerId === drag.pointerId) {
    endDrag(e);
    return;
  }
});

renderer.domElement.addEventListener("pointercancel", (e) => {
  if (pushPull.active) endPushPull(e);
  if (drag.active) endDrag(e);
});

renderer.domElement.addEventListener("dblclick", (e) => e.preventDefault());

// -----------------------------
// Keyboard
// -----------------------------
window.addEventListener("keydown", (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? e.metaKey : e.ctrlKey;

  // Undo / Redo (ignore while typing)
  if (mod && e.key.toLowerCase() === "z" && !isTypingTarget(document.activeElement)) {
    e.preventDefault();
    if (e.shiftKey) doRedo(); // Cmd/Ctrl+Shift+Z
    else doUndo();            // Cmd/Ctrl+Z
    return;
  }
  if (mod && e.key.toLowerCase() === "y" && !isTypingTarget(document.activeElement)) {
    e.preventDefault();
    doRedo();                 // Ctrl+Y
    return;
  }

  // Axis lock while push/pulling
  if (pushPull.active) {
    const k = e.key.toLowerCase();
    if (k === "x" || k === "y" || k === "z") {
      pushPull.lockAxis = (pushPull.lockAxis === k) ? null : k;
      exportQuantities({ axis_lock_changed: pushPull.lockAxis });
      // update hover face on next move (or right now if mouse is stationary)
      return;
    }
    if (k === "escape") {
      pushPull.lockAxis = null;
      exportQuantities({ axis_lock_changed: null });
      return;
    }
  }

  // ESC cancels drawing + clears selection
  if (e.key === "Escape") {
    cancelDrawing();
    hoverFaceMesh.visible = false;
    clearSelection();
    return;
  }

  // Delete / Backspace deletes selected (ignore if typing)
  if ((e.key === "Delete" || e.key === "Backspace") && !isTypingTarget(document.activeElement)) {
    deleteSelected();
  }
});

// -----------------------------
// Buttons
// -----------------------------
applyBtn?.addEventListener("click", applyInputsToSelection);

// ENTER key to trigger Apply button when editing sidebar inputs
[lenEl, widEl, hgtEl, baseYEl].forEach(el => {
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      applyInputsToSelection();
    }
  });
});

clearBtn?.addEventListener("click", () => {
  for (const o of objects) {
    scene.remove(o.mesh);
    o.mesh.geometry.dispose();
    o.mesh.material.dispose();
  }
  objects.length = 0;
  selected.clear();
  refreshSelectionVisuals();
  drawing = false;
  startPt = null;
  currentPt = null;
  clearPreview();
  hoverFaceMesh.visible = false;
  exportQuantities({ cleared: true });
});

// Light output refresh when editing inputs
[lenEl, widEl, hgtEl, baseYEl, snapEl, snapSizeEl, ppEl].forEach(el => {
  el?.addEventListener("input", () => exportQuantities());
});

// -----------------------------
// Render loop
// -----------------------------
function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initial output
exportQuantities();