/* Optional source-photo anchor: original frame in its fixed frustum, inferred surroundings outside. */
(() => {
  'use strict';
  const MOVIE_SHA = '0022434da1eab7f346282ffeedce6ab58168a500a8750975eda430301cd0ad46';
  const DEFINITIONS = [['overview', '全园鸟瞰'], ['court', '花廊雨庭'], ['bridge', '叠水溪桥'], ['bamboo', '竹冠仰望'],
    ['gallery', '廊下望湖'], ['pavilion', '平亭望湖'], ['lotus', '荷湾石桥'], ['grove', '林下小径']];
  const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const MIN_FOV = 35, MAX_FOV = 110, MAX_PITCH = 85, CUBE_SIZE = 3072;
  const SOURCE_PHOTO_ASPECT = 1920 / 1080, SOURCE_PHOTO_FEATHER = .03;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const radians = (v) => v * Math.PI / 180;
  const wrapYaw = (v) => ((v + 180) % 360 + 360) % 360 - 180;
  const isSHA = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);

  function safeNodeScript(value, id) {
    return DEFINITIONS.some(([known]) => known === id) && [`nodes/${id}.js`, `nodes-v4/${id}.js`, `nodes-v5/${id}.js`].includes(value) ? value : '';
  }

  function safeImagePath(value, id, kind) {
    if (!DEFINITIONS.some(([known]) => known === id)) return '';
    const allowed = kind === 'source' ? [`assets/source/${id}.png`] : FACE_KEYS.includes(kind) ?
      [`assets/cubes/${id}/${kind}.jpg`, `assets/cubes/${id}/${kind}.avif`, `assets/cubes-v4/${id}/${kind}.avif`, `assets/cubes-v5/${id}/${kind}.avif`] : [];
    return allowed.includes(value) ? value : '';
  }

  function bytes64(text) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', result = [];
    let value = 0, bits = 0;
    for (const char of text) {
      if (char === '=') break;
      const digit = alphabet.indexOf(char); if (digit < 0) return [];
      value = (value << 6) | digit; bits += 6;
      if (bits >= 8) { bits -= 8; result.push((value >>> bits) & 255); value &= (1 << bits) - 1; }
    }
    return result;
  }

  function dataImageInfo(value, kind) {
    const prefix = `data:image/${kind};base64,`;
    if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
    const data = value.slice(prefix.length);
    if (!data.length || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(-32))) return null;
    const head = bytes64(data.slice(0, 44)), tail = bytes64(data.slice(-24));
    if (kind === 'jpeg') return head[0] === 255 && head[1] === 216 && head[2] === 255 && tail.at(-2) === 255 && tail.at(-1) === 217 ? { kind } : null;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    const end = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
    if (!signature.every((v, i) => head[i] === v) || !end.every((v, i) => tail.slice(-12)[i] === v)) return null;
    const width = head[16] * 16777216 + head[17] * 65536 + head[18] * 256 + head[19];
    const height = head[20] * 16777216 + head[21] * 65536 + head[22] * 256 + head[23];
    return { kind, width, height };
  }

  function validateIndex(input) {
    if (!input || input.movieSHA !== MOVIE_SHA) throw new Error('影片来源标识缺失或不匹配。');
    if (!isSHA(input.modelSHA)) throw new Error('缺少有效的补建模型 SHA-256。');
    if (!Array.isArray(input.nodes) || input.nodes.length !== 8) throw new Error('须提供八个原片取景节点。');
    const nodes = input.nodes.map((node, i) => {
      const [id, label] = DEFINITIONS[i];
      if (!node || node.id !== id || node.label !== label) throw new Error('节点 ID、名称或顺序不匹配。');
      if (!isSHA(node.sourceSHA) || !Number.isFinite(node.sourceSecond) || typeof node.sourceSecond !== 'number' || node.sourceSecond < 0 || node.sourceSecond > 180) throw new Error(label + '缺少有效原帧标识或时间。');
      const nodeScript = safeNodeScript(node.nodeScript, id);
      if (!nodeScript) throw new Error(label + '的节点文件路径不合法。');
      const cubeSize = node.cubeSize === undefined ? CUBE_SIZE : node.cubeSize;
      if (![1024, 1254, 1536, 2048, 3072].includes(cubeSize)) throw new Error(label + '须声明实际六面尺寸，支持1024、1254、1536、2048或3072像素。');
      const sourcePhotoAnchor = node.sourcePhotoAnchor === undefined ? input.sourcePhotoAnchor === true : node.sourcePhotoAnchor === true;
      if (sourcePhotoAnchor && (typeof node.sourceFov !== 'number' || !Number.isFinite(node.sourceFov) || node.sourceFov <= 0 || node.sourceFov >= 179)) throw new Error(label + '须提供取景计划中有效的原片水平视角 sourceFov。');
      if (node.modelSHA !== undefined && !isSHA(node.modelSHA)) throw new Error(label + '的补全依据标识无效。');
      if (node.cubeEdgeBlend !== undefined && (![0, .05].includes(node.cubeEdgeBlend))) throw new Error(label + '的六面边缘过渡设置无效。');
      return { id, label, sourceSecond: node.sourceSecond, sourceSHA: node.sourceSHA, nodeScript, cubeSize, modelSHA: node.modelSHA || input.modelSHA, cubeEdgeBlend: node.cubeEdgeBlend || 0,
        modelYaw: wrapYaw(finite(node.modelYaw, 0)), modelPitch: clamp(finite(node.modelPitch, 0), -MAX_PITCH, MAX_PITCH), modelFov: clamp(finite(node.modelFov, 75), MIN_FOV, MAX_FOV),
        sourcePhotoAnchor, sourceFov: finite(node.sourceFov, finite(node.modelFov, 75)),
        sourceYaw: wrapYaw(finite(node.sourceYaw, finite(node.modelYaw, 0))), sourcePitch: clamp(finite(node.sourcePitch, finite(node.modelPitch, 0)), -90, 90) };
    });
    return { movieSHA: input.movieSHA, modelSHA: input.modelSHA,
      title: typeof input.title === 'string' && input.title.trim() ? input.title : '晴汀园 · 原片与建模环视',
      defaultNode: nodes.some((node) => node.id === input.defaultNode) ? input.defaultNode : 'pavilion',
      defaultMode: input.defaultMode === 'model' ? 'model' : 'photo', sourcePhotoAnchor: input.sourcePhotoAnchor === true, nodes };
  }

  function validateNodePayload(payload, node) {
    if (!payload || payload.id !== node.id) throw new Error('节点返回的数据身份不匹配。');
    const png = dataImageInfo(payload.sourceDataUrl, 'png');
    const sourceDataUrl = png && png.width === 1920 && png.height === 1080 ? payload.sourceDataUrl : '';
    const sourceUrl = payload.sourceUrl !== undefined ? safeImagePath(payload.sourceUrl, node.id, 'source') : sourceDataUrl;
    if (!sourceUrl) throw new Error('当前节点缺少有效的原片 PNG 路径或完整的 1920×1080 原片。');
    const cubeFaces = {};
    for (const key of FACE_KEYS) {
      const face = payload.cubeFaces?.[key];
      cubeFaces[key] = safeImagePath(face, node.id, key) || (dataImageInfo(face, 'jpeg') ? face : '');
    }
    return { id: node.id, sourceUrl, sourceDataUrl, cubeFaces, hasFaces: FACE_KEYS.every((key) => Boolean(cubeFaces[key])) };
  }

  function validateSourceDimensions(width, height) {
    if (width !== 1920 || height !== 1080) throw new Error('原片影像须为原始 1920×1080 PNG，未缩小替代。');
    return true;
  }

  function photoLayout(width, height, imageWidth, imageHeight, dpr = 1, scale = 1) {
    const ratio = Math.max(.1, finite(dpr, 1));
    const fit = Math.min(width / imageWidth, height / imageHeight, 1 / ratio);
    const maxScale = Math.max(1, 1 / (fit * ratio)), boundedScale = clamp(scale, 1, maxScale);
    return { fit, maxScale, scale: boundedScale, width: imageWidth * fit, height: imageHeight * fit,
      x: Math.max(0, (imageWidth * fit * boundedScale - width) / 2), y: Math.max(0, (imageHeight * fit * boundedScale - height) / 2) };
  }

  function canvasSize(width, height, dpr = 1) {
    const ratio = Math.min(2, Math.max(.1, finite(dpr, 1)));
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
  }

  function clarityFovMin(canvasWidth, cubeSize = CUBE_SIZE) {
    return clamp(Math.atan(.8 * canvasWidth / cubeSize) * 360 / Math.PI, MIN_FOV, MAX_FOV);
  }

  function sourceClarityFovMin(canvasWidth, sourceFov) {
    return clamp(Math.atan(.8 * canvasWidth * Math.tan(radians(sourceFov) / 2) / 1920) * 360 / Math.PI, MIN_FOV, MAX_FOV);
  }

  function cubeEdgeWeights(ray, blend = .05) {
    if (!Array.isArray(ray) || ray.length !== 3 || !ray.every(Number.isFinite) || !ray.some((v) => v !== 0)) throw new Error('Expected finite nonzero ray');
    const a=ray.map(Math.abs),m=Math.max(...a);
    if (!(blend>0)) return a.map((v,i)=>i===a.indexOf(m)?1:0);
    const weights=a.map(v=>{const t=clamp((v-m*(1-blend))/(m*blend),0,1);return t*t*(3-2*t);});
    const sum=weights.reduce((a,b)=>a+b,0);return weights.map(v=>v/sum);
  }

  function cubeDensity(cubeSize, fov, canvasWidth) {
    return cubeSize * Math.tan(radians(fov) / 2) / canvasWidth;
  }

  // Camera-space Y points up; image v=0 is the original PNG's top row.
  // This is the same pitch-then-yaw transform as the existing cubemap shader.
  function rotatePhotoRay(ray, yaw, pitch) {
    const cp = Math.cos(radians(pitch)), sp = Math.sin(radians(pitch));
    const cy = Math.cos(radians(yaw)), sy = Math.sin(radians(yaw));
    const tilted = [ray[0], cp * ray[1] + sp * ray[2], -sp * ray[1] + cp * ray[2]];
    return [cy * tilted[0] + sy * tilted[2], tilted[1], -sy * tilted[0] + cy * tilted[2]];
  }

  function sourcePhotoRay(u, v, node = {}) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('Photo UV must be finite.');
    const tanHalfFov = Math.tan(radians(clamp(finite(node.sourceFov, finite(node.modelFov, 75)), .001, 178.999)) / 2);
    const camera = [(2 * u - 1) * tanHalfFov, (1 - 2 * v) * tanHalfFov / SOURCE_PHOTO_ASPECT, 1];
    const rotated = rotatePhotoRay(camera, finite(node.sourceYaw, finite(node.modelYaw, 0)), finite(node.sourcePitch, finite(node.modelPitch, 0)));
    const length = Math.hypot(...rotated);
    return rotated.map((value) => value / length);
  }

  function projectSourcePhoto(ray, node = {}) {
    if (!Array.isArray(ray) || ray.length !== 3 || !ray.every(Number.isFinite) || !Math.hypot(...ray)) throw new Error('Photo ray must be a finite nonzero direction.');
    const yaw = finite(node.sourceYaw, finite(node.modelYaw, 0)), pitch = finite(node.sourcePitch, finite(node.modelPitch, 0));
    const cy = Math.cos(radians(yaw)), sy = Math.sin(radians(yaw));
    const cp = Math.cos(radians(pitch)), sp = Math.sin(radians(pitch));
    const unyawed = [cy * ray[0] - sy * ray[2], ray[1], sy * ray[0] + cy * ray[2]];
    const camera = [unyawed[0], cp * unyawed[1] - sp * unyawed[2], sp * unyawed[1] + cp * unyawed[2]];
    if (camera[2] <= 0) return { u: null, v: null, inside: false, alpha: 0, depth: camera[2] };
    const tanHalfFov = Math.tan(radians(clamp(finite(node.sourceFov, finite(node.modelFov, 75)), .001, 178.999)) / 2);
    const u = .5 + camera[0] / (camera[2] * tanHalfFov) * .5;
    const v = .5 - camera[1] / (camera[2] * tanHalfFov / SOURCE_PHOTO_ASPECT) * .5;
    const edge = Math.min(u, 1 - u, v, 1 - v), t = clamp(edge / SOURCE_PHOTO_FEATHER, 0, 1);
    return { u, v, inside: edge >= 0, alpha: t * t * (3 - 2 * t), depth: camera[2] };
  }

  function validateFaceDimensions(dimensions, wanted = CUBE_SIZE) {
    if (!Array.isArray(dimensions) || dimensions.length !== 6 || !dimensions.every((face) => face.width === wanted && face.height === wanted)) {
      throw new Error(`六面实际尺寸不一致或不符合声明的${wanted}×${wanted}，未缩小替代。`);
    }
    return true;
  }

  function createSelectionGate() {
    let sequence = 0, selected = '';
    return { select(id) { selected = id; return { id, sequence: ++sequence }; },
      current(ticket) { return Boolean(ticket && ticket.id === selected && ticket.sequence === sequence); } };
  }

  function createModeIntent(initialMode = 'photo') {
    let requested = initialMode === 'model' ? 'model' : 'photo';
    return { choose(next) { requested = next === 'model' ? 'model' : 'photo'; },
      wantsModel() { return requested === 'model'; }, failed() { requested = 'photo'; } };
  }

  function createNodeStore(nodes, { loadScript, timeoutMs = 20000, maxCache = 2 }) {
    const known = new Map(nodes.map((node) => [node.id, node])), cache = new Map(), pending = new Map();
    function finish(id, error, value) {
      const job = pending.get(id); if (!job) return;
      pending.delete(id); clearTimeout(job.timer); job.dispose?.();
      if (error) { job.reject(error); return; }
      cache.delete(id); cache.set(id, value);
      while (cache.size > maxCache) cache.delete(cache.keys().next().value);
      job.resolve(value);
    }
    return {
      load(id) {
        const node = known.get(id);
        if (!node || !safeNodeScript(node.nodeScript, id)) return Promise.reject(new Error('节点路径不在本站白名单内。'));
        if (cache.has(id)) { const value = cache.get(id); cache.delete(id); cache.set(id, value); return Promise.resolve(value); }
        if (pending.has(id)) return pending.get(id).promise;
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const job = { promise, resolve, reject, timer: null, dispose: null }; pending.set(id, job);
        job.timer = setTimeout(() => finish(id, new Error('节点数据载入超时，请重试或切换其他节点。')), timeoutMs);
        try {
          const dispose = loadScript(node.nodeScript,
            () => { if (pending.has(id)) finish(id, new Error('节点文件未提供对应数据。')); },
            () => finish(id, new Error('节点文件无法读取，请检查网络后重试。')));
          if (pending.has(id)) job.dispose = dispose; else dispose?.();
        } catch (error) { finish(id, error); }
        return promise;
      },
      accept(payload) {
        const node = known.get(payload?.id); if (!node || !pending.has(node.id)) return false;
        try { finish(node.id, null, validateNodePayload(payload, node)); }
        catch (error) { finish(node.id, error); }
        return true;
      },
      evict(id) { cache.delete(id); },
      cancelPendingExcept(id) { for (const other of [...pending.keys()]) if (other !== id) finish(other, new Error('节点载入已取消。')); },
      cachedIds() { return [...cache.keys()]; },
      dispose() { for (const id of [...pending.keys()]) finish(id, new Error('节点载入已取消。')); cache.clear(); }
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { MOVIE_SHA, DEFINITIONS, FACE_KEYS, safeNodeScript, safeImagePath, validateIndex, validateNodePayload, validateSourceDimensions,
      photoLayout, canvasSize, clarityFovMin, sourceClarityFovMin, cubeDensity, cubeEdgeWeights, validateFaceDimensions, createSelectionGate, createModeIntent, createNodeStore, wrapYaw,
      SOURCE_PHOTO_ASPECT, SOURCE_PHOTO_FEATHER, sourcePhotoRay, projectSourcePhoto };
    return;
  }

  const $ = (id) => document.getElementById(id);
  const ui = { tour: $('tour'), area: $('view-area'), photo: $('photo-stage'), photoSlot: $('photo-slot'), canvas: $('model-canvas'),
    tourTitle: $('tour-title'), title: $('scene-title'), time: $('source-time'), scope: $('scope-label'), hint: $('view-hint'),
    photoMode: $('mode-photo'), modelMode: $('mode-model'), download: $('download-source'), nav: $('scene-nav'),
    previous: $('scene-prev'), next: $('scene-next'), counter: $('scene-counter'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'),
    reset: $('reset-view'), value: $('view-value'), fullscreen: $('fullscreen'), status: $('load-state'), statusTitle: $('load-title'),
    statusMessage: $('load-message'), retry: $('retry'), toast: $('toast'), about: $('about-dialog'), movieSHA: $('movie-sha'),
    sourceSHA: $('source-sha'), aboutTime: $('about-time'), modelSHA: $('model-sha'), modelStatus: $('model-status'),
    sceneDialog: $('scene-dialog'), sceneOpen: $('scenes-open'), sceneClose: $('scenes-close'),
    tools: $('view-tools'), toolsToggle: $('tools-toggle') };
  const gate = createSelectionGate(), pointers = new Map(), buttons = [];
  let modeIntent = createModeIntent();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let data = null, store = null, index = 5, mode = 'photo', ticket = null, payload = null;
  let sourceImage = null, sourceJob = null, sourceReady = false, modelReady = false, modelLoading = false, modelError = '';
  let photo = { scale: 1, x: 0, y: 0 }, view = { yaw: 0, pitch: 0, fov: 75 }, gesture = null;
  let gl = null, program = null, uniforms = null, texture = null, sourceTexture = null, rendererReady = false, rendererUsesAnchor = false, activeFaces = [], modelRun = 0;
  let framePending = false, toastTimer = 0, lastLimitToast = 0;
  const current = () => data?.nodes[index];
  const usesPhotoAnchor = () => current()?.sourcePhotoAnchor === true;
  const size = () => { const r = ui.area.getBoundingClientRect(); return { width: Math.max(1, r.width), height: Math.max(1, r.height) }; };
  const drawSize = () => { const r = size(); return canvasSize(r.width, r.height, window.devicePixelRatio || 1); };
  const modelMin = () => Math.max(clarityFovMin(drawSize().width, current()?.cubeSize || CUBE_SIZE), usesPhotoAnchor() ? sourceClarityFovMin(drawSize().width, current().sourceFov) : MIN_FOV);
  const seconds = (v) => `${Number(v.toFixed(3))} 秒`;
  const clock = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;

  function status(title, message, error = false, background = false) {
    ui.status.hidden = false; ui.status.classList.toggle('is-error', error); ui.statusTitle.textContent = title;
    ui.status.classList.toggle('is-background', background);
    ui.statusMessage.textContent = message; ui.retry.hidden = !error; ui.area.setAttribute('aria-busy', String(!error));
  }
  function clearStatus() { ui.status.hidden = true; ui.area.setAttribute('aria-busy', 'false'); }
  function toast(message) { clearTimeout(toastTimer); ui.toast.textContent = message; ui.toast.hidden = false; toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 4500); }
  function zoomLimit() { if (Date.now() - lastLimitToast > 1200) { lastLimitToast = Date.now(); toast('已到当前画面的清晰放大上限'); } }
  function clearGesture() { pointers.clear(); gesture = null; ui.area.classList.remove('is-dragging'); }
  function cancelFaces() { ++modelRun; activeFaces.forEach((job) => job.cancel()); activeFaces = []; modelLoading = false; }
  function releaseModel() {
    cancelFaces();
    if (gl && !gl.isContextLost()) { if (texture) gl.deleteTexture(texture); if (sourceTexture) gl.deleteTexture(sourceTexture); }
    texture = null; sourceTexture = null; modelReady = false;
  }

  function photoMetrics() { const s = size(); return sourceImage ? photoLayout(s.width, s.height, sourceImage.naturalWidth, sourceImage.naturalHeight, window.devicePixelRatio || 1, photo.scale) : null; }
  function renderPhoto() {
    if (!sourceReady || !sourceImage) return;
    const p = photoMetrics(); photo.scale = p.scale; photo.x = clamp(photo.x, -p.x, p.x); photo.y = clamp(photo.y, -p.y, p.y);
    sourceImage.style.width = `${p.width}px`; sourceImage.style.height = `${p.height}px`;
    sourceImage.style.transform = `translate(${photo.x}px, ${photo.y}px) scale(${photo.scale})`;
  }
  function controls() {
    const usable = mode === 'photo' ? sourceReady : modelReady;
    const p = mode === 'photo' ? photoMetrics() : null;
    ui.photoMode.disabled = !data; ui.modelMode.disabled = !sourceReady || !payload?.hasFaces;
    ui.modelMode.title = payload?.hasFaces ? usesPhotoAnchor() ? '原片影像＋环视补全，周围为推定景物；不是原始三维模型' : '摄影风格环视补全，方向与细节为推定；不是原始三维模型' : '当前节点环视补全尚未备齐';
    ui.modelMode.setAttribute('aria-label', usesPhotoAnchor() ? '原片影像加环视补全' : '摄影补全环视');
    ui.zoomIn.disabled = !usable || (mode === 'photo' ? photo.scale >= (p?.maxScale || 1) - 1e-8 : view.fov <= modelMin() + 1e-8);
    ui.zoomOut.disabled = !usable || (mode === 'photo' ? photo.scale <= 1 + 1e-8 : view.fov >= MAX_FOV - 1e-8);
    ui.reset.disabled = !usable; ui.value.value = mode === 'photo' ? `${Math.round(photo.scale * 100)}%` : `${Math.round(view.fov)}°`; ui.value.textContent = ui.value.value;
    ui.scope.textContent = mode === 'photo' ? '影片原帧' : modelLoading ? '原片 · 环视载入中' : usesPhotoAnchor() ? '原片影像＋环视补全' : '摄影环视补全';
    ui.scope.classList.toggle('is-supplement', mode !== 'photo' && !modelLoading);
    ui.hint.textContent = modelLoading ? '可先看原片' : mode === 'photo' ? '拖移查看 · 缩放细节' : usesPhotoAnchor() ? '原片方向保留 · 周围为推定景物' : '拖动环视 · 周围为推定影像';
    ui.tour.dataset.mode = mode === 'model' && modelReady ? 'model' : 'photo';
    const faceSize = current()?.cubeSize, faceDescription = faceSize ? `每面${faceSize}×${faceSize}` : '尺寸尚未声明';
    ui.modelStatus.textContent = modelError || (modelReady ? usesPhotoAnchor() ? `1920×1080原片按补全方案推定的方向与水平视角投影；${faceDescription}，周围为推定景物，不是原始三维模型` : `摄影补全环视已载入，${faceDescription}；未叠加原片，不是原始三维模型` : modelLoading ? '正在载入六面环视影像' : payload && !payload.hasFaces ? '六面影像尚未备齐，原片可查看' : `环视影像按需载入，${faceDescription}`);
  }

  function usePhoto(focus = false) {
    cancelFaces(); mode = 'photo'; clearGesture(); ui.photo.hidden = false; ui.canvas.hidden = true;
    ui.photoMode.setAttribute('aria-pressed', 'true'); ui.modelMode.setAttribute('aria-pressed', 'false');
    ui.area.setAttribute('aria-label', `${current()?.label || '原片'}画面，按原始像素约束缩放，Home 复位`);
    if (sourceReady) clearStatus(); renderPhoto(); controls(); if (focus) ui.area.focus({ preventScroll: true });
  }
  function failModel(message) {
    modeIntent.failed(); releaseModel();
    modelError = message.replaceAll('建模环视', '环视补全').replaceAll('模型六面', '环视六面');
    usePhoto(); toast(modelError + ' 已返回原片，可手动重试环视补全。');
  }

  function imageLoad(url) {
    const image = new Image(); image.decoding = 'async'; let finished = false, rejectJob;
    const promise = new Promise((resolve, reject) => {
      rejectJob = reject;
      image.onload = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(image); } };
      image.onerror = () => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error('影像无法载入，请检查网络后重试。')); } };
    });
    const timer = setTimeout(() => { if (!finished) { finished = true; rejectJob(new Error('影像载入超时，请检查网络后重试。')); } }, 90000);
    image.src = url;
    return { promise, cancel() { if (!finished) { finished = true; clearTimeout(timer); rejectJob(new Error('影像载入已取消。')); } image.onload = null; image.onerror = null; image.src = ''; },
      release() { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; } };
  }

  function compile(type, source) {
    const shader = gl.createShader(type); if (!shader) throw new Error('无法建立建模环视着色器。');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('浏览器无法编译建模环视着色器。'); }
    return shader;
  }
  function initializeRenderer() {
    rendererReady = false;
    gl = ui.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
    if (!gl || gl.isContextLost()) throw new Error('此浏览器暂时无法显示建模环视。');
    const sourceLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const limit = Math.min(sourceLimit, gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE));
    if (current().cubeSize > limit) throw new Error(`此设备纹理上限为${limit}像素，无法显示此节点${current().cubeSize}像素六面影像。`);
    if (usesPhotoAnchor() && sourceLimit < 1920) throw new Error(`此设备纹理上限为${sourceLimit}像素，无法直接载入1920像素原片投影，可继续查看原片。`);
    const p = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT), precision = p && p.precision > 0 ? 'highp' : 'mediump';
    const vertex = compile(gl.VERTEX_SHADER, `attribute vec2 aPosition; varying ${precision} vec2 vPosition; void main(){vPosition=aPosition;gl_Position=vec4(aPosition,0.0,1.0);}`);
    const anchored = data.nodes.some((node) => node.sourcePhotoAnchor === true); rendererUsesAnchor = anchored;
    const sourceDeclarations = anchored ? 'uniform sampler2D uSourcePhoto; uniform vec2 uSourceAngles; uniform float uSourceTanHalfFov; uniform float uSourceEnabled;' : '';
    const sourceProjection = anchored ? `
        // Undo the ORIGINAL camera pose, not the user's current look direction.
        float scy=cos(uSourceAngles.x),ssy=sin(uSourceAngles.x),scp=cos(uSourceAngles.y),ssp=sin(uSourceAngles.y);
        vec3 unyawed=vec3(scy*ray.x-ssy*ray.z,ray.y,ssy*ray.x+scy*ray.z);
        vec3 camera=vec3(unyawed.x,scp*unyawed.y-ssp*unyawed.z,ssp*unyawed.y+scp*unyawed.z);
        if(uSourceEnabled>0.5&&camera.z>0.0){
          vec2 uv=vec2(0.5+0.5*camera.x/(camera.z*uSourceTanHalfFov),0.5-0.5*camera.y/(camera.z*uSourceTanHalfFov/${SOURCE_PHOTO_ASPECT.toFixed(12)}));
          float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));
          if(edge>=0.0){
            float alpha=smoothstep(0.0,${SOURCE_PHOTO_FEATHER.toFixed(3)},edge);
            // RGB is sampled directly; no additional sRGB decode/encode or tone map.
            color=mix(color,texture2D(uSourcePhoto,uv).rgb,alpha);
          }
        }` : '';
    const fragment = compile(gl.FRAGMENT_SHADER, `precision ${precision} float; varying ${precision} vec2 vPosition; uniform samplerCube uModel; uniform float uAspect; uniform float uTanHalfFov; uniform vec2 uAngles; uniform float uCubeEdgeBlend; ${sourceDeclarations}
      vec3 sampleSurround(vec3 ray){
        if(uCubeEdgeBlend<0.001)return textureCube(uModel,ray).rgb;
        vec3 a=abs(ray);float m=max(max(a.x,a.y),a.z);
        vec3 w=smoothstep(vec3(m*(1.0-uCubeEdgeBlend)),vec3(m),a);w/=w.x+w.y+w.z;
        vec3 color=vec3(0.0);
        if(w.x>0.0)color+=w.x*textureCube(uModel,vec3(sign(ray.x)*m*1.002,ray.y,ray.z)).rgb;
        if(w.y>0.0)color+=w.y*textureCube(uModel,vec3(ray.x,sign(ray.y)*m*1.002,ray.z)).rgb;
        if(w.z>0.0)color+=w.z*textureCube(uModel,vec3(ray.x,ray.y,sign(ray.z)*m*1.002)).rgb;
        return color;
      }
      void main(){ vec3 ray=normalize(vec3(vPosition.x*uTanHalfFov,vPosition.y*uTanHalfFov/uAspect,1.0));
        float cp=cos(uAngles.y),sp=sin(uAngles.y),cy=cos(uAngles.x),sy=sin(uAngles.x);
        ray=vec3(ray.x,cp*ray.y+sp*ray.z,-sp*ray.y+cp*ray.z);ray=vec3(cy*ray.x+sy*ray.z,ray.y,-sy*ray.x+cy*ray.z);
        vec3 color=sampleSurround(ray); ${sourceProjection}
        gl_FragColor=vec4(color,1.0); }`);
    program = gl.createProgram(); if (!program) throw new Error('无法建立建模环视程序。');
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('浏览器无法建立建模环视程序。');
    gl.useProgram(program); const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniformNames = ['uModel', 'uAspect', 'uTanHalfFov', 'uAngles', 'uCubeEdgeBlend'];
    if (anchored) uniformNames.push('uSourcePhoto', 'uSourceAngles', 'uSourceTanHalfFov', 'uSourceEnabled');
    uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(uniforms.uModel, 0);
    // Different sampler types must never share a texture unit, even conditionally.
    if (anchored) gl.uniform1i(uniforms.uSourcePhoto, 1);
    gl.clearColor(22 / 255, 43 / 255, 36 / 255, 1); rendererReady = true;
  }
  function uploadCube(images) {
    const wanted = current().cubeSize;
    validateFaceDimensions(images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })), wanted);
    const targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z];
    const next = gl.createTexture(); if (!next) throw new Error('浏览器无法分配模型六面纹理。');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, next); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Engine X=world X, Y=world Z, Z=world Y. Files follow standard OpenGL
    // cube orientations, with raw image top row at texture v=0. No axis swap.
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try {
      images.forEach((image, i) => gl.texImage2D(targets[i], 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image));
      if (gl.getError() !== gl.NO_ERROR) throw new Error('浏览器未能载入完整模型六面纹理。');
    } catch (error) { gl.deleteTexture(next); throw error; }
    if (texture) gl.deleteTexture(texture); texture = next;
  }

  function uploadSourcePhoto() {
    validateSourceDimensions(sourceImage?.naturalWidth, sourceImage?.naturalHeight);
    if (usesPhotoAnchor() && gl.getParameter(gl.MAX_TEXTURE_SIZE) < 1920) throw new Error('此设备无法直接载入1920像素原片投影，可继续查看原片。');
    const next = gl.createTexture(); if (!next) throw new Error('无法分配原片影像纹理。');
    const oldFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const oldPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const oldColorConversion = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, next);
    // DOM-image first row is v=0 with FLIP=false, matching projectSourcePhoto's top-origin UV.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try {
      // The original PNG is uploaded directly; no canvas, resize, or regenerated source image.
      if (usesPhotoAnchor()) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceImage);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      if (gl.getError() !== gl.NO_ERROR) throw new Error('浏览器未能载入原片影像纹理。');
    } catch (error) { gl.deleteTexture(next); throw error; }
    finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, oldFlip);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, oldPremultiply);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, oldColorConversion);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (sourceTexture) gl.deleteTexture(sourceTexture); sourceTexture = next;
  }

  function resetModel() { const node = current(); view = { yaw: node.modelYaw, pitch: node.modelPitch, fov: clamp(node.modelFov, modelMin(), MAX_FOV) }; }
  function showReadyModel() {
    ui.photo.hidden = true; ui.canvas.hidden = false;
    ui.area.setAttribute('aria-label', usesPhotoAnchor() ? `${current().label}原片影像加环视补全，原片方向保留，周围为推定景物，不支持自由行走` : `${current().label}摄影补全环视，依据原片推定，不是恢复的原始三维模型，不支持自由行走`);
    clearStatus(); controls(); requestDraw();
  }
  async function useModel() {
    if (!sourceReady || !payload?.hasFaces) return;
    mode = 'model'; clearGesture(); ui.photo.hidden = false; ui.canvas.hidden = true;
    ui.photoMode.setAttribute('aria-pressed', 'false'); ui.modelMode.setAttribute('aria-pressed', 'true');
    ui.area.setAttribute('aria-label', `${current().label}原片画面，高清环视正在载入`); ui.area.focus({ preventScroll: true });
    if (modelReady && rendererReady) { showReadyModel(); return; }
    cancelFaces(); const run = modelRun, selected = ticket; modelLoading = true; modelError = ''; resetModel();
    status('环视正在载入', '先看原片，稍后进入环视。也可点“原片”停止载入。', false, true); controls();
    let jobs = [];
    try {
      if (!rendererReady) initializeRenderer();
      jobs = FACE_KEYS.map((key) => imageLoad(payload.cubeFaces[key])); activeFaces = jobs;
      const images = await Promise.all(jobs.map((job) => job.promise));
      if (!gate.current(selected) || run !== modelRun || mode !== 'model') return;
      uploadCube(images); if (rendererUsesAnchor) uploadSourcePhoto();
      modelReady = true; modelLoading = false; showReadyModel();
    } catch (error) { if (gate.current(selected) && run === modelRun) failModel(error.message); }
    finally { jobs.forEach((job) => job.cancel()); if (activeFaces === jobs) activeFaces = []; }
  }

  function requestDraw() {
    if (framePending) return; framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      if (mode === 'photo' || (!modelReady && sourceReady)) { renderPhoto(); controls(); return; }
      if (!modelReady || !rendererReady || !gl || gl.isContextLost() || !texture) return;
      const draw = drawSize(); view.fov = clamp(view.fov, modelMin(), MAX_FOV);
      if (ui.canvas.width !== draw.width || ui.canvas.height !== draw.height) { ui.canvas.width = draw.width; ui.canvas.height = draw.height; }
      gl.viewport(0, 0, draw.width, draw.height); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program);
      if (rendererUsesAnchor) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform2f(uniforms.uSourceAngles, radians(current().sourceYaw), radians(current().sourcePitch));
        gl.uniform1f(uniforms.uSourceTanHalfFov, Math.tan(radians(current().sourceFov) / 2));
        gl.uniform1f(uniforms.uSourceEnabled, usesPhotoAnchor() ? 1 : 0);
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      gl.uniform1f(uniforms.uCubeEdgeBlend,current().cubeEdgeBlend);
      gl.uniform1f(uniforms.uAspect, draw.width / draw.height); gl.uniform1f(uniforms.uTanHalfFov, Math.tan(radians(view.fov) / 2));
      gl.uniform2f(uniforms.uAngles, radians(view.yaw), radians(view.pitch)); gl.drawArrays(gl.TRIANGLES, 0, 3); controls();
    });
  }

  async function selectNode(nextIndex) {
    if (!data || !data.nodes[nextIndex]) return;
    sourceJob?.cancel(); sourceJob = null; releaseModel(); clearGesture(); index = nextIndex;
    const node = current(), selected = gate.select(node.id); ticket = selected;
    store.cancelPendingExcept(node.id);
    payload = null; sourceImage = null; sourceReady = false; modelError = ''; photo = { scale: 1, x: 0, y: 0 };
    ui.photoSlot.replaceChildren(); ui.download.hidden = true; ui.download.removeAttribute('href'); usePhoto();
    ui.title.textContent = node.label; ui.time.textContent = `原片 ${clock(node.sourceSecond)}`; ui.aboutTime.textContent = seconds(node.sourceSecond);
    ui.sourceSHA.textContent = node.sourceSHA; ui.counter.textContent = `${String(index + 1).padStart(2, '0')} / 08`;
    ui.modelSHA.textContent = node.modelSHA;
    buttons.forEach((button, i) => { if (i === index) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current'); });
    status('正在走近这处风景', node.label);
    try {
      const loaded = await store.load(node.id); if (!gate.current(selected)) return;
      payload = loaded;
      status('正在载入原片画面', node.label);
      const job = imageLoad(loaded.sourceUrl); sourceJob = job; const image = await job.promise;
      if (!gate.current(selected)) { job.release(); return; }
      validateSourceDimensions(image.naturalWidth, image.naturalHeight);
      image.alt = `${node.label}，最终 v14 原片 ${seconds(node.sourceSecond)}`; image.draggable = false;
      sourceImage = image; sourceReady = true; ui.photoSlot.replaceChildren(image);
      ui.download.href = loaded.sourceUrl; ui.download.download = `晴汀园_${node.label}_${Number(node.sourceSecond.toFixed(3))}s_原片.png`; ui.download.hidden = false;
      clearStatus(); renderPhoto(); controls();
      if (modeIntent.wantsModel()) {
        if (loaded.hasFaces) useModel();
        else failModel('当前节点的高清六面影像尚未备齐。');
      }
    } catch (error) { if (gate.current(selected)) { sourceReady = false; status('此节点暂未就绪', error.message + ' 可重试或切换其他节点。', true); controls(); } }
  }

  function resetView() { clearGesture(); if (mode === 'photo') { photo = { scale: 1, x: 0, y: 0 }; renderPhoto(); } else resetModel(); controls(); requestDraw(); }
  function zoomPhoto(factor, x = 0, y = 0) {
    const maximum = photoMetrics().maxScale, proposed = photo.scale * factor, next = clamp(proposed, 1, maximum), ratio = next / photo.scale;
    photo.x = x - (x - photo.x) * ratio; photo.y = y - (y - photo.y) * ratio; photo.scale = next;
    if (factor > 1 && proposed >= maximum - 1e-8) zoomLimit(); renderPhoto(); controls();
  }
  function zoomModel(fov) { const minimum = modelMin(); if (fov <= minimum + 1e-8) zoomLimit(); view.fov = clamp(fov, minimum, MAX_FOV); controls(); requestDraw(); }
  function zoom(direction) { if (mode === 'photo' && sourceReady) zoomPhoto(direction < 0 ? 1.2 : 1 / 1.2); else if (modelReady) zoomModel(view.fov + direction * 5); }

  function pointerInfo() { const pp = [...pointers.values()], r = ui.area.getBoundingClientRect(); return { distance: Math.hypot(pp[0].x - pp[1].x, pp[0].y - pp[1].y), x: (pp[0].x + pp[1].x) / 2 - r.left - r.width / 2, y: (pp[0].y + pp[1].y) / 2 - r.top - r.height / 2 }; }
  function startGesture() {
    if (pointers.size >= 2) gesture = { kind: 'pinch', ...pointerInfo(), photo: { ...photo }, view: { ...view } };
    else if (pointers.size === 1) gesture = { kind: 'drag', ...pointers.values().next().value, photo: { ...photo }, view: { ...view } };
    else gesture = null;
  }
  ui.area.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button,a,input') || (event.pointerType === 'mouse' && event.button !== 0) || !(mode === 'photo' ? sourceReady : modelReady)) return;
    event.preventDefault(); ui.area.focus({ preventScroll: true }); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); ui.area.setPointerCapture(event.pointerId); ui.area.classList.add('is-dragging'); startGesture();
  });
  ui.area.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const p = pointerInfo();
      if (mode === 'photo') { const proposed = gesture.photo.scale * p.distance / Math.max(1, gesture.distance), max = photoMetrics().maxScale;
        photo.scale = clamp(proposed, 1, max); const ratio = photo.scale / gesture.photo.scale;
        photo.x = p.x - (gesture.x - gesture.photo.x) * ratio; photo.y = p.y - (gesture.y - gesture.photo.y) * ratio; if (proposed >= max && proposed > gesture.photo.scale) zoomLimit(); }
      else zoomModel(Math.atan(Math.tan(radians(gesture.view.fov) / 2) * gesture.distance / Math.max(1, p.distance)) * 360 / Math.PI);
    } else if (gesture.kind === 'drag') {
      if (mode === 'photo') { photo.x = gesture.photo.x + event.clientX - gesture.x; photo.y = gesture.photo.y + event.clientY - gesture.y; }
      else { const speed = gesture.view.fov / size().width; view.yaw = wrapYaw(gesture.view.yaw + (gesture.x - event.clientX) * speed); view.pitch = clamp(gesture.view.pitch + (event.clientY - gesture.y) * speed, -MAX_PITCH, MAX_PITCH); }
    }
    renderPhoto(); controls(); requestDraw();
  });
  const endPointer = (event) => { pointers.delete(event.pointerId); if (!pointers.size) ui.area.classList.remove('is-dragging'); startGesture(); };
  ui.area.addEventListener('pointerup', endPointer); ui.area.addEventListener('pointercancel', endPointer); ui.area.addEventListener('lostpointercapture', endPointer);
  ui.area.addEventListener('wheel', (event) => {
    if (event.target.closest('button,a,input') || !(mode === 'photo' ? sourceReady : modelReady)) return;
    event.preventDefault(); const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ui.area.clientHeight : 1);
    if (mode === 'photo') { const r = ui.area.getBoundingClientRect(); zoomPhoto(Math.exp(-clamp(delta, -400, 400) * .0018), event.clientX - r.left - r.width / 2, event.clientY - r.top - r.height / 2); }
    else zoomModel(view.fov + clamp(delta * .035, -12, 12)); startGesture();
  }, { passive: false });
  ui.area.addEventListener('dblclick', (event) => { if (mode === 'photo' && !event.target.closest('button,a,input')) resetView(); });
  ui.area.addEventListener('keydown', (event) => {
    if (event.target.closest('button,a,input') || ui.about.open || ui.sceneDialog.open || !(mode === 'photo' ? sourceReady : modelReady)) return;
    if (event.key === 'Home' || event.key.toLowerCase() === 'r') { event.preventDefault(); resetView(); return; }
    if (['+', '=', '-', '_'].includes(event.key)) { event.preventDefault(); zoom(event.key === '+' || event.key === '=' ? -1 : 1); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 10 : 3;
    if (mode === 'photo') { if (event.key === 'ArrowLeft') photo.x += 40; if (event.key === 'ArrowRight') photo.x -= 40; if (event.key === 'ArrowUp') photo.y += 40; if (event.key === 'ArrowDown') photo.y -= 40; renderPhoto(); }
    else { if (event.key === 'ArrowLeft') view.yaw = wrapYaw(view.yaw - step); if (event.key === 'ArrowRight') view.yaw = wrapYaw(view.yaw + step); if (event.key === 'ArrowUp') view.pitch = clamp(view.pitch + step, -MAX_PITCH, MAX_PITCH); if (event.key === 'ArrowDown') view.pitch = clamp(view.pitch - step, -MAX_PITCH, MAX_PITCH); }
    controls(); requestDraw();
  });

  ui.photoMode.addEventListener('click', () => { modeIntent.choose('photo'); usePhoto(true); });
  ui.modelMode.addEventListener('click', () => { modeIntent.choose('model'); useModel(); });
  ui.previous.addEventListener('click', () => selectNode((index + 7) % 8)); ui.next.addEventListener('click', () => selectNode((index + 1) % 8));
  ui.zoomIn.addEventListener('click', () => zoom(-1)); ui.zoomOut.addEventListener('click', () => zoom(1)); ui.reset.addEventListener('click', resetView);
  ui.retry.addEventListener('click', () => { if (data) { store.evict(current().id); selectNode(index); } else window.location.reload(); });
  function closeTools(focus = false) {
    ui.tools.hidden = true; ui.toolsToggle.setAttribute('aria-expanded', 'false');
    if (focus) ui.toolsToggle.focus({ preventScroll: true });
  }
  ui.toolsToggle.addEventListener('click', () => {
    const open = ui.tools.hidden; clearGesture(); ui.tools.hidden = !open;
    ui.toolsToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!ui.tools.hidden && !ui.tools.contains(event.target) && !ui.toolsToggle.contains(event.target)) closeTools();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.tools.hidden && !ui.about.open && !ui.sceneDialog.open) {
      closeTools(true); event.preventDefault();
    }
  });
  ui.sceneOpen.addEventListener('click', () => {
    clearGesture(); closeTools(); ui.sceneDialog.showModal(); ui.sceneOpen.setAttribute('aria-expanded', 'true');
    const selected = buttons[index];
    if (selected) { selected.focus({ preventScroll: true }); selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); }
  });
  ui.sceneClose.addEventListener('click', () => ui.sceneDialog.close());
  ui.sceneDialog.addEventListener('close', () => {
    ui.sceneOpen.setAttribute('aria-expanded', 'false'); ui.sceneOpen.focus({ preventScroll: true });
  });
  for (const dialog of [ui.about, ui.sceneDialog]) dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  $('about-open').addEventListener('click', () => ui.about.showModal()); $('about-close').addEventListener('click', () => ui.about.close());
  ui.fullscreen.addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (ui.tour.requestFullscreen) await ui.tour.requestFullscreen(); else toast('此浏览器未提供全屏功能。'); } catch (error) { toast('浏览器未能进入全屏，可继续在当前窗口查看。'); } });
  document.addEventListener('fullscreenchange', () => { const active = Boolean(document.fullscreenElement); ui.fullscreen.setAttribute('aria-pressed', String(active)); ui.fullscreen.setAttribute('aria-label', active ? '退出全屏' : '进入全屏'); requestDraw(); });
  window.addEventListener('resize', requestDraw); if (window.ResizeObserver) new ResizeObserver(requestDraw).observe(ui.area);
  ui.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); rendererReady = false; texture = null; sourceTexture = null; failModel('浏览器建模环视渲染已中断。'); });
  ui.canvas.addEventListener('webglcontextrestored', () => { rendererReady = false; program = null; uniforms = null; controls(); });

  try {
    data = validateIndex(window.QINGT_HD_VR); modeIntent = createModeIntent(data.defaultMode);
    ui.tourTitle.textContent = '晴汀园'; document.title = '晴汀园 · 云游园林'; ui.movieSHA.textContent = data.movieSHA; ui.modelSHA.textContent = data.modelSHA;
    store = createNodeStore(data.nodes, { loadScript(path, loaded, failed) {
      const script = document.createElement('script'); script.async = true; script.src = path; script.onload = loaded; script.onerror = failed; document.head.appendChild(script);
      return () => { script.onload = null; script.onerror = null; script.remove(); };
    } });
    window.QINGT_HD_NODE = (value) => store.accept(value);
    data.nodes.forEach((node, i) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-card';
      const image = document.createElement('img'); image.className = 'scene-thumb'; image.alt = ''; image.width = 400; image.height = 225;
      image.loading = 'lazy'; image.decoding = 'async'; image.src = `assets/thumbs/${node.id}.jpg`;
      const number = document.createElement('span'); number.className = 'node-number'; number.textContent = String(i + 1).padStart(2, '0');
      const label = document.createElement('span'); label.className = 'node-label'; label.textContent = node.label;
      const time = document.createElement('span'); time.className = 'node-time'; time.textContent = `原片 ${clock(node.sourceSecond)}`;
      const info = document.createElement('span'); info.className = 'card-info'; info.append(number, label, time);
      const check = document.createElement('span'); check.className = 'scene-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      button.append(image, info, check);
      button.setAttribute('aria-label', `查看${node.label}，原片${seconds(node.sourceSecond)}`);
      button.addEventListener('click', () => { ui.sceneDialog.close(); selectNode(i); }); ui.nav.appendChild(button); buttons.push(button); });
    ui.previous.disabled = false; ui.next.disabled = false; selectNode(data.nodes.findIndex((node) => node.id === data.defaultNode));
  } catch (error) { status('取景数据尚未就绪', error.message || '请检查网络后重试。', true); controls(); }
})();
