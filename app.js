
  // CapView Core Clean v0.2.3 — Métricas planejado x executado por demanda.

(() => {
  // ----------------------
  // State + helpers
  // ----------------------
  const STORAGE_KEY = 'resource_planner_state';
  const USER_KEY = 'resource_planner_user';
  const DB_PATH_KEY = 'capview_db_network_path';
  const DB_META_KEY = 'capview_db_meta';
  const DB_BASELINE_KEY = 'capview_db_baseline';
  const APP_SCHEMA_VERSION = '0.2.3-demand-metrics';
  const HOURS_PER_DAY = 9; // regra fixa: 9h/dia para todos os recursos
  const PAGE_SIZE = 10; // itens por página (Demandas e Recursos)
  const DASH_PER_RESOURCE_PAGE_SIZE = 5; // Dashboard: Por Recurso (mês)
  const DASH_SHEET_PAGE_SIZE = 10; // Dashboard Planilha: linhas por página
  const MODAL_DEMANDS_PAGE_SIZE = 10; // Modais com lista de demandas: 10 por página

  const qs = (sel, el=document) => el.querySelector(sel);
  const qsa = (sel, el=document) => [...el.querySelectorAll(sel)];

  // Keep the background blur consistent whenever any <dialog> is open.
  const syncModalBlur = () => {
    const anyOpen = !!document.querySelector('dialog[open]');
    document.body.classList.toggle('modal-open', anyOpen);
  };

  const openDialog = (dlg) => {
    if (!dlg) return;
    try { dlg.showModal(); } catch { dlg.setAttribute('open',''); }
    syncModalBlur();
  };

  const closeDialog = (dlg) => {
    if (!dlg) return;
    try { dlg.close(); } catch { dlg.removeAttribute('open'); }
    syncModalBlur();
  };

  // Backwards-compat helper (algumas partes usavam uid())
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  // ----------------------
  // HE (Hora Extra) Modals
  // ----------------------
  let hePendingDeleteId = null;

  const fillHeResourceOptions = (sel) => {
    if (!sel) return;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value:'__ALL__' }, ['Todos os recursos']));
    for (const r of (state.resources||[])) sel.appendChild(el('option', { value:r.id }, [r.nome]));
  };

  const openHeModal = (prefill={}) => {
    const dlg = qs('#heModal');
    const sel = qs('#heModalResource');
    const dateInp = qs('#heModalDate');
    const hoursInp = qs('#heModalHours');
    const motivoInp = qs('#heModalMotivo');
    const tituloInp = qs('#heModalTitulo');
    const predioInp = qs('#heModalPredio');
    const focalInp = qs('#heModalFocal');
    const prioridadeInp = qs('#heModalPrioridade');
    const obsInp = qs('#heModalObs');

    fillHeResourceOptions(sel);
    sel.value = String(prefill.resourceId || '__ALL__');
    dateInp.value = String(prefill.date || formatDate(new Date()));
    hoursInp.value = String(prefill.horas ?? 9);
    motivoInp.value = String(prefill.motivo || '');
    if (tituloInp) tituloInp.value = String(prefill.titulo || prefill.atividade || '');
    if (predioInp) predioInp.value = String(prefill.predio || '');
    if (focalInp) focalInp.value = String(prefill.focal || '');
    if (prioridadeInp) prioridadeInp.value = String(prefill.prioridade || 'Média');
    if (obsInp) obsInp.value = String(prefill.observacoes || '');

    openDialog(dlg);
    setTimeout(() => { try{ (tituloInp || motivoInp).focus(); }catch{} }, 0);
  };

  const openHeConfirm = (ot) => {
    const dlg = qs('#heConfirmModal');
    const body = qs('#heConfirmBody');
    const rid = ot?.resourceId || '__ALL__';
    const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
    body.innerHTML = '';
    body.appendChild(el('div', {}, [
      'Você confirma excluir esta HE?'
    ]));
    body.appendChild(el('div', { class:'tiny muted', style:'margin-top:8px' }, [
      el('div', {}, ['Data: ', el('span', { class:'mono' }, [formatDateBR(ot?.date)])]),
      el('div', {}, ['Recurso: ', rname]),
      el('div', {}, ['Horas: ', el('span', { class:'mono' }, [`${Number(ot?.horas||0).toFixed(1)}h`])]),
      el('div', {}, ['Atividade: ', String(ot?.titulo || ot?.atividade || '—')]),
      el('div', {}, ['Motivo: ', String(ot?.motivo||'')]),
    ]));
    openDialog(dlg);
  };

  const closeHeModal = () => closeDialog(qs('#heModal'));
  const closeHeConfirm = () => { hePendingDeleteId = null; closeDialog(qs('#heConfirmModal')); };

  const safeUUID = () => {
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : null; } catch { return null; }
  };

  const slugify = (s) => String(s||'')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/(^-|-$)/g,'')
    .slice(0, 40);

  

  // Preview-only identity (does NOT persist). Used while typing in the modal.
  const previewUserIdentity = (displayName) => {
    const nm = String(displayName||'').trim();
    if (!nm) return { displayName:'', userId:'' };
    const slug = slugify(nm) || 'user';
    const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
    return { displayName: nm, userId: `${slug}__${suffix}` };
  };

// Compat: uid() existed in older builds (definido acima)

  let userName = '';
  let userId = '';

  const loadUserIdentity = () => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return { displayName:'', userId:'' };
    try {
      const obj = JSON.parse(raw);
      // support legacy shapes and auto-generate a stable userId when missing
      if (typeof obj === 'string') {
        const nm = String(obj||'').trim();
        return ensureUserIdentity(nm);
      }
      if (obj && typeof obj === 'object') {
        const nm = String(obj.displayName || obj.name || obj.userName || '').trim();
        let id = String(obj.userId || obj.id || '').trim();
        if (nm && !id) {
          const slug = slugify(nm) || 'user';
          const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
          id = `${slug}__${suffix}`;
          localStorage.setItem(USER_KEY, JSON.stringify({ displayName: nm, userId: id }));
        }
        return { displayName: nm, userId: id };
      }
    } catch {
      // legacy: raw string with the name
      const nm = String(raw||'').trim();
      if (!nm) return { displayName:'', userId:'' };
      const slug = slugify(nm) || 'user';
      const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
      const id = `${slug}__${suffix}`;
      const u = { displayName: nm, userId: id };
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      return u;
    }
    return { displayName:'', userId:'' };
  };

  const persistUserIdentity = (u) => {
    localStorage.setItem(USER_KEY, JSON.stringify({ displayName:u.displayName||'', userId:u.userId||'' }));
  };

  const ensureUserIdentity = (displayName) => {
    const nm = String(displayName||'').trim();
    if (!nm) return { displayName:'', userId:'' };
    let existing = loadUserIdentity();
    // keep the same userId on this PC/browser once created
    if (!existing.userId) {
      const slug = slugify(nm) || 'user';
      const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
      existing.userId = `${slug}__${suffix}`;
    }
    existing.displayName = nm;
    persistUserIdentity(existing);
    return existing;
  };

  const idPrefix = () => (userId && userName) ? userId : 'unknown';

  // IDs prefixados por userId (com fallback) — evita colisões na consolidação
  const generateId = (kind='id') => {
    const u = safeUUID() || uid();
    return `${idPrefix()}::${kind}::${u}`;
  };
  const isWeekend = (d) => { const day = d.getDay(); return day === 0 || day === 6; };
  const formatDate = (date) => {
    const d = (date instanceof Date) ? date : new Date(date);
    const z = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return z.toISOString().slice(0,10);
  };
  const formatDateBR = (value) => {
    if (!value) return '';
    // Accept Date or ISO-like string (YYYY-MM-DD)
    if (value instanceof Date) {
      const dd = String(value.getDate()).padStart(2,'0');
      const mm = String(value.getMonth()+1).padStart(2,'0');
      const yy = value.getFullYear();
      return `${dd}/${mm}/${yy}`;
    }
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    // Fallback: try Date parsing
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yy = d.getFullYear();
      return `${dd}/${mm}/${yy}`;
    }
    return s;
  };
  const getDaysInMonth = (year, month) => {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
    return days;
  };
  const downloadFile = (content, fileName, contentType) => {
    const a = document.createElement('a');
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

    const readFileText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result||''));
    reader.onerror = reject;
    reader.readAsText(file);
  });


  const normalizeImportedState = (obj) => ({
    ...defaultState(),
    ...(obj && typeof obj === 'object' ? obj : {}),
    schemaVersion: String(obj?.schemaVersion || obj?.meta?.schemaVersion || APP_SCHEMA_VERSION),
    resources: Array.isArray(obj?.resources) ? obj.resources : [],
    demands: Array.isArray(obj?.demands) ? obj.demands : [],
    blockings: Array.isArray(obj?.blockings) ? obj.blockings : [],
    holidays: Array.isArray(obj?.holidays) ? obj.holidays : [],
    reprogrammings: Array.isArray(obj?.reprogrammings) ? obj.reprogrammings : [],
    overtimes: Array.isArray(obj?.overtimes) ? obj.overtimes : [],
    events: Array.isArray(obj?.events) ? obj.events : [],
  });

  const parseSnapshotText = (txt) => {
    const obj = JSON.parse(String(txt||'{}'));
    if (!obj || typeof obj !== 'object') throw new Error('Arquivo inválido.');
    return normalizeImportedState(obj);
  };


  const DB_COLLECTION_KEYS = ['resources','demands','blockings','holidays','reprogrammings','overtimes','events'];
  const stableStringify = (value) => {
    const seen = new WeakSet();
    const sortAny = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(sortAny);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortAny(v[k]);
      return out;
    };
    return JSON.stringify(sortAny(value));
  };

  const simpleHash = (txt) => {
    const s = String(txt || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };

  const normalizeDbStateOnly = (obj) => normalizeImportedState(obj);

  const sameItem = (a,b) => stableStringify(a) === stableStringify(b);
  const deepClone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const META_MERGE_KEYS = new Set(['createdAt','createdBy','updatedAt','updatedBy','version','last_edit_at','last_edit_by','last_edit_justification','timestamp','user','user_id']);

  const nowIso = () => new Date().toISOString();

  const applyCreateMeta = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out = { ...item };
    if (!out.createdAt) out.createdAt = nowIso();
    if (!out.createdBy) out.createdBy = userName || out.createdBy || '';
    out.updatedAt = nowIso();
    out.updatedBy = userName || out.updatedBy || '';
    out.version = Number(out.version || 0) > 0 ? Number(out.version) : 1;
    return out;
  };

  const applyUpdateMeta = (next, previous) => {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
    const prev = (previous && typeof previous === 'object' && !Array.isArray(previous)) ? previous : {};
    const out = { ...next };
    out.createdAt = out.createdAt || prev.createdAt || nowIso();
    out.createdBy = out.createdBy || prev.createdBy || userName || '';
    out.updatedAt = nowIso();
    out.updatedBy = userName || out.updatedBy || '';
    out.version = Math.max(Number(prev.version || 0), Number(out.version || 0), 0) + 1;
    return out;
  };

  const toMapById = (arr) => {
    const m = new Map();
    for (const item of (Array.isArray(arr) ? arr : [])) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '');
      if (!id) continue;
      m.set(id, item);
    }
    return m;
  };

  const changedKeys = (baseItem, nextItem) => {
    const keys = new Set([
      ...Object.keys((baseItem && typeof baseItem === 'object') ? baseItem : {}),
      ...Object.keys((nextItem && typeof nextItem === 'object') ? nextItem : {}),
    ]);
    const out = [];
    for (const key of keys) {
      if (key === 'id') continue;
      const before = baseItem ? baseItem[key] : undefined;
      const after = nextItem ? nextItem[key] : undefined;
      if (stableStringify(before) !== stableStringify(after)) out.push(key);
    }
    return out;
  };

  const buildConflictRecord = ({ collection, id, reason, baseItem, localItem, remoteItem, localChangedKeys=[], remoteChangedKeys=[] }) => ({
    collection,
    id,
    reason,
    baseItem: deepClone(baseItem),
    localItem: deepClone(localItem),
    remoteItem: deepClone(remoteItem),
    localChangedKeys: [...localChangedKeys],
    remoteChangedKeys: [...remoteChangedKeys],
  });

  const mergeObjectFields = ({ collection, id, baseItem, localItem, remoteItem }) => {
    const localKeysAll = changedKeys(baseItem, localItem);
    const remoteKeysAll = changedKeys(baseItem, remoteItem);
    const localDataKeys = localKeysAll.filter(k => !META_MERGE_KEYS.has(k));
    const remoteDataKeys = remoteKeysAll.filter(k => !META_MERGE_KEYS.has(k));
    const overlap = localDataKeys.filter(k => remoteDataKeys.includes(k));
    if (overlap.length) {
      return {
        merged: null,
        conflict: buildConflictRecord({
          collection, id, reason: 'same_field_changed', baseItem, localItem, remoteItem,
          localChangedKeys: localKeysAll, remoteChangedKeys: remoteKeysAll,
        })
      };
    }
    const merged = deepClone(baseItem || {});
    merged.id = String((localItem && localItem.id) || (remoteItem && remoteItem.id) || (baseItem && baseItem.id) || id);
    for (const key of localDataKeys) merged[key] = deepClone(localItem[key]);
    for (const key of remoteDataKeys) merged[key] = deepClone(remoteItem[key]);
    const createdAtCandidates = [baseItem?.createdAt, localItem?.createdAt, remoteItem?.createdAt].filter(Boolean).sort();
    const versionMax = Math.max(Number(baseItem?.version || 0), Number(localItem?.version || 0), Number(remoteItem?.version || 0), 0);
    merged.createdAt = createdAtCandidates[0] || nowIso();
    merged.createdBy = localItem?.createdBy || remoteItem?.createdBy || baseItem?.createdBy || '';
    merged.updatedAt = nowIso();
    merged.updatedBy = `merge:${userName || 'sistema'}`;
    merged.version = versionMax + 1;
    if (localItem?.last_edit_justification || remoteItem?.last_edit_justification) {
      merged.last_edit_justification = [localItem?.last_edit_justification, remoteItem?.last_edit_justification].filter(Boolean).join(' | ');
    }
    return { merged, conflict: null };
  };

  const mergeThreeWayCollection = (collectionKey, baseArr, localArr, remoteArr) => {
    const base = toMapById(baseArr), local = toMapById(localArr), remote = toMapById(remoteArr);
    const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    const out = [];
    const conflicts = [];
    let autoMerged = 0;
    for (const id of ids) {
      const b = base.has(id) ? base.get(id) : undefined;
      const l = local.has(id) ? local.get(id) : undefined;
      const r = remote.has(id) ? remote.get(id) : undefined;
      const localChanged = (b === undefined) ? (l !== undefined) : !sameItem(l, b);
      const remoteChanged = (b === undefined) ? (r !== undefined) : !sameItem(r, b);

      if (!localChanged && !remoteChanged) {
        if (r !== undefined) out.push(deepClone(r));
        else if (l !== undefined) out.push(deepClone(l));
        continue;
      }
      if (localChanged && !remoteChanged) {
        if (l !== undefined) out.push(deepClone(l));
        continue;
      }
      if (!localChanged && remoteChanged) {
        if (r !== undefined) out.push(deepClone(r));
        continue;
      }
      if (sameItem(l, r)) {
        if (l !== undefined) out.push(deepClone(l));
        continue;
      }

      // Ambos criaram item novo com mesmo ID.
      // Tenta mesclar campos em vez de bloquear imediatamente.
      if (b === undefined) {
        if (sameItem(l, r)) {
          if (l !== undefined) out.push(deepClone(l));
          continue;
        }
        // Usa objeto vazio como base para tentar merge de campos
        const fieldMergeNew = mergeObjectFields({ collection: collectionKey, id, baseItem: {id}, localItem: l, remoteItem: r });
        if (fieldMergeNew.conflict) {
          conflicts.push(fieldMergeNew.conflict);
        } else {
          out.push(fieldMergeNew.merged);
          autoMerged += 1;
        }
        continue;
      }

      if (l === undefined || r === undefined) {
        conflicts.push(buildConflictRecord({
          collection: collectionKey, id, reason: 'edit_vs_delete', baseItem: b, localItem: l, remoteItem: r,
          localChangedKeys: changedKeys(b, l), remoteChangedKeys: changedKeys(b, r),
        }));
        continue;
      }

      const fieldMerge = mergeObjectFields({ collection: collectionKey, id, baseItem: b, localItem: l, remoteItem: r });
      if (fieldMerge.conflict) {
        conflicts.push(fieldMerge.conflict);
        continue;
      }
      out.push(fieldMerge.merged);
      autoMerged += 1;
    }
    return { items: out, conflicts, autoMerged };
  };

  const mergeStatesThreeWay = (baseState, localState, remoteState) => {
    const base = normalizeDbStateOnly(baseState || {});
    const local = normalizeDbStateOnly(localState || {});
    const remote = normalizeDbStateOnly(remoteState || {});
    const merged = normalizeDbStateOnly(remote);
    const conflicts = [];
    const summary = {};
    let autoMergedCount = 0;
    for (const key of DB_COLLECTION_KEYS) {
      const beforeRemote = Array.isArray(remote[key]) ? remote[key].length : 0;
      const beforeLocal = Array.isArray(local[key]) ? local[key].length : 0;
      const res = mergeThreeWayCollection(key, base[key], local[key], remote[key]);
      merged[key] = res.items;
      conflicts.push(...res.conflicts);
      autoMergedCount += Number(res.autoMerged || 0);
      summary[key] = {
        remote: beforeRemote,
        local: beforeLocal,
        merged: Array.isArray(res.items) ? res.items.length : 0,
        conflicts: res.conflicts.length,
        autoMerged: Number(res.autoMerged || 0),
      };
    }
    merged.meta = {
      ...(remote.meta && typeof remote.meta === 'object' ? remote.meta : {}),
      ...(local.meta && typeof local.meta === 'object' ? local.meta : {}),
      mergedAt: nowIso(),
      mergedBy: userName || '',
      mergedById: userId || '',
      mergeConflictCount: conflicts.length,
      mergeAutoMergedCount: autoMergedCount,
      mergeSummary: summary,
      mergeHasBlockingConflicts: conflicts.length > 0,
    };
    return { merged, conflicts, conflictCount: conflicts.length, autoMergedCount, summary };
  };

  const getDbFileMeta = (file, txt='') => ({
    lastModified: Number(file?.lastModified || 0),
    size: Number(file?.size || String(txt || '').length || 0),
    hash: simpleHash(txt),
  });

  const loadDbMeta = () => {
    try {
      const raw = localStorage.getItem(DB_META_KEY);
      if (!raw) return { mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 };
      const obj = JSON.parse(raw);
      return {
        mode: String(obj.mode || 'none'),
        name: String(obj.name || ''),
        lastLoadedAt: String(obj.lastLoadedAt || ''),
        writable: !!obj.writable,
        baselineHash: String(obj.baselineHash || ''),
        baselineLastModified: Number(obj.baselineLastModified || 0),
        baselineSize: Number(obj.baselineSize || 0),
      };
    } catch {
      return { mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 };
    }
  };

  const persistDbMeta = (meta) => {
    localStorage.setItem(DB_META_KEY, JSON.stringify({
      mode: String(meta?.mode || 'none'),
      name: String(meta?.name || ''),
      lastLoadedAt: String(meta?.lastLoadedAt || ''),
      writable: !!meta?.writable,
      baselineHash: String(meta?.baselineHash || ''),
      baselineLastModified: Number(meta?.baselineLastModified || 0),
      baselineSize: Number(meta?.baselineSize || 0),
    }));
  };

  const loadDbBaseline = () => {
    try {
      const raw = localStorage.getItem(DB_BASELINE_KEY);
      if (!raw) return null;
      return normalizeDbStateOnly(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const persistDbBaseline = (snapshot) => {
    try {
      if (!snapshot) {
        localStorage.removeItem(DB_BASELINE_KEY);
        return;
      }
      localStorage.setItem(DB_BASELINE_KEY, JSON.stringify(normalizeDbStateOnly(snapshot)));
    } catch (e) {
      // Bancos grandes podem ultrapassar a cota do localStorage.
      // O snapshot continua válido em memória e/ou no arquivo JSON selecionado;
      // apenas deixamos de duplicar o BD inteiro dentro do navegador.
      try { localStorage.removeItem(DB_BASELINE_KEY); } catch {}
      console.warn('[CapView Storage] Baseline grande demais para localStorage. Mantido fora do cache local.', e);
    }
  };

  let dbBinding = loadDbMeta();
  let dbFileHandle = null;
  let dbLoadedSnapshot = loadDbBaseline();
  let dbPathValue = localStorage.getItem(DB_PATH_KEY) || '';

  const setDbPathValue = (value) => {
    dbPathValue = String(value || '').trim();
    localStorage.setItem(DB_PATH_KEY, dbPathValue);
  };

  const setDbBinding = (meta, handle=null, loadedSnapshot=null) => {
    dbBinding = {
      mode: String(meta?.mode || 'none'),
      name: String(meta?.name || ''),
      lastLoadedAt: String(meta?.lastLoadedAt || ''),
      writable: !!meta?.writable,
      baselineHash: String(meta?.baselineHash || ''),
      baselineLastModified: Number(meta?.baselineLastModified || 0),
      baselineSize: Number(meta?.baselineSize || 0),
    };
    dbFileHandle = handle || null;
    dbLoadedSnapshot = loadedSnapshot ? normalizeDbStateOnly(loadedSnapshot) : null;
    persistDbMeta(dbBinding);
    persistDbBaseline(dbLoadedSnapshot);
  };

  const resetDbBinding = () => {
    setDbBinding({ mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 }, null, null);
  };

  const hasDbBinding = () => String(dbBinding?.mode || 'none') !== 'none';

  const confirmClearAllData = () => {
    const pwd = prompt('Informe a senha para limpar os dados locais do sistema:');
    if (pwd === null) return false;
    if (String(pwd) !== 'CAPVIEW') {
      alert('Senha inválida.');
      return false;
    }
    if (!confirm('Isso limpará todos os dados locais do sistema, incluindo localStorage, vínculo com BD e usuário salvo neste navegador. Continuar?')) return false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(DB_META_KEY);
      localStorage.removeItem(DB_PATH_KEY);
    } catch {}
    state = defaultState();
    dbFileHandle = null;
    resetDbBinding();
    setDbPathValue('');
    userName = '';
    userId = '';
    updateAvatar();
    activeTab = 'dashboard';
    persist();
    render();
    toast('Dados locais limpos com sucesso.');
    setTimeout(() => openUserModal(true), 150);
    return true;
  };

  const canUseFileSystemAccess = () => !!window.showOpenFilePicker;
  const isFileOrigin = () => String(window.location?.protocol || '') === 'file:';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const isDbHandleRecoverableError = (e) => {
    const name = String(e?.name || '');
    const msg = String(e?.message || '');
    return (
      name === 'InvalidStateError' ||
      name === 'SecurityError' ||
      name === 'NotFoundError' ||
      /state had changed since it was read from disk/i.test(msg) ||
      /depends on state cached in an interface object/i.test(msg) ||
      /permission|createWritable|user activation/i.test(msg) ||
      /unsafe attempt to load url/i.test(msg)
    );
  };

  const clearDbHandleOnly = () => {
    dbFileHandle = null;
    setDbBinding({
      ...dbBinding,
      mode:'none',
      writable:false,
      baselineHash:'',
      baselineLastModified:0,
      baselineSize:0,
      lastLoadedAt:new Date().toISOString(),
    }, null, null);
  };

  const recoverDbHandleByReselect = async (reason='') => {
    clearDbHandleOnly();
    toast(reason || 'O vínculo com o BD ficou inválido. Selecione o arquivo JSON novamente.');
    await sleep(50);
    await selectDbReadWrite();
    return !!(dbFileHandle && dbBinding.mode === 'rw');
  };

  const holidayKey = (h) => String(h?.id || h?.data || h?.date || '').trim();

  const mergeHolidaysNonDestructive = (incomingHolidays, currentHolidays) => {
    const out = [];
    const seen = new Set();
    const add = (h) => {
      if (!h || typeof h !== 'object') return;
      const key = holidayKey(h);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ ...h });
    };
    // Prioriza o que veio do BD, mas preserva feriados já cadastrados localmente.
    for (const h of (Array.isArray(incomingHolidays) ? incomingHolidays : [])) add(h);
    for (const h of (Array.isArray(currentHolidays) ? currentHolidays : [])) add(h);
    return out;
  };

  const applyImportedSnapshot = (snapshot, opts={}) => {
    const currentHolidays = Array.isArray(state?.holidays) ? state.holidays : [];
    const next = normalizeImportedState(snapshot);
    if (opts?.preserveHolidays !== false) {
      next.holidays = mergeHolidaysNonDestructive(next.holidays, currentHolidays);
    }
    state = next;
    const prevSuppress = suppressDbAutoSave;
    suppressDbAutoSave = true;
    try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
    render();
    return state;
  };

  const ensureHandlePermission = async (handle, mode='readwrite', { prompt=true } = {}) => {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    const opts = { mode };
    let status = 'prompt';
    try { status = await handle.queryPermission(opts); } catch {}
    if (status === 'granted') return true;
    if (!prompt || typeof handle.requestPermission !== 'function') return false;
    try { status = await handle.requestPermission(opts); } catch { status = 'denied'; }
    return status === 'granted';
  };

  const ensureDbHandlePermission = async (mode='readwrite', opts={}) => ensureHandlePermission(dbFileHandle, mode, opts);

  const dbWriteHelpText = () => {
    if (isFileOrigin()) {
      return 'Permissão de escrita não concedida pelo navegador. Como o app está aberto via file://, o navegador pode exigir um novo gesto do usuário. Clique em "Selecionar arquivo JSON" novamente e tente salvar de novo.';
    }
    return 'Permissão de escrita não concedida pelo navegador. Clique em "Selecionar arquivo JSON" novamente e autorize acesso de leitura/gravação.';
  };

  const isDbPermissionError = (e) => {
    const msg = String(e?.message || '');
    return e?.name === 'SecurityError' || /permission|createWritable|user activation/i.test(msg);
  };

  const buildDbExportObject = () => ({
    ...state,
    schemaVersion: APP_SCHEMA_VERSION,
    meta: {
      ...(state.meta && typeof state.meta==='object' ? state.meta : {}),
      authorName: userName || '',
      authorUserId: userId || '',
      exportedAt: new Date().toISOString(),
      exportSource: 'CapView+',
      schemaVersion: APP_SCHEMA_VERSION,
    }
  });

  // ----------------------
  // Demand filters + donut modal
  // ----------------------
  const overlapsRange = (start, end, rangeStart, rangeEnd) => {
    // all args are ISO date strings (YYYY-MM-DD). Empty rangeStart/rangeEnd means open-ended.
    const rs = rangeStart || '0000-01-01';
    const re = rangeEnd   || '9999-12-31';
    const s = start || '0000-01-01';
    const e = end   || '9999-12-31';
    return !(e < rs || s > re);
  };

  const filterDemands = ({ status='', resourceId='', dateStart='', dateEnd='', titleQuery='' } = {}) => {
    const st = (status||'').trim();
    const rid = (resourceId||'').trim();
    const ds = (dateStart||'').trim();
    const de = (dateEnd||'').trim();
    const tq = String(titleQuery||'').trim().toLowerCase();

    return (state.demands||[]).filter(d => {
      const dStatus = effectiveStatus(d);
      if (st && dStatus != st) return false;

      if (tq && !String(d.titulo||'').toLowerCase().includes(tq)) return false;

      if (rid) {
        if (rid === '__NONE__') {
          if ((d.responsavel_id||'').trim()) return false;
        } else {
          if ((d.responsavel_id||'') !== rid) return false;
        }
      }

      if (ds || de) {
        if (!overlapsRange(d.data_inicio, d.data_fim, ds, de)) return false;
      }
      return true;
    });
  };

  const renderDemandsTable = (demands, { compact=false } = {}) => {
    const resMap = resourceById();
    const t = el('table');
    t.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', {}, ['Título']),
      el('th', {}, ['Responsável']),
      el('th', {}, ['Período']),
      el('th', {}, ['%/dia']),
      el('th', {}, ['Prioridade']),
      el('th', {}, ['Status']),
    ])]));
    const tb = el('tbody');

    for (const d of demands) {
      const tr = el('tr');
        if (effectiveStatus(d) === 'Atrasada') tr.classList.add('overdueRow');
      tr.appendChild(el('td', {}, [
        el('div', { style:'font-weight:950' }, [d.titulo]),
        d.predio || d.focal ? el('div', { class:'tiny' }, [`${(d.predio||'').trim()}${d.predio && d.focal ? ' • ' : ''}${(d.focal||'').trim()}`.trim()]) : el('div', { class:'tiny', style:'display:none' }, [''])
      ].filter(Boolean)));
      const respName = (d.responsavel_id||'') ? (resMap[d.responsavel_id]?.nome || '—') : '—';
      tr.appendChild(el('td', {}, [respName]));
      tr.appendChild(el('td', { class:'mono tiny' }, [`${formatDateBR(d.data_inicio)} → ${formatDateBR(d.data_fim)}`]));
      tr.appendChild(el('td', {}, [`${Number(d.percentual_diario||0)}%`]));
      tr.appendChild(el('td', {}, [d.prioridade || '—']));
      const st = effectiveStatus(d);
      tr.appendChild(el('td', {}, [statusPill(d)]));
      tb.appendChild(tr);
    }

    if (demands.length === 0) {
      tb.appendChild(el('tr', {}, [el('td', { colspan:'7', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhuma demanda para este filtro.'])]));
    }

    t.appendChild(tb);
    return t;
  };

  const openDonutModal = (status) => {
    const modal = qs('#donutModal');
    const title = qs('#donutModalTitle');
    const sub = qs('#donutModalSub');
    const body = qs('#donutModalBody');

    const list = filterDemands({
      status,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: uiFilters.demandTitle
    });
    // sempre começa na primeira página ao abrir o modal
    uiPagination.donutModalPage = 1;

    const renderModal = () => {
      title.textContent = `Demandas — ${status}`;
      sub.textContent = `${list.length} demanda(s) • clique em "Ir para Demandas" para aplicar filtro na tela`;

      body.innerHTML = '';

      const activePills = buildFilterPills({ includeClear:false });
      if (activePills) {
        body.appendChild(el('div', { class:'tiny muted', style:'margin-bottom:6px' }, ['Filtros ativos (além do status clicado):']));
        body.appendChild(activePills);
        body.appendChild(el('div', { style:'height:8px' }));
      }

      body.appendChild(el('div', { class:'row', style:'margin-bottom:10px' }, [
        button('Ir para Demandas (aplicar filtro)', 'primary', () => {
          uiFilters.demandStatus = status;
          uiPagination.demandsPage=1;
          activeTab = 'demands';
          uiFilters.focusDemandsList = true;
          modal.close();
          render();
        }),
        button('Limpar filtro', '', () => {
          uiFilters.demandStatus = '';
          uiFilters.demandResourceId = '';
          uiFilters.demandDateStart = '';
          uiFilters.demandDateEnd = '';
          uiFilters.demandTitle = '';
          toast('Filtro limpo.');
          render();
        })
      ]));

      const total = list.length;
      const totalPages = Math.max(1, Math.ceil(total / MODAL_DEMANDS_PAGE_SIZE));
      uiPagination.donutModalPage = Math.min(Math.max(1, uiPagination.donutModalPage), totalPages);
      const startIdx = (uiPagination.donutModalPage - 1) * MODAL_DEMANDS_PAGE_SIZE;
      const pageItems = list.slice(startIdx, startIdx + MODAL_DEMANDS_PAGE_SIZE);

      body.appendChild(renderDemandsTable(pageItems, { compact:true }));

      if (total > MODAL_DEMANDS_PAGE_SIZE) {
        body.appendChild(buildPager({
          page: uiPagination.donutModalPage,
          totalPages,
          total,
          startIdx,
          shown: pageItems.length,
          onPrev: () => { uiPagination.donutModalPage--; renderModal(); },
          onNext: () => { uiPagination.donutModalPage++; renderModal(); },
          onFirst: () => { uiPagination.donutModalPage = 1; renderModal(); },
          onLast: () => { uiPagination.donutModalPage = totalPages; renderModal(); },
        }));
      }
    };

    renderModal();
    if (!modal.open) openDialog(modal);
  };

  // close button
  setTimeout(() => {
    const closeBtn = qs('#donutModalClose');
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener('click', () => qs('#donutModal')?.close());
    }
  }, 0);

  // close button (heat map modal)
  setTimeout(() => {
    const closeBtn = qs('#heatModalClose');
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener('click', () => qs('#heatModal')?.close());
    }
  }, 0);

  const toast = (msg) => {
    const el = qs('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  };

  const defaultState = () => ({
    resources: [],
    demands: [],
    blockings: [],
    holidays: [],
    reprogrammings: [],
    overtimes: [],
    events: []
  });

  // ----------------------
  // Status (padrão)
  // ----------------------
  const STATUS = ['Em andamento','Atrasada','Concluída','Mapeada','Congelada'];
  const STATUS_COUNTS_IN_ALLOCATION = new Set(['Em andamento','Atrasada']);

  const normalizeStatus = (s) => {
    const v = String(s||'').trim();
    if (!v) return 'Mapeada';
    // compatibilidade com versões anteriores
    if (v.toLowerCase() === 'planejada') return 'Mapeada';
    if (v.toLowerCase() === 'em andamento') return 'Em andamento';
    if (v.toLowerCase() === 'concluída' || v.toLowerCase() === 'concluida') return 'Concluída';
    if (v.toLowerCase() === 'suspensa') return 'Congelada';
    if (v.toLowerCase() === 'atrasada') return 'Atrasada';
    if (v.toLowerCase() === 'mapeada') return 'Mapeada';
    if (v.toLowerCase() === 'congelada') return 'Congelada';
    return v;
  };

  // ----------------------
  // Status derivado: Atrasada (automático por prazo)
  // Regra: se HOJE > data_fim e status base não é Concluída/Congelada, então fica Atrasada.
  // Importante: HOJE é calculado em DATA LOCAL (não UTC) para evitar virar "amanhã" antes da hora no Brasil.
  // ----------------------
  const todayISO = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  };


  // ----------------------
  // Execution Layer — Apontamentos de Atividades e Métricas (v0.2.3)
  // ----------------------
  const PROJECT_STEP_OPTIONS = [
    'ARI', 'PV', 'ANR', 'QI', 'QO', 'QP', 'RP', 'ERU', 'URS', 'RTM',
    'Revisão', 'Reunião', 'Execução de Teste', 'Correção', 'Evidência', 'Outro'
  ];

  const normalizeProjectStep = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const found = PROJECT_STEP_OPTIONS.find(x => x.toLowerCase() === raw.toLowerCase());
    return found || raw;
  };

  const parseApontamentoHours = (value) => {
    const normalized = String(value ?? '').replace(',', '.').trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  const isISODateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

  const sortApontamentosChronological = (items=[]) => [...items].sort((a,b) => {
    const d = String(a.data || '').localeCompare(String(b.data || ''));
    if (d !== 0) return d;
    return Number(a.created_at || 0) - Number(b.created_at || 0);
  });

  const normalizeApontamento = (item={}) => {
    const now = Date.now();
    const createdAt = Number(item.created_at || item.createdAt || now);
    const horas = parseApontamentoHours(item.horas);
    return {
      id: String(item.id || generateId('apt')),
      data: String(item.data || todayISO()).trim(),
      etapa: normalizeProjectStep(item.etapa || item.tipo || 'Outro'),
      horas: Number.isFinite(horas) && horas > 0 ? horas : 0,
      observacao: String(item.observacao || item.observações || item.obs || '').trim(),
      usuario: String(item.usuario || item.user || item.created_by || userName || 'Sessão local').trim(),
      user_id: String(item.user_id || item.userId || userId || '').trim(),
      created_at: createdAt,
      updated_at: Number(item.updated_at || item.updatedAt || createdAt),
      updated_by: String(item.updated_by || item.updatedBy || item.usuario || userName || 'Sessão local').trim(),
      updated_by_id: String(item.updated_by_id || item.updatedById || item.user_id || userId || '').trim(),
    };
  };

  const normalizeDemandApontamentos = (demand={}) => {
    const list = Array.isArray(demand.apontamentos) ? demand.apontamentos : [];
    return sortApontamentosChronological(list.map(normalizeApontamento).filter(a => a.data && a.etapa && Number(a.horas) > 0));
  };

  const demandExecutionMetrics = (demand={}, apontamentosOverride=null) => {
    const apontamentos = Array.isArray(apontamentosOverride) ? normalizeDemandApontamentos({ apontamentos: apontamentosOverride }) : normalizeDemandApontamentos(demand);
    const realHours = Math.round(apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0) * 100) / 100;

    const start = String(demand.data_inicio || '').trim();
    const end = String(demand.data_fim || '').trim();
    const percent = Math.max(0, Number(demand.percentual_diario || 0));
    const resourceId = String(demand.responsavel_id || '').trim();

    let plannedDays = 0;
    if (isISODateString(start) && isISODateString(end) && start <= end && percent > 0) {
      let cursor = isoToLocalMidnight(start);
      const limit = isoToLocalMidnight(end);
      while (cursor && limit && cursor.getTime() <= limit.getTime()) {
        const dateStr = formatDate(cursor);
        let eligible = !isWeekend(cursor) && !isHoliday(dateStr);
        if (eligible && resourceId) {
          eligible = !nonWorkingReasonForDay(resourceId, cursor);
        }
        if (eligible) plannedDays++;
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const plannedHours = Math.round((plannedDays * HOURS_PER_DAY * (percent / 100)) * 100) / 100;
    const delta = Math.round((plannedHours - realHours) * 100) / 100; // saldo: horas planejadas restantes; negativo = acima do planejado
    const progressPct = plannedHours > 0 ? Math.round((realHours / plannedHours) * 1000) / 10 : (realHours > 0 ? 100 : 0);
    const efficiencyPct = plannedHours > 0 ? Math.round((realHours / plannedHours) * 1000) / 10 : null;

    let trend = 'Sem dados suficientes';
    let trendTone = 'neutral';
    if (plannedHours > 0) {
      if (realHours > plannedHours) { trend = 'Estourado'; trendTone = 'danger'; }
      else if (realHours >= plannedHours * 0.9) { trend = 'Atenção'; trendTone = 'warn'; }
      else if (realHours > 0) { trend = 'Dentro do planejado'; trendTone = 'ok'; }
      else { trend = 'Não iniciado'; trendTone = 'neutral'; }
    }

    return {
      plannedHours,
      realHours,
      delta,
      progressPct,
      efficiencyPct,
      trend,
      trendTone,
      plannedDays,
      apontamentosCount: apontamentos.length,
    };
  };


  // Dashboard Operacional (v0.3.0) — leitura gerencial das horas reais apontadas.
  // Não altera capacidade planejada; apenas consolida apontamentos já registrados nas demandas.
  const buildOperationalDashboardModel = (demands=[], periodStart='', periodEnd='') => {
    const inPeriod = (dateStr) => {
      const d = String(dateStr || '').trim();
      if (!isISODateString(d)) return false;
      if (periodStart && d < periodStart) return false;
      if (periodEnd && d > periodEnd) return false;
      return true;
    };
    const addHours = (map, key, horas, meta={}) => {
      const k = String(key || 'Não informado').trim() || 'Não informado';
      if (!map.has(k)) map.set(k, { label:k, horas:0, count:0, ...meta });
      const item = map.get(k);
      item.horas = Math.round((Number(item.horas || 0) + Number(horas || 0)) * 100) / 100;
      item.count = Number(item.count || 0) + 1;
      Object.assign(item, meta);
      return item;
    };
    const weekStartKey = (iso) => {
      const d = isoToLocalMidnight(iso);
      if (!d) return 'Sem semana';
      const day = d.getDay(); // 0 domingo
      const diff = day === 0 ? -6 : 1 - day; // segunda-feira
      d.setDate(d.getDate() + diff);
      return formatDate(d);
    };

    const byStep = new Map();
    const byUser = new Map();
    const byWeek = new Map();
    const byDemand = new Map();
    const bottlenecks = [];
    let totalRealHours = 0;
    let totalApontamentos = 0;
    let lastApontamento = null;

    for (const demand of (demands || [])) {
      const apontamentos = normalizeDemandApontamentos(demand).filter(a => inPeriod(a.data));
      const realHoursDemand = Math.round(apontamentos.reduce((acc,a)=>acc+Number(a.horas||0),0) * 100) / 100;
      if (realHoursDemand > 0) {
        addHours(byDemand, demand.id || demand.titulo || 'Demanda', realHoursDemand, {
          title: demand.titulo || demand.id || 'Demanda',
          demandId: demand.id || ''
        });
      }

      for (const a of apontamentos) {
        const h = Number(a.horas || 0);
        totalRealHours = Math.round((totalRealHours + h) * 100) / 100;
        totalApontamentos += 1;
        addHours(byStep, normalizeProjectStep(a.etapa || 'Outro'), h);
        addHours(byUser, a.usuario || a.updated_by || 'Sessão local', h);
        addHours(byWeek, weekStartKey(a.data), h, { label: `Semana de ${formatDateBR(weekStartKey(a.data))}` });
        if (!lastApontamento || String(a.data) > String(lastApontamento.data) || (String(a.data) === String(lastApontamento.data) && Number(a.created_at||0) > Number(lastApontamento.created_at||0))) {
          lastApontamento = { ...a, demandTitle: demand.titulo || demand.id || 'Demanda' };
        }
      }

      const allMetrics = demandExecutionMetrics(demand);
      if (allMetrics.plannedHours > 0 && allMetrics.realHours > 0) {
        const ratio = allMetrics.realHours / allMetrics.plannedHours;
        if (ratio >= 0.9) {
          bottlenecks.push({
            title: demand.titulo || demand.id || 'Demanda',
            plannedHours: allMetrics.plannedHours,
            realHours: allMetrics.realHours,
            pct: Math.round(ratio * 1000) / 10,
            tone: ratio > 1 ? 'Estourado' : 'Atenção'
          });
        }
      }
    }

    const sortHoursDesc = (arr) => arr.sort((a,b) => Number(b.horas||0) - Number(a.horas||0));
    return {
      periodStart,
      periodEnd,
      totalRealHours,
      totalApontamentos,
      byStep: sortHoursDesc([...byStep.values()]),
      byUser: sortHoursDesc([...byUser.values()]),
      byWeek: [...byWeek.values()].sort((a,b)=>String(a.label).localeCompare(String(b.label))),
      byDemand: sortHoursDesc([...byDemand.values()]),
      bottlenecks: bottlenecks.sort((a,b)=>Number(b.pct||0)-Number(a.pct||0)),
      lastApontamento,
    };
  };

  const validateApontamentoInput = ({ data, etapa, horas }, demand={}) => {
    if (!isISODateString(data)) return 'Informe uma data válida para o apontamento.';
    if (!normalizeProjectStep(etapa)) return 'Informe a etapa do projeto.';
    if (!Number.isFinite(horas) || horas <= 0) return 'Informe horas gastas maior que zero.';
    if (horas > 24) return 'Horas gastas não pode ser maior que 24h em um único apontamento.';
    if (demand.data_inicio && data < demand.data_inicio) return 'A data do apontamento não pode ser anterior ao início planejado da demanda.';
    if (demand.data_fim && data > demand.data_fim) return 'A data do apontamento não pode ser posterior ao fim planejado da demanda.';
    return '';
  };

  const isoToLocalMidnight = (iso) => {
    const s = String(iso||'').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  };

  const daysLate = (demand) => {
    const prazo = (demand?.data_fim||'').trim();
    if (!prazo) return 0;
    const t = todayISO();
    if (t <= prazo) return 0;
    const a = isoToLocalMidnight(prazo);
    const b = isoToLocalMidnight(t);
    if (!a || !b) return 0;
    const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
    return Math.max(1, diff);
  };

  const effectiveStatus = (demand) => {
    const base = normalizeStatus(demand?.status);
    // Concluída e Congelada nunca viram atrasadas automaticamente
    if (base === 'Concluída' || base === 'Congelada') return base;
    const prazo = (demand?.data_fim||'').trim();
    // Atrasada começa no DIA SEGUINTE ao prazo (HOJE > data_fim)
    if (prazo && todayISO() > prazo) return 'Atrasada';
    return base;
  };

  const overdueTooltip = (demand) => {
    const dl = daysLate(demand);
    if (!dl) return '';
    const prazo = formatDateBR(demand.data_fim);
    return `Atrasada há ${dl} dia(s). Prazo: ${prazo}. (Status automático)`;
  };



  ({displayName: userName, userId} = loadUserIdentity());

  let activeTab = 'dashboard';

  // filtros de UI (não persistidos)
  const uiFilters = {
    demandStatus: '', // '', 'Em andamento', 'Atrasada', 'Concluída', 'Mapeada', 'Congelada'
    demandResourceId: '', // '', resourceId, '__NONE__'
    demandDateStart: '', // YYYY-MM-DD
    demandDateEnd: '',   // YYYY-MM-DD
    demandTitle: '',     // pesquisa por título da demanda
    focusDemandsList: false,
    focusDemandsForm: false,
    prefillDemand: null, // { responsavel_id, data_inicio, data_fim }
  };

  // Busca por título sem perder foco: evita render() a cada tecla de forma destrutiva.
  let demandTitleSearchTimer = null;
  let demandTitleSearchFocus = null;

  const restoreDemandTitleSearchFocus = () => {
    if (!demandTitleSearchFocus || !demandTitleSearchFocus.id) return;
    const info = demandTitleSearchFocus;
    demandTitleSearchFocus = null;
    const inp = document.getElementById(info.id);
    if (!inp) return;
    try {
      inp.focus();
      const len = String(inp.value || '').length;
      const start = Math.min(Number(info.start ?? len), len);
      const end = Math.min(Number(info.end ?? start), len);
      if (typeof inp.setSelectionRange === 'function') inp.setSelectionRange(start, end);
    } catch {}
  };

  const bindDemandTitleSearch = (inputEl, inputId, pageKey = 'demandsPage', tabKey = null) => {
    inputEl.id = inputId;
    inputEl.value = uiFilters.demandTitle || '';
    inputEl.addEventListener('input', () => {
      uiFilters.demandTitle = inputEl.value || '';
      if (pageKey && uiPagination[pageKey] !== undefined) uiPagination[pageKey] = 1;
      if (tabKey) activeTab = tabKey;
      demandTitleSearchFocus = {
        id: inputId,
        start: inputEl.selectionStart,
        end: inputEl.selectionEnd
      };
      clearTimeout(demandTitleSearchTimer);
      demandTitleSearchTimer = setTimeout(() => {
        render();
        setTimeout(restoreDemandTitleSearchFocus, 0);
      }, 250);
    });
  };

  // paginação (não persistida)
  const uiPagination = {
    demandsPage: 1,
    resourcesPage: 1,
    dashboardPerResourcePage: 1,
    dashboardSheetPage: 1,
    evaluationPage: 1,
    blockingsPage: 1,
    holidaysPage: 1,
    // Modais
    donutModalPage: 1,
    dayModalPage: 1,
    // Janelas Livres
    windowsHeatPage: 1,   // Heatmap (Janelas por recurso x meses)
    windowsNextPage: 1,   // Próxima janela livre
    windowsMatrixPage: 1, // Matriz de janelas livres
  };


  const STATUS_COLORS = {
    'Em andamento': 'var(--indigo)',
    'Atrasada': 'var(--red)',
    'Concluída': 'var(--green)',
    'Mapeada': 'var(--slate)',
    'Congelada': 'var(--yellow)'
  };

  const hasAnyDemandFilters = () => {
    return !!(uiFilters.demandStatus || uiFilters.demandResourceId || uiFilters.demandDateStart || uiFilters.demandDateEnd || uiFilters.demandTitle);
  };

  const buildFilterPills = ({ includeClear=true } = {}) => {
    const pills = [];

    if (uiFilters.demandStatus) {
      const st = uiFilters.demandStatus;
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:`background:${STATUS_COLORS[st]||'var(--indigo)'}` }),
        `Status: ${st}`,
        el('button', { class:'xbtn', title:'Remover filtro de status', onclick: () => { uiFilters.demandStatus=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandResourceId) {
      let label = 'Recurso';
      if (uiFilters.demandResourceId === '__NONE__') label = 'Sem responsável (Mapeada)';
      else {
        const r = (state.resources||[]).find(x => x.id === uiFilters.demandResourceId);
        label = r ? r.nome : 'Recurso';
      }
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--slate)' }),
        `Recurso: ${label}`,
        el('button', { class:'xbtn', title:'Remover filtro de recurso', onclick: () => { uiFilters.demandResourceId=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandTitle) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo)' }),
        `Título: ${uiFilters.demandTitle}`,
        el('button', { class:'xbtn', title:'Remover pesquisa por título', onclick: () => { uiFilters.demandTitle=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandDateStart) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo)' }),
        `De: ${uiFilters.demandDateStart}`,
        el('button', { class:'xbtn', title:'Remover data início do filtro', onclick: () => { uiFilters.demandDateStart=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandDateEnd) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo2)' }),
        `Até: ${uiFilters.demandDateEnd}`,
        el('button', { class:'xbtn', title:'Remover data fim do filtro', onclick: () => { uiFilters.demandDateEnd=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (!pills.length) return null;

    const clearAll = () => {
      uiFilters.demandStatus = '';
      uiFilters.demandResourceId = '';
      uiFilters.demandDateStart = '';
      uiFilters.demandDateEnd = '';
      uiFilters.demandTitle = '';
      toast('Filtros limpos.');
      uiPagination.demandsPage=1;
      render();
    };

    return el('div', { class:'row' }, [
      ...pills,
      ...(includeClear ? [button('Limpar filtros', '', clearAll)] : [])
    ]);
  };

  let state = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeImportedState(JSON.parse(saved));
    } catch {}
    // Quando a base é grande, o app não duplica o BD no localStorage.
    // Nesses casos, o usuário deve carregar/selecionar o JSON normalmente;
    // o marcador leve evita erro de quota, mas não tenta restaurar dados incompletos.
    return defaultState();
  })();

  /* migrate demands */
  try {
    state.demands = (state.demands||[]).map(d => {
      const st = effectiveStatus(d);
      const out = { ...d, status: st };
      // Mapeada = sempre sem responsável
      if (st === 'Mapeada') { out.responsavel_id = ''; out.responsavel = ''; }
      return out;
    });
  } catch {}

  // Autosync runtime: keeps localStorage fast while allowing safe queued DB saves.
  let dbAutoSyncEnabled = localStorage.getItem('capview_db_autosync_enabled') !== '0';
  let dbAutoSaveTimer = null;
  let dbAutoSaveRunning = false;
  let dbAutoSaveStartedAt = 0;
  let dbAutoSavePending = false;
  let dbAutoSaveDirtySince = 0;
  let dbWatcherTimer = null;
  let dbWatcherRunning = false;
  let suppressDbAutoSave = false;
  let dbLastSyncLabel = '';
  let dbAutoSyncPauseReason = localStorage.getItem('capview_db_autosync_pause_reason') || '';

  // V5.5.1 — Modo Eventos por usuário (sem backend)
  const EVENT_MODE_KEY = 'capview_event_mode_enabled_v551';
  const EVENT_FOLDER_META_KEY = 'capview_event_folder_meta_v551';
  let capviewEventMode = {
    enabled: localStorage.getItem(EVENT_MODE_KEY) === '1',
    folderName: '',
    lastReadAt: '',
    lastWriteAt: '',
    lastStatus: '',
    pendingReadCount: 0,
    autoSyncEnabled: localStorage.getItem('capview_event_autosync_enabled_v560') !== '0',
    autoSyncMs: 4000,
    autoSyncRunning: false,
    autoSyncLastTickAt: '',
    autoSyncError: '',
  };
  try { capviewEventMode = { ...capviewEventMode, ...(JSON.parse(localStorage.getItem(EVENT_FOLDER_META_KEY)||'{}')||{}) }; } catch {}
  let capviewDataDirHandle = null;
  let capviewEventsDirHandle = null;
  let capviewSnapshotFileHandle = null;

  // V5.7 — Outbox local: se a pasta ainda não estiver selecionada ou se a gravação falhar,
  // o evento fica guardado no navegador e é reenviado quando a pasta CapViewData for vinculada.
  const EVENT_OUTBOX_KEY = 'capview_event_outbox_v570';
  const EVENT_OUTBOX_MAX = 500;
  let capviewEventWriteInFlight = false;

  // V5.8 — Controle local de eventos já vistos/aplicados.
  // O snapshot pode ainda não estar consolidado; por isso o app continua
  // aplicando todos os eventos pendentes para montar a tela, mas só notifica
  // como "novo" o que ainda não foi visto nesta estação.
  const APPLIED_EVENTS_KEY = 'capview_applied_event_ids_v580';
  const APPLIED_EVENTS_MAX = 5000;

  const loadAppliedEventIds = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(APPLIED_EVENTS_KEY) || '[]');
      return new Set((Array.isArray(arr) ? arr : []).map(String).filter(Boolean));
    } catch { return new Set(); }
  };

  const saveAppliedEventIds = (set) => {
    try {
      const arr = [...(set || new Set())].map(String).filter(Boolean).slice(-APPLIED_EVENTS_MAX);
      localStorage.setItem(APPLIED_EVENTS_KEY, JSON.stringify(arr));
    } catch {}
  };

  const markAppliedEvents = (events) => {
    const ids = loadAppliedEventIds();
    for (const ev of (Array.isArray(events) ? events : [])) {
      if (ev && ev.id) ids.add(String(ev.id));
    }
    saveAppliedEventIds(ids);
  };

  const resetAppliedEventControl = () => {
    try { localStorage.removeItem(APPLIED_EVENTS_KEY); } catch {}
  };

  const loadLocalEventOutbox = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(EVENT_OUTBOX_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter(e => e && e.id).slice(-EVENT_OUTBOX_MAX) : [];
    } catch { return []; }
  };

  const saveLocalEventOutbox = (arr) => {
    try { localStorage.setItem(EVENT_OUTBOX_KEY, JSON.stringify((Array.isArray(arr) ? arr : []).filter(e => e && e.id).slice(-EVENT_OUTBOX_MAX))); } catch {}
  };

  const rememberLocalEventForSharedFile = (event) => {
    if (!event || !event.id) return;
    const arr = loadLocalEventOutbox();
    if (!arr.some(e => String(e.id) === String(event.id))) arr.push(event);
    saveLocalEventOutbox(arr);
  };

  const forgetLocalEventsFromOutbox = (ids) => {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return;
    saveLocalEventOutbox(loadLocalEventOutbox().filter(e => !idSet.has(String(e.id))));
  };

  const mergeEventListsUnique = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const ev of (Array.isArray(list) ? list : [])) {
        if (!ev || !ev.id) continue;
        const id = String(ev.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(ev);
      }
    }
    return out.sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  };

  const sharedFolderReady = () => !!(capviewEventMode.enabled && capviewDataDirHandle && capviewEventsDirHandle && capviewSnapshotFileHandle);

  const persistEventFolderMeta = () => {
    try { localStorage.setItem(EVENT_MODE_KEY, capviewEventMode.enabled ? '1' : '0'); } catch {}
    try { localStorage.setItem(EVENT_FOLDER_META_KEY, JSON.stringify({
      folderName: capviewEventMode.folderName || '',
      lastReadAt: capviewEventMode.lastReadAt || '',
      lastWriteAt: capviewEventMode.lastWriteAt || '',
      lastStatus: capviewEventMode.lastStatus || '',
      pendingReadCount: Number(capviewEventMode.pendingReadCount || 0),
      autoSyncEnabled: capviewEventMode.autoSyncEnabled !== false,
      autoSyncMs: Number(capviewEventMode.autoSyncMs || 4000),
      autoSyncLastTickAt: capviewEventMode.autoSyncLastTickAt || '',
      autoSyncError: capviewEventMode.autoSyncError || '',
    })); } catch {}
    try { localStorage.setItem('capview_event_autosync_enabled_v560', capviewEventMode.autoSyncEnabled === false ? '0' : '1'); } catch {}
  };

  const setEventModeStatus = (msg) => {
    capviewEventMode.lastStatus = String(msg || '');
    persistEventFolderMeta();
    try { console.log('[CapView Eventos]', msg || ''); } catch {}
  };

  // V5.6 — Autosync de eventos por pasta compartilhada.
  let capviewEventAutoSyncTimer = null;
  let capviewEventAutoSyncInFlight = false;
  let capviewEventAutoSyncDirty = false;

  const eventAutoSyncAvailable = () => !!(
    capviewEventMode.enabled &&
    capviewEventMode.autoSyncEnabled !== false &&
    capviewDataDirHandle &&
    capviewEventsDirHandle &&
    capviewSnapshotFileHandle
  );

  const stopEventAutoSync = () => {
    if (capviewEventAutoSyncTimer) clearInterval(capviewEventAutoSyncTimer);
    capviewEventAutoSyncTimer = null;
    capviewEventMode.autoSyncRunning = false;
    persistEventFolderMeta();
  };

  const eventAutoSyncTick = async (reason='timer') => {
    if (!eventAutoSyncAvailable()) return 0;
    if (document.hidden && reason === 'timer') return 0;
    if (capviewEventAutoSyncInFlight) { capviewEventAutoSyncDirty = true; return 0; }
    capviewEventAutoSyncInFlight = true;
    capviewEventMode.autoSyncRunning = true;
    capviewEventMode.autoSyncLastTickAt = new Date().toISOString();
    capviewEventMode.autoSyncError = '';
    persistEventFolderMeta();
    try {
      const count = await syncEventsFromFolder({ silent:true, source:'autosync' });
      if (count > 0) toast('Eventos sincronizados automaticamente: ' + count);
      return count;
    } catch (e) {
      capviewEventMode.autoSyncError = e?.message || 'Falha no autosync de eventos.';
      setEventModeStatus('Autosync eventos: ' + capviewEventMode.autoSyncError);
      return 0;
    } finally {
      capviewEventAutoSyncInFlight = false;
      capviewEventMode.autoSyncRunning = false;
      persistEventFolderMeta();
      if (capviewEventAutoSyncDirty) {
        capviewEventAutoSyncDirty = false;
        setTimeout(() => eventAutoSyncTick('dirty'), 250);
      }
    }
  };

  // V5.8.1 — Proteção de edição ativa.
  // Quando o autosync recebe eventos enquanto o usuário está digitando, o app
  // atualiza o estado em memória, mas adia o render() para não apagar campos
  // ainda não salvos no formulário aberto.
  let capviewDeferredRenderPending = false;
  let capviewDeferredRenderReason = '';
  let capviewDeferredRenderToastAt = 0;

  const isEditableElement = (node) => {
    if (!node) return false;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    try { if (node.isContentEditable) return true; } catch {}
    return false;
  };

  const hasOpenEditingDialog = () => {
      const editingDialogIds = new Set(['demandEditModal','demandReprogramModal','demandStagesModal','resourceEditModal','heModal','userModal']);
  };

  const isUserEditingNow = () => {
    const active = document.activeElement;
    if (isEditableElement(active)) return true;
    if (hasOpenEditingDialog()) return true;
    return false;
  };

  const requestRenderSafely = (reason='autosync') => {
    if (isUserEditingNow()) {
      capviewDeferredRenderPending = true;
      capviewDeferredRenderReason = reason;
      const now = Date.now();
      if (now - capviewDeferredRenderToastAt > 12000) {
        capviewDeferredRenderToastAt = now;
        toast('Atualização recebida. A tela será atualizada ao finalizar a edição.');
      }
      setEventModeStatus('Atualização recebida, render adiado para preservar campos em edição.');
      return false;
    }
    capviewDeferredRenderPending = false;
    capviewDeferredRenderReason = '';
    render();
    return true;
  };

  const flushDeferredRenderIfSafe = () => {
    if (!capviewDeferredRenderPending) return false;
    if (isUserEditingNow()) return false;
    capviewDeferredRenderPending = false;
    const reason = capviewDeferredRenderReason || 'autosync';
    capviewDeferredRenderReason = '';
    render();
    toast('Tela atualizada com eventos recebidos.');
    try { console.log('[CapView Eventos] Render adiado aplicado:', reason); } catch {}
    return true;
  };

  document.addEventListener('focusout', () => setTimeout(flushDeferredRenderIfSafe, 200), true);
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const txt = String(t?.textContent || '').toLowerCase();
    const action = String(t?.getAttribute?.('data-action') || '').toLowerCase();
    if (/salvar|cancelar|fechar/.test(txt) || /save|cancel|close/.test(action)) {
      setTimeout(flushDeferredRenderIfSafe, 450);
    }
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Tab' || ev.key === 'Enter') setTimeout(flushDeferredRenderIfSafe, 450);
  }, true);
  setInterval(flushDeferredRenderIfSafe, 2500);

  const startEventAutoSync = () => {
    stopEventAutoSync();
    if (!eventAutoSyncAvailable()) return false;
    const ms = Math.max(3000, Number(capviewEventMode.autoSyncMs || 4000));
    capviewEventAutoSyncTimer = setInterval(() => eventAutoSyncTick('timer'), ms);
    setEventModeStatus('Autosync de eventos ligado a cada ' + Math.round(ms/1000) + 's.');
    setTimeout(() => eventAutoSyncTick('start'), 150);
    return true;
  };

  const toggleEventAutoSync = () => {
    capviewEventMode.autoSyncEnabled = capviewEventMode.autoSyncEnabled === false;
    persistEventFolderMeta();
    if (capviewEventMode.autoSyncEnabled) {
      if (startEventAutoSync()) toast('Autosync de eventos ligado.');
      else toast('Autosync ligado, mas selecione a pasta CapViewData para iniciar.');
    } else {
      stopEventAutoSync();
      setEventModeStatus('Autosync de eventos desligado.');
      toast('Autosync de eventos desligado.');
    }
    render();
  };

  // V5.5 — marcador global de status do autosync.
  function markDbSync(msg) {
    try {
      dbLastSyncLabel = `${new Date().toLocaleTimeString('pt-BR')} • ${String(msg || '')}`;
      console.log('[CapView DB Sync]', msg || '');
    } catch (e) {
      console.warn('[CapView DB Sync] Falha ao atualizar status:', e);
    }
  }


  // V5.4.5 — Fila operacional local para autosync sem backend.
  // O navegador/File System Access API não entrega lock atômico entre usuários,
  // então a proteção realista é: registrar alteração local como pendente, reler
  // o JSON compartilhado, rebater a alteração local em cima da versão mais nova,
  // reler novamente antes de gravar e repetir em caso de corrida.
  const DB_OP_QUEUE_KEY = 'capview_db_operation_queue_v2';
  const DB_OP_QUEUE_MAX = 25;
  let dbOperationQueue = [];

  const loadDbOperationQueue = () => {
    try {
      const raw = localStorage.getItem(DB_OP_QUEUE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-DB_OP_QUEUE_MAX) : [];
    } catch { return []; }
  };

  const persistDbOperationQueue = () => {
    try {
      const payload = JSON.stringify(dbOperationQueue.slice(-DB_OP_QUEUE_MAX));
      if (payload.length > LOCAL_STORAGE_LIMIT_HINT_BYTES) throw new DOMException('Fila grande demais para localStorage', 'QuotaExceededError');
      localStorage.setItem(DB_OP_QUEUE_KEY, payload);
    } catch (e) {
      // Em BD grande, não insistimos em persistir snapshots enormes na fila local.
      // A fila em memória continua válida durante a sessão e evita travar a UI/carregamento.
      try { localStorage.removeItem(DB_OP_QUEUE_KEY); } catch {}
      console.warn('[CapView Queue] Fila grande demais para localStorage. Mantida apenas em memória nesta sessão.', e);
    }
  };

  const clearDbOperationQueue = () => {
    dbOperationQueue = [];
    try { localStorage.removeItem(DB_OP_QUEUE_KEY); } catch {}
  };

  const enqueueDbOperation = (reason='change') => {
    try {
      const snapshot = normalizeImportedState(buildDbExportObject());
      dbOperationQueue = loadDbOperationQueue();
      dbOperationQueue.push({
        id: `${Date.now()}_${uid()}`,
        reason: String(reason || 'change'),
        queuedAt: new Date().toISOString(),
        baselineHash: String(dbBinding?.baselineHash || ''),
        snapshot
      });
      dbOperationQueue = dbOperationQueue.slice(-DB_OP_QUEUE_MAX);
      persistDbOperationQueue();
      markDbSync(`aguardando para salvar (${dbOperationQueue.length})`);
      return true;
    } catch (e) {
      console.warn('[CapView Queue] Falha ao enfileirar operação. UI liberada; persistência local mantida.', e);
      markDbSync('fila local indisponível; dados mantidos localmente');
      return false;
    }
  };

  const getQueuedLocalSnapshot = () => {
    dbOperationQueue = loadDbOperationQueue();
    if (dbOperationQueue.length) {
      const last = dbOperationQueue[dbOperationQueue.length - 1];
      if (last && last.snapshot) return normalizeImportedState(last.snapshot);
    }
    return normalizeImportedState(buildDbExportObject());
  };

  const pauseDbAutoSync = (reason='pausado', message='Autosync pausado. Ligue novamente para mesclar com o BD mais atual.') => {
    dbAutoSyncEnabled = false;
    dbAutoSyncPauseReason = String(reason || 'pausado');
    localStorage.setItem('capview_db_autosync_enabled', '0');
    localStorage.setItem('capview_db_autosync_pause_reason', dbAutoSyncPauseReason);
    stopDbWatcher();
    dbAutoSavePending = false;
    dbAutoSaveDirtySince = 0;
    try { markDbSync(`autosync pausado: ${dbAutoSyncPauseReason}`); } catch {}
    toast(message);
    render();
  };

  const clearDbAutoSyncPause = () => {
    dbAutoSyncPauseReason = '';
    localStorage.removeItem('capview_db_autosync_pause_reason');
  };

  const LOCAL_LIGHT_STATE_KEY = 'capview_lightweight_state_v1';
  const LOCAL_STORAGE_LIMIT_HINT_BYTES = 4200000;

  const buildLightweightLocalState = () => ({
    schemaVersion: APP_SCHEMA_VERSION,
    meta: {
      lightweight: true,
      savedAt: new Date().toISOString(),
      reason: 'BD grande mantido no JSON/BD selecionado, sem duplicar no localStorage.',
      counts: {
        resources: Array.isArray(state.resources) ? state.resources.length : 0,
        demands: Array.isArray(state.demands) ? state.demands.length : 0,
        blockings: Array.isArray(state.blockings) ? state.blockings.length : 0,
        holidays: Array.isArray(state.holidays) ? state.holidays.length : 0,
        reprogrammings: Array.isArray(state.reprogrammings) ? state.reprogrammings.length : 0,
        overtimes: Array.isArray(state.overtimes) ? state.overtimes.length : 0,
        events: Array.isArray(state.events) ? state.events.length : 0,
      }
    },
    resources: [],
    demands: [],
    blockings: [],
    holidays: [],
    reprogrammings: [],
    overtimes: [],
    events: []
  });

  const persistStateLocallySafe = () => {
    try {
      const payload = JSON.stringify(state);
      // Evita bater na cota típica do localStorage em bases grandes.
      if (payload.length > LOCAL_STORAGE_LIMIT_HINT_BYTES) throw new DOMException('Estado local muito grande para localStorage', 'QuotaExceededError');
      localStorage.setItem(STORAGE_KEY, payload);
      localStorage.removeItem(LOCAL_LIGHT_STATE_KEY);
      return true;
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      try { localStorage.setItem(LOCAL_LIGHT_STATE_KEY, JSON.stringify(buildLightweightLocalState())); } catch {}
      console.warn('[CapView Storage] Estado grande demais para localStorage. O BD será mantido no JSON selecionado e em memória durante a sessão.', e);
      return false;
    }
  };

  const persist = (opts={}) => {
    // A gravação local nunca pode ser bloqueada pela camada de autosync.
    persistStateLocallySafe();
    if (capviewEventMode.enabled && !opts.skipAutoSave && !sharedFolderReady()) {
      setEventModeStatus('Modo Eventos ligado, mas a pasta CapViewData ainda não foi selecionada nesta sessão. Eventos ficam no outbox local.');
    }
    if (!capviewEventMode.enabled && !suppressDbAutoSave && !opts.skipAutoSave && dbAutoSyncEnabled && hasDbBinding && hasDbBinding() && dbBinding.mode === 'rw' && dbFileHandle) {
      dbAutoSaveDirtySince = Date.now();
      dbAutoSavePending = true;
      try { enqueueDbOperation('persist'); }
      catch (e) { console.warn('[CapView Persist] enqueue falhou sem bloquear a UI:', e); }
      try { scheduleDbAutoSave('persist'); }
      catch (e) { console.warn('[CapView Persist] schedule autosave falhou sem bloquear a UI:', e); }
    }
  };

  let scheduleDbAutoSave = (_reason='') => {};

  const updateAvatar = () => {
    const av = qs('#avatar');
    const inp = qs('#userName');
    if (!av || !inp) return;
    document.body.classList.toggle('need-user', !userName);
    av.setAttribute('role','button');
    av.tabIndex = 0;
    inp.value = userName || '';
    if (!userName) {
      av.textContent = '!';
      av.classList.add('warn');
      av.setAttribute('aria-label','Defina o usuário');
      av.title = 'Clique para definir o usuário';
    } else {
      av.textContent = userName.slice(0,1).toUpperCase();
      av.classList.remove('warn');
      av.title = userId ? `ID: ${userId}` : '';
    }
  };

  const setUser = (name) => {
    const u = ensureUserIdentity(name);
    userName = u.displayName;
    userId = u.userId;
    updateAvatar();
  };

  // ----------------------
  // Guard: require user identity for any action that creates/edits data
  const hasUser = () => !!(userName && userId);

  const openUserModal = (force=false) => {
    const dlg = qs('#userModal');
    if (!dlg) return;
    const nameInput = qs('#userModalName');
    const idInput = qs('#userModalId');
    const currentName = userName || (qs('#userName')?.value || '');
    if (nameInput) nameInput.value = currentName;
    const nm = String(currentName||'').trim();
    if (nm) {
      const u = previewUserIdentity(nm);
      if (idInput) idInput.value = u.userId;
    } else {
      if (idInput) idInput.value = userId || '';
    }
    dlg.dataset.force = force ? '1' : '0';
    const must = (dlg.dataset.force === '1') && !hasUser();
    const btnClose = qs('#userModalClose');
    const btnCancel = qs('#userModalCancel');
    if (btnClose) { btnClose.disabled = must; btnClose.style.opacity = must ? '.45' : ''; }
    if (btnCancel) { btnCancel.disabled = must; btnCancel.style.opacity = must ? '.45' : ''; }
    document.body.classList.add('user-modal-open');
    openDialog(dlg);
  };

  // V5.4.6 — guard não-bloqueante para CRUD local.
  // A fila/autosync não pode impedir o usuário de criar/editar dados.
  // Se a identidade não estiver definida em uma segunda instância/navegador,
  // criamos uma identidade técnica local e mantemos o aviso para o usuário
  // informar o nome depois. Isso evita o sintoma de botão/ação parecer
  // "travado" enquanto preserva autoria mínima nos IDs/metadados.
  const ensureNonBlockingUser = () => {
    if (hasUser()) return true;
    const suffix = (safeUUID() || uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
    userName = 'Sessão local';
    userId = `sessao-local__${suffix}`;
    persistUserIdentity({ displayName:userName, userId });
    updateAvatar();
    return true;
  };

  const requireUser = (reason='', opts={}) => {
    if (hasUser()) return true;
    if (opts && opts.blocking === true) {
      toast(reason || 'Defina seu usuário para registrar autoria e evitar conflitos.');
      openUserModal(true);
      return false;
    }
    ensureNonBlockingUser();
    toast('Identidade técnica criada para não bloquear a edição. Depois, clique no avatar e informe seu nome.');
    return true;
  };

  const requiresUserByType = (type) => {
    const t = String(type||'');
    return [
      'ADD_DEMAND','UPDATE_DEMAND','EDIT_DEMAND','DELETE_DEMAND',
      'REPROGRAM_DEMAND',
      'ADD_RESOURCE','UPDATE_RESOURCE','EDIT_RESOURCE','DELETE_RESOURCE',
      'ADD_BLOCKING','DELETE_BLOCKING',
      'ADD_HOLIDAY','DELETE_HOLIDAY',
      'ADD_OVERTIME','DELETE_OVERTIME',
      'IMPORT_ADD','IMPORT_REPLACE'
    ].includes(t);
  };

  const requiresBlockingUserByType = (type) => {
    const t = String(type||'');
    return ['CLEAR_ALL'].includes(t);
  };



  const dispatch = (type, payload) => {
    if (requiresUserByType(type) && !requireUser('Defina seu usuário para registrar autoria e evitar conflitos.', { blocking: requiresBlockingUserByType(type) })) return;
    let eventPayload = payload;

    switch (type) {
      case 'ADD_RESOURCE': {
        const stamped = applyCreateMeta(payload);
        state.resources.unshift(stamped);
        eventPayload = stamped;
        break;
      }
      case 'UPDATE_RESOURCE': {
        const prev = (state.resources||[]).find(r => r.id === payload.id);
        const stamped = applyUpdateMeta(payload, prev);
        state.resources = state.resources.map(r => r.id === stamped.id ? stamped : r);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_RESOURCE':
        state.resources = state.resources.filter(r => r.id !== payload);
        break;
      case 'ADD_DEMAND': {
        const stamped = applyCreateMeta(payload);
        state.demands.unshift(stamped);
        eventPayload = stamped;
        break;
      }
      case 'UPDATE_DEMAND': {
        const prev = (state.demands||[]).find(d => d.id === payload.id);
        const stamped = applyUpdateMeta(payload, prev);
        state.demands = state.demands.map(d => d.id === stamped.id ? stamped : d);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_DEMAND':
        state.demands = (state.demands||[]).filter(d => String(d.id) !== String(payload));
        break;
      case 'REPROGRAM_DEMAND': {
        const rp = applyCreateMeta(payload.reprogramming || {});
        state.reprogrammings.push(rp);
        state.demands = state.demands.map(d => {
          if (d.id !== payload.demandId) return d;
          const novoInicio = rp.novo_inicio || d.data_inicio || '';
          const novoFim = rp.novo_fim || rp.novo_prazo || d.data_fim || '';
          return applyUpdateMeta({ ...d, data_inicio: novoInicio, data_fim: novoFim, reprogramacoes: (d.reprogramacoes||0) + 1 }, d);
        });
        eventPayload = { ...payload, reprogramming: rp };
        break;
      }
      case 'ADD_BLOCKING': {
        const stamped = applyCreateMeta(payload);
        state.blockings.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_BLOCKING':
        state.blockings = state.blockings.filter(b => b.id !== payload);
        break;
      case 'ADD_HOLIDAY': {
        const stamped = applyCreateMeta(payload);
        state.holidays.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_HOLIDAY':
        state.holidays = state.holidays.filter(h => h.id !== payload);
        break;
      case 'ADD_OVERTIME': {
        const stamped = applyCreateMeta(payload);
        state.overtimes.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_OVERTIME': {
        const id = (payload && typeof payload==='object') ? payload.id : payload;
        state.overtimes = state.overtimes.filter(o => String(o.id) !== String(id));
        break;
      }
      case 'IMPORT_SNAPSHOT':
        state = { ...payload, events: state.events };
        break;
      default:
        break;
    }

    const event = { id: generateId('event'), type, payload: eventPayload, timestamp: Date.now(), user: userName, user_id: userId || '' };
    state.events = [...state.events, event];

    // Em modo eventos, nunca dependa de gravação direta no snapshot.
    // O evento é salvo no outbox local primeiro e depois enviado para /events/usuario.json.
    try {
      if (capviewEventMode.enabled) rememberLocalEventForSharedFile(event);
      recordSharedEvent(event);
    } catch(e) {
      console.warn('[CapView Eventos] Registro assíncrono não iniciado:', e);
      if (capviewEventMode.enabled) setEventModeStatus('Evento mantido no outbox local. Selecione a pasta CapViewData para gravar em /events.');
    }

    persist();
    render();
  };

  const importEvents = (newEvents) => {
    const existing = new Set((state.events||[]).map(e => e.id));
    const filtered = (newEvents||[]).filter(e => e && e.id && !existing.has(e.id));
    const combined = [...(state.events||[]), ...filtered].sort((a,b) => (a.timestamp||0)-(b.timestamp||0));

    const rebuilt = defaultState();
    rebuilt.events = combined;

    for (const event of combined) {
      const { type, payload } = event;
      switch (type) {
        case 'ADD_RESOURCE': rebuilt.resources.push(payload); break;
        case 'UPDATE_RESOURCE': rebuilt.resources = rebuilt.resources.map(r => r.id === payload.id ? payload : r); break;
        case 'DELETE_RESOURCE': rebuilt.resources = rebuilt.resources.filter(r => r.id !== payload); break;
        case 'ADD_DEMAND': rebuilt.demands.push(payload); break;
        case 'UPDATE_DEMAND': rebuilt.demands = rebuilt.demands.map(d => d.id === payload.id ? payload : d); break;
        case 'DELETE_DEMAND': rebuilt.demands = rebuilt.demands.filter(d => String(d.id) !== String(payload)); break;
        case 'REPROGRAM_DEMAND':
          rebuilt.reprogrammings.push(payload.reprogramming);
          rebuilt.demands = rebuilt.demands.map(d => {
            if (d.id !== payload.demandId) return d;
            const novoInicio = payload.reprogramming.novo_inicio || d.data_inicio || '';
            const novoFim = payload.reprogramming.novo_fim || payload.reprogramming.novo_prazo || d.data_fim || '';
            return { ...d, data_inicio: novoInicio, data_fim: novoFim, reprogramacoes: (d.reprogramacoes||0) + 1 };
          });
          break;
        case 'ADD_BLOCKING': rebuilt.blockings.push(payload); break;
        case 'DELETE_BLOCKING': rebuilt.blockings = rebuilt.blockings.filter(b => b.id !== payload); break;
        case 'ADD_HOLIDAY': rebuilt.holidays.push(payload); break;
        case 'DELETE_HOLIDAY': rebuilt.holidays = rebuilt.holidays.filter(h => h.id !== payload); break;
        case 'ADD_OVERTIME': rebuilt.overtimes.push(payload); break;
        case 'DELETE_OVERTIME': { const id = (payload && typeof payload==='object') ? payload.id : payload; rebuilt.overtimes = rebuilt.overtimes.filter(o => String(o.id) !== String(id)); break; }
        default: break;
      }
    }

    state = rebuilt;
    persist();
    render();
  };


  // ----------------------
  // V5.5.1 — Eventos por usuário em pasta compartilhada
  // ----------------------
  const eventSafeName = () => {
    const base = String(userId || userName || 'sessao-local').trim() || 'sessao-local';
    return base.replace(/[^a-z0-9_.-]+/gi,'_').slice(0,80) || 'sessao-local';
  };

  const ensureEventUser = () => {
    if (!hasUser()) ensureNonBlockingUser();
    return true;
  };

  const fileTextOrDefault = async (handle, fallback='') => {
    try { const file = await handle.getFile(); const txt = await file.text(); return String(txt || fallback || ''); }
    catch { return String(fallback || ''); }
  };

  const writeTextToFileHandle = async (handle, text) => {
    const writable = await handle.createWritable();
    await writable.write(String(text || ''));
    await writable.close();
  };
  const writeJsonToFileHandle = async (handle, obj) => writeTextToFileHandle(handle, JSON.stringify(obj, null, 2));

  const ensureEventFolderReady = async ({ createSnapshotIfMissing=true } = {}) => {
    if (!capviewDataDirHandle || !capviewEventsDirHandle || !capviewSnapshotFileHandle) throw new Error('Selecione a pasta CapViewData primeiro.');
    if (createSnapshotIfMissing) {
      const txt = await fileTextOrDefault(capviewSnapshotFileHandle, '');
      if (!String(txt||'').trim()) await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(buildDbExportObject()));
    }
    return true;
  };

  const ensureUserEventFileInitialized = async () => {
    ensureEventUser();
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const handle = await capviewEventsDirHandle.getFileHandle(eventSafeName() + '.json', { create:true });
    const txt = await fileTextOrDefault(handle, '');
    if (!String(txt || '').trim()) await writeJsonToFileHandle(handle, []);
    return handle;
  };

  const selectCapViewDataFolder = async () => {
    try {
      if (!window.showDirectoryPicker) { toast('Seu navegador não permite selecionar pasta. Use Edge/Chrome atualizado.'); return false; }
      ensureEventUser();
      const dir = await window.showDirectoryPicker({ mode:'readwrite' });
      if (!dir) return false;
      capviewDataDirHandle = dir;
      capviewEventsDirHandle = await dir.getDirectoryHandle('events', { create:true });
      capviewSnapshotFileHandle = await dir.getFileHandle('snapshot.json', { create:true });
      capviewEventMode.enabled = true;
      capviewEventMode.folderName = dir.name || 'CapViewData';
      capviewEventMode.lastStatus = 'Pasta vinculada. Alterações serão registradas em /events por usuário.';
      persistEventFolderMeta();
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await ensureUserEventFileInitialized();
      try { stopDbWatcher(); } catch {}
      dbAutoSyncEnabled = false;
      localStorage.setItem('capview_db_autosync_enabled', '0');
      const flushed = await flushLocalEventOutbox();
      toast('Pasta CapViewData vinculada. Modo Eventos ligado.' + (flushed ? ' Outbox enviado: ' + flushed + ' evento(s).' : ''));
      await syncEventsFromFolder({ silent:true });
      if (capviewEventMode.autoSyncEnabled !== false) startEventAutoSync();
      render();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.error('[CapView Eventos] Falha ao selecionar pasta:', e);
      toast('Falha ao selecionar pasta de eventos.');
      return false;
    }
  };

  const getMyEventFileHandle = async () => ensureUserEventFileInitialized();

  const readEventArrayFromHandle = async (handle) => {
    const txt = await fileTextOrDefault(handle, '[]');
    if (!String(txt||'').trim()) return [];
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) return parsed.filter(e => e && e.id);
      if (parsed && Array.isArray(parsed.events)) return parsed.events.filter(e => e && e.id);
    } catch (e) { console.warn('[CapView Eventos] Arquivo de eventos inválido:', handle?.name, e); }
    return [];
  };

  const writeSingleEventToUserFile = async (event) => {
    const handle = await getMyEventFileHandle();
    const arr = await readEventArrayFromHandle(handle);
    if (!arr.some(e => String(e.id) === String(event.id))) {
      arr.push({ ...event, status:'pending', sourceFile:eventSafeName() + '.json' });
      arr.sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));
      await writeJsonToFileHandle(handle, arr);
    }
    // Verificação pós-gravação: evita falso positivo se o navegador negar escrita.
    const check = await readEventArrayFromHandle(handle);
    if (!check.some(e => String(e.id) === String(event.id))) throw new Error('Evento não confirmado no arquivo do usuário.');
    return true;
  };

  const flushLocalEventOutbox = async () => {
    if (!capviewEventMode.enabled || !sharedFolderReady()) return 0;
    if (capviewEventWriteInFlight) return 0;
    capviewEventWriteInFlight = true;
    const outbox = loadLocalEventOutbox();
    const writtenIds = [];
    try {
      for (const ev of outbox) {
        await writeSingleEventToUserFile(ev);
        writtenIds.push(String(ev.id));
      }
      if (writtenIds.length) {
        forgetLocalEventsFromOutbox(writtenIds);
        capviewEventMode.lastWriteAt = new Date().toISOString();
        setEventModeStatus('Outbox enviado para /events/' + eventSafeName() + '.json: ' + writtenIds.length + ' evento(s).');
      }
      return writtenIds.length;
    } catch (e) {
      console.warn('[CapView Eventos] Falha ao enviar outbox:', e);
      setEventModeStatus('Falha ao enviar outbox: ' + (e?.message || 'erro desconhecido'));
      return writtenIds.length;
    } finally {
      capviewEventWriteInFlight = false;
    }
  };

  const recordSharedEvent = async (event) => {
    if (!capviewEventMode.enabled) return false;
    if (!event || !event.id) return false;
    rememberLocalEventForSharedFile(event);

    if (!sharedFolderReady()) {
      setEventModeStatus('Evento guardado no outbox local. Selecione a pasta CapViewData para criar /events/' + eventSafeName() + '.json.');
      return false;
    }

    const flushed = await flushLocalEventOutbox();
    if (flushed > 0 && capviewEventMode.autoSyncEnabled !== false) setTimeout(() => eventAutoSyncTick('local-write'), 250);
    return flushed > 0;
  };

  const readSnapshotFromEventFolder = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const txt = await fileTextOrDefault(capviewSnapshotFileHandle, '{}');
    try { return normalizeImportedState(JSON.parse(txt || '{}')); }
    catch { return defaultState(); }
  };

  const readAllSharedEvents = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const all = [];
    try {
      for await (const [name, handle] of capviewEventsDirHandle.entries()) {
        if (!handle || handle.kind !== 'file') continue;
        if (!String(name||'').toLowerCase().endsWith('.json')) continue;
        const arr = await readEventArrayFromHandle(handle);
        for (const ev of arr) all.push({ ...ev, sourceFile: ev.sourceFile || name });
      }
    } catch (e) { console.warn('[CapView Eventos] Falha ao ler diretório de eventos:', e); }
    const seen = new Set();
    return all.filter(e => e && e.id && !seen.has(String(e.id)) && seen.add(String(e.id))).sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));
  };

  const applySingleEventToState = (target, event) => {
    if (!target || !event) return target;
    const type = event.type, payload = event.payload;
    const upsert = (arr, item) => {
      if (!item || !item.id) return Array.isArray(arr) ? arr : [];
      const base = Array.isArray(arr) ? arr : [];
      return base.some(x => String(x.id) === String(item.id)) ? base.map(x => String(x.id) === String(item.id) ? item : x) : [...base, item];
    };
    switch (type) {
      case 'ADD_RESOURCE': case 'UPDATE_RESOURCE': target.resources = upsert(target.resources, payload); break;
      case 'DELETE_RESOURCE': target.resources = (target.resources||[]).filter(r => String(r.id) !== String(payload)); break;
      case 'ADD_DEMAND': case 'UPDATE_DEMAND': target.demands = upsert(target.demands, payload); break;
      case 'DELETE_DEMAND': target.demands = (target.demands||[]).filter(d => String(d.id) !== String(payload)); break;
      case 'REPROGRAM_DEMAND': {
        if (payload?.reprogramming) target.reprogrammings = upsert(target.reprogrammings, payload.reprogramming);
        target.demands = (target.demands||[]).map(d => {
          if (String(d.id) !== String(payload?.demandId)) return d;
          const rp = payload.reprogramming || {};
          return { ...d, data_inicio: rp.novo_inicio || d.data_inicio || '', data_fim: rp.novo_fim || rp.novo_prazo || d.data_fim || '', reprogramacoes: (d.reprogramacoes||0) + 1 };
        });
        break;
      }
      case 'ADD_BLOCKING': target.blockings = upsert(target.blockings, payload); break;
      case 'DELETE_BLOCKING': target.blockings = (target.blockings||[]).filter(b => String(b.id) !== String(payload)); break;
      case 'ADD_HOLIDAY': target.holidays = upsert(target.holidays, payload); break;
      case 'DELETE_HOLIDAY': target.holidays = (target.holidays||[]).filter(h => String(h.id) !== String(payload)); break;
      case 'ADD_OVERTIME': target.overtimes = upsert(target.overtimes, payload); break;
      case 'DELETE_OVERTIME': { const id = (payload && typeof payload==='object') ? payload.id : payload; target.overtimes = (target.overtimes||[]).filter(o => String(o.id) !== String(id)); break; }
      default: break;
    }
    if (!Array.isArray(target.events)) target.events = [];
    if (!target.events.some(e => String(e.id) === String(event.id))) target.events.push(event);
    return target;
  };

  const buildStateFromSnapshotAndEvents = (snapshot, events) => {
    const merged = normalizeImportedState(deepClone(snapshot || defaultState()));

    // FIX V6.0.4 — Feriados são base de calendário, não apenas eventos.
    // Quando o snapshot.json da pasta ainda não tem holidays, o sync de eventos
    // não pode reconstruir o estado zerando os feriados cadastrados/localmente.
    // Por isso, antes de aplicar eventos, mescla os feriados do snapshot com os
    // feriados já existentes na sessão/localStorage. Eventos DELETE_HOLIDAY
    // continuam respeitados logo abaixo, porque são aplicados depois desta união.
    try {
      const localHolidays = Array.isArray(state?.holidays) ? state.holidays : [];
      merged.holidays = mergeHolidaysNonDestructive(merged.holidays, localHolidays);
    } catch (e) {
      console.warn('[CapView Feriados] Falha ao preservar feriados locais durante sync de eventos:', e);
    }

    // Eventos já incorporados no snapshot consolidado. Esses não precisam ser
    // reaplicados na tela.
    const snapshotEventIds = new Set((merged.events||[]).map(e => String(e.id)));

    // Eventos ainda não consolidados no snapshot. Eles precisam ser reaplicados
    // a cada leitura para montar a visão atual, mas não devem gerar toast em loop.
    const pending = (events||[])
      .filter(e => e && e.id && !snapshotEventIds.has(String(e.id)))
      .sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));

    const appliedIds = loadAppliedEventIds();
    const newPending = pending.filter(e => !appliedIds.has(String(e.id)));

    for (const ev of pending) applySingleEventToState(merged, ev);

    // Marca como visto depois de montar a tela. Assim o próximo autosync pode
    // reconstruir a visão, mas não mostra novamente "evento recebido".
    markAppliedEvents(pending);

    merged.meta = {
      ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
      eventModeMergedAt: new Date().toISOString(),
      eventModePendingApplied: pending.length,
      eventModeNewPendingApplied: newPending.length
    };
    return { merged, pending, newPending };
  };

  const syncEventsFromFolder = async ({ silent=false, source='manual' } = {}) => {
    try {
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await flushLocalEventOutbox();
      const snapshot = await readSnapshotFromEventFolder();
      const sharedEvents = await readAllSharedEvents();
      const events = mergeEventListsUnique(sharedEvents, state.events || [], loadLocalEventOutbox());
      const { merged, pending, newPending } = buildStateFromSnapshotAndEvents(snapshot, events);
      state = normalizeImportedState(merged);
      capviewEventMode.lastReadAt = new Date().toISOString();
      capviewEventMode.pendingReadCount = newPending.length;
      const pendingUsers = [...new Set(newPending.map(e => e.user || e.user_id || e.sourceFile || 'usuário').filter(Boolean))].slice(0,3);
      setEventModeStatus((source === 'autosync' ? 'Autosync: ' : '') + newPending.length + ' evento(s) novo(s); ' + pending.length + ' pendente(s) aplicado(s) sobre o snapshot' + (pendingUsers.length ? ' • recebido de: ' + pendingUsers.join(', ') : '') + '.');
      const prevSuppress = suppressDbAutoSave;
      suppressDbAutoSave = true;
      try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
      if (!silent) toast(newPending.length + ' evento(s) novo(s); ' + pending.length + ' pendente(s) aplicado(s).');
      else if (newPending.length > 0 && source === 'autosync') toast('Evento recebido: ' + pendingUsers.join(', '));
      if (!silent || newPending.length > 0 || source !== 'autosync') requestRenderSafely(source === 'autosync' ? 'autosync-eventos' : 'sync-eventos');
      return newPending.length;
    } catch (e) {
      console.error('[CapView Eventos] Falha ao sincronizar:', e);
      if (!silent) toast(e?.message || 'Falha ao ler eventos da pasta.');
      return 0;
    }
  };

  const consolidateEventsToSnapshot = async () => {
    try {
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await flushLocalEventOutbox();
      const snapshot = await readSnapshotFromEventFolder();
      const sharedEvents = await readAllSharedEvents();
      const events = mergeEventListsUnique(sharedEvents, state.events || [], loadLocalEventOutbox());
      const { merged, pending } = buildStateFromSnapshotAndEvents(snapshot, events);
      markAppliedEvents(merged.events || []);
      merged.meta = { ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}), consolidatedAt: new Date().toISOString(), consolidatedBy: userName || '', consolidatedById: userId || '', consolidatedEventCount: (merged.events||[]).length };
      await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(merged));
      state = normalizeImportedState(merged);
      capviewEventMode.lastReadAt = new Date().toISOString();
      capviewEventMode.pendingReadCount = 0;
      setEventModeStatus('Snapshot consolidado com ' + pending.length + ' evento(s) novo(s).');
      const prevSuppress = suppressDbAutoSave;
      suppressDbAutoSave = true;
      try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
      toast('Snapshot consolidado. ' + pending.length + ' evento(s) novo(s) incorporado(s).');
      render();
      return true;
    } catch (e) {
      console.error('[CapView Eventos] Falha ao consolidar snapshot:', e);
      toast(e?.message || 'Falha ao consolidar eventos no snapshot.');
      return false;
    }
  };

  const disableEventMode = () => {
    stopEventAutoSync();
    capviewEventMode.enabled = false;
    capviewEventMode.lastStatus = 'Modo Eventos desligado nesta sessão.';
    persistEventFolderMeta();
    toast('Modo Eventos desligado.');
    render();
  };




  // ----------------------
  // Import snapshot (Adicionar / Mesclar)
  // - Mantém tudo LOCAL (file://)
  // - Não sobrescreve: concatena coleções e resolve colisões de ID
  // - Une resources/holidays de forma não destrutiva (base oficial)
  const mergeSnapshotAdd = (incoming) => {
    if (!incoming || typeof incoming !== 'object') throw new Error('Snapshot inválido.');

    const meta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
    const originName = String(meta.authorName || incoming.userName || '').trim();
    const originUserId = String(meta.authorUserId || incoming.userId || '').trim();
    const origin = (originUserId || (originName ? (slugify(originName)||'import') : 'import'));

    const makeImportedId = (kind) => `${origin}::${kind}::${safeUUID()||uid()}`;

    const mergeUnionById = (target, add, kind) => {
      const arrT = Array.isArray(target) ? target : [];
      const arrA = Array.isArray(add) ? add : [];
      const seen = new Set(arrT.map(x => String(x && x.id)));
      for (const raw of arrA) {
        if (!raw || typeof raw !== 'object') continue;
        const item = { ...raw };
        const id0 = String(item.id || '').trim();
        if (!id0 || seen.has(id0)) item.id = makeImportedId(kind);
        seen.add(String(item.id));
        // carimbo de origem (não quebra builds antigas)
        if (!item.created_by) item.created_by = originName || origin;
        if (!item.created_by_id) item.created_by_id = originUserId || origin;
        arrT.push(item);
      }
      return arrT;
    };

    // Base: resources / holidays -> união não destrutiva
    if (Array.isArray(incoming.resources)) {
      const existing = new Set((state.resources||[]).map(r=>String(r.id)));
      for (const r of incoming.resources) {
        if (!r || !r.id) continue;
        if (!existing.has(String(r.id))) state.resources.push(r);
      }
    }
    if (Array.isArray(incoming.holidays)) {
      const existing = new Set((state.holidays||[]).map(h=>String(h.id||h.data)));
      for (const h of incoming.holidays) {
        if (!h) continue;
        const key = String(h.id||h.data||'');
        if (!key) continue;
        if (!existing.has(key)) state.holidays.push(h);
      }
    }

    // Propostas: concatena + resolve colisões
    state.demands = mergeUnionById(state.demands, incoming.demands, 'demand');
    state.blockings = mergeUnionById(state.blockings, incoming.blockings, 'blocking');
    state.overtimes = mergeUnionById(state.overtimes, incoming.overtimes, 'he');
    state.reprogrammings = mergeUnionById(state.reprogrammings, incoming.reprogrammings, 'reprogram');

    // Events: concatena, mas garante IDs únicos
    const evT = Array.isArray(state.events) ? state.events : [];
    const evA = Array.isArray(incoming.events) ? incoming.events : [];
    const seenEv = new Set(evT.map(e => String(e && e.id)));
    for (const raw of evA) {
      if (!raw || typeof raw !== 'object') continue;
      const e = { ...raw };
      const id0 = String(e.id||'').trim();
      if (!id0 || seenEv.has(id0)) e.id = makeImportedId('event');
      seenEv.add(String(e.id));
      if (!e.user) e.user = originName || origin;
      if (!e.user_id) e.user_id = originUserId || origin;
      evT.push(e);
    }
    state.events = evT;

    persist();
    render();
  };

  // ----------------------
  // Calculations
  // ----------------------
  const resourceById = () => Object.fromEntries(state.resources.map(r => [r.id, r]));

  // ----------------------
  // Capacity Engine v0.1.2
  // ----------------------
  // Núcleo único para regras de capacidade, HE, feriados, bloqueios, férias/OFF e alocação.
  // Mantém wrappers legados abaixo para não alterar chamadas existentes nem visual.
  const CapacityEngine = {
    isHoliday(dateStr) {
      return (state.holidays || []).some(h => h.data === dateStr);
    },

    blockingFor(resourceId, dateStr) {
      return (state.blockings || []).find(b => b.recurso_id === resourceId && b.data === dateStr);
    },

    overtimeInfo(resourceId, dateStr) {
      const list = Array.isArray(state.overtimes) ? state.overtimes : [];
      const items = list.filter(o => {
        const rid = (o.resourceId ?? o.recurso_id ?? '__ALL__');
        const dt = (o.date ?? o.data ?? '');
        if (!dt || dt !== dateStr) return false;
        return rid === '__ALL__' || rid === resourceId;
      }).map(o => ({
        id: o.id,
        horas: Number(o.horas || 0) || 0,
        motivo: (o.motivo || '').trim(),
        titulo: (o.titulo || o.atividade || '').trim(),
        atividade: (o.atividade || o.titulo || '').trim(),
        predio: (o.predio || '').trim(),
        focal: (o.focal || '').trim(),
        prioridade: (o.prioridade || '').trim(),
        observacoes: (o.observacoes || '').trim(),
        resourceId: (o.resourceId ?? o.recurso_id ?? '__ALL__'),
        date: (o.date ?? o.data ?? dateStr),
        createdAt: o.createdAt,
      }));

      const total = items.reduce((s, x) => s + Math.max(0, Number(x.horas || 0)), 0);
      return { total, items };
    },

    fmtHours(h) {
      const v = Math.max(0, Number(h || 0));
      if (!isFinite(v)) return '0';
      return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : v.toFixed(1);
    },

    isThirdPartyOff(resource, dateStr) {
      if (!resource || resource.tipo !== 'Terceiro') return false;
      if (resource.vigencia_inicio && dateStr < resource.vigencia_inicio) return true;
      if (resource.vigencia_fim && dateStr > resource.vigencia_fim) return true;
      return false;
    },

    nonWorkingReasonForDay(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      if (isWeekend(dateObj)) return { code: -5, label: 'FDS' };
      if (this.isHoliday(dateStr)) return { code: -2, label: 'FER' };
      const blk = this.blockingFor(resourceId, dateStr);
      if (blk) {
        if (String(blk.tipo || '').trim().toLowerCase() === 'férias') return { code: -4, label: 'FÉR' };
        return { code: -1, label: 'BLOQ' };
      }
      const res = (state.resources || []).find(r => r.id === resourceId);
      if (this.isThirdPartyOff(res, dateStr)) return { code: -3, label: 'OFF' };
      return null;
    },

    baseCapacityForDay(resourceId, dateObj) {
      const reason = this.nonWorkingReasonForDay(resourceId, dateObj);
      if (reason) return 0;
      return HOURS_PER_DAY;
    },

    dailyCapacityWithOvertime(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const he = this.overtimeInfo(resourceId, dateStr).total;
      const base = this.baseCapacityForDay(resourceId, dateObj);
      return Math.max(0, Number(base || 0)) + Math.max(0, Number(he || 0));
    },

    dailyPercentAllocated(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const reason = this.nonWorkingReasonForDay(resourceId, dateObj);

      // Regra conservadora HE/FDS:
      // HE adiciona capacidade extra, mas NÃO libera demanda normal em dia não útil.
      // Assim, FDS/feriado/bloqueio/férias/OFF com HE aparece como HE azul, sem somar demandas do intervalo.
      if (reason) return reason.code;

      let total = 0;
      for (const dem of (state.demands || [])) {
        if (dem.responsavel_id === resourceId) {
          const st = effectiveStatus(dem);
          if (!STATUS_COUNTS_IN_ALLOCATION.has(st)) continue;
          if (dateStr >= dem.data_inicio && dateStr <= dem.data_fim) {
            total += Number(dem.percentual_diario || 0);
          }
        }
      }
      return total;
    },

    freeHoursInfo(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const otInfo = this.overtimeInfo(resourceId, dateStr);
      const otHours = Math.max(0, Number(otInfo.total || 0));
      const res = (state.resources || []).find(r => r.id === resourceId);
      const blk = this.blockingFor(resourceId, dateStr);
      const isVac = blk && String(blk.tipo || '').trim().toLowerCase() === 'férias';
      const blockedNoHe = isWeekend(dateObj) || this.isHoliday(dateStr) || !!blk || this.isThirdPartyOff(res, dateStr);

      if (blockedNoHe && otHours <= 0) {
        if (isWeekend(dateObj)) return { dateStr, capacity: 0, allocated: 0, free: 0, tag: 'FDS', cls: 'bg-wknd', eligible: false, overtime: otInfo };
        if (this.isHoliday(dateStr)) return { dateStr, capacity: 0, allocated: 0, free: 0, tag: 'FER', cls: 'bg-holiday', eligible: false, overtime: otInfo };
        if (blk) return { dateStr, capacity: 0, allocated: 0, free: 0, tag: isVac ? 'FÉRIAS' : 'BLOQ', cls: isVac ? 'bg-vac' : 'bg-block', eligible: false, overtime: otInfo };
        return { dateStr, capacity: 0, allocated: 0, free: 0, tag: 'OFF', cls: 'bg-off', eligible: false, overtime: otInfo };
      }

      const base = blockedNoHe ? 0 : HOURS_PER_DAY;
      const capacity = Math.max(0, Number(base || 0)) + otHours;
      const perc = this.dailyPercentAllocated(resourceId, dateObj);
      const allocated = Math.max(0, Number(perc || 0)) / 100 * HOURS_PER_DAY;
      const free = capacity - allocated;

      let cls = '';
      if (this.isHoliday(dateStr)) cls = 'bg-holiday';
      else if (isWeekend(dateObj) && otHours > 0) cls = 'bg-he';
      else if (free < 0) cls = 'bg-over';
      else if (free <= capacity * 0.2) cls = 'bg-mid';
      else cls = 'bg-ok';

      const tag = this.isHoliday(dateStr) ? 'FER' :
        ((isWeekend(dateObj) && otHours > 0) ? `HE ${otHours}h` : (perc > 0 ? `-${allocated.toFixed(1)}h` : 'livre'));

      return { dateStr, capacity, allocated, free, tag, cls, eligible: true, overtime: otInfo };
    }
  };

  const isHoliday = (dateStr) => CapacityEngine.isHoliday(dateStr);
  const blockingFor = (resourceId, dateStr) => CapacityEngine.blockingFor(resourceId, dateStr);
  const overtimeInfo = (resourceId, dateStr) => CapacityEngine.overtimeInfo(resourceId, dateStr);
  const fmtHours = (h) => CapacityEngine.fmtHours(h);
  const isThirdPartyOff = (resource, dateStr) => CapacityEngine.isThirdPartyOff(resource, dateStr);
  const nonWorkingReasonForDay = (resourceId, dateObj) => CapacityEngine.nonWorkingReasonForDay(resourceId, dateObj);
  const baseCapacityForDay = (resourceId, dateObj) => CapacityEngine.baseCapacityForDay(resourceId, dateObj);
  const dailyCapacityWithOvertime = (resourceId, dateObj) => CapacityEngine.dailyCapacityWithOvertime(resourceId, dateObj);
  const dailyPercentAllocated = (resourceId, dateObj) => CapacityEngine.dailyPercentAllocated(resourceId, dateObj);


  const kpis = (demandsList = state.demands) => {
    const totalResources = state.resources.length;
    const activeResources = state.resources.filter(r => r.ativo !== false).length;
    const totalDemands = (demandsList||[]).length;
    const openDemands = (demandsList||[]).filter(d => effectiveStatus(d) !== 'Concluída').length;
    return { totalResources, activeResources, totalDemands, openDemands };
  };



  // ----------------------
  // Detalhes por dia (modal)
  // ----------------------
  const demandsForResourceOnDate = (resourceId, dateStr) => {
    return (state.demands||[]).filter(d => {
      if ((d.responsavel_id||'') !== resourceId) return false;
      return dateStr >= d.data_inicio && dateStr <= d.data_fim;
    });
  };

  const openDayDetails = (resourceId, dateObj) => {
    const dateStr = formatDate(dateObj);
    const res = state.resources.find(r => r.id === resourceId);
    const dlg = qs('#dayModal');

    qs('#dayModalTitle').textContent = `${(res && res.nome) ? res.nome : 'Recurso'} — ${formatDateBR(dateStr)}`;

    const weekday = dateObj.toLocaleString('pt-BR', { weekday:'long' });
    const meta = [];
    if (isWeekend(dateObj)) meta.push('fim de semana');
    if (isHoliday(dateStr)) meta.push('feriado');
    const blk = blockingFor(resourceId, dateStr);
    if (blk) meta.push((String(blk.tipo||'').trim().toLowerCase() === 'férias') ? 'férias' : 'bloqueio');
    if (isThirdPartyOff(res, dateStr)) meta.push('fora de vigência');
    qs('#dayModalSub').textContent = `${weekday}${meta.length ? ' • ' + meta.join(' • ') : ''}`;

    const demands = demandsForResourceOnDate(resourceId, dateStr);
    const heInfo = overtimeInfo(resourceId, dateStr);
    const nonWorkingReason = nonWorkingReasonForDay(resourceId, dateObj);

    // Patch conservador HE/FDS no modal:
    // em dia não útil (FDS/feriado/bloqueio/férias/OFF), HE NÃO libera as demandas normais do intervalo.
    // O modal deve refletir a mesma regra do card: mostra apenas HE quando houver HE.
    const visibleDemands = nonWorkingReason ? [] : demands;
    const totalDemands = visibleDemands.length;

    // sempre começa na primeira página ao abrir o modal
    uiPagination.dayModalPage = 1;

    let allocPerc = 0;
    for (const d of visibleDemands) {
      const st = effectiveStatus(d);
      if (!STATUS_COUNTS_IN_ALLOCATION.has(st)) continue;
      allocPerc += Number(d.percentual_diario||0);
    }
    const allocHH = (allocPerc/100) * HOURS_PER_DAY;
    const capFinal = dailyCapacityWithOvertime(resourceId, dateObj);

    const summaryBadges = [];
    if (heInfo.total > 0) {
      summaryBadges.push(el('span', { class:'heBadge' }, [el('span', { class:'sDot' }, []), `HE no dia: +${fmtHours(heInfo.total)}h`]));
    }
    if (!nonWorkingReason) {
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-ok' }), `${totalDemands} demandas`]));
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-mid' }), `${Math.max(0, Math.round(allocPerc))}% alocado (conta)`]));
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-holiday' }), `${allocHH.toFixed(1)}h de ${capFinal.toFixed(1)}h`]));
    } else if (heInfo.total <= 0) {
      const reasonDotClass = nonWorkingReason?.label === 'FER' ? 'bg-holiday' :
        nonWorkingReason?.label === 'FÉR' ? 'bg-vac' :
        nonWorkingReason?.label === 'BLOQ' ? 'bg-block' :
        nonWorkingReason?.label === 'OFF' ? 'bg-off' : 'bg-wknd';
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:`dot ${reasonDotClass}` }), `${nonWorkingReason.label || 'Dia não útil'}`]));
    }

    const summary = el('div', { class:'grid' }, [
      el('div', { class:'row' }, summaryBadges),
      el('div', { class:'tiny muted' }, [
        nonWorkingReason
          ? 'Dia não útil: demandas normais do intervalo não são contabilizadas nem listadas neste card. Quando existir HE, apenas a HE aparece.'
          : 'Obs: para a capacidade do dashboard, só contam status: ',
        !nonWorkingReason ? el('b', {}, ['Em andamento']) : null,
        !nonWorkingReason ? ' e ' : null,
        !nonWorkingReason ? el('b', {}, ['Atrasada']) : null,
        !nonWorkingReason ? '. Concluída/Congelada/Mapeada não contabilizam.' : null
      ].filter(Boolean))
    ]);

    const body = qs('#dayModalBody');

    const renderDayModal = () => {
      body.innerHTML = '';

      // Ação rápida: cadastrar demanda já com recurso e data preenchidos
      body.appendChild(el('div', { class:'row', style:'justify-content:flex-end;margin-bottom:10px' }, [
        button('Cadastrar demanda', 'primary', () => {
          const dateStr2 = dateStr;
          uiFilters.prefillDemand = { responsavel_id: resourceId, data_inicio: dateStr2, data_fim: dateStr2 };
          // opcional: já aplicar filtro por recurso na lista
          uiFilters.demandResourceId = resourceId;
          // levar o usuário direto para o cadastro
          activeTab = 'demands';
          uiFilters.focusDemandsForm = true;
          try { dlg.close(); } catch {}
          render();
        })
      ]));
      body.appendChild(summary);

      body.appendChild(el('div', { class:'hr' }));

      const total = visibleDemands.length;
      const totalPages = Math.max(1, Math.ceil(total / MODAL_DEMANDS_PAGE_SIZE));
      uiPagination.dayModalPage = Math.min(Math.max(1, uiPagination.dayModalPage), totalPages);
      const startIdx = (uiPagination.dayModalPage - 1) * MODAL_DEMANDS_PAGE_SIZE;
      const pageItems = visibleDemands.slice(startIdx, startIdx + MODAL_DEMANDS_PAGE_SIZE);

      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Título']),
        el('th', {}, ['Status']),
        el('th', {}, ['%/dia']),
        el('th', {}, ['Prédio']),
        el('th', {}, ['Focal']),
        el('th', {}, ['Responsável']),
        el('th', {}, ['Período']),
      ])]));
      const tb = el('tbody');
      if (pageItems.length === 0 && heInfo.items.length === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'7', style:'padding:16px;text-align:center;color:var(--muted)' }, [nonWorkingReason ? 'Nenhuma alocação contabilizada neste dia.' : 'Sem demandas nesse dia.'])]));
      } else {
        for (const d of pageItems) {
          const st = effectiveStatus(d);
          const counts = STATUS_COUNTS_IN_ALLOCATION.has(st);
          const tr = el('tr');
          if (st === 'Atrasada') tr.classList.add('overdueRow');
          tr.appendChild(el('td', {}, [
            el('div', { style:'font-weight:950' }, [d.titulo]),
            el('div', { class:'tiny' }, [counts ? 'Conta na alocação' : 'Não conta na alocação'])
          ]));
          tr.appendChild(el('td', {}, [statusPill(d)]));
          tr.appendChild(el('td', {}, [String(d.percentual_diario||0)]));
          tr.appendChild(el('td', {}, [d.predio||'—']));
          tr.appendChild(el('td', {}, [d.focal||'—']));
          tr.appendChild(el('td', {}, [resourceById()[d.responsavel_id]?.nome || '—']));
          tr.appendChild(el('td', { class:'mono tiny' }, [`${formatDateBR(d.data_inicio)} → ${formatDateBR(d.data_fim)}`]));
          tb.appendChild(tr);
        }

        for (const x of heInfo.items) {
          const tituloHe = String(x.titulo || x.atividade || x.motivo || 'Hora extra').trim();
          const trHe = el('tr', { class:'heRow' });
          trHe.appendChild(el('td', {}, [
            el('div', { style:'font-weight:950;color:#1e3a8a' }, [`HE — ${tituloHe}`]),
            el('div', { class:'tiny' }, [x.motivo ? `Motivo: ${x.motivo}` : 'Capacidade extra cadastrada'])
          ]));
          trHe.appendChild(el('td', {}, [el('span', { class:'heBadge' }, [el('span', { class:'sDot' }, []), 'Hora Extra'])]));
          trHe.appendChild(el('td', { class:'mono' }, [`+${fmtHours(x.horas)}h`]));
          trHe.appendChild(el('td', {}, [x.predio || '—']));
          trHe.appendChild(el('td', {}, [x.focal || '—']));
          trHe.appendChild(el('td', {}, [resourceById()[x.resourceId || resourceId]?.nome || (x.resourceId === '__ALL__' ? 'Todos' : '—')]));
          trHe.appendChild(el('td', { class:'mono tiny' }, [formatDateBR(x.date || dateStr)]));
          tb.appendChild(trHe);
        }
      }
      t.appendChild(tb);
      body.appendChild(t);

      if (total > MODAL_DEMANDS_PAGE_SIZE) {
        body.appendChild(buildPager({
          page: uiPagination.dayModalPage,
          totalPages,
          total,
          startIdx,
          shown: pageItems.length,
          onPrev: () => { uiPagination.dayModalPage--; renderDayModal(); },
          onNext: () => { uiPagination.dayModalPage++; renderDayModal(); },
          onFirst: () => { uiPagination.dayModalPage = 1; renderDayModal(); },
          onLast: () => { uiPagination.dayModalPage = totalPages; renderDayModal(); },
        }));
      }
    };

    renderDayModal();
    openDialog(dlg);
  };

  // ----------------------
  // Editar Demanda (modal com justificativa opcional)
  // ----------------------
  const openDemandEditModal = (demand) => {
    const dlg = qs('#demandEditModal');
    const resMap = resourceById();

    qs('#demandEditModalTitle').textContent = `Editar demanda — ${demand.titulo}`;
    qs('#demandEditModalSub').textContent = 'Justificativa opcional (fica registrada no histórico se preenchida).';

    const body = qs('#demandEditModalBody');
    body.innerHTML = '';

    const titulo = el('input', { value: demand.titulo || '', placeholder:'Ex: PQ Sistema X' });
    const predio = el('input', { value: demand.predio || '', placeholder:'Ex: Prédio A' });
    const focal = el('input', { value: demand.focal || '', placeholder:'Ex: Fulano (Focal)' });

    const responsavel = el('select');
    responsavel.appendChild(el('option', { value:'' }, ['Sem responsável (Mapeada)']));
    for (const r of state.resources) {
      responsavel.appendChild(el('option', { value:r.id }, [`${r.nome}${r.tipo==='Terceiro' ? ' (Terceiro)' : ''}`]));
    }
    responsavel.value = demand.responsavel_id || '';

    const ini = el('input', { type:'date', value: demand.data_inicio || '' });
    const fim = el('input', { type:'date', value: demand.data_fim || '' });
    const perc = el('input', { type:'number', min:'0', step:'5', value: String(demand.percentual_diario ?? 100) });
    const prioridade = el('select', {}, [
      el('option', { value:'Baixa' }, ['Baixa']),
      el('option', { value:'Média' }, ['Média']),
      el('option', { value:'Alta' }, ['Alta']),
      el('option', { value:'Crítica' }, ['Crítica']),
    ]);
    prioridade.value = demand.prioridade || 'Média';

    const status = el('select', {}, [
        el('option', { value:'Em andamento' }, ['Em andamento']),
        el('option', { value:'Atrasada', disabled:'' }, ['Atrasada (automático)']),
        el('option', { value:'Concluída' }, ['Concluída']),
      el('option', { value:'Mapeada' }, ['Mapeada (sem responsável)']),
      el('option', { value:'Congelada' }, ['Congelada']),
    ]);
    status.value = normalizeStatus(demand.status);

    const obs = el('textarea', { placeholder:'Observações...' }, [demand.observacoes || '']);

    const just = el('textarea', { placeholder:'Justificativa (opcional)...', style:'min-height:92px' });
    const justHint = el('div', { class:'tiny muted' }, [
      'Se você preencher, a justificativa será registrada no histórico (events) do app para rastreabilidade.'
    ]);

    // Etapas do projeto agora são gerenciadas em modal separado.
    const syncMapeada = () => {
      const st = normalizeStatus(status.value);
      if (st === 'Mapeada') {
        responsavel.value = '';
        responsavel.disabled = true;
      } else {
        responsavel.disabled = false;
        if (!responsavel.value) {
          // tenta manter o antigo responsável se existir
          responsavel.value = demand.responsavel_id || '';
        }
      }
    };
    status.addEventListener('change', syncMapeada);
    responsavel.addEventListener('change', () => {
      if (!responsavel.value) {
        status.value = 'Mapeada';
        syncMapeada();
      }
    });
    syncMapeada();

    const before = {
      titulo: demand.titulo,
      predio: demand.predio,
      focal: demand.focal,
      responsavel_id: demand.responsavel_id,
      data_inicio: demand.data_inicio,
      data_fim: demand.data_fim,
      percentual_diario: demand.percentual_diario,
      prioridade: demand.prioridade,
      status: demand.status,
      observacoes: demand.observacoes,
      apontamentos: normalizeDemandApontamentos(demand)
    };

    // Botão de salvar será criado mais abaixo
    let saveBtn = null;

	    const save = () => {
      const justification = (just.value || '').trim();

      const nextStatus = normalizeStatus(status.value);
      if (nextStatus === 'Atrasada') { toast('Status Atrasada é automático — selecione outro status.'); return; }
      const next = {
        ...demand,
        titulo: (titulo.value || '').trim() || demand.titulo,
        predio: (predio.value || '').trim(),
        focal: (focal.value || '').trim(),
        responsavel_id: (nextStatus === 'Mapeada') ? '' : (responsavel.value || ''),
        data_inicio: (ini.value || '').trim() || demand.data_inicio,
        data_fim: (fim.value || '').trim() || demand.data_fim,
        percentual_diario: Number(perc.value || demand.percentual_diario || 0),
        prioridade: prioridade.value,
        status: nextStatus,
        observacoes: (obs.value || '').trim(),
        apontamentos: normalizeDemandApontamentos(demand),
        last_edit_by: userName,
        last_edit_at: Date.now(),
        last_edit_justification: justification,
      };

      // registra um evento extra com diff para auditoria (além do UPDATE_DEMAND padrão)
      const after = {
        titulo: next.titulo,
        predio: next.predio,
        focal: next.focal,
        responsavel_id: next.responsavel_id,
        data_inicio: next.data_inicio,
        data_fim: next.data_fim,
        percentual_diario: next.percentual_diario,
        prioridade: next.prioridade,
        status: next.status,
        observacoes: next.observacoes,
        apontamentos: normalizeDemandApontamentos(next)
      };
      state.events = [...state.events, { id: generateId('event'), type:'EDIT_DEMAND', payload:{ demand_id: demand.id, before, after, justification }, timestamp: Date.now(), user: userName, user_id: userId || '' }];

      dispatch('UPDATE_DEMAND', next);
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      toast('Demanda atualizada.');
    };

	    saveBtn = button('Salvar alterações', 'primary', save);
	    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }),
	      saveBtn,
    ]);

    body.appendChild(el('div', { class:'grid' }, [
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:2' }, [el('label', {}, ['Título']), titulo]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Prioridade']), prioridade]),
      ]),
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Prédio']), predio]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Focal']), focal]),
      ]),
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Responsável']), responsavel]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Status']), status]),
        el('div', { class:'field', style:'max-width:110px' }, [el('label', {}, ['%/dia']), perc]),
      ]),
      el('div', { class:'row' }, [
        el('div', { class:'field' }, [el('label', {}, ['Início']), ini]),
        el('div', { class:'field' }, [el('label', {}, ['Fim']), fim]),
      ]),
      el('div', { class:'field' }, [el('label', {}, ['Observações']), obs]),
      el('div', { class:'field' }, [el('label', {}, ['Justificativa (opcional)']), just, justHint]),
      footer
    ]));

    openDialog(dlg);
  };

  const openDemandStagesModal = (demand) => {
    const dlg = qs('#demandStagesModal');
    if (!dlg || !demand) return;

    qs('#demandStagesModalTitle').textContent = `Etapas do projeto — ${demand.titulo}`;
    qs('#demandStagesModalSub').textContent = 'Registre e edite as etapas de apontamento reais da demanda.';

    const body = qs('#demandStagesModalBody');
    body.innerHTML = '';

    let apontamentos = normalizeDemandApontamentos(demand);
    let editingAptId = '';
    const aptData = el('input', { type:'date', value: todayISO() });
    const aptEtapa = el('select');
    for (const step of PROJECT_STEP_OPTIONS) aptEtapa.appendChild(el('option', { value:step }, [step]));
    const aptHoras = el('input', { type:'number', min:'0.25', max:'24', step:'0.25', placeholder:'Ex: 2.5' });
    const aptObs = el('input', { placeholder:'Observação do apontamento...' });
    const aptList = el('div');
    const aptSummary = el('div', { class:'tiny muted' });
    let saveAptBtn = null;
    let cancelAptBtn = null;

    const resetApontamentoForm = () => {
      editingAptId = '';
      aptData.value = todayISO();
      aptEtapa.value = PROJECT_STEP_OPTIONS[0];
      aptHoras.value = '';
      aptObs.value = '';
      if (saveAptBtn) saveAptBtn.textContent = 'Adicionar etapa';
      if (cancelAptBtn) cancelAptBtn.style.display = 'none';
    };

    const renderApontamentos = () => {
      apontamentos = sortApontamentosChronological(apontamentos.map(normalizeApontamento).filter(a => a.data && a.etapa && Number(a.horas) > 0));
      aptList.innerHTML = '';

      const totalHoras = apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0);
      const etapasUnicas = new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean));
      aptSummary.textContent = `${apontamentos.length} apontamento(s) • ${etapasUnicas.size} etapa(s) • ${fmtHours(totalHoras)}h realizadas.`;

      if (!apontamentos.length) {
        aptList.appendChild(el('div', { style:'padding:14px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:#fafafa' }, [
          'Nenhum apontamento cadastrado para esta demanda.'
        ]));
        return;
      }

      for (const a of apontamentos) {
        const created = a.created_at ? new Date(Number(a.created_at)).toLocaleString('pt-BR') : '—';
        const card = el('div', { style:'border:1px solid var(--border);border-radius:16px;padding:12px;background:#fff;margin-bottom:10px' }, [
          el('div', { class:'row', style:'justify-content:space-between;align-items:center' }, [
            el('div', { style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
              el('span', { style:'font-weight:950' }, [a.etapa || 'Sem etapa']),
              el('span', { class:'mono' }, [`${fmtHours(a.horas||0)}h`])
            ]),
            el('div', { class:'row', style:'gap:6px' }, [
              button('Editar', '', () => {
                editingAptId = String(a.id);
                aptData.value = a.data || todayISO();
                aptEtapa.value = normalizeProjectStep(a.etapa) || PROJECT_STEP_OPTIONS[0];
                aptHoras.value = String(a.horas || '');
                aptObs.value = a.observacao || '';
                if (saveAptBtn) saveAptBtn.textContent = 'Salvar etapa';
                if (cancelAptBtn) cancelAptBtn.style.display = '';
              }),
              button('Excluir', 'danger', () => {
                apontamentos = apontamentos.filter(x => String(x.id) !== String(a.id));
                if (editingAptId === String(a.id)) resetApontamentoForm();
                renderApontamentos();
                toast('Apontamento removido. Salve a demanda para persistir.');
              })
            ])
          ]),
          el('div', { style:'margin-top:8px;color:#334155' }, [a.observacao || 'Sem observação.']),
          el('div', { class:'tiny muted', style:'margin-top:8px' }, [`${a.usuario||'—'} • ${a.data || 'Sem data'} • criado em ${created}`])
        ]);
        aptList.appendChild(card);
      }
    };

    const upsertApontamento = () => {
      const data = String(aptData.value || '').trim();
      const etapa = normalizeProjectStep(aptEtapa.value);
      const horas = parseApontamentoHours(aptHoras.value);
      const validation = validateApontamentoInput({ data, etapa, horas }, demand);
      if (validation) { toast(validation); return; }

      if (editingAptId) {
        const idx = apontamentos.findIndex(a => String(a.id) === String(editingAptId));
        if (idx < 0) { toast('Apontamento em edição não encontrado.'); resetApontamentoForm(); return; }
        apontamentos[idx] = normalizeApontamento({
          ...apontamentos[idx],
          data,
          etapa,
          horas,
          observacao: String(aptObs.value || '').trim(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        });
        toast('Apontamento atualizado. Salve a demanda para persistir.');
      } else {
        apontamentos.push(normalizeApontamento({
          id: generateId('apt'),
          data,
          etapa,
          horas,
          observacao: String(aptObs.value || '').trim(),
          usuario: userName || 'Sessão local',
          user_id: userId || '',
          created_at: Date.now(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        }));
        toast('Apontamento adicionado. Salve a demanda para persistir.');
      }
      resetApontamentoForm();
      renderApontamentos();
    };

    renderApontamentos();
    saveAptBtn = button('Adicionar etapa', 'primary', upsertApontamento);
    cancelAptBtn = button('Cancelar edição', '', () => { resetApontamentoForm(); });
    cancelAptBtn.style.display = 'none';

    const apontamentosBox = el('div', { class:'field', style:'border:1px solid var(--border);border-radius:18px;padding:14px;background:#fff' }, [
      el('label', {}, ['Etapas do projeto / apontamento real']),
      el('div', { class:'tiny muted', style:'margin-bottom:10px' }, ['Registre horas reais gastas por documento/atividade. Não soma novamente na capacidade planejada.']),
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'min-width:150px;flex:0 0 150px' }, [el('label', {}, ['Data']), aptData]),
        el('div', { class:'field', style:'min-width:170px;flex:0 0 170px' }, [el('label', {}, ['Etapa']), aptEtapa]),
        el('div', { class:'field', style:'min-width:130px;flex:0 0 130px' }, [el('label', {}, ['Horas gastas']), aptHoras]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Observação']), aptObs]),
        el('div', { class:'field', style:'align-self:flex-end;flex:0 0 auto' }, [saveAptBtn]),
        el('div', { class:'field', style:'align-self:flex-end;flex:0 0 auto' }, [cancelAptBtn]),
      ]),
      aptSummary,
      aptList
    ]);

    const save = () => {
      const next = {
        ...demand,
        apontamentos: normalizeDemandApontamentos({ apontamentos }),
        last_edit_by: userName,
        last_edit_at: Date.now()
      };
      state.events = [...state.events, { id: generateId('event'), type:'EDIT_DEMAND_STAGES', payload:{ demand_id: demand.id, before: normalizeDemandApontamentos(demand), after: normalizeDemandApontamentos(next) }, timestamp: Date.now(), user: userName, user_id: userId || '' }];
      dispatch('UPDATE_DEMAND', next);
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      syncModalBlur();
      toast('Etapas atualizadas.');
    };

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } syncModalBlur(); }),
      button('Salvar alterações', 'primary', save)
    ]);

    body.appendChild(apontamentosBox);
    body.appendChild(footer);
    openDialog(dlg);
  };

  // ----------------------
  // Reprogramar Demanda (modal: nova data de início + fim + justificativa obrigatória)
  // ----------------------

  const openDemandReprogramModal = (demand) => {
    const dlg = qs('#demandReprogramModal');
    if (!dlg || !demand) return;

    qs('#demandReprogramModalTitle').textContent = `Reprogramar demanda — ${demand.titulo}`;
    qs('#demandReprogramModalSub').textContent = 'Altere apenas as datas e informe a justificativa (obrigatória).';

    const body = qs('#demandReprogramModalBody');
    body.innerHTML = '';

    const novaIni = el('input', { type:'date', value: demand.data_inicio || '' });
    const novaFim = el('input', { type:'date', value: demand.data_fim || '' });
    const just = el('textarea', { placeholder:'Justificativa (obrigatória)...', style:'min-height:92px' });

    const dateErr = el('div', { class:'inlineError', style:'display:none' }, ['Verifique as datas: início e fim são obrigatórios e o fim não pode ser anterior ao início.']);
    const justErr = el('div', { class:'inlineError', style:'display:none' }, ['Informe uma justificativa para confirmar a reprogramação.']);

    const setInvalid = (fieldEl, ok) => {
      const wrap = fieldEl.closest('.field');
      if (wrap) wrap.classList.toggle('invalid', !ok);
    };

    const validateDates = () => {
      const ini = (novaIni.value || '').trim();
      const fim = (novaFim.value || '').trim();
      let ok = true;
      if (!ini || !fim) ok = false;
      if (ok && fim < ini) ok = false;
      setInvalid(novaIni, ok);
      setInvalid(novaFim, ok);
      dateErr.style.display = ok ? 'none' : 'block';
      return ok;
    };

    const validateJust = () => {
      const j = (just.value || '').trim();
      const ok = j.length > 0;
      setInvalid(just, ok);
      justErr.style.display = ok ? 'none' : 'block';
      return ok;
    };

    const confirmBtn = button('Confirmar reprogramação', 'primary', () => {
      const okDates = validateDates();
      const okJust = validateJust();
      if (!okDates) {
        if (!novaIni.value) novaIni.focus();
        else if (!novaFim.value) novaFim.focus();
        return;
      }
      if (!okJust) {
        just.focus();
        return;
      }

      const rp = {
        id: generateId(),
        demanda_id: demand.id,
        data: formatDate(new Date()),
        novo_inicio: novaIni.value,
        novo_fim: novaFim.value,
        // compatibilidade com snapshots antigos
        novo_prazo: novaFim.value,
        motivo: (just.value || '').trim(),
        impacto_hh: 0,
        timestamp: Date.now(),
        user: userName,
        user_id: userId || '',
      };

      dispatch('REPROGRAM_DEMAND', { demandId: demand.id, reprogramming: rp });
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      toast('Demanda reprogramada.');
    });

    // Começa bloqueado ate preencher justificativa + datas validas
    confirmBtn.disabled = true;

    const refreshConfirmState = () => {
      const ini = (novaIni.value || '').trim();
      const fim = (novaFim.value || '').trim();
      const okDates = !!ini && !!fim && (fim >= ini);
      const okJust = (just.value || '').trim().length > 0;
      confirmBtn.disabled = !(okDates && okJust);
    };

    const onInput = () => {
      // se usuario ja interagiu, mostra erro conforme necessario
      const ini = (novaIni.value || '').trim();
      const fim = (novaFim.value || '').trim();
      if (ini && fim) validateDates();
      else dateErr.style.display = 'none';

      if ((just.value || '').trim()) { setInvalid(just, true); justErr.style.display = 'none'; }

      refreshConfirmState();
    };

    novaIni.addEventListener('input', onInput);
    novaFim.addEventListener('input', onInput);
    just.addEventListener('input', onInput);

    // estado inicial
    refreshConfirmState();

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }),
      confirmBtn,
    ]);

    body.appendChild(el('div', { class:'grid' }, [
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Nova data (início)']), novaIni]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Nova data (fim)']), novaFim]),
      ]),
      el('div', { class:'field' }, [dateErr]),
      el('div', { class:'field' }, [el('label', {}, ['Justificativa (obrigatória)']), just, justErr]),
      footer
    ]));

    openDialog(dlg);
  };

  // ----------------------
  // Editar Recurso (modal flutuante)
  // ----------------------
  const openResourceEditModal = (resource) => {
    const dlg = qs('#resourceEditModal');
    if (!dlg || !resource) return;

    qs('#resourceEditModalTitle').textContent = `Editar recurso — ${resource.nome || '—'}`;
    qs('#resourceEditModalSub').textContent = 'Atualize os campos e salve.';

    const body = qs('#resourceEditModalBody');
    body.innerHTML = '';

    const nome = el('input', { value: resource.nome || '', placeholder:'Ex: Arthur' });

    const tipo = el('select', {}, [
      el('option', { value:'Interno' }, ['Interno']),
      el('option', { value:'Terceiro' }, ['Terceiro']),
    ]);
    tipo.value = (resource.tipo === 'Terceiro') ? 'Terceiro' : 'Interno';

    // Regra fixa do app (9h/dia): mostramos só como informativo
    const horasInfo = el('input', { value: String(HOURS_PER_DAY), disabled:'', title:'Regra fixa do app (9h/dia)' });

    const ativo = el('select', {}, [
      el('option', { value:'true' }, ['Ativo']),
      el('option', { value:'false' }, ['Inativo']),
    ]);
    ativo.value = (resource.ativo === false) ? 'false' : 'true';

    const vigIni = el('input', { type:'date', value: (resource.vigencia_inicio || '') });
    const vigFim = el('input', { type:'date', value: (resource.vigencia_fim || '') });

    const vigRow = el('div', { class:'row' }, [
      el('div', { class:'field' }, [el('label', {}, ['Vigência início']), vigIni]),
      el('div', { class:'field' }, [el('label', {}, ['Vigência fim']), vigFim]),
    ]);

    const vigHint = el('div', { class:'warn', style:'margin-top:10px;display:none' }, [
      'Dica: Para Terceiro, fora da vigência o recurso aparece como OFF e não conta capacidade.'
    ]);

    const syncVig = () => {
      const isThird = (String(tipo.value).trim() === 'Terceiro');
      vigRow.style.display = isThird ? '' : 'none';
      vigHint.style.display = isThird ? '' : 'none';
      if (!isThird) {
        vigIni.value = '';
        vigFim.value = '';
      }
    };
    tipo.addEventListener('change', syncVig);
    syncVig();

    const before = {
      nome: resource.nome,
      tipo: resource.tipo,
      ativo: (resource.ativo === false ? false : true),
      vigencia_inicio: resource.vigencia_inicio,
      vigencia_fim: resource.vigencia_fim,
    };

    const save = () => {
      const next = {
        ...resource,
        nome: (nome.value || '').trim() || resource.nome,
        tipo: (String(tipo.value).trim() === 'Terceiro') ? 'Terceiro' : 'Interno',
        horas_dia: HOURS_PER_DAY,
        ativo: (ativo.value === 'true'),
        vigencia_inicio: (String(tipo.value).trim() === 'Terceiro' ? (vigIni.value || undefined) : undefined),
        vigencia_fim: (String(tipo.value).trim() === 'Terceiro' ? (vigFim.value || undefined) : undefined),
        last_edit_by: userName,
        last_edit_at: Date.now(),
      };

      const after = {
        nome: next.nome,
        tipo: next.tipo,
        ativo: (next.ativo === false ? false : true),
        vigencia_inicio: next.vigencia_inicio,
        vigencia_fim: next.vigencia_fim,
      };

      state.events = [...state.events, {
        id: generateId(),
        type: 'EDIT_RESOURCE',
        payload: { resource_id: resource.id, before, after },
        timestamp: Date.now(),
        user: userName
      }];

      dispatch('UPDATE_RESOURCE', next);
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      syncModalBlur();
      toast('Recurso atualizado.');
    };

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } syncModalBlur(); }),
      button('Salvar alterações', 'primary', save),
    ]);

    body.appendChild(el('div', { class:'grid' }, [
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:2' }, [el('label', {}, ['Nome']), nome]),
        el('div', { class:'field', style:'flex:1;min-width:200px' }, [el('label', {}, ['Tipo']), tipo]),
      ]),
      el('div', { class:'row' }, [
        // Horas/dia e um campo compacto (regra fixa 9h/dia)
        el('div', { class:'field compact', style:'max-width:140px' }, [el('label', {}, ['Horas/dia']), horasInfo]),
        el('div', { class:'field', style:'flex:1;min-width:200px' }, [el('label', {}, ['Status']), ativo]),
      ]),
      vigRow,
      vigHint,
      footer
    ]));

    openDialog(dlg);
  };
  // ----------------------
  // UI building blocks
  // ----------------------
  const el = (tag, attrs={}, children=[]) => {
    const node = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === false || v === undefined || v === null) continue;
      else node.setAttribute(k, String(v));
    }
    for (const ch of (Array.isArray(children) ? children : [children])) {
      if (ch === null || ch === undefined) continue;
      node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    }
    return node;
  };

  const card = (title, rightNode, bodyNode) => {
    return el('div', { class:'card' }, [
      el('div', { class:'hd' }, [
        el('h2', {}, [title]),
        rightNode || el('div')
      ]),
      el('div', { class:'bd' }, [bodyNode])
    ]);
  };

  const badgeLegend = () => {
    const root = el('div', { class:'legendDropdown' });
    const btn = el('button', { class:'legendBtn', type:'button', title:'Abrir menu de legendas' }, [
      '☰ Legendas',
      el('span', { class:'chev' }, ['▾'])
    ]);

    const item = (dotCls, label, desc='') => el('div', { class:'legendItem' }, [
      el('span', { class:`legendDot ${dotCls}` }, []),
      el('span', {}, [label, desc ? el('small', {}, [desc]) : null])
    ]);

    const group = (title, items) => el('div', { class:'legendGroup' }, [
      el('div', { class:'legendGroupTitle' }, [title]),
      ...items
    ]);

    const menu = el('div', { class:'legendMenu', role:'menu' }, [
      group('Capacidade', [
        item('ok', '≤ 80%', 'Alocação confortável'),
        item('mid', '81–100%', 'Próximo do limite'),
        item('over', '> 100%', 'Capacidade excedida'),
      ]),
      group('Bloqueios', [
        item('block', 'Bloqueio', 'Dia sem capacidade'),
        item('vac', 'Férias', 'Recurso indisponível'),
        item('off', 'Fora vigência', 'Terceiro fora do período'),
      ]),
      group('Eventos especiais', [
        item('holiday', 'Feriado', 'Capacidade zerada'),
        item('vac', 'HE', 'Hora extra registrada'),
      ]),
    ]);

    const close = () => { root.classList.remove('open'); btn.setAttribute('aria-expanded','false'); };
    const open = () => { root.classList.add('open'); btn.setAttribute('aria-expanded','true'); };

    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (root.classList.contains('open')) close(); else open();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
      if (!root.isConnected) return;
      if (!root.contains(e.target)) close();
    });

    root.appendChild(btn);
    root.appendChild(menu);
    return root;
  };

  const pill = (label, cls) => el('span', { class:'pill' }, [
    el('span', { class:'dot '+cls }, []),
    label
  ]);

  const statusPill = (statusOrDemand) => {
    // Aceita string (status) OU um objeto demanda (para tooltip/ícone)
    const isObj = statusOrDemand && typeof statusOrDemand === 'object';
    const s = isObj ? effectiveStatus(statusOrDemand) : normalizeStatus(statusOrDemand);
    const key = (s === 'Em andamento') ? 'andamento' : (s === 'Atrasada') ? 'atrasada' : (s === 'Concluída') ? 'concluida' : (s === 'Mapeada') ? 'mapeada' : (s === 'Congelada') ? 'congelada' : 'planejada';
    const title = isObj ? (overdueTooltip(statusOrDemand) || '') : '';
    const children = [
      el('span', { class:'sDot' }, []),
    ];
    if (s === 'Atrasada') {
      children.push(el('span', { class:'statusIcon', title: title || 'Atrasada (automático)' }, ['⏰']));
    }
    children.push(s || 'Mapeada');
    return el('span', { class:`statusPill s-${key}`, title: title || undefined }, children);
  };

  const button = (label, cls, onClick) => el('button', { class:'btn '+(cls||''), onclick:onClick }, [label]);

  const sortTimestampValue = (item) => {
    if (!item || typeof item !== 'object') return 0;
    const candidates = [item.createdAt, item.timestamp, item.updatedAt, item.last_edit_at];
    for (const v of candidates) {
      if (v === undefined || v === null || v === '') continue;
      const n = (typeof v === 'number') ? v : Date.parse(String(v));
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };

  const newestFirst = (items) => (Array.isArray(items) ? [...items] : [])
    .sort((a,b) => {
      const diff = sortTimestampValue(b) - sortTimestampValue(a);
      if (diff !== 0) return diff;
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });

  const buildPager = ({ page, totalPages, total, startIdx, shown, onPrev, onNext, onFirst, onLast } = {}) => {
    const infoTxt = (total===0) ? 'Nenhum item' : `Mostrando ${startIdx+1}-${startIdx+shown} de ${total}`;
    const info = el('div', { class:'info' }, [`${infoTxt} • Página ${page} de ${totalPages}`]);

    const firstBtn = button('« Início', '', onFirst || onPrev);
    firstBtn.disabled = page <= 1;
    const prevBtn = button('‹ Anterior', '', onPrev);
    prevBtn.disabled = page <= 1;
    const nextBtn = button('Próxima ›', '', onNext);
    nextBtn.disabled = page >= totalPages;
    const lastBtn = button('Final »', '', onLast || onNext);
    lastBtn.disabled = page >= totalPages;

    return el('div', { class:'pager' }, [
      info,
      el('div', { class:'controls' }, [firstBtn, prevBtn, nextBtn, lastBtn])
    ]);
  };


  const input = (label, attrs) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    el('input', attrs)
  ]);

  const select = (label, attrs, options) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    (() => {
      const s = el('select', attrs);
      for (const opt of options) {
        s.appendChild(el('option', { value: opt.value }, [opt.label]));
      }
      return s;
    })()
  ]);

  const textarea = (label, attrs) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    el('textarea', attrs)
  ]);

  // ----------------------
  // Views
  // ----------------------
  let viewDate = new Date();


  /* === Capacidade VSC helpers (global) === */
/* === Capacidade VSC helpers (global) === */
function buildConsolidatedMonthTotals(year, m0) {
  const resources = (state.resources || []);
  let cap = 0;
  let alloc = 0;
  let free = 0;
  let overResources = 0;

  // Self-contained month aggregation (does NOT depend on view-scoped helpers like monthlyWindow/freeHoursInfo)
  const days = getDaysInMonth(year, m0);

  for (const r of resources) {
    let mCap = 0, mAlloc = 0, mFree = 0;

    for (const d of days) {
      const dateStr = formatDate(d);

      // HE for this resource OR __ALL__ is included by overtimeInfo()
      const ot = (typeof overtimeInfo === 'function') ? overtimeInfo(r.id, dateStr) : { total: 0, items: [] };
      const otHours = Math.max(0, Number(ot.total || 0));

      // Weekends do NOT count unless there is HE (rule of the app)
      const weekend = isWeekend(d);
      if (weekend && otHours <= 0) continue;

      // Base capacity:
      // - Weekday: 9h
      // - Weekend: 0h (+ HE only)
      // - Holiday / Blocking / OFF: 0h (+ HE only)
      let base = weekend ? 0 : HOURS_PER_DAY;

      if (isHoliday(dateStr)) base = 0;
      const blk = blockingFor(r.id, dateStr);
      if (blk) base = 0;

      const resObj = (state.resources || []).find(x => x.id === r.id);
      if (typeof isThirdPartyOff === 'function' && isThirdPartyOff(resObj, dateStr)) base = 0;

      const dayCap = Math.max(0, Number(base || 0)) + otHours;

      // Allocated continues based on 9h rule and only for normal days
      // For Holiday/Blocking/OFF we keep allocated/free as 0 (same behavior used in Janelas Livres),
      // but capacity still counts if HE exists.
      let dayAlloc = 0;
      let dayFree = 0;

      if (!isHoliday(dateStr) && !blk && !(typeof isThirdPartyOff === 'function' && isThirdPartyOff(resObj, dateStr))) {
        const perc = (typeof dailyPercentAllocated === 'function') ? dailyPercentAllocated(r.id, d) : 0;
        dayAlloc = Math.max(0, Number(perc || 0)) / 100 * HOURS_PER_DAY;
        dayFree = dayCap - dayAlloc;
      }

      mCap += dayCap;
      mAlloc += dayAlloc;
      mFree += dayFree;
    }

    cap += mCap;
    alloc += mAlloc;
    free += mFree;
    if (mAlloc > mCap) overResources += 1;
  }

  const usagePct = cap > 0 ? (alloc / cap) * 100 : 0;
  const overHH = Math.max(0, alloc - cap);
  return { cap, alloc, free, usagePct, overHH, overResources, totalResources: resources.length };
}
function buildConsolidatedYearSeries(year) {
    const labels = Array.from({ length: 12 }, (_, m0) =>
      new Date(year, m0, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')
    );
    const points = [];
    for (let m0 = 0; m0 < 12; m0++) {
      const t = buildConsolidatedMonthTotals(year, m0);
      points.push({ m0, label: labels[m0], ...t });
    }
    return points;
  }
  function serializeSvg(svgEl) {
    const clone = svgEl.cloneNode(true);
    // garantir xmlns
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="UTF-8"?>\n` + xml;
  }
  function exportSvg(svgEl, fileName) {
    const xml = serializeSvg(svgEl);
    downloadFile(xml, fileName, 'image/svg+xml;charset=utf-8');
  }
  async function exportPngFromSvg(svgEl, fileName) {
    const xml = serializeSvg(svgEl);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const vb = (svgEl.getAttribute('viewBox') || '0 0 1200 520').split(/\s+/).map(Number);
    const w = Math.max(1, Math.round(vb[2] || 1200));
    const h = Math.max(1, Math.round(vb[3] || 520));

    const img = new Image();
    img.decoding = 'async';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // fundo branco (corporativo)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    URL.revokeObjectURL(url);

    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve();
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(pngUrl);
        resolve();
      }, 'image/png');
    });
  }
  function buildCapacityVsPlannedSvg({ title, series }) {
    const W = 1200;
    const H = 520;
    const pad = { l: 70, r: 70, t: 70, b: 70 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;

    const maxHH = Math.max(1, ...series.map(p => Math.max(p.cap || 0, p.alloc || 0)));
    const rawMaxPct = Math.max(0, ...series.map(p => (p.usagePct || 0)));
    const maxPct = Math.max(120, 100, Math.ceil(rawMaxPct/10)*10);
    const yHH = (v) => pad.t + (ch - (v / maxHH) * ch);
    const yPct = (pct) => pad.t + (ch - (pct / maxPct) * ch);

    const xStep = cw / series.length;
    const barW = Math.min(36, Math.max(18, xStep * 0.32));
    const barGap = 8;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('style','max-width:100%;height:auto;display:block;');
    svg.setAttribute('role', 'img');

    const rect = (x, y, w, h, fill, rx=4) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', w);
      r.setAttribute('height', Math.max(0, h));
      r.setAttribute('rx', rx);
      r.setAttribute('fill', fill);
      return r;
    };

    const line = (x1, y1, x2, y2, stroke, w=2, dash=null) => {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', stroke);
      l.setAttribute('stroke-width', w);
      if (dash) l.setAttribute('stroke-dasharray', dash);
      return l;
    };

    const text = (x, y, s, fill='#0f172a', size=12, weight=600, anchor='middle') => {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('fill', fill);
      t.setAttribute('font-size', size);
      t.setAttribute('font-weight', weight);
      t.setAttribute('text-anchor', anchor);
      t.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial');
      t.textContent = s;
      return t;
  }
    // background
    svg.appendChild(rect(0, 0, W, H, '#ffffff', 0));

    // title
    svg.appendChild(text(pad.l, 36, title || 'Capacidade vs Planejado (Consolidado)', 'var(--orange)', 28, 900, 'start'));

    // grid (HH)
    const gridN = 5;
    for (let i=0;i<=gridN;i++){
      const v = (maxHH/gridN)*i;
      const y = yHH(v);
      svg.appendChild(line(pad.l, y, W-pad.r, y, '#e5e7eb', 1));
      svg.appendChild(text(pad.l-10, y+4, fmtHours(v).replace('h',''), '#64748b', 11, 700, 'end'));
    }

    // axis right (%)
    const ticksPct = (maxPct <= 100)
      ? [0,20,40,60,80,100]
      : (maxPct <= 150)
        ? [0,25,50,75,100, maxPct]
        : (maxPct <= 250)
          ? [0,50,100,150,200, maxPct]
          : [0,50,100,150,200,250, maxPct];

    for (const pct of ticksPct) {
      const y = yPct(pct);
      svg.appendChild(text(W-pad.r+10, y+4, `${Math.round(pct)}%`, '#64748b', 11, 700, 'start'));
    }

    // 100% reference line (uso)
    const y100 = yPct(100);
    svg.appendChild(line(pad.l, y100, W-pad.r, y100, '#ef4444', 2, '6 6'));

    // bars + % line
    let pathD = '';
    series.forEach((p, i) => {
      const cx = pad.l + xStep*i + xStep/2;
      const xCap = cx - barGap/2 - barW;
      const xAlloc = cx + barGap/2;

      const capH = (p.cap || 0) / maxHH * ch;
      const allocH = (p.alloc || 0) / maxHH * ch;

      svg.appendChild(rect(xCap, pad.t + (ch - capH), barW, capH, '#c2410c')); // laranja
      svg.appendChild(rect(xAlloc, pad.t + (ch - allocH), barW, allocH, '#3b82f6')); // azul

      // label month
      svg.appendChild(text(cx, pad.t + ch + 26, p.label, '#334155', 12, 800, 'middle'));

      // label % no topo
      const pct = Math.round(p.usagePct || 0);
      svg.appendChild(text(cx, pad.t + 20, `${pct}%`, '#111827', 13, 900, 'middle'));

      // path point
      const px = cx;
      const py = yPct(p.usagePct || 0);
      pathD += (i===0 ? `M ${px} ${py}` : ` L ${px} ${py}`);
      // dot
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', px); c.setAttribute('cy', py);
      c.setAttribute('r', 3.5);
      c.setAttribute('fill', '#ef4444');
      svg.appendChild(c);
    });

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#ef4444');
    path.setAttribute('stroke-width', 2.5);
    svg.appendChild(path);

    // legend
    const lx = pad.l;
    const ly = H - 24;
    svg.appendChild(rect(lx, ly-10, 14, 10, '#c2410c', 2));
    svg.appendChild(text(lx+20, ly-1, 'Capacidade (HH)', '#334155', 12, 800, 'start'));
    svg.appendChild(rect(lx+170, ly-10, 14, 10, '#3b82f6', 2));
    svg.appendChild(text(lx+190, ly-1, 'Planejado (HH)', '#334155', 12, 800, 'start'));
    svg.appendChild(line(lx+340, ly-5, lx+370, ly-5, '#ef4444', 2.5));
    svg.appendChild(text(lx+380, ly-1, '% Uso', '#334155', 12, 800, 'start'));

    return svg;
  }

  const viewDashboard = () => {
    const dashboardFilteredDemands = filterDemands({
      status: uiFilters.demandStatus,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: uiFilters.demandTitle
    });

    const { totalResources, activeResources, totalDemands, openDemands } = kpis(dashboardFilteredDemands);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const days = getDaysInMonth(year, month);

    const right = el('div', { class:'row' }, [
      button('◀', 'ghost', () => { viewDate = new Date(year, month-1, 1); render(); }),
      el('div', { class:'tag' }, [viewDate.toLocaleString('pt-BR', { month:'long', year:'numeric' })]),
      button('▶', 'ghost', () => { viewDate = new Date(year, month+1, 1); render(); }),
    ]);

    const sheetTotal = state.resources.length;
    const sheetTotalPages = Math.max(1, Math.ceil(sheetTotal / DASH_SHEET_PAGE_SIZE));
    uiPagination.dashboardSheetPage = Math.min(Math.max(1, uiPagination.dashboardSheetPage), sheetTotalPages);
    const sheetStartIdx = (uiPagination.dashboardSheetPage - 1) * DASH_SHEET_PAGE_SIZE;
    const sheetResources = state.resources.slice(sheetStartIdx, sheetStartIdx + DASH_SHEET_PAGE_SIZE);

    const table = el('div', { class:'scrollX' }, [
      (() => {
        const t = el('table', { class:'calTable' });
        const thead = el('thead');
        const trh = el('tr');
        trh.appendChild(el('th', { class:'stickyCol', style:'min-width:220px' }, ['Recurso / Dia']));
        for (const d of days) {
          const wd = d.toLocaleString('pt-BR', { weekday:'short' }).slice(0,3);
          trh.appendChild(el('th', { class:'dayHead '+(isWeekend(d)?'bg-wknd':''), title: formatDateBR(d) }, [
            el('div', { class:'mono', style:'font-weight:900' }, [String(d.getDate())]),
            el('div', { class:'tiny' }, [wd])
          ]));
        }
        thead.appendChild(trh);
        t.appendChild(thead);

        const tbody = el('tbody');
        if (state.resources.length === 0) {
          const tr = el('tr');
          tr.appendChild(el('td', { colspan: String(days.length+1), style:'padding:34px;text-align:center;color:var(--muted)' }, ['Nenhum recurso cadastrado. Vá em "Recursos" para começar.']));
          tbody.appendChild(tr);
        } else {
          for (const r of sheetResources) {
            const tr = el('tr', { id: `winres-${r.id}` });
            tr.appendChild(el('td', { class:'stickyCol' }, [
              el('div', { style:'font-weight:950' }, [r.nome]),
              el('div', { class:'tiny' }, [`${r.tipo} • ${HOURS_PER_DAY}h/dia`])
            ]));
            for (const d of days) {
              const dateStr = formatDate(d);
              const val = dailyPercentAllocated(r.id, d);
              const heTotal = overtimeInfo(r.id, dateStr).total;
              const holidayDay = isHoliday(dateStr);
              let cls = 'cell';
              let top = '';
              let sub = '';

              if (val === -5) {
                cls += ' bg-wknd';
                top = 'FDS';
                sub = '';
              } else if (val === -1) {
                cls += ' bg-block';
                top = 'BLOQ';
                sub = '';
              } else if (val === -4) {
                cls += ' bg-vac';
                top = 'FÉR';
                sub = '';
              } else if (val === -2) {
                cls += ' bg-holiday';
                top = 'FER';
                sub = '';
              } else if (val === -3) {
                cls += ' bg-off';
                top = 'OFF';
                sub = '';
              } else {
                const p = Number(val||0);
                top = (p===0? '0%': `${p}%`);
                const hh = (p/100 * HOURS_PER_DAY);
                sub = p>0 ? `${hh.toFixed(1)}h` : '';
                if (p > 100) cls += ' bg-over';
                else if (p > 80) cls += ' bg-mid';
                else if (p > 0) cls += ' bg-ok';
              }

              // Mantém destaque visual para fim de semana; só contabiliza se houver HE.
              if (isWeekend(d)) cls += ' bg-wknd';
              if (heTotal > 0) {
                cls += ' has-he';
                // Feriado mantém roxo: HE vira informação/badge, não troca a identidade do dia.
                if (Number(val||0) <= 0 && !holidayDay) cls += ' bg-he';
              }

              const nonWorkingWithHe = heTotal > 0 && Number(val||0) <= 0;
              tr.appendChild(el('td', { class: cls+' clickable', title: formatDateBR(dateStr), onclick: () => openDayDetails(r.id, d) }, [
                el('div', { class:'top' }, [nonWorkingWithHe ? (holidayDay ? 'FER' : 'HE') : top]),
                el('div', { class:'sub' }, [nonWorkingWithHe ? (holidayDay ? `HE +${fmtHours(heTotal)}h` : `+${fmtHours(heTotal)}h`) : sub]),
                (heTotal > 0 && Number(val||0) > 0) ? el('div', { class:'heLine mono' }, [`HE: ${fmtHours(heTotal)}h`]) : null
              ].filter(Boolean)));
            }
            tbody.appendChild(tr);
          }
        }
        t.appendChild(tbody);
        return t;
      })()
    ]);

    const sheetPager = buildPager({
      page: uiPagination.dashboardSheetPage,
      totalPages: sheetTotalPages,
      total: sheetTotal,
      startIdx: sheetStartIdx,
      shown: sheetResources.length,
      onPrev: () => { uiPagination.dashboardSheetPage--; render(); },
      onNext: () => { uiPagination.dashboardSheetPage++; render(); },
      onFirst: () => { uiPagination.dashboardSheetPage = 1; render(); },
      onLast: () => { uiPagination.dashboardSheetPage = sheetTotalPages; render(); },
    });

    const tableBlock = el('div', {}, [table, sheetPager]);

    const statusCounts = (() => {
      const counts = { 'Em andamento':0, 'Atrasada':0, 'Concluída':0, 'Mapeada':0, 'Congelada':0 };
      for (const d of (dashboardFilteredDemands||[])) {
        const st = effectiveStatus(d);
        if (counts[st] === undefined) counts[st] = 0;
        counts[st] += 1;
      }
      return counts;
    })();

    const dashFiltersBar = (() => {
      const statusSel = el('select');
      statusSel.appendChild(el('option', { value:'' }, ['Todos os status']));
      for (const s of STATUS) statusSel.appendChild(el('option', { value:s }, [s]));
      statusSel.value = uiFilters.demandStatus || '';
      statusSel.addEventListener('change', () => { uiFilters.demandStatus = statusSel.value; uiPagination.demandsPage=1; render(); });

      const resSel = el('select');
      resSel.appendChild(el('option', { value:'' }, ['Todos os recursos']));
      resSel.appendChild(el('option', { value:'__NONE__' }, ['Sem responsável (Mapeada)']));
      for (const r of state.resources) resSel.appendChild(el('option', { value:r.id }, [r.nome]));
      resSel.value = uiFilters.demandResourceId || '';
      resSel.addEventListener('change', () => { uiFilters.demandResourceId = resSel.value; uiPagination.demandsPage=1; render(); });

      const titleSearch = el('input', { type:'search', placeholder:'Digite parte do título...' });
      bindDemandTitleSearch(titleSearch, 'dashboardDemandTitleSearch');

      const ds = el('input', { type:'date' });
      const de = el('input', { type:'date' });
      ds.value = uiFilters.demandDateStart || '';
      de.value = uiFilters.demandDateEnd || '';
      ds.addEventListener('change', () => { uiFilters.demandDateStart = ds.value || ''; uiPagination.demandsPage=1; render(); });
      de.addEventListener('change', () => { uiFilters.demandDateEnd = de.value || ''; uiPagination.demandsPage=1; render(); });

      const pills = buildFilterPills({ includeClear:true });

      return el('div', { class:'grid', style:'gap:10px' }, [
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [el('label', {}, ['Status']), statusSel]),
          el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
          el('div', { class:'field', style:'flex:1;min-width:240px' }, [el('label', {}, ['Pesquisar título']), titleSearch]),
          el('div', { class:'field' }, [el('label', {}, ['De']), ds]),
          el('div', { class:'field' }, [el('label', {}, ['Até']), de]),
        ]),
        pills ? pills : el('div', { style:'display:none' }, [''])
      ]);
    })();

    const donutNode = (() => {
      const order = ['Em andamento','Atrasada','Concluída','Mapeada','Congelada'];
      const colors = {
        'Em andamento': 'var(--indigo)',
        'Atrasada': 'var(--red)',
        'Concluída': 'var(--green)',
        'Mapeada': 'var(--slate)',
        'Congelada': 'var(--yellow)'
      };
      const realTotal = order.reduce((a,k)=>a+(statusCounts[k]||0),0);

      // Quando não há nenhuma demanda (ou filtros zeraram), não deixar o donut
      // parecer "Congelada" (amarelo). Usamos um estado vazio: cinza + borda tracejada.
      let donut;
      if (!realTotal) {
        donut = el('div', { class:'donut empty', style:`background:conic-gradient(#cbd5e1 0 100%);` });
      } else {
        const total = realTotal;
        let acc = 0;
        const stops = [];
        for (const k of order) {
          const v = (statusCounts[k]||0);
          const pct = (v/total)*100;
          const start = acc;
          acc += pct;
          stops.push(`${colors[k]} ${start.toFixed(2)}% ${acc.toFixed(2)}%`);
        }
        donut = el('div', { class:'donut', style:`background:conic-gradient(${stops.join(',')});` });
      }
      const legend = el('div', { class:'legend' }, order.map(k =>
        el('div', {
          class:'item',
          title:`Filtrar demandas: ${k}`,
          onclick: () => {
            openDonutModal(k);
          }
        }, [
          el('span', { class:'sw', style:`background:${colors[k]}` }),
          `${k}: ${statusCounts[k]||0}`
        ])
      ));
      return el('div', { class:'donutWrap' }, [donut, legend]);
    })();

    const perResource = (() => {
      const perTotal = state.resources.length;
      const perTotalPages = Math.max(1, Math.ceil(perTotal / DASH_PER_RESOURCE_PAGE_SIZE));
      uiPagination.dashboardPerResourcePage = Math.min(Math.max(1, uiPagination.dashboardPerResourcePage), perTotalPages);
      const perStartIdx = (uiPagination.dashboardPerResourcePage - 1) * DASH_PER_RESOURCE_PAGE_SIZE;
      const pageResources = state.resources.slice(perStartIdx, perStartIdx + DASH_PER_RESOURCE_PAGE_SIZE);

      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Recurso']),
        el('th', {}, ['Demandas ativas (mês)']),
        el('th', {}, ['% médio alocado (mês)']),
        el('th', {}, ['Pico']),
        el('th', {}, ['Barra']),
      ])]));
      const tb = el('tbody');
      const daysInMonth = days;

      for (const r of pageResources) {
        // demandas ativas no mês (exclui Concluída e Mapeada)
        const active = (dashboardFilteredDemands||[]).filter(d => {
          if ((d.responsavel_id||'') !== r.id) return false;
          const st = effectiveStatus(d);
          if (st === 'Mapeada' || st === 'Concluída') return false;
          // overlap com o mês
          const start = d.data_inicio;
          const end = d.data_fim;
          const monthStart = formatDate(daysInMonth[0]);
          const monthEnd = formatDate(daysInMonth[daysInMonth.length-1]);
          return !(end < monthStart || start > monthEnd);
        }).length;

        // % medio/pico alocado considerando apenas dias úteis disponíveis; FDS/feriado só entram com HE
        let sum = 0;
        let n = 0;
        let peak = 0;
        for (const day of daysInMonth) {
          const v = dailyPercentAllocated(r.id, day);
          if (v < 0) continue; // feriado/bloq/férias/off
          const p = Number(v||0);
          peak = Math.max(peak, p);
          sum += p;
          n += 1;
        }
        const avg = n ? (sum/n) : 0;
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [r.nome]), el('div', { class:'tiny' }, [r.tipo]) ]));
        tr.appendChild(el('td', {}, [String(active)]));
        tr.appendChild(el('td', {}, [`${avg.toFixed(0)}%`]));
        tr.appendChild(el('td', {}, [`${peak.toFixed(0)}%`]));
        tr.appendChild(el('td', {}, [
          el('div', { class:'bar', title:`Média ${avg.toFixed(0)}%` }, [
            el('span', { style:`width:${Math.min(100, Math.max(0, avg)).toFixed(0)}%` })
          ])
        ]));
        tb.appendChild(tr);
      }

      if (perTotal === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'5', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Cadastre recursos para ver o gráfico por recurso.'])]));
      }

      t.appendChild(tb);

      const pager = buildPager({
        page: uiPagination.dashboardPerResourcePage,
        totalPages: perTotalPages,
        total: perTotal,
        startIdx: perStartIdx,
        shown: pageResources.length,
        onPrev: () => { uiPagination.dashboardPerResourcePage--; render(); },
        onNext: () => { uiPagination.dashboardPerResourcePage++; render(); },
        onFirst: () => { uiPagination.dashboardPerResourcePage = 1; render(); },
        onLast: () => { uiPagination.dashboardPerResourcePage = perTotalPages; render(); },
      });

      return el('div', {}, [
        el('div', { class:'scrollX' }, [t]),
        pager
      ]);
    })();


    const operationalDashboard = (() => {
      const monthStart = formatDate(new Date(year, month, 1));
      const monthEnd = formatDate(new Date(year, month + 1, 0));
      const periodStart = uiFilters.demandDateStart || monthStart;
      const periodEnd = uiFilters.demandDateEnd || monthEnd;
      const model = buildOperationalDashboardModel(dashboardFilteredDemands, periodStart, periodEnd);

      const fmtPct = (v) => `${Number(v || 0).toFixed(Number(v || 0) % 1 ? 1 : 0)}%`;
      const miniMetric = (label, value, hint='') => el('div', { style:'border:1px solid var(--border);border-radius:14px;padding:10px;background:#f8fafc' }, [
        el('div', { class:'tiny muted' }, [label]),
        el('div', { class:'mono', style:'font-weight:950;font-size:18px' }, [value]),
        el('div', { class:'tiny muted', style:'margin-top:2px' }, [hint])
      ]);

      const simpleRanking = (title, rows, columns, emptyMsg) => {
        const t = el('table');
        t.appendChild(el('thead', {}, [el('tr', {}, columns.map(c => el('th', {}, [c.label])))]));
        const tb = el('tbody');
        const topRows = (rows || []).slice(0, 5);
        if (!topRows.length) {
          tb.appendChild(el('tr', {}, [el('td', { colspan:String(columns.length), style:'padding:14px;text-align:center;color:var(--muted)' }, [emptyMsg])]));
        } else {
          for (const row of topRows) {
            tb.appendChild(el('tr', {}, columns.map(c => el('td', {}, [String(c.get(row))]))));
          }
        }
        t.appendChild(tb);
        return el('div', { class:'grid', style:'gap:8px' }, [
          el('div', { style:'font-weight:950' }, [title]),
          el('div', { class:'scrollX' }, [t])
        ]);
      };

      const gargalos = simpleRanking('Gargalos / atenção', model.bottlenecks, [
        { label:'Demanda', get:r => r.title },
        { label:'Realizado', get:r => `${fmtHours(r.realHours)}h` },
        { label:'Planejado', get:r => `${fmtHours(r.plannedHours)}h` },
        { label:'Consumo', get:r => `${fmtPct(r.pct)} • ${r.tone}` },
      ], 'Nenhum gargalo encontrado no período/filtro atual.');

      const rankingDocs = simpleRanking('Ranking de documentos', model.byStep, [
        { label:'Etapa', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhuma etapa apontada no período.');

      const rankingUsers = simpleRanking('Horas por colaborador', model.byUser, [
        { label:'Colaborador', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhum colaborador com apontamento no período.');

      const semanal = simpleRanking('Produtividade semanal', model.byWeek, [
        { label:'Semana', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhuma produtividade semanal no período.');

      const demandasConsumidas = simpleRanking('Demandas mais consumidas', model.byDemand, [
        { label:'Demanda', get:r => r.title },
        { label:'Horas realizadas', get:r => `${fmtHours(r.horas)}h` },
      ], 'Nenhuma demanda consumiu horas reais no período.');

      return el('div', { class:'grid', style:'gap:12px' }, [
        el('div', { class:'tiny muted' }, [
          `Período operacional: ${formatDateBR(periodStart)} até ${formatDateBR(periodEnd)}. `,
          'Considera somente apontamentos reais cadastrados nas demandas filtradas. Não altera a capacidade planejada.'
        ]),
        el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px' }, [
          miniMetric('Horas reais no período', `${fmtHours(model.totalRealHours)}h`, `${model.totalApontamentos} apontamento(s)`),
          miniMetric('Tipos documentais', String(model.byStep.length), 'etapas diferentes'),
          miniMetric('Colaboradores', String(model.byUser.length), 'com apontamento'),
          miniMetric('Demandas consumidas', String(model.byDemand.length), 'com horas reais'),
          miniMetric('Último apontamento', model.lastApontamento ? `${formatDateBR(model.lastApontamento.data)} • ${model.lastApontamento.etapa}` : '—', model.lastApontamento ? model.lastApontamento.demandTitle : 'sem histórico no período'),
        ]),
        el('div', { class:'split' }, [rankingDocs, rankingUsers]),
        el('div', { class:'split' }, [semanal, demandasConsumidas]),
        gargalos
      ]);
    })();

    return el('div', { class:'grid' }, [
      el('div', { class:'kpi' }, [
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Recursos (total)']), el('div', { class:'val' }, [String(totalResources)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Recursos (ativos)']), el('div', { class:'val' }, [String(activeResources)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Demandas (total)']), el('div', { class:'val' }, [String(totalDemands)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Demandas (abertas)']), el('div', { class:'val' }, [String(openDemands)])]),
      ]),
      el('div', { class:'split' }, [
        card('Demandas (Geral)', null, el('div', { class:'grid' }, [dashFiltersBar, donutNode])),
        card('Por Recurso (mês)', null, perResource)
      ]),

      (() => {
        const series = buildConsolidatedYearSeries(year);
const svg = buildCapacityVsPlannedSvg({ title: 'Capacidade VSC - Consolidado', series });
        const totalsMonth = buildConsolidatedMonthTotals(year, (new Date()).getMonth());
        const rightNode = el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;justify-content:flex-end' }, [
          el('div', { class:'tag', title:'Uso do mês atual (Planejado/Capacidade)' }, [
            `Mês: ${Math.round(totalsMonth.usagePct||0)}% • Overcap: ${fmtHours(totalsMonth.overHH||0)}h • Estourados: ${totalsMonth.overResources||0}/${totalsMonth.totalResources||0}`
          ]),
          button('Exportar SVG', 'ghost', () => exportSvg(svg, `capacidade_vsc_${year}.svg`)),
          button('Exportar PNG', 'ghost', () => exportPngFromSvg(svg, `capacidade_vsc_${year}.png`)),
        ]);

        const bodyNode = el('div', { class:'grid', style:'gap:10px' }, [
          el('div', { style:'max-width:100%;overflow:auto' }, [svg])
        ]);

        return card('Capacidade VSC — Consolidado (Ano)', rightNode, bodyNode);
      })(),
      card('Dashboard Planilha', el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;justify-content:flex-end;align-items:center' }, [right, badgeLegend()]), tableBlock)
    ]);
  };


  // Dashboard de Avaliação (v0.3.1.3) — cards em estilo kanban com paginação.
  // Objetivo: comparar janela planejada x execução real apontada, mantendo foco no projeto.
  const viewEvaluationDashboard = () => {
    const dashboardFilteredDemands = filterDemands({
      status: uiFilters.demandStatus,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: uiFilters.demandTitle
    });

    const now = todayISO();
    const EVALUATION_PAGE_SIZE = 6;
    const clamp = (v, min=0, max=100) => Math.max(min, Math.min(max, Number(v || 0)));
    const pctText = (v) => `${clamp(v).toFixed(1).replace('.0','')}%`;
    const hoursText = (v) => `${fmtHours(v)}h`;
    const daysInclusive = (start, end) => {
      const a = isoToLocalMidnight(start);
      const b = isoToLocalMidnight(end);
      if (!a || !b) return 0;
      return Math.max(1, Math.floor((b.getTime() - a.getTime()) / 86400000) + 1);
    };
    const elapsedWindowPct = (demand) => {
      const start = demand?.data_inicio || '';
      const end = demand?.data_fim || '';
      if (!isISODateString(start) || !isISODateString(end)) return 0;
      if (now < start) return 0;
      if (now > end) return 100;
      const total = daysInclusive(start, end);
      const elapsed = daysInclusive(start, now);
      return total ? clamp((elapsed / total) * 100) : 0;
    };
    const remainingDaysLabel = (demand) => {
      if (!demand?.data_fim || !isISODateString(demand.data_fim)) return '';
      const a = isoToLocalMidnight(now);
      const b = isoToLocalMidnight(demand.data_fim);
      if (!a || !b) return '';
      const diff = Math.ceil((b.getTime() - a.getTime()) / 86400000);
      if (diff < 0) return `${Math.abs(diff)} dia(s) após o prazo`;
      if (diff === 0) return 'vence hoje';
      return `${diff} dia(s) restantes`;
    };
    const projectHealth = (metrics, windowPct, demand) => {
      const realPct = Number(metrics.progressPct || 0);
      const remainingText = remainingDaysLabel(demand);
      const isExpired = remainingText.includes('após o prazo');
      if (!metrics.plannedHours) return { label:'Sem base planejada', tone:'neutral', hint:'Demanda sem horas planejadas calculáveis.' };
      if (metrics.realHours > metrics.plannedHours) return { label:'Acima do planejado', tone:'danger', hint:'Horas realizadas já superaram as horas planejadas.' };
      if (isExpired && realPct < 100) return { label:'Prazo vencido', tone:'danger', hint:'Janela encerrada com execução real abaixo do planejado.' };
      if (windowPct >= 70 && realPct < 40) return { label:'Atenção ao andamento', tone:'warn', hint:'A janela avançou mais que a execução real apontada.' };
      if (realPct >= 90) return { label:'Próximo do limite', tone:'warn', hint:'Consumo de horas já está próximo do planejado.' };
      if (realPct > windowPct + 25) return { label:'Consumo acelerado', tone:'warn', hint:'Execução real está consumindo horas mais rápido que a janela.' };
      if (realPct > 0) return { label:'Dentro do planejado', tone:'ok', hint:'Execução real compatível com a janela planejada.' };
      return { label:'Não iniciado', tone:'neutral', hint:'Sem apontamentos reais registrados para a demanda.' };
    };

    const projects = (dashboardFilteredDemands || []).map(d => {
      const metrics = demandExecutionMetrics(d);
      const apontamentos = normalizeDemandApontamentos(d);
      const windowPct = elapsedWindowPct(d);
      const health = projectHealth(metrics, windowPct, d);
      const remainingBalance = Number(metrics.plannedHours || 0) - Number(metrics.realHours || 0);
      const etapasUnicas = new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean)).size;
      const lastStep = apontamentos.slice().sort((a,b) =>
        String(b.data||'').localeCompare(String(a.data||'')) || Number(b.created_at||0)-Number(a.created_at||0)
      )[0] || null;
      const stepBadges = [...new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean))].slice(0,6);
      return { demand:d, metrics, apontamentos, windowPct, health, remainingBalance, etapasUnicas, lastStep, stepBadges, remainingDays: remainingDaysLabel(d) };
    }).sort((a,b) => {
      const toneWeight = { danger:0, warn:1, neutral:2, ok:3 };
      return (toneWeight[a.health.tone] ?? 9) - (toneWeight[b.health.tone] ?? 9) || String(a.demand.data_fim||'').localeCompare(String(b.demand.data_fim||''));
    });

    const totals = projects.reduce((acc,p) => {
      acc.planned += Number(p.metrics.plannedHours || 0);
      acc.real += Number(p.metrics.realHours || 0);
      acc.apontamentos += Number(p.metrics.apontamentosCount || 0);
      if (p.health.tone === 'danger' || p.health.tone === 'warn') acc.attention += 1;
      return acc;
    }, { planned:0, real:0, apontamentos:0, attention:0 });
    const overallPct = totals.planned > 0 ? (totals.real / totals.planned) * 100 : 0;

    const miniMetric = (label, value, hint='', tone='') => el('div', {
      style:`border:1px solid var(--border);border-radius:14px;padding:10px;background:${tone==='ok'?'#ecfdf5':tone==='warn'?'#fffbeb':tone==='danger'?'#fef2f2':'#f8fafc'}`
    }, [
      el('div', { class:'tiny muted' }, [label]),
      el('div', { class:'mono', style:'font-weight:950;font-size:18px;line-height:1.15' }, [value]),
      el('div', { class:'tiny muted', style:'margin-top:3px' }, [hint])
    ]);

    const progressBar = (pct, title) => el('div', { class:'bar', title }, [
      el('span', { style:`width:${clamp(pct).toFixed(0)}%` })
    ]);

    const projectCard = (p) => {
      const d = p.demand;
      const m = p.metrics;
      const statusTone = p.health.tone === 'danger' ? 'bad' : (p.health.tone === 'warn' ? 'warn' : (p.health.tone === 'ok' ? 'ok' : 'info'));
      const balanceText = p.remainingBalance >= 0
        ? `${hoursText(p.remainingBalance)}`
        : `${hoursText(Math.abs(p.remainingBalance))}`;
      const balanceHint = p.remainingBalance >= 0 ? 'restantes' : 'acima do planejado';
      const balanceTone = p.remainingBalance < 0 ? 'danger' : 'ok';
      const lastText = p.lastStep
        ? `${formatDateBR(p.lastStep.data)} • ${normalizeProjectStep(p.lastStep.etapa)}`
        : '—';

      return el('div', {
        style:'border:1px solid var(--border);border-radius:18px;padding:14px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.06);display:flex;flex-direction:column;gap:12px;min-height:340px'
      }, [
        el('div', { class:'row', style:'justify-content:space-between;gap:10px;align-items:flex-start' }, [
          el('div', { style:'min-width:0' }, [
            el('div', { style:'font-weight:950;font-size:15px;line-height:1.25;word-break:break-word' }, [d.titulo || d.id || 'Demanda']),
            el('div', { class:'tiny muted', style:'margin-top:4px' }, [`Janela: ${formatDateBR(d.data_inicio)} até ${formatDateBR(d.data_fim)}${p.remainingDays ? ' • ' + p.remainingDays : ''}`])
          ]),
          el('span', { class:`pill ${statusTone}`, title:p.health.hint, style:'white-space:nowrap' }, [p.health.label])
        ]),

        el('div', { style:'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px' }, [
          miniMetric('Horas planejadas', hoursText(m.plannedHours), `${m.plannedDays || 0} dia(s) úteis`),
          miniMetric('Horas realizadas', hoursText(m.realHours), `${m.apontamentosCount || 0} apontamento(s)`),
          miniMetric('Saldo de horas', balanceText, balanceHint, balanceTone),
          miniMetric('Eficiência', pctText(m.progressPct), 'realizado ÷ planejado'),
          miniMetric('Progresso real', pctText(m.progressPct), 'realizado ÷ planejado'),
          miniMetric('Tendência', p.health.label, 'baseado nas horas realizadas', p.health.tone === 'danger' ? 'danger' : (p.health.tone === 'warn' ? 'warn' : (p.health.tone === 'ok' ? 'ok' : ''))),
          miniMetric('Etapas', String(p.etapasUnicas || 0), 'tipos documentais'),
          miniMetric('Último apontamento', lastText, 'histórico operacional')
        ]),

        el('div', { class:'grid', style:'gap:8px;margin-top:auto' }, [
          el('div', { class:'row', style:'justify-content:space-between' }, [el('div', { class:'tiny muted' }, ['Avanço da janela']), el('div', { class:'tiny mono' }, [pctText(p.windowPct)])]),
          progressBar(p.windowPct, 'Percentual da janela planejada já consumido'),
          el('div', { class:'row', style:'justify-content:space-between' }, [el('div', { class:'tiny muted' }, ['Execução real apontada']), el('div', { class:'tiny mono' }, [pctText(m.progressPct)])]),
          progressBar(m.progressPct, 'Percentual das horas planejadas já apontado como realizado')
        ]),

        p.stepBadges.length
          ? el('div', { class:'row', style:'gap:6px;flex-wrap:wrap' }, p.stepBadges.map(step => el('span', { class:'tag' }, [step])))
          : el('div', { class:'tiny muted' }, ['Sem etapas apontadas.'])
      ]);
    };

    const filtersBar = (() => {
      const title = el('input', { type:'search', placeholder:'Filtrar por projeto...', value: uiFilters.demandTitle || '' });
      bindDemandTitleSearch(title, 'evaluationProjectSearch', 'evaluationPage', 'evaluation');
      const status = el('select', {}, [
        el('option', { value:'' }, ['Todos os status']),
        ...STATUS.map(s => el('option', { value:s, selected: uiFilters.demandStatus === s }, [s]))
      ]);
      status.addEventListener('change', () => { uiFilters.demandStatus = status.value; uiPagination.evaluationPage = 1; render(); });
      return el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;align-items:end' }, [
        el('div', { class:'field', style:'min-width:220px;flex:1' }, [el('label', {}, ['Projeto']), title]),
        el('div', { class:'field', style:'min-width:180px' }, [el('label', {}, ['Status']), status]),
      ]);
    })();

    const total = projects.length;
    const totalPages = Math.max(1, Math.ceil(total / EVALUATION_PAGE_SIZE));
    uiPagination.evaluationPage = Math.min(Math.max(1, uiPagination.evaluationPage || 1), totalPages);
    const startIdx = (uiPagination.evaluationPage - 1) * EVALUATION_PAGE_SIZE;
    const pageItems = projects.slice(startIdx, startIdx + EVALUATION_PAGE_SIZE);

    const cards = projects.length
      ? el('div', { class:'grid', style:'gap:12px' }, [
          el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px;align-items:stretch' }, pageItems.map(projectCard)),
          buildPager({
            page: uiPagination.evaluationPage,
            totalPages,
            total,
            startIdx,
            shown: pageItems.length,
            onPrev: () => { uiPagination.evaluationPage--; render(); },
            onNext: () => { uiPagination.evaluationPage++; render(); },
            onFirst: () => { uiPagination.evaluationPage = 1; render(); },
            onLast: () => { uiPagination.evaluationPage = totalPages; render(); },
          })
        ])
      : el('div', { style:'padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:#fff' }, ['Nenhuma demanda encontrada para avaliação.']);

    return el('div', { class:'grid', style:'gap:14px' }, [
      card('Dashboard de Avaliação', null, el('div', { class:'grid', style:'gap:12px' }, [
        el('div', { class:'tiny muted' }, ['Visão por projeto: compara a janela planejada com as horas reais apontadas, sem ranking por colaborador.']),
        filtersBar,
        el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px' }, [
          miniMetric('Projetos avaliados', String(projects.length), 'demandas no filtro atual'),
          miniMetric('Horas planejadas', hoursText(totals.planned), 'base de planejamento'),
          miniMetric('Horas realizadas', hoursText(totals.real), `${totals.apontamentos} apontamento(s)`),
          miniMetric('Aderência geral', pctText(overallPct), 'realizado ÷ planejado'),
          miniMetric('Projetos em atenção', String(totals.attention), 'atenção ou acima do planejado')
        ])
      ])),
      card('Avaliação por Projeto — Kanban', null, cards)
    ]);
  };


  const viewResources = () => {
    const form = (() => {
      const name = el('input', { placeholder:'Ex: Arthur', value:'' });
      const type = el('select', {}, [
        el('option', { value:'Interno' }, ['Interno']),
        el('option', { value:'Terceiro' }, ['Terceiro']),
      ]);
      const hours = el('input', { type:'number', min:'0', step:'0.5', value:String(HOURS_PER_DAY), disabled:'true', title:'Regra fixa do app: 9h/dia' });
      const active = el('select', {}, [
        el('option', { value:'true' }, ['Ativo']),
        el('option', { value:'false' }, ['Inativo']),
      ]);
      const vigIni = el('input', { type:'date' });
      const vigFim = el('input', { type:'date' });

      const thirdWrap = el('div', { class:'row', style:'width:100%' }, [
        el('div', { class:'field' }, [el('label', {}, ['Vigência Início (Terceiro)']), vigIni]),
        el('div', { class:'field' }, [el('label', {}, ['Vigência Fim (Terceiro)']), vigFim]),
      ]);
      const updateThirdVisibility = () => {
        thirdWrap.style.display = (type.value === 'Terceiro') ? '' : 'none';
      };
      type.addEventListener('change', updateThirdVisibility);
      updateThirdVisibility();

      const submit = () => {
        const nome = name.value.trim();
        if (!nome) return toast('Informe o nome do recurso.');
        const payload = {
          id: generateId(),
          nome,
          tipo: type.value,
          horas_dia: HOURS_PER_DAY,
          ativo: active.value === 'true',
          vigencia_inicio: vigIni.value || undefined,
          vigencia_fim: vigFim.value || undefined,
        };
        dispatch('ADD_RESOURCE', payload);
        name.value = ''; hours.value = String(HOURS_PER_DAY); type.value = 'Interno'; active.value = 'true'; vigIni.value=''; vigFim.value='';
        updateThirdVisibility();
        toast('Recurso adicionado.');
      };

      return card('Cadastrar Recurso',
        el('div', { class:'row' }, [button('Adicionar', 'primary', submit)]),
        el('div', { class:'split' }, [
          el('div', {}, [
            el('div', { class:'row' }, [
              el('div', { class:'field' }, [el('label', {}, ['Nome']), name]),
              el('div', { class:'field' }, [el('label', {}, ['Tipo']), type]),
              el('div', { class:'field' }, [el('label', {}, ['Horas/dia']), hours]),
              el('div', { class:'field' }, [el('label', {}, ['Status']), active]),
            ]),
            thirdWrap,
            el('div', { class:'hint tiny' }, [
              el('b', {}, ['Dica: ']),
              'Para Terceiro, fora da vigência o dia aparece como OFF e não conta capacidade.'
            ])
          ]),
        ])
      );
    })();

    const list = (() => {
      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Nome']),
        el('th', {}, ['Tipo']),
        el('th', {}, ['Horas/dia']),
        el('th', {}, ['Ativo']),
        el('th', {}, ['Vigência']),
        el('th', {}, ['Ações']),
      ])]));

      const tb = el('tbody');
      const allRes = newestFirst(state.resources||[]);
      const total = allRes.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      uiPagination.resourcesPage = Math.min(Math.max(1, uiPagination.resourcesPage), totalPages);
      const startIdx = (uiPagination.resourcesPage - 1) * PAGE_SIZE;
      const pageItems = allRes.slice(startIdx, startIdx + PAGE_SIZE);

      for (const r of pageItems) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [r.nome]), el('div', { class:'tiny' }, [r.id]) ]));
        tr.appendChild(el('td', {}, [r.tipo]));
        tr.appendChild(el('td', {}, [String(HOURS_PER_DAY)]));
        tr.appendChild(el('td', {}, [r.ativo === false ? 'Não' : 'Sim']));
        const vig = (r.tipo === 'Terceiro') ? `${r.vigencia_inicio?formatDateBR(r.vigencia_inicio):'—'} → ${r.vigencia_fim?formatDateBR(r.vigencia_fim):'—'}` : '—';
        tr.appendChild(el('td', { class:'mono tiny' }, [vig]));

        const edit = () => {
          openResourceEditModal(r);
        };

        const del = () => {
          if (!confirm(`Excluir recurso "${r.nome}"?`)) return;
          // Also remove linked demands and blockings
          state.demands = state.demands.filter(d => d.responsavel_id !== r.id);
          state.blockings = state.blockings.filter(b => b.recurso_id !== r.id);
          dispatch('DELETE_RESOURCE', r.id);
          toast('Recurso excluído.');
        };

        tr.appendChild(el('td', {}, [
          el('div', { class:'row' }, [
            button('Editar', '', edit),
            button('Excluir', 'danger', del),
          ])
        ]));

        tb.appendChild(tr);
      }

      if (state.resources.length === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'padding:20px;text-align:center;color:var(--muted)' }, ['Nenhum recurso ainda.'])]));
      }

      t.appendChild(tb);

      const pager = buildPager({
        page: uiPagination.resourcesPage,
        totalPages,
        total,
        startIdx,
        shown: pageItems.length,
        onPrev: () => { uiPagination.resourcesPage--; render(); },
        onNext: () => { uiPagination.resourcesPage++; render(); },
        onFirst: () => { uiPagination.resourcesPage = 1; render(); },
        onLast: () => { uiPagination.resourcesPage = totalPages; render(); },
      });

      const right = el('div', { class:'row' }, [
        button('Limpar dados do sistema', 'danger', confirmClearAllData)
      ]);

      const body = el('div', { class:'grid', style:'gap:10px' }, [t, (totalPages>1 ? pager : null)].filter(Boolean));
      return card('Recursos Cadastrados', right, body);
    })();

    return el('div', { class:'grid' }, [form, list]);
  };

  const viewDemands = () => {
    const resMap = resourceById();

    const filteredDemands = (() => {
      return filterDemands({
        status: uiFilters.demandStatus,
        resourceId: uiFilters.demandResourceId,
        dateStart: uiFilters.demandDateStart,
        dateEnd: uiFilters.demandDateEnd,
        titleQuery: uiFilters.demandTitle
      });
    })();

    const form = (() => {
      const titulo = el('input', { placeholder:'Ex: PQ Sistema X' });
      const predio = el('input', { placeholder:'Ex: Prédio A' });
      const focal = el('input', { placeholder:'Ex: Fulano (Focal)' });

      // Responsáveis: busca + chips (mais intuitivo que select multiple/Ctrl)
      const selectedRespIds = new Set();
      const respSearch = el('input', { class:'multiSelectInput', placeholder:'Digite o nome do responsável...' });
      const respChips = el('div', { style:'display:contents' });
      const respMenu = el('div', { class:'multiSelectMenu' });
      const respBox = el('div', { class:'multiSelectBox' }, [respChips, respSearch]);
      const responsavel = el('div', { class:'multiSelect', title:'Digite para buscar e clique para adicionar responsáveis' }, [
        respBox,
        respMenu
      ]);

      const getRespName = (id) => (state.resources||[]).find(r => r.id === id)?.nome || id;
      const selectedResponsaveis = () => [...selectedRespIds].filter(Boolean);
      const closeRespMenu = () => responsavel.classList.remove('open');
      const openRespMenu = () => { if (!respSearch.disabled) { responsavel.classList.add('open'); renderRespOptions(); } };
      const isRespBoxAtEnd = () => {
        if (!respBox) return true;
        return (respBox.scrollLeft + respBox.clientWidth) >= (respBox.scrollWidth - 8);
      };
      const restoreRespBoxScroll = (scrollLeft, shouldStayAtEnd=false) => {
        if (!respBox) return;
        respBox.scrollLeft = shouldStayAtEnd ? respBox.scrollWidth : scrollLeft;
      };
      const removeResponsavelChip = (rid) => {
        if (!rid || !selectedRespIds.has(rid)) return;
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        selectedRespIds.delete(rid);
        renderRespChips();
        renderRespOptions();
        restoreRespBoxScroll(keepScrollLeft, false);
        if (selectedRespIds.size === 0) { status.value = 'Mapeada'; syncMapeada(); }
      };

      const renderRespChips = () => {
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        respChips.innerHTML = '';
        for (const rid of selectedRespIds) {
          const chip = el('span', { class:'multiSelectChip', 'data-rid': rid }, [
            el('span', {}, [getRespName(rid)]),
            el('button', { type:'button', title:'Remover responsável', 'data-remove-rid': rid }, ['×'])
          ]);
          const btnRemove = chip.querySelector('button');
          btnRemove.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            removeResponsavelChip(rid);
          });
          btnRemove.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          });
          respChips.appendChild(chip);
        }
        restoreRespBoxScroll(keepScrollLeft, false);
      };
      const addResponsavelChip = (rid) => {
        if (!rid || selectedRespIds.has(rid)) return;
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        const wasAtEnd = isRespBoxAtEnd() && document.activeElement === respSearch;
        selectedRespIds.add(rid);
        respSearch.value = '';
        if (normalizeStatus(status.value) === 'Mapeada') status.value = 'Em andamento';
        syncMapeada();
        renderRespChips();
        renderRespOptions();
        openRespMenu();
        restoreRespBoxScroll(keepScrollLeft, wasAtEnd);
      };

      const renderRespOptions = () => {
        const q = (respSearch.value||'').trim().toLowerCase();
        const available = (state.resources||[])
          .filter(r => !selectedRespIds.has(r.id))
          .filter(r => !q || String(r.nome||'').toLowerCase().includes(q) || String(r.tipo||'').toLowerCase().includes(q))
          .slice(0, 12);
        respMenu.innerHTML = '';
        if (!available.length) {
          respMenu.appendChild(el('div', { class:'multiSelectEmpty' }, [q ? 'Nenhum responsável encontrado.' : 'Todos os responsáveis já foram selecionados.']));
          return;
        }
        for (const r of available) {
          const opt = el('button', { type:'button', class:'multiSelectOption', 'data-rid': r.id }, [`${r.nome}${r.tipo==='Terceiro' ? ' (Terceiro)' : ''}`]);
          respMenu.appendChild(opt);
        }
      };

      respMenu.addEventListener('mousedown', (ev) => {
        const opt = ev.target.closest('.multiSelectOption');
        if (!opt) return;
        ev.preventDefault();
        ev.stopPropagation();
        addResponsavelChip(opt.getAttribute('data-rid'));
      });

      respSearch.addEventListener('input', () => { openRespMenu(); });
      respSearch.addEventListener('focus', openRespMenu);
      respSearch.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !respSearch.value && selectedRespIds.size) {
          const last = [...selectedRespIds].at(-1);
          removeResponsavelChip(last);
        }
        if (ev.key === 'Escape') closeRespMenu();
      });
      responsavel.addEventListener('mousedown', (ev) => {
        if (ev.target.closest('.multiSelectOption')) return;
        if (ev.target.closest('[data-remove-rid]')) return;
        if (ev.target.closest('.multiSelectChip')) return;
        if (respSearch.disabled) return;
        setTimeout(() => { try { respSearch.focus(); openRespMenu(); } catch {} }, 0);
      });
      document.addEventListener('mousedown', (ev) => { if (!responsavel.contains(ev.target)) closeRespMenu(); });

      const ini = el('input', { type:'date' });
      const fim = el('input', { type:'date' });
      const perc = el('input', { type:'number', min:'0', step:'5', value:'100' });
      const prioridade = el('select', {}, [
        el('option', { value:'Baixa' }, ['Baixa']),
        el('option', { value:'Média' }, ['Média']),
        el('option', { value:'Alta' }, ['Alta']),
        el('option', { value:'Crítica' }, ['Crítica']),
      ]);
      const status = el('select', {}, [
        el('option', { value:'Em andamento' }, ['Em andamento']),
        el('option', { value:'Concluída' }, ['Concluída']),
        el('option', { value:'Mapeada' }, ['Mapeada (sem responsável)']),
        el('option', { value:'Congelada' }, ['Congelada']),
      ]);
      const obs = el('textarea', { placeholder:'Observações...' });

      const syncMapeada = () => {
        const st = normalizeStatus(status.value);
        if (st === 'Mapeada') {
          selectedRespIds.clear();
          respSearch.value = '';
          // Mantém o campo habilitado: se o usuário clicar em um responsável,
          // o status muda automaticamente para Em andamento. Isso evita depender
          // de Ctrl e evita o bloqueio visual do campo.
          respSearch.disabled = false;
          responsavel.classList.remove('disabled');
        } else {
          respSearch.disabled = false;
          responsavel.classList.remove('disabled');
        }
        renderRespChips();
        renderRespOptions();
      };
      status.addEventListener('change', syncMapeada);
      // default
      status.value = 'Mapeada';
      syncMapeada();

      // Prefill vindo de atalhos (ex.: abrir dia na matriz de janelas e clicar em "Cadastrar demanda")
      if (uiFilters.prefillDemand) {
        const p = uiFilters.prefillDemand;
        if (p.data_inicio) ini.value = p.data_inicio;
        if (p.data_fim) fim.value = p.data_fim;
        if (p.responsavel_id) {
          selectedRespIds.add(p.responsavel_id);
          status.value = 'Em andamento';
        } else {
          status.value = 'Mapeada';
        }
        syncMapeada();
        uiFilters.prefillDemand = null;
      }

      const submit = () => {
        if (!titulo.value.trim()) return toast('Informe o título.');

        // Regras: Mapeada = sempre sem responsável; demais status permitem 1 ou mais responsáveis
        let st = normalizeStatus(status.value);
        const respIds = selectedResponsaveis();
        const hasResp = respIds.length > 0;
        if (!hasResp) st = 'Mapeada';
        if (st !== 'Mapeada' && !hasResp) return toast('Selecione um ou mais responsáveis ou marque como Mapeada.');

        // Regra: não é permitido CADASTRAR como Atrasada (status é automático, quando aplicável)
        if (st === 'Atrasada') return toast('Status Atrasada é automático — selecione outro status para cadastrar.');

        // Datas: só são opcionais quando for Mapeada (sem responsável)
        const iniVal = (ini.value || '').trim();
        const fimVal = (fim.value || '').trim();
        if (st === 'Mapeada') {
          // permite sem datas, mas se preencher uma, exige as duas e valida ordem
          if ((iniVal && !fimVal) || (!iniVal && fimVal)) return toast('Para demanda Mapeada: preencha início e fim ou deixe ambos em branco.');
          if (iniVal && fimVal && fimVal < iniVal) return toast('Para demanda Mapeada: a data fim não pode ser anterior ao início.');
        } else {
          if (!iniVal || !fimVal) return toast('Informe início e fim.');
          if (fimVal < iniVal) return toast('A data fim não pode ser anterior ao início.');
        }

        const basePayload = {
          titulo: titulo.value.trim(),
          predio: (predio.value||'').trim(),
          focal: (focal.value||'').trim(),
          data_inicio: iniVal,
          data_fim: fimVal,
          percentual_diario: Number(perc.value||0),
          observacoes: obs.value || '',
          prioridade: prioridade.value,
          status: st,
          reprogramacoes: 0,
        };
        const targets = (st === 'Mapeada') ? [''] : respIds;
        for (const rid of targets) {
          dispatch('ADD_DEMAND', { ...basePayload, id: generateId(), responsavel_id: rid });
        }
        titulo.value=''; predio.value=''; selectedRespIds.clear(); respSearch.value=''; focal.value=''; ini.value=''; fim.value=''; perc.value='100'; obs.value=''; prioridade.value='Média'; status.value='Mapeada';
        syncMapeada();
        toast(targets.length > 1 ? `${targets.length} demandas adicionadas.` : 'Demanda adicionada.');
      };

      const right = el('div', { class:'row' }, [button('Adicionar', 'primary', submit)]);
      const body = el('div', { class:'split' }, [
        el('div', {}, [
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Título']), titulo]),
            el('div', { class:'field' }, [el('label', {}, ['Prédio']), predio]),
            el('div', { class:'field' }, [el('label', {}, ['Focal']), focal]),
            el('div', { class:'field demandRespField' }, [el('label', {}, ['Responsável(is)']), responsavel]),
            el('div', { class:'field demandPercField' }, [el('label', {}, ['% diário']), perc]),
            el('div', { class:'field' }, [el('label', {}, ['Prioridade']), prioridade]),
            el('div', { class:'field' }, [el('label', {}, ['Status']), status]),
          ]),
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Início']), ini]),
            el('div', { class:'field' }, [el('label', {}, ['Fim']), fim]),
          ]),
          el('div', { class:'field' }, [el('label', {}, ['Observações']), obs])
        ])
      ]);
      const c = card('Cadastrar Demanda', right, body);
      c.id = 'demandsFormCard';
      return c;
    })();

    const list = (() => {
      // Filtros (Status + Recurso + Intervalo de datas)
      const statusSel = el('select');
      statusSel.appendChild(el('option', { value:'' }, ['Todos os status']));
      for (const s of STATUS) statusSel.appendChild(el('option', { value:s }, [s]));
      statusSel.value = uiFilters.demandStatus || '';
      statusSel.addEventListener('change', () => { uiFilters.demandStatus = statusSel.value; uiPagination.demandsPage=1; render(); });

      const resSel = el('select');
      resSel.appendChild(el('option', { value:'' }, ['Todos os recursos']));
      resSel.appendChild(el('option', { value:'__NONE__' }, ['Sem responsável (Mapeada)']));
      for (const r of state.resources) resSel.appendChild(el('option', { value:r.id }, [r.nome]));
      resSel.value = uiFilters.demandResourceId || '';
      resSel.addEventListener('change', () => { uiFilters.demandResourceId = resSel.value; uiPagination.demandsPage=1; render(); });

      const titleSearch = el('input', { type:'search', placeholder:'Digite parte do título...' });
      bindDemandTitleSearch(titleSearch, 'dashboardDemandTitleSearch');

      const ds = el('input', { type:'date' });
      const de = el('input', { type:'date' });
      ds.value = uiFilters.demandDateStart || '';
      de.value = uiFilters.demandDateEnd || '';
      ds.addEventListener('change', () => { uiFilters.demandDateStart = ds.value || ''; uiPagination.demandsPage=1; render(); });
      de.addEventListener('change', () => { uiFilters.demandDateEnd = de.value || ''; uiPagination.demandsPage=1; render(); });

      const clearAll = () => {
        uiFilters.demandStatus = '';
        uiFilters.demandResourceId = '';
        uiFilters.demandDateStart = '';
        uiFilters.demandDateEnd = '';
        uiFilters.demandTitle = '';
        toast('Filtros limpos.');
        uiPagination.demandsPage=1;
        render();
      };

      const filtersBar = el('div', { class:'row' }, [
        el('div', { class:'field' }, [el('label', {}, ['Status']), statusSel]),
        el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
        el('div', { class:'field', style:'flex:1;min-width:240px' }, [el('label', {}, ['Pesquisar título']), titleSearch]),
        el('div', { class:'field' }, [el('label', {}, ['Data início (filtro)']), ds]),
        el('div', { class:'field' }, [el('label', {}, ['Data fim (filtro)']), de]),
      ]);

      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Título']),
        el('th', {}, ['Prédio']),
        el('th', {}, ['Focal']),
        el('th', {}, ['Responsável']),
        el('th', {}, ['Período']),
        el('th', {}, ['%/dia']),
        el('th', {}, ['Prioridade']),
        el('th', {}, ['Status']),
        el('th', {}, ['Ações']),
      ])]));
      const tb = el('tbody');

      const orderedDemands = newestFirst(filteredDemands);
      const total = orderedDemands.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      uiPagination.demandsPage = Math.min(Math.max(1, uiPagination.demandsPage), totalPages);
      const startIdx = (uiPagination.demandsPage - 1) * PAGE_SIZE;
      const pageItems = orderedDemands.slice(startIdx, startIdx + PAGE_SIZE);

      for (const d of pageItems) {
        const tr = el('tr');
        if (effectiveStatus(d) === 'Atrasada') tr.classList.add('overdueRow');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [d.titulo]), el('div', { class:'tiny' }, [d.observacoes||''])]));
        tr.appendChild(el('td', {}, [d.predio||'—']));
        tr.appendChild(el('td', {}, [d.focal||'—']));
        tr.appendChild(el('td', {}, [resMap[d.responsavel_id]?.nome || '—']));
        tr.appendChild(el('td', { class:'mono tiny' }, [`${formatDateBR(d.data_inicio)} → ${formatDateBR(d.data_fim)}`]));
        tr.appendChild(el('td', {}, [String(d.percentual_diario||0)]));
        tr.appendChild(el('td', {}, [d.prioridade]));
        tr.appendChild(el('td', {}, [statusPill(d)]));

        const edit = () => {
          openDemandEditModal(d);
        };

        const stages = () => {
          openDemandStagesModal(d);
        };

        const reprogram = () => {
          openDemandReprogramModal(d);
        };

        const del = () => {
          if (!confirm(`Excluir demanda "${d.titulo}"?`)) return;
          dispatch('DELETE_DEMAND', d.id);
          toast('Demanda excluída.');
        };

        tr.appendChild(el('td', {}, [
          el('div', { class:'row' }, [
            button('Etapas', '', stages),
            button('Editar', '', edit),
            button('Reprogramar', '', reprogram),
            button('Excluir', 'danger', del),
          ])
        ]));
        tb.appendChild(tr);
      }

      if (filteredDemands.length === 0) {
        const msg = (state.demands||[]).length === 0
          ? 'Nenhuma demanda ainda.'
          : (hasAnyDemandFilters() ? 'Nenhuma demanda para estes filtros.' : 'Nenhuma demanda encontrada.');
        tb.appendChild(el('tr', {}, [el('td', { colspan:'9', style:'padding:20px;text-align:center;color:var(--muted)' }, [msg])]));
      }

      t.appendChild(tb);
      const right = hasAnyDemandFilters() ? buildFilterPills({ includeClear:true }) : null;

      const pager = buildPager({
        page: uiPagination.demandsPage,
        totalPages,
        total,
        startIdx,
        shown: pageItems.length,
        onPrev: () => { uiPagination.demandsPage--; render(); },
        onNext: () => { uiPagination.demandsPage++; render(); },
        onFirst: () => { uiPagination.demandsPage = 1; render(); },
        onLast: () => { uiPagination.demandsPage = totalPages; render(); },
      });

      const bodyWrap = el('div', { class:'grid', style:'gap:10px' }, [filtersBar, t, (totalPages>1 ? pager : null)].filter(Boolean));
      const c = card('Demandas', right, bodyWrap);
      c.id = 'demandsListCard';
      return c;
    })();

    const warn = (state.resources.length === 0)
      ? el('div', { class:'warn' }, ['Cadastre pelo menos 1 recurso antes de criar demandas.'])
      : null;

    const root = el('div', { class:'grid' }, [warn, form, list].filter(Boolean));
    // se veio do clique na legenda, faz scroll para a lista e reseta o flag
    if (uiFilters.focusDemandsList) {
      uiFilters.focusDemandsList = false;
      setTimeout(() => {
        const node = document.getElementById('demandsListCard');
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior:'smooth', block:'start' });
      }, 0);
    }

    // se veio de um atalho de cadastro (ex.: modal do dia), faz scroll para o formulário
    if (uiFilters.focusDemandsForm) {
      uiFilters.focusDemandsForm = false;
      setTimeout(() => {
        const node = document.getElementById('demandsFormCard');
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior:'smooth', block:'start' });
      }, 0);
    }
    return root;
  };

  const viewCalendar = () => {
    const resMap = resourceById();

    const form = (() => {
      const res = el('select');
      res.appendChild(el('option', { value:'' }, ['Selecione...']));
      for (const r of state.resources) res.appendChild(el('option', { value:r.id }, [r.nome]));
      const date = el('input', { type:'date' });
      const tipo = el('select', {}, [
        el('option', { value:'Férias' }, ['Férias']),
        el('option', { value:'Reunião' }, ['Reunião']),
        el('option', { value:'Indisponível' }, ['Indisponível']),
      ]);

      const hDate = el('input', { type:'date' });
      const hDesc = el('input', { placeholder:'Ex: Feriado Municipal' });

      const addBlocking = () => {
        if (!res.value) return toast('Selecione um recurso.');
        if (!date.value) return toast('Selecione a data.');
        dispatch('ADD_BLOCKING', { id: generateId(), recurso_id: res.value, data: date.value, tipo: tipo.value });
        uiPagination.blockingsPage = 1;
        date.value='';
        toast('Bloqueio adicionado.');
      };
      const addHoliday = () => {
        if (!hDate.value) return toast('Selecione a data do feriado.');
        dispatch('ADD_HOLIDAY', { id: generateId(), data: hDate.value, descricao: (hDesc.value||'').trim() || 'Feriado' });
        uiPagination.holidaysPage = 1;
        hDate.value=''; hDesc.value='';
        toast('Feriado adicionado.');
      };

      return el('div', { class:'grid' }, [
        card('Adicionar Bloqueio', el('div', { class:'row' }, [button('Adicionar', 'primary', addBlocking)]),
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Recurso']), res]),
            el('div', { class:'field' }, [el('label', {}, ['Data']), date]),
            el('div', { class:'field' }, [el('label', {}, ['Tipo']), tipo]),
          ])
        ),
        card('Adicionar Feriado', el('div', { class:'row' }, [button('Adicionar', 'primary', addHoliday)]),
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Data']), hDate]),
            el('div', { class:'field' }, [el('label', {}, ['Descrição']), hDesc]),
          ])
        )
      ]);
    })();

    const lists = (() => {
      // Paginação: 10 itens por página (Bloqueios e Feriados)

      // ---- Bloqueios
      const blockingsAll = (state.blockings||[]).slice().sort((a,b) => {
        const da = a.data || '';
        const db = b.data || '';
        if (da !== db) return da.localeCompare(db);
        const ra = (resMap[a.recurso_id]?.nome || '');
        const rb = (resMap[b.recurso_id]?.nome || '');
        if (ra !== rb) return ra.localeCompare(rb);
        return String(a.id||'').localeCompare(String(b.id||''));
      });

      const bTotal = blockingsAll.length;
      const bTotalPages = Math.max(1, Math.ceil(bTotal / PAGE_SIZE));
      uiPagination.blockingsPage = Math.min(Math.max(1, uiPagination.blockingsPage), bTotalPages);
      const bStartIdx = (uiPagination.blockingsPage - 1) * PAGE_SIZE;
      const blockings = blockingsAll.slice(bStartIdx, bStartIdx + PAGE_SIZE);

      const t1 = el('table');
      t1.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Recurso']),
        el('th', {}, ['Data']),
        el('th', {}, ['Tipo']),
        el('th', {}, ['Ações'])
      ])]));

      const btb = el('tbody');
      for (const b of blockings) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [resMap[b.recurso_id]?.nome || '—']));
        tr.appendChild(el('td', { class:'mono tiny' }, [formatDateBR(b.data)]));
        tr.appendChild(el('td', {}, [b.tipo]));
        tr.appendChild(el('td', {}, [button('Excluir', 'danger', () => {
          dispatch('DELETE_BLOCKING', b.id);
          toast('Bloqueio removido.');
        })]));
        btb.appendChild(tr);
      }
      if (bTotal === 0) {
        btb.appendChild(el('tr', {}, [el('td', { colspan:'4', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhum bloqueio.'])]));
      }
      t1.appendChild(btb);

      const bPager = (bTotalPages > 1) ? buildPager({
        page: uiPagination.blockingsPage,
        totalPages: bTotalPages,
        total: bTotal,
        startIdx: bStartIdx,
        shown: blockings.length,
        onPrev: () => { uiPagination.blockingsPage--; render(); },
        onNext: () => { uiPagination.blockingsPage++; render(); },
        onFirst: () => { uiPagination.blockingsPage = 1; render(); },
        onLast: () => { uiPagination.blockingsPage = bTotalPages; render(); },
      }) : null;

      const bBody = el('div', { class:'grid', style:'gap:10px' }, [t1, bPager].filter(Boolean));

      // ---- Feriados
      const holidaysAll = (state.holidays||[]).slice().sort((a,b) => {
        const da = a.data || '';
        const db = b.data || '';
        if (da !== db) return da.localeCompare(db);
        return String(a.id||'').localeCompare(String(b.id||''));
      });

      const hTotal = holidaysAll.length;
      const hTotalPages = Math.max(1, Math.ceil(hTotal / PAGE_SIZE));
      uiPagination.holidaysPage = Math.min(Math.max(1, uiPagination.holidaysPage), hTotalPages);
      const hStartIdx = (uiPagination.holidaysPage - 1) * PAGE_SIZE;
      const holidays = holidaysAll.slice(hStartIdx, hStartIdx + PAGE_SIZE);

      const t2 = el('table');
      t2.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Data']),
        el('th', {}, ['Descrição']),
        el('th', {}, ['Ações'])
      ])]));

      const htb = el('tbody');
      for (const h of holidays) {
        const tr = el('tr');
        tr.appendChild(el('td', { class:'mono tiny' }, [formatDateBR(h.data)]));
        tr.appendChild(el('td', {}, [h.descricao]));
        tr.appendChild(el('td', {}, [button('Excluir', 'danger', () => {
          dispatch('DELETE_HOLIDAY', h.id);
          toast('Feriado removido.');
        })]));
        htb.appendChild(tr);
      }
      if (hTotal === 0) {
        htb.appendChild(el('tr', {}, [el('td', { colspan:'3', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhum feriado.'])]));
      }
      t2.appendChild(htb);

      const hPager = (hTotalPages > 1) ? buildPager({
        page: uiPagination.holidaysPage,
        totalPages: hTotalPages,
        total: hTotal,
        startIdx: hStartIdx,
        shown: holidays.length,
        onPrev: () => { uiPagination.holidaysPage--; render(); },
        onNext: () => { uiPagination.holidaysPage++; render(); },
        onFirst: () => { uiPagination.holidaysPage = 1; render(); },
        onLast: () => { uiPagination.holidaysPage = hTotalPages; render(); },
      }) : null;

      const hBody = el('div', { class:'grid', style:'gap:10px' }, [t2, hPager].filter(Boolean));

      return el('div', { class:'grid' }, [
        card('Bloqueios cadastrados', null, bBody),
        card('Feriados cadastrados', null, hBody),
      ]);
    })();

    return el('div', { class:'grid' }, [form, lists]);
  };

  
const viewWindows = () => {
  // Matriz de Janelas (janela deslizante, sem limite de período) + Próxima Janela Livre

  // Heatmap mensal (Recursos × Meses) + Drilldown em barras (Top 10 / Todos)

  // UI state (não persistido)
  if (!uiFilters.windows) {
    uiFilters.windows = {
      start: formatDate(new Date()),
      days: 14,
      minFree: 4,
    };
  }

  if (!uiFilters.windowsHeat) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    uiFilters.windowsHeat = {
      startMonth: `${y}-${m}`,
      months: 6,
      metric: 'occupation', // 'occupation' | 'freePct' | 'freeHH'
      view: 'occupation', // 'occupation' | 'capacity_free' | 'bottleneck' | 'idleness'
      // Padrão: mostrar TODOS e usar paginação (evita confusão de “sumiu recurso”).
      show: 'all',  // 'top' | 'all'
      topN: 10,
      dynamicOrder: true,
      sortDir: 'asc', // asc = menos livre primeiro
      fixedOrderIds: null,
    };
  }

  const w = uiFilters.windows;
  const wh = uiFilters.windowsHeat;

  const clampDays = (n) => {
    const v = Math.max(1, Math.min(365, Number(n||14)));
    return isFinite(v) ? v : 14;
  };

  const toDate = (iso) => {
    if (!iso) return new Date();
    const [y,m,d] = String(iso).split('-').map(Number);
    return new Date(y, (m||1)-1, d||1);
  };

  const addDays = (dateObj, n) => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + Number(n||0));
    return d;
  };

  const parseMonth = (ym) => {
    const [y,m] = String(ym||'').split('-').map(Number);
    if (!y || !m) {
      const n = new Date();
      return { y:n.getFullYear(), m:n.getMonth() };
    }
    return { y, m: m-1 };
  };

  const fmtMonthLabel = (y, m0) => {
    const d = new Date(y, m0, 1);
    const mon = d.toLocaleString('pt-BR', { month:'short' }).replace('.', '');
    return `${mon}/${String(y).slice(-2)}`;
  };

  const addMonths = (y, m0, delta) => {
    const d = new Date(y, m0, 1);
    d.setMonth(d.getMonth() + Number(delta||0));
    return { y: d.getFullYear(), m: d.getMonth() };
  };

  const monthKey = (y, m0) => `${y}-${String(m0+1).padStart(2,'0')}`;

  const clampMonths = (n) => {
    const v = Math.max(1, Math.min(36, Number(n||6)));
    return isFinite(v) ? v : 6;
  };

  const monthlyWindow = (resourceId, y, m0) => {
    const days = getDaysInMonth(y, m0);
    let cap = 0;
    let alloc = 0;
    let free = 0;
    let daysZero = 0;
    let daysOver = 0;
    let eligibleDays = 0;
    let heTotal = 0;
    let holidaysCount = 0;
    let blockingsCount = 0;

    for (const d of days) {
      const dateStr = formatDate(d);
      const info = freeHoursInfo(resourceId, d);
      const he = overtimeInfo(resourceId, dateStr).total;
      heTotal += Math.max(0, Number(he||0));
      if (isHoliday(dateStr)) holidaysCount += 1;
      if (blockingFor(resourceId, dateStr)) blockingsCount += 1;
      // Fins de semana sem HE não entram no cálculo mensal de capacidade gerencial
      if (info.eligible === false) continue;
      eligibleDays += 1;
      cap += info.capacity;
      alloc += info.allocated;
      free += info.free;
      if (info.free <= 0) daysZero += 1;
      if (info.free < 0) daysOver += 1;
    }

    const pct = cap > 0 ? (free / cap) * 100 : 0;
    const occPct = cap > 0 ? (alloc / cap) * 100 : 0;
    const demandsCount = (state.demands||[]).filter(d => {
      if ((d.responsavel_id||'') !== resourceId) return false;
      const st = effectiveStatus(d);
      if (!STATUS_COUNTS_IN_ALLOCATION.has(st)) return false;
      const monthStart = `${y}-${String(m0+1).padStart(2,'0')}-01`;
      const lastDay = String(new Date(y, m0+1, 0).getDate()).padStart(2,'0');
      const monthEnd = `${y}-${String(m0+1).padStart(2,'0')}-${lastDay}`;
      return String(d.data_inicio||'') <= monthEnd && String(d.data_fim||'') >= monthStart;
    }).length;
    return {
      y, m0,
      key: monthKey(y, m0),
      label: fmtMonthLabel(y, m0),
      cap, alloc, free, pct, occPct,
      days: days.length,
      eligibleDays,
      demandsCount,
      heTotal,
      holidaysCount,
      blockingsCount,
      daysZero,
      daysOver,
    };
  };

  const heatClassFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free') {
      if (freePct <= 10) return 'heat-overload';
      if (freePct <= 25) return 'heat-tight';
      if (freePct <= 50) return 'heat-attention';
      if (freePct <= 80) return 'heat-healthy';
      return 'heat-free';
    }
    if (view === 'bottleneck') {
      if (m.daysOver > 0 || occ > 100) return 'heat-overload';
      if (freePct <= 10) return 'heat-overload';
      if (freePct <= 25) return 'heat-tight';
      if (freePct <= 50) return 'heat-attention';
      return 'heat-healthy';
    }
    if (view === 'idleness') {
      if (freePct > 80) return 'heat-free';
      if (freePct > 50) return 'heat-healthy';
      if (freePct > 25) return 'heat-attention';
      return 'heat-neutral';
    }
    // Ocupação gerencial: vermelho=sobrecarga, amarelo/laranja=atenção, verde=saudável, azul=ociosidade
    if (occ > 100 || m.daysOver > 0) return 'heat-overload';
    if (occ >= 85) return 'heat-tight';
    if (occ >= 50) return 'heat-healthy';
    if (occ >= 25) return 'heat-attention';
    return 'heat-free';
  };

  const heatLabelFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (m.daysOver > 0 || occ > 100 || Number(m.free||0) < 0) return 'Sobrecarga';
    if (view === 'capacity_free' || view === 'bottleneck') {
      if (freePct <= 10) return 'Sem janela';
      if (freePct <= 25) return 'Apertado';
      if (freePct <= 50) return 'Atenção';
      if (freePct <= 80) return 'Saudável';
      return 'Ociosidade alta';
    }
    if (view === 'idleness') {
      if (freePct > 80) return 'Ociosidade alta';
      if (freePct > 50) return 'Folga moderada';
      if (freePct > 25) return 'Folga baixa';
      return 'Sem ociosidade relevante';
    }
    if (occ >= 90) return 'Apertado';
    if (occ >= 80) return 'Atenção';
    if (occ >= 50) return 'Saudável';
    return 'Ociosidade alta';
  };

  const heatValueFor = (m, view='occupation') => {
    if (view === 'capacity_free') return Math.max(0, Number(m.pct||0));
    if (view === 'bottleneck') return 100 - Math.max(0, Number(m.pct||0));
    if (view === 'idleness') return Math.max(0, Number(m.pct||0));
    return Math.max(0, Number(m.occPct||0));
  };

  const heatTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free') return `${freePct.toFixed(0)}% livre`;
    if (view === 'bottleneck') return `${Math.max(0, 100 - freePct).toFixed(0)} risco`;
    if (view === 'idleness') return `${freePct.toFixed(0)}% livre`;
    return `${occ.toFixed(0)}% ocup.`;
  };

  const heatMainTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free' || view === 'idleness') return `${Math.max(0, Number(m.free||0)).toFixed(0)}h`;
    if (view === 'bottleneck') return `${Math.max(0, 100 - freePct).toFixed(0)}%`;
    return `${occ.toFixed(0)}%`;
  };

  const heatSubTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    if (view === 'capacity_free' || view === 'idleness') return `${freePct.toFixed(0)}% livre`;
    if (view === 'bottleneck') return `${Math.max(0, Number(m.free||0)).toFixed(0)}h livres`;
    return `${Math.max(0, Number(m.free||0)).toFixed(0)}h livres`;
  };

  const buildMonths = () => {
    const { y, m } = parseMonth(wh.startMonth);
    const list = [];
    const count = clampMonths(wh.months);
    for (let i=0;i<count;i++) {
      const mm = addMonths(y, m, i);
      list.push(mm);
    }
    return list;
  };

  const openHeatModal = ({ y, m0, focusResourceId=null } = {}) => {
    const modal = qs('#heatModal');
    const title = qs('#heatModalTitle');
    const sub = qs('#heatModalSub');
    const body = qs('#heatModalBody');

    const label = fmtMonthLabel(y, m0);
    title.textContent = `Heatmap gerencial — ${label}`;

    const rows = (state.resources||[]).map(r => ({
      r,
      m: monthlyWindow(r.id, y, m0)
    }));

    const metric = wh.metric || wh.view || 'occupation';
    const val = (x) => heatValueFor(x.m, metric);
    const dir = wh.sortDir === 'desc' ? -1 : 1;
    rows.sort((a,b) => (val(a) - val(b)) * dir);

    sub.textContent = `${rows.length} recurso(s) • modo: ${metric === 'capacity_free' ? 'capacidade livre' : metric === 'bottleneck' ? 'risco de gargalo' : metric === 'idleness' ? 'ociosidade' : 'ocupação'}`;
    body.innerHTML = '';

    const modeRow = el('div', { class:'row', style:'margin-bottom:10px' }, [
      el('span', { class:'tag' }, ['Drilldown: ranking por recurso'] ),
      button(wh.show === 'top' ? 'Mostrar Todos' : 'Mostrar Top 10', '', () => {
        wh.show = (wh.show === 'top') ? 'all' : 'top';
        openHeatModal({ y, m0, focusResourceId });
      }),
      button('Abrir matriz do mês', 'primary', () => {
        // Ajusta matriz diária para o mês inteiro
        const first = new Date(y, m0, 1);
        w.start = formatDate(first);
        w.days = Math.min(365, getDaysInMonth(y, m0).length);
        if (focusResourceId) w.scrollToResourceId = focusResourceId;
        modal.close();
        render();
        toast('Matriz ajustada para o mês.');
      })
    ]);
    body.appendChild(modeRow);

    const list = (wh.show === 'top') ? rows.slice(0, Math.max(1, Number(wh.topN||10))) : rows;
    const maxV = Math.max(1e-9, ...list.map(val));

    const wrap = el('div', { class:'grid' });
    for (const item of list) {
      const r = item.r;
      const m = item.m;
      const v = val(item);
      const pctTxt = `${Math.max(0, m.pct).toFixed(0)}% livre`;
      const occTxt = `${Math.max(0, m.occPct).toFixed(0)}% ocup.`;
      const hhTxt = `${m.free.toFixed(1)}h`;
      const isFocus = focusResourceId && focusResourceId === r.id;

      const row = el('div', { class:'card', style:`box-shadow:none;${isFocus?'border-color:rgba(79,70,229,.55)':''}` }, [
        el('div', { class:'bd' }, [
          el('div', { class:'row', style:'justify-content:space-between;gap:12px' }, [
            el('div', {}, [
              el('div', { style:'font-weight:950' }, [r.nome]),
              el('div', { class:'tiny' }, [`Ocupação: ${occTxt} • Livre: ${hhTxt} (${pctTxt}) • Cap: ${m.cap.toFixed(1)}h • Alocado: ${m.alloc.toFixed(1)}h • Demandas: ${m.demandsCount} • HE: ${m.heTotal.toFixed(1)}h`])
            ]),
            button('Abrir matriz (recurso)', '', () => {
              const first = new Date(y, m0, 1);
              w.start = formatDate(first);
              w.days = Math.min(365, getDaysInMonth(y, m0).length);
              w.scrollToResourceId = r.id;
              modal.close();
              render();
            })
          ]),
          el('div', { style:'margin-top:10px' }, [
            el('div', { class:'bar', title: `${occTxt} • ${pctTxt} • ${hhTxt}` }, [
              el('span', { style:`width:${Math.max(0, Math.min(100, (v/maxV)*100)).toFixed(1)}%` })
            ])
          ])
        ])
      ]);
      wrap.appendChild(row);
    }

    body.appendChild(wrap);
    if (!modal.open) openDialog(modal);
  };

  // Drilldown mensal: dias do mês (HH + % por dia) para um recurso
  const openMonthModal = ({ resourceId, y, m0 } = {}) => {
    const modal = qs('#monthModal');
    const title = qs('#monthModalTitle');
    const sub = qs('#monthModalSub');
    const body = qs('#monthModalBody');

    const res = state.resources.find(r => r.id === resourceId);
    const label = fmtMonthLabel(y, m0);
    title.textContent = `Janelas livres — ${label}`;
    sub.textContent = `${res ? res.nome : 'Recurso'} • HH + % por dia`;
    body.innerHTML = '';

    const monthInfo = monthlyWindow(resourceId, y, m0);
    const summary = el('div', { class:'row', style:'justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px' }, [
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        el('span', { class:'pill' }, [el('span', { class:'dot bg-ok' }), `Livre: ${monthInfo.free.toFixed(1)}h (${Math.max(0, monthInfo.pct).toFixed(0)}%)`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-mid' }), `Cap: ${monthInfo.cap.toFixed(1)}h`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-holiday' }), `Alocado: ${monthInfo.alloc.toFixed(1)}h (${Math.max(0, monthInfo.occPct).toFixed(0)}% ocup.)`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-he' }), `HE: ${monthInfo.heTotal.toFixed(1)}h`]),
      ]),
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        button('Ranking do mês', '', () => { try{ modal.close(); }catch{ modal.removeAttribute('open'); } openHeatModal({ y, m0, focusResourceId: resourceId }); }),
        button('Abrir matriz do mês', 'primary', () => {
          const first = new Date(y, m0, 1);
          w.start = formatDate(first);
          w.days = Math.min(365, getDaysInMonth(y, m0).length);
          w.scrollToResourceId = resourceId;
          try{ modal.close(); }catch{ modal.removeAttribute('open'); }
          render();
          toast('Matriz ajustada para o mês (recurso em foco).');
        })
      ])
    ]);
    body.appendChild(summary);

    const dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const dowRow = el('div', { class:'monthDow' }, dows.map(x => el('div', { class:'dow' }, [x])));
    body.appendChild(dowRow);

    const grid = el('div', { class:'monthGrid' });
    const days = getDaysInMonth(y, m0);
    const firstDow = days[0].getDay(); // 0=Dom
    for (let i=0;i<firstDow;i++) grid.appendChild(el('div', { class:'monthBlank' }, ['']));

    for (const d of days) {
      const dateStr = formatDate(d);
      const info = freeHoursInfo(resourceId, d);
      const pct = (info.capacity > 0) ? (Math.max(0, info.free) / info.capacity) * 100 : 0;
      const hhTxt = `${info.free.toFixed(0)}h`;
      const pctTxt = `${pct.toFixed(0)}%`;
      const heTotal = overtimeInfo(resourceId, dateStr).total;

      const ending = (state.demands||[]).filter(x => (x.responsavel_id||'') === resourceId && x.data_fim === dateStr);
      const endingCount = ending.length;

      const active = demandsForResourceOnDate(resourceId, dateStr);
      const activeCount = active.length;

      const tipLines = [
        `${res ? res.nome : 'Recurso'} • ${formatDateBR(dateStr)}`,
        `Livre: ${info.free.toFixed(1)}h (${pctTxt}) • Cap: ${info.capacity.toFixed(1)}h • Alocado: ${info.allocated.toFixed(1)}h`,
        `Demandas no dia: ${activeCount}${endingCount ? ` • Termina hoje: ${endingCount}` : ''}`
      ];
      if (endingCount) {
        const names = ending.slice(0,3).map(x => x.titulo).filter(Boolean);
        if (names.length) tipLines.push(`Fim: ${names.join(', ')}${endingCount>3?'…':''}`);
      }
      if (info.free < 0) tipLines.push('⚠ Excedente (overalloc)');
      if (info.capacity === 0) tipLines.push('Dia sem capacidade (feriado/bloqueio/férias/off)');

      let cls = 'monthCell';
      // Classe de cor por % livre (apenas neste modal)
      // Regras:
      // 0% = sem janela (vermelho)
      // 1–33% = janela baixa (laranja)
      // 34–66% = janela média (amarelo)
      // 67–99% = boa janela (verde claro)
      // 100% = totalmente livre (verde destacado)
      const freePct = (info.capacity > 0) ? (Math.max(0, info.free) / info.capacity) * 100 : 0;
      if (freePct <= 0) cls += ' free-0';
      else if (freePct <= 33) cls += ' free-1';
      else if (freePct <= 66) cls += ' free-2';
      else if (freePct < 100) cls += ' free-3';
      else cls += ' free-4';
      if (isHoliday(dateStr)) cls += ' bg-holiday';
     

      // Core Clean v1: funções consolidadas de gráfico/exportação ficam no escopo global.

 if (isWeekend(d)) cls += ' mutedDay';
      if (info.capacity === 0) cls += ' zero';
      if (info.free < 0) cls += ' over';

      const cell = el('div', {
        class: cls,
        title: tipLines.join('\n'),
        onclick: () => {
          // Fecha este drilldown e abre detalhes do dia (com CTA de cadastrar demanda)
          try{ modal.close(); }catch{ modal.removeAttribute('open'); }
          openDayDetails(resourceId, d);
        }
      }, [
        el('div', { class:'d mono' }, [String(d.getDate()).padStart(2,'0')]),
        el('div', { class:'hh mono' }, [hhTxt]),
        el('div', { class:'pct mono' }, [pctTxt]),
        (heTotal > 0) ? el('div', { class:'heLine mono' }, [`HE: ${fmtHours(heTotal)}h`]) : null,
        endingCount ? el('div', { class:'badgeEnd', title:`${endingCount} demanda(s) termina(m) hoje` }, [`fim: ${endingCount}`]) : null,
      ].filter(Boolean));

      grid.appendChild(cell);
    }
    body.appendChild(grid);
    if (!modal.open) openDialog(modal);
  }
  const freeHoursInfo = (resourceId, dateObj) => CapacityEngine.freeHoursInfo(resourceId, dateObj);

  const buildDays = () => {
    const start = toDate(w.start);
    const list = [];
    for (let i=0;i<clampDays(w.days);i++) list.push(addDays(start, i));
    return list;
  };

  const findNextWindow = (resourceId) => {
    const start = toDate(w.start);
    const minFree = Math.max(0, Number(w.minFree||0));
    const MAX_LOOKAHEAD = 3650; // ~10 anos ("sem limite" na prática, sem travar)
    for (let i=0;i<MAX_LOOKAHEAD;i++) {
      const d = addDays(start, i);
      const info = freeHoursInfo(resourceId, d);
      // só considera dias com janela de verdade
      if (info.eligible && info.capacity > 0 && info.free >= minFree) {
        return { date: info.dateStr, free: info.free };
      }
    }
    return null;
  };

  const days = buildDays();
  const months = buildMonths();

  // controls
  const startInput = el('input', { type:'date' });
  startInput.value = w.start;
  startInput.addEventListener('change', () => { w.start = startInput.value || formatDate(new Date()); render(); });

  const daysInput = el('input', { type:'number', min:'1', max:'365', step:'1' });
  daysInput.value = String(clampDays(w.days));
  daysInput.addEventListener('change', () => { w.days = clampDays(daysInput.value); render(); });

  const minFreeInput = el('input', { type:'number', min:'0', max:'9', step:'0.5' });
  minFreeInput.value = String(Number(w.minFree||0));
  minFreeInput.addEventListener('change', () => { w.minFree = Number(minFreeInput.value||0); render(); });

  const shift = (dir) => {
    const start = toDate(w.start);
    const n = clampDays(w.days) * (dir < 0 ? -1 : 1);
    w.start = formatDate(addDays(start, n));
    render();
  };

  const jumpToday = () => { w.start = formatDate(new Date()); render(); };

  const right = el('div', { class:'row' }, [
    button('◀', 'ghost', () => shift(-1)),
    button('Hoje', '', jumpToday),
    button('▶', 'ghost', () => shift(1)),
  ]);

  const hint = el('div', { class:'hint tiny' }, [
    el('b', {}, ['Modo rápido: ']),
    'matriz por janelas deslizantes (sem limite) + “Próxima janela livre”. ',
    el('b', {}, ['Janelas = capacidade remanescente diária. ']),
    'Feriado/Bloqueio/Férias/OFF zeram o dia. Excedente (negativo) é permitido.'
  ]);

  // Heatmap mensal (Recursos × Meses)
  const heatmap = (() => {
    if ((state.resources||[]).length === 0) {
      return card('Heatmap gerencial por recurso (meses)', null, el('div', { class:'warn' }, ['Cadastre recursos para ver o heatmap mensal.']));
    }

    // Build dataset for months on screen
    const perRes = (state.resources||[]).map(r => {
      const ms = months.map(mm => monthlyWindow(r.id, mm.y, mm.m));
      const viewMode = wh.metric || wh.view || 'occupation';
      const score = ms.reduce((a,b)=>a + heatValueFor(b, viewMode), 0) / Math.max(1, ms.length);
      return { r, ms, score };
    });

    // Dynamic ordering
    if (wh.dynamicOrder) {
      const dir = wh.sortDir === 'desc' ? -1 : 1;
      perRes.sort((a,b) => (a.score - b.score) * dir);
    } else if (Array.isArray(wh.fixedOrderIds)) {
      const idx = new Map(wh.fixedOrderIds.map((id,i)=>[id,i]));
      perRes.sort((a,b) => (idx.get(a.r.id) ?? 1e9) - (idx.get(b.r.id) ?? 1e9));
    }
    // show Top N or all (com paginação quando 'Todos')
    const allRows = (wh.show === 'top') ? perRes.slice(0, Math.max(1, Number(wh.topN||10))) : perRes;

    const HEAT_PAGE_SIZE = 10;
    let heatPage = Math.max(1, Number(uiPagination.windowsHeatPage||1));
    const heatTotalPages = Math.max(1, Math.ceil(allRows.length / HEAT_PAGE_SIZE));
    heatPage = Math.min(heatPage, heatTotalPages);
    uiPagination.windowsHeatPage = heatPage;

    const rows = (wh.show === 'all')
      ? allRows.slice((heatPage-1)*HEAT_PAGE_SIZE, heatPage*HEAT_PAGE_SIZE)
      : allRows;

    // Cores do heatmap agora seguem a legenda executiva (classe por faixa),
    // sem escala verde relativa por página.

    const heatControls = (() => {
      const monthInp = el('input', { type:'month' });
      monthInp.value = wh.startMonth;
      monthInp.addEventListener('change', () => { wh.startMonth = monthInp.value || wh.startMonth; render(); });

      const monthsInp = el('input', { type:'number', min:'1', max:'36', step:'1' });
      monthsInp.value = String(clampMonths(wh.months));
      monthsInp.addEventListener('change', () => { wh.months = clampMonths(monthsInp.value); render(); });

      const showSel = el('select');
      showSel.appendChild(el('option', { value:'top' }, ['Top 10']));
      showSel.appendChild(el('option', { value:'all' }, ['Todos']));
      showSel.value = wh.show;
      showSel.addEventListener('change', () => { wh.show = showSel.value; uiPagination.windowsHeatPage = 1; render(); });

      const metricSel = el('select');
      metricSel.appendChild(el('option', { value:'occupation' }, ['Ocupação']));
      metricSel.appendChild(el('option', { value:'capacity_free' }, ['Capacidade livre']));
      metricSel.appendChild(el('option', { value:'bottleneck' }, ['Risco de gargalo']));
      metricSel.appendChild(el('option', { value:'idleness' }, ['Ociosidade']));
      metricSel.value = wh.metric || wh.view || 'occupation';
      metricSel.addEventListener('change', () => { wh.metric = metricSel.value; wh.view = metricSel.value; render(); });

      const dirSel = el('select');
      dirSel.appendChild(el('option', { value:'desc' }, ['Maior risco / ocupação']));
      dirSel.appendChild(el('option', { value:'asc' }, ['Menor risco / ociosidade'])) ;
      dirSel.value = wh.sortDir;
      dirSel.addEventListener('change', () => { wh.sortDir = dirSel.value; render(); });

      const dynChk = el('input', { type:'checkbox' });
      dynChk.checked = !!wh.dynamicOrder;
      dynChk.addEventListener('change', () => {
        wh.dynamicOrder = dynChk.checked;
        if (!wh.dynamicOrder && !Array.isArray(wh.fixedOrderIds)) {
          wh.fixedOrderIds = (state.resources||[]).map(r => r.id);
        }
        render();
      });

      const fixBtn = button('Fixar ordem atual', '', () => {
        wh.fixedOrderIds = (perRes||[]).map(x => x.r.id);
        wh.dynamicOrder = false;
        render();
        toast('Ordem fixada.');
      });

      const shiftMonth = (dir) => {
        const { y, m } = parseMonth(wh.startMonth);
        const moved = addMonths(y, m, clampMonths(wh.months) * (dir<0?-1:1));
        wh.startMonth = monthKey(moved.y, moved.m);
        render();
      };

      return el('div', { class:'row' }, [
        el('div', { class:'field' }, [el('label', {}, ['Mês inicial']), monthInp]),
        el('div', { class:'field' }, [el('label', {}, ['Meses na tela']), monthsInp]),
        el('div', { class:'field' }, [el('label', {}, ['Mostrar']), showSel]),
        el('div', { class:'field' }, [el('label', {}, ['Visualização']), metricSel]),
        el('div', { class:'field' }, [el('label', {}, ['Ordenar por']), dirSel]),
        el('div', { class:'field' }, [el('label', {}, ['Ordenação dinâmica']), el('div', { class:'row' }, [dynChk, el('span', { class:'tiny muted' }, ['(desligue para manter fixa)'])])]),
        fixBtn,
        button('◀', 'ghost', () => shiftMonth(-1)),
        button('Hoje', '', () => {
          const n = new Date();
          wh.startMonth = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
          render();
        }),
        button('▶', 'ghost', () => shiftMonth(1)),
      ]);
    })();

    const heatPager = (() => {
      if (wh.show !== 'all') return null;
      const total = allRows.length;
      if (total <= HEAT_PAGE_SIZE) return null;
      const totalPages = Math.max(1, Math.ceil(total / HEAT_PAGE_SIZE));
      const startIdx = (uiPagination.windowsHeatPage-1) * HEAT_PAGE_SIZE;
      const shown = Math.min(HEAT_PAGE_SIZE, Math.max(0, total - startIdx));
      return buildPager({
        page: uiPagination.windowsHeatPage,
        totalPages,
        total,
        startIdx,
        shown,
        onPrev: () => { uiPagination.windowsHeatPage = Math.max(1, uiPagination.windowsHeatPage-1); render(); },
        onNext: () => { uiPagination.windowsHeatPage = Math.min(totalPages, uiPagination.windowsHeatPage+1); render(); },
        onFirst: () => { uiPagination.windowsHeatPage = 1; render(); },
        onLast: () => { uiPagination.windowsHeatPage = totalPages; render(); },
      });
    })();

    const heatTable = (() => {
      const t = el('table', { class:'calTable' });
      const thead = el('thead');
      const trh = el('tr');
      trh.appendChild(el('th', { class:'stickyCol', style:'min-width:240px' }, ['Recurso']));
      for (const mm of months) {
        const key = monthKey(mm.y, mm.m);
        trh.appendChild(el('th', { class:'dayHead', title:key, style:'min-width:70px;cursor:pointer', onclick: () => openHeatModal({ y:mm.y, m0:mm.m }) }, [
          el('div', { style:'font-weight:950' }, [fmtMonthLabel(mm.y, mm.m)]),
          el('div', { class:'tiny' }, ['(clique)'])
        ]));
      }
      thead.appendChild(trh);
      t.appendChild(thead);

      const tbody = el('tbody');
      for (const rr of rows) {
        const tr = el('tr');
        tr.appendChild(el('td', { class:'stickyCol' }, [
          el('div', { style:'font-weight:950' }, [rr.r.nome]),
          el('div', { class:'tiny' }, [`${rr.r.tipo} • ${HOURS_PER_DAY}h/dia`])
        ]));

        for (const m of rr.ms) {
          const mode = wh.metric || wh.view || 'occupation';
          const cls = heatClassFor(m, mode);
          const label = heatLabelFor(m, mode);
          const title = `${rr.r.nome} • ${m.label}
Status: ${label}
Ocupação: ${Math.max(0,m.occPct).toFixed(0)}% (${m.alloc.toFixed(1)}h alocadas / ${m.cap.toFixed(1)}h cap.)
Livre: ${m.free.toFixed(1)}h (${Math.max(0,m.pct).toFixed(0)}%)
Dias 0h: ${m.daysZero} • Dias excedidos: ${m.daysOver}`;
          tr.appendChild(el('td', { class:`cell clickable heatCell ${cls}`, title, onclick: () => openMonthModal({ resourceId: rr.r.id, y:m.y, m0:m.m0 }) }, [
            el('div', { class:'top' }, [heatMainTextFor(m, mode)]),
            el('div', { class:'sub' }, [heatSubTextFor(m, mode)])
          ]));
        }
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      return el('div', { class:'scrollX' }, [t]);
    })();

    return card('Heatmap gerencial por recurso (meses)', null, el('div', { class:'grid' }, [
      el('div', { class:'tiny muted' }, ['Heatmap executivo: no modo Ocupação, a célula mostra % ocupado e horas livres; vermelho = sobrecarga/sem janela, laranja/amarelo = atenção, verde = saudável e azul = ociosidade alta. Clique em uma célula para detalhar.']),
      el('div', { class:'heatLegend' }, [
        el('span', { class:'heatBadge heat-overload' }, ['🔴 Sobrecarga / sem janela']),
        el('span', { class:'heatBadge heat-tight' }, ['🟠 Apertado']),
        el('span', { class:'heatBadge heat-attention' }, ['🟡 Atenção']),
        el('span', { class:'heatBadge heat-healthy' }, ['🟢 Saudável']),
        el('span', { class:'heatBadge heat-free' }, ['🔵 Ociosidade alta'])
      ]),
      heatControls,
      heatPager || el('div', { style:'display:none' }),
      heatTable,
    ]));
  })();

  // Próxima Janela Livre (cards)
  const nextCards = (() => {
    if (state.resources.length === 0) {
      return el('div', { class:'warn' }, ['Cadastre recursos para ver a próxima janela livre.']);
    }

    const NEXT_PAGE_SIZE = 8;
    const allRes = (state.resources||[]);
    let nextPage = Math.max(1, Number(uiPagination.windowsNextPage||1));
    const nextTotalPages = Math.max(1, Math.ceil(allRes.length / NEXT_PAGE_SIZE));
    nextPage = Math.min(nextPage, nextTotalPages);
    uiPagination.windowsNextPage = nextPage;
    const resPage = allRes.slice((nextPage-1)*NEXT_PAGE_SIZE, nextPage*NEXT_PAGE_SIZE);

    const grid = el('div', { class:'kpi', style:'grid-template-columns:repeat(3,minmax(0,1fr))' });
    for (const r of resPage) {
      const found = findNextWindow(r.id);
      const val = found ? `${formatDateBR(found.date)}` : '—';
      const sub = found ? `${found.free.toFixed(1)}h livres (≥ ${Number(w.minFree||0)}h)` : `Não encontrado (até ~10 anos)`;
      const cardEl = el('div', { class:'k' }, [
        el('div', { class:'lbl' }, [r.nome]),
        el('div', { class:'val mono' }, [val]),
        el('div', { class:'tiny' }, [sub]),
        found ? el('div', { style:'margin-top:10px' }, [
          button('Abrir dia', 'primary', () => {
            // abre modal de detalhes do dia
            const d = toDate(found.date);
            openDayDetails(r.id, d);
          })
        ]) : el('div', { style:'height:0' })
      ]);
      grid.appendChild(cardEl);
    }
    const pager = (() => {
      if (allRes.length <= NEXT_PAGE_SIZE) return null;
      const total = allRes.length;
      const totalPages = nextTotalPages;
      const startIdx = (uiPagination.windowsNextPage-1) * NEXT_PAGE_SIZE;
      const shown = Math.min(NEXT_PAGE_SIZE, Math.max(0, total - startIdx));
      return buildPager({
        page: uiPagination.windowsNextPage,
        totalPages,
        total,
        startIdx,
        shown,
        onPrev: () => { uiPagination.windowsNextPage = Math.max(1, uiPagination.windowsNextPage-1); render(); },
        onNext: () => { uiPagination.windowsNextPage = Math.min(totalPages, uiPagination.windowsNextPage+1); render(); },
        onFirst: () => { uiPagination.windowsNextPage = 1; render(); },
        onLast: () => { uiPagination.windowsNextPage = totalPages; render(); },
      });
    })();

    return card('Próxima janela livre', null, el('div', { class:'grid' }, [
      grid,
      pager || el('div', { style:'display:none' }),
    ]));
  })();

  // Matriz
  const table = el('div', { class:'scrollX' }, [
    (() => {
      const t = el('table', { class:'calTable' });
      const thead = el('thead');
      const trh = el('tr');
      trh.appendChild(el('th', { class:'stickyCol', style:'min-width:240px' }, ['Recurso / Dia (HH livres)']));

      for (const d of days) {
        const wd = d.toLocaleString('pt-BR', { weekday:'short' }).slice(0,3);
        const dateStr = formatDate(d);
        trh.appendChild(el('th', { class:'dayHead '+(isWeekend(d)?'bg-wknd':''), title: formatDateBR(dateStr) }, [
          el('div', { class:'mono', style:'font-weight:900' }, [String(d.getDate()).padStart(2,'0')]),
          el('div', { class:'tiny' }, [wd])
        ]));
      }

      thead.appendChild(trh);
      t.appendChild(thead);

      const tbody = el('tbody');
      if (state.resources.length === 0) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan:String(days.length+1), style:'padding:24px;text-align:center;color:var(--muted)' }, ['Cadastre recursos para ver janelas.'])]));
      } else {
        const MATRIX_PAGE_SIZE = 10;
        const allRes = (state.resources||[]);

        // Se veio de um drilldown (heatmap), ajustar pagina para conter o recurso
        if (w.scrollToResourceId) {
          const idx = allRes.findIndex(x => x.id === w.scrollToResourceId);
          if (idx >= 0) uiPagination.windowsMatrixPage = Math.floor(idx / MATRIX_PAGE_SIZE) + 1;
        }

        let matrixPage = Math.max(1, Number(uiPagination.windowsMatrixPage||1));
        const matrixTotalPages = Math.max(1, Math.ceil(allRes.length / MATRIX_PAGE_SIZE));
        matrixPage = Math.min(matrixPage, matrixTotalPages);
        uiPagination.windowsMatrixPage = matrixPage;
        const resPage = allRes.slice((matrixPage-1)*MATRIX_PAGE_SIZE, matrixPage*MATRIX_PAGE_SIZE);

        for (const r of resPage) {
          const tr = el('tr');
          tr.id = `winres-${r.id}`;
          tr.appendChild(el('td', { class:'stickyCol' }, [
            el('div', { style:'font-weight:950' }, [r.nome]),
            el('div', { class:'tiny' }, [`${r.tipo} • ${HOURS_PER_DAY}h/dia`])
          ]));

          for (const d of days) {
            const info = freeHoursInfo(r.id, d);
            const heTotal = overtimeInfo(r.id, info.dateStr).total;
            let cls = 'cell '+info.cls;

            // Mantém destaque visual para fim de semana, mas sem bloquear o dia.
            if (isWeekend(d)) cls += ' bg-wknd';

            tr.appendChild(el('td', { class: cls+' clickable', title: formatDateBR(info.dateStr), onclick: () => openDayDetails(r.id, d) }, [
              el('div', { class:'top' }, [`${info.free.toFixed(1)}h`]),
              el('div', { class:'sub' }, [info.tag]),
              (heTotal > 0) ? el('div', { class:'heLine mono' }, [`HE: ${fmtHours(heTotal)}h`]) : null
            ].filter(Boolean)));
          }
          tbody.appendChild(tr);
        }
      }

      t.appendChild(tbody);
      return t;
    })()
  ]);

  // Scroll helper (para drilldown do heatmap -> matriz)
  setTimeout(() => {
    const rid = w.scrollToResourceId;
    if (!rid) return;
    const rowEl = qs(`#winres-${rid}`);
    if (rowEl && typeof rowEl.scrollIntoView === 'function') {
      rowEl.scrollIntoView({ behavior:'smooth', block:'center' });
      w.scrollToResourceId = null;
    }
  }, 0);

  const controls = el('div', { class:'row' }, [
    el('div', { class:'field' }, [el('label', {}, ['Data inicial (matriz)']), startInput]),
    el('div', { class:'field' }, [el('label', {}, ['Dias na tela']), daysInput]),
    el('div', { class:'field' }, [el('label', {}, ['Janela mínima (Próxima janela)']), minFreeInput]),
  ]);


  // Hora Extra (HE) — capacidade pontual (principalmente fins de semana)
  const overtimeCard = (() => {
    const all = Array.isArray(state.overtimes) ? state.overtimes : [];

    const resSel = el('select');
    resSel.appendChild(el('option', { value:'__ALL__' }, ['Todos os recursos']));
    for (const r of (state.resources||[])) resSel.appendChild(el('option', { value:r.id }, [r.nome]));

    const dateInp = el('input', { type:'date' });
    dateInp.value = formatDate(new Date());

    const hoursInp = el('input', { type:'number', min:'0', max:'24', step:'0.5' });
    hoursInp.value = '9';

    const motivoInp = el('input', { type:'text', placeholder:'Motivo (opcional)' });

    const addBtn = button('Adicionar HE', 'primary', () => {
      const date = (dateInp.value||'').trim();
      const horas = Math.max(0, Number(hoursInp.value||0));
      if (!date) return toast('Informe a data da HE.');
      if (!isFinite(horas) || horas <= 0) return toast('Informe as horas da HE (maior que 0).');

      const rid = resSel.value || '__ALL__';
      dispatch('ADD_OVERTIME', {
        id: generateId('he'),
        resourceId: rid,
        date,
        horas,
        motivo: (motivoInp.value||'').trim(),
        createdAt: Date.now(),
      });
      toast('HE adicionada.');
      // limpa motivo para facilitar novos lançamentos
      motivoInp.value = '';
      render();
    });

    const form = el('div', { class:'row' }, [
      el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
      el('div', { class:'field' }, [el('label', {}, ['Data']), dateInp]),
      el('div', { class:'field' }, [el('label', {}, ['Horas']), hoursInp]),
      el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Motivo']), motivoInp]),
      addBtn,
    ]);

    const list = (() => {
      if (all.length === 0) return el('div', { class:'muted tiny' }, ['Nenhuma HE cadastrada.']);
      const sorted = all.slice().sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.resourceId||'').localeCompare(String(b.resourceId||'')));
      const wrap = el('div', { class:'scrollX' });
      const tbl = el('table', { class:'demandsTable' });
      const thead = el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Data']),
          el('th', {}, ['Recurso']),
          el('th', {}, ['Horas']),
          el('th', {}, ['Motivo']),
          el('th', {}, ['']),
        ])
      ]);
      tbl.appendChild(thead);
      const tbody = el('tbody');
      for (const ot of sorted) {
        const rid = ot.resourceId || '__ALL__';
        const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
        const tr = el('tr', {}, [
          el('td', { class:'mono' }, [formatDateBR(ot.date)]),
          el('td', {}, [rname]),
          el('td', { class:'mono' }, [`${Number(ot.horas||0).toFixed(1)}h`]),
          el('td', { class:'tiny muted' }, [String(ot.motivo||'')]),
          el('td', {}, [button('Excluir', 'ghost', () => { dispatch('DELETE_OVERTIME', { id: ot.id }); render(); toast('HE removida.'); })])
        ]);
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      return wrap;
    })();

    const note = el('div', { class:'tiny muted' }, [
      'Regra: fins de semana não entram no cálculo de janelas. ',
      el('b', {}, ['HE']),' adiciona capacidade apenas na data/recurso informado.'
    ]);

    return card('Hora Extra (HE) — fins de semana', null, el('div', { class:'grid' }, [note, form, list]));
  })();

  return el('div', { class:'grid' }, [
    hint,
	    heatmap,
	    nextCards,
	    card('Controles', right, controls),
    (() => {
      const MATRIX_PAGE_SIZE = 10;
      const total = (state.resources||[]).length;
      if (total <= MATRIX_PAGE_SIZE) return card('Matriz de janelas livres', null, table);
      const totalPages = Math.max(1, Math.ceil(total / MATRIX_PAGE_SIZE));
      const startIdx = (uiPagination.windowsMatrixPage-1) * MATRIX_PAGE_SIZE;
      const shown = Math.min(MATRIX_PAGE_SIZE, Math.max(0, total - startIdx));
      const pager = buildPager({
        page: uiPagination.windowsMatrixPage,
        totalPages,
        total,
        startIdx,
        shown,
        onPrev: () => { uiPagination.windowsMatrixPage = Math.max(1, uiPagination.windowsMatrixPage-1); render(); },
        onNext: () => { uiPagination.windowsMatrixPage = Math.min(totalPages, uiPagination.windowsMatrixPage+1); render(); },
        onFirst: () => { uiPagination.windowsMatrixPage = 1; render(); },
        onLast: () => { uiPagination.windowsMatrixPage = totalPages; render(); },
      });
      return card('Matriz de janelas livres', null, el('div', { class:'grid' }, [pager, table]));
    })()
  ]);
};



  const viewOvertime = () => {
    // Hora Extra (HE) — capacidade pontual (principalmente fins de semana)
    const overtimeCard = (() => {
      const all = Array.isArray(state.overtimes) ? state.overtimes : [];

      const note = el('div', { class:'tiny muted' }, [
        'Regra: fins de semana não entram no cálculo de janelas. ',
        el('b', {}, ['HE']),' adiciona capacidade apenas na data/recurso informado.'
      ]);

      const toolbar = el('div', { class:'row', style:'justify-content:space-between; align-items:center;' }, [
        el('div', { class:'tiny muted' }, ['Cadastre reforços pontuais por data/recurso.']),
        el('button', { class:'btn primary', type:'button', 'data-action':'he-open' }, ['Adicionar HE'])
      ]);

      const list = (() => {
        if (all.length === 0) return el('div', { class:'muted tiny' }, ['Nenhuma HE cadastrada.']);
        const sorted = all.slice().sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.resourceId||'').localeCompare(String(b.resourceId||'')));
        const wrap = el('div', { class:'scrollX' });
        const tbl = el('table', { class:'demandsTable' });
        const thead = el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Data']),
            el('th', {}, ['Recurso']),
            el('th', {}, ['Horas']),
            el('th', {}, ['Atividade / Contexto']),
            el('th', {}, ['']),
          ])
        ]);
        tbl.appendChild(thead);
        const tbody = el('tbody');
        for (const ot of sorted) {
          const rid = ot.resourceId || '__ALL__';
          const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
          const tr = el('tr', {}, [
            el('td', { class:'mono' }, [formatDateBR(ot.date)]),
            el('td', {}, [rname]),
            el('td', { class:'mono' }, [`${Number(ot.horas||0).toFixed(1)}h`]),
            el('td', {}, [
              el('div', { class:'heBadge', style:'width:max-content' }, [el('span', { class:'sDot' }, []), String(ot.titulo || ot.atividade || ot.motivo || 'Hora extra')]),
              el('div', { class:'tiny muted', style:'margin-top:6px' }, [[ot.predio ? `Prédio: ${ot.predio}` : '', ot.focal ? `Focal: ${ot.focal}` : '', ot.prioridade ? `Prioridade: ${ot.prioridade}` : '', ot.motivo ? `Motivo: ${ot.motivo}` : ''].filter(Boolean).join(' • ')]),
            ]),
            el('td', {}, [
              el('button', { class:'btn ghost', type:'button', 'data-action':'he-delete', 'data-id': String(ot.id||'') }, ['Excluir'])
            ])
          ]);
          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        return wrap;
      })();

      return card('Hora Extra (HE) — fins de semana', null, el('div', { class:'grid' }, [note, toolbar, list]));
    })();

return el('div', { class:'grid' }, [
      el('div', { class:'hint tiny' }, [
        el('b', {}, ['Hora Extra (HE): ']),
        'cadastre capacidade extra pontual por data/recurso. Útil para liberar fins de semana ou reforços específicos.'
      ]),
      overtimeCard
    ]);
  };
  const viewConsolidation = () => {
    const exportSnapshot = () => {
      const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
      const safeId = (userId||'noid').replace(/[^a-z0-9_-]+/gi,'_');
      const fileName = `Planner_Snapshot_${safeName}_${safeId}_${formatDate(new Date())}.json`;
      const out = buildDbExportObject();
      downloadFile(JSON.stringify(out, null, 2), fileName, 'application/json');
      toast('Snapshot exportado.');
    };

    const exportEvents = () => {
      const lines = (state.events||[]).map(e => JSON.stringify(e));
      const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
      const safeId = (userId||'noid').replace(/[^a-z0-9_-]+/gi,'_');
      const fileName = `Planner_Events_${safeName}_${safeId}_${formatDate(new Date())}.jsonl`;
      downloadFile(lines.join('\n'), fileName, 'application/json');
      toast('Events exportados.');
    };

    const SNAPSHOT_IMPORT_PASSWORD = "CAPVIEW";

    const requireSnapshotPassword = async () => {
      const pw = prompt("Digite a senha para importar o Snapshot padrão:");
      if (!pw) return false;
      return String(pw) === SNAPSHOT_IMPORT_PASSWORD;
    };

    const loadStateFromText = (txt, mode, fileName, handle=null, fileMeta=null) => {
      const obj = parseSnapshotText(txt);
      const applied = applyImportedSnapshot(obj, { preserveHolidays:true });
      setDbBinding({
        mode,
        name: fileName || '',
        lastLoadedAt: new Date().toISOString(),
        writable: mode === 'rw',
        baselineHash: String(fileMeta?.hash || simpleHash(txt)),
        baselineLastModified: Number(fileMeta?.lastModified || 0),
        baselineSize: Number(fileMeta?.size || String(txt||'').length || 0),
      }, handle, applied);
    };

    const importSnapshot = async (file) => {
      if (!(await requireSnapshotPassword())) {
        toast('Senha inválida. Importação cancelada.');
        return;
      }
      const txt = await readFileText(file);
      const obj = parseSnapshotText(txt);
      applyImportedSnapshot(obj);
      toast('Snapshot importado.');
    };

    const importSnapshotAdd = async (file) => {
      const txt = await readFileText(file);
      const obj = parseSnapshotText(txt);
      mergeSnapshotAdd(obj);
      toast('Snapshot adicionado/mesclado.');
    };

    const importDbReadOnly = async (file) => {
      const txt = await readFileText(file);
      loadStateFromText(txt, 'ro', file?.name || 'BD importado', null, getDbFileMeta(file, txt));
      toast('BD importado em somente leitura.');
    };

    const selectDbReadWrite = async () => {
      try {
        if (!canUseFileSystemAccess()) {
          toast('Seu navegador não permite vínculo ler/gravar direto. Use Edge/Chrome e selecione o JSON pelo botão. Caminho salvo não abre arquivo automaticamente por segurança.');
          return false;
        }
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [{ description:'Arquivos JSON', accept: { 'application/json': ['.json'] } }],
        });
        if (!handle) return false;
        const granted = await ensureHandlePermission(handle, 'readwrite', { prompt:true });
        if (!granted) {
          toast(dbWriteHelpText());
          return false;
        }
        const file = await handle.getFile();
        const txt = await file.text();
        loadStateFromText(txt, 'rw', file?.name || handle.name || 'BD selecionado', handle, getDbFileMeta(file, txt));
        toast('BD selecionado em ler/gravar.');
        startDbWatcher();
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        console.error(e);
        if (isDbHandleRecoverableError(e)) {
          clearDbHandleOnly();
          toast('O navegador invalidou o vínculo com o arquivo. Tente selecionar o JSON novamente.');
          return false;
        }
        alert('Falha ao selecionar o banco de dados.');
        return false;
      }
    };


    const readSelectedDbSnapshot = async ({ expectedHash='', retries=5, delayMs=180 } = {}) => {
      if (!dbFileHandle) throw new Error('Nenhum BD selecionado.');
      let last = null;
      try {
        for (let attempt = 0; attempt <= retries; attempt++) {
          const file = await dbFileHandle.getFile();
          const txt = await file.text();
          const meta = getDbFileMeta(file, txt);
          last = { file, txt, meta };
          if (!expectedHash || meta.hash === expectedHash) return { ...last, matchedExpectedHash: true };
          if (attempt < retries) await sleep(delayMs * (attempt + 1));
        }
        return { ...(last || {}), matchedExpectedHash: false };
      } catch (e) {
        if (isDbHandleRecoverableError(e)) {
          const err = new Error('O arquivo selecionado mudou no disco ou perdeu a permissão desta sessão. Selecione o JSON novamente para continuar.');
          err.name = 'RecoverableDbHandleError';
          err.cause = e;
          throw err;
        }
        throw e;
      }
    };

    const backupRemoteBeforeWrite = async (remoteTxt, reason='manual-save') => {
      try {
        const safeDb = String(dbBinding?.name || 'CapView_DB').replace(/[^a-z0-9_.-]+/gi,'_');
        const stamp = new Date().toISOString().replace(/[:.]/g,'-');
        downloadFile(String(remoteTxt || '{}'), `backup_antes_${reason}_${safeDb}_${stamp}.json`, 'application/json');
        return true;
      } catch (e) {
        console.warn('[DB] Falha ao gerar backup antes da gravação:', e);
        return false;
      }
    };

    const writeStateToSelectedDb = async (stateToWrite, opts={}) => {
      const granted = await ensureDbHandlePermission('readwrite', { prompt:true });
      if (!granted) {
        const err = new Error(dbWriteHelpText());
        err.name = 'SecurityError';
        throw err;
      }
      let backupTxt = '';
      try {
        if (opts?.backupBeforeWrite !== false) {
          const currentFile = await dbFileHandle.getFile();
          backupTxt = await currentFile.text();
        }
      } catch (e) {
        console.warn('[DB] Não foi possível ler o arquivo atual para backup:', e);
      }
      const payload = normalizeImportedState(stateToWrite || buildDbExportObject());
      const txtOut = JSON.stringify({
        ...payload,
        schemaVersion: APP_SCHEMA_VERSION,
        meta: {
          ...((payload.meta && typeof payload.meta === 'object') ? payload.meta : {}),
          authorName: userName || '',
          authorUserId: userId || '',
          exportedAt: new Date().toISOString(),
          exportSource: 'CapView+',
          schemaVersion: APP_SCHEMA_VERSION,
        }
      }, null, 2);
      const expectedHash = simpleHash(txtOut);
      try {
        if (backupTxt && opts?.backupBeforeWrite !== false) await backupRemoteBeforeWrite(backupTxt, opts?.backupReason || 'save');
        // V5.4.1: não chamar getFile() imediatamente antes do createWritable().
        // Em Edge/Chrome, se o JSON foi alterado no disco por outra sessão, essa leitura
        // pode deixar o FileSystemHandle em estado inválido e disparar InvalidStateError.
        const writable = await dbFileHandle.createWritable();
        await writable.write(txtOut);
        await writable.close();
        const latest = await readSelectedDbSnapshot({ expectedHash, retries: 6, delayMs: 220 });
        const latestTxt = String((latest && latest.txt) || txtOut);
        let latestObj = parseSnapshotText(latestTxt);

        // Se outra instância sobrescreveu este write no mesmo intervalo, o hash esperado
        // não aparece. Não assumimos sucesso: tentamos preservar a alteração local com
        // merge imediato usando a baseline conhecida.
        if (latest && latest.matchedExpectedHash === false && opts?.allowRaceRecovery !== false) {
          const baseObj = dbLoadedSnapshot || loadDbBaseline() || latestObj;
          const recovery = mergeStatesThreeWay(baseObj, normalizeImportedState(stateToWrite || buildDbExportObject()), latestObj);
          if (recovery.conflictCount === 0) {
            await sleep(350 + (userDelayHash() % 900));
            return await writeStateToSelectedDb(recovery.merged, {
              backupReason: opts?.backupReason || 'race-recovery',
              backupBeforeWrite:false,
              allowRaceRecovery:false
            });
          }
          pauseDbAutoSync('conflito pós-gravação', `Autosync pausado: ${recovery.conflictCount} conflito(s) após gravação simultânea. Use Mesclar manualmente.`);
          const err = new Error('Conflito pós-gravação simultânea. A fila local foi preservada para mesclagem manual.');
          err.name = 'PostWriteConflictError';
          throw err;
        }

        state = latestObj;
        suppressDbAutoSave = true;
        try { persist({ skipAutoSave:true }); }
        finally { suppressDbAutoSave = false; }
        setDbBinding({
          ...dbBinding,
          lastLoadedAt: new Date().toISOString(),
          writable: true,
          baselineHash: String((latest && latest.meta && latest.meta.hash) || expectedHash),
          baselineLastModified: Number((latest && latest.meta && latest.meta.lastModified) || 0),
          baselineSize: Number((latest && latest.meta && latest.meta.size) || String(latestTxt).length || 0),
        }, dbFileHandle, latestObj);
        if (opts?.clearQueue !== false) clearDbOperationQueue();
        dbAutoSavePending = false;
        dbAutoSaveDirtySince = 0;
        render();
        return latestObj;
      } catch (e) {
        if (isDbHandleRecoverableError(e) || e?.name === 'RecoverableDbHandleError') {
          const err = new Error('O vínculo com o arquivo ficou inválido após mudança no disco ou restrição do navegador. Selecione o JSON novamente para concluir o salvamento.');
          err.name = 'RecoverableDbHandleError';
          err.cause = e;
          throw err;
        }
        throw e;
      }
    };


    // V5.4.3: guarda anti-sobrescrita rápida.
    // Como o File System Access API não oferece gravação atômica/CAS entre abas/PCs,
    // a proteção é: pequena janela com atraso determinístico por usuário + releitura
    // imediatamente antes de gravar. Assim, quando duas instâncias salvam quase juntas,
    // uma grava primeiro e a outra detecta a alteração remota e entra no merge.
    const userDelayHash = () => {
      const src = String(userId || userName || 'local');
      let h = 0;
      for (let i=0;i<src.length;i++) h = ((h << 5) - h + src.charCodeAt(i)) | 0;
      return Math.abs(h);
    };

    const autosyncRaceGuardDelay = async () => {
      const base = 450;
      const spread = 1450;
      const jitter = userDelayHash() % spread;
      await sleep(base + jitter);
    };

    const autoMergeAndSaveNow = async (reason='auto') => {
      if (!dbAutoSyncEnabled || !dbFileHandle || dbBinding.mode !== 'rw') return false;
      if (dbAutoSaveRunning && dbAutoSaveStartedAt && (Date.now() - dbAutoSaveStartedAt > 30000)) {
        console.warn('[Autosync] Lock antigo liberado automaticamente.');
        dbAutoSaveRunning = false;
        dbAutoSavePending = false;
      }
      if (dbAutoSaveRunning) { dbAutoSavePending = true; return false; }
      dbAutoSaveRunning = true;
      dbAutoSaveStartedAt = Date.now();
      try {
        dbOperationQueue = loadDbOperationQueue();
        const localObj = getQueuedLocalSnapshot();
        const queueCount = dbOperationQueue.length || (dbAutoSavePending ? 1 : 0);
        if (queueCount) markDbSync(`fila: ${queueCount} operação(ões) pendente(s)`);

        let lastMergedResult = null;
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const remote = await readSelectedDbSnapshot({ retries: 1, delayMs: 160 });
          const remoteObj = parseSnapshotText(remote.txt);
          const baselineHash = String(dbBinding.baselineHash || '');
          const remoteChanged = !!(baselineHash && remote.meta.hash && baselineHash !== remote.meta.hash);
          const baseObj = dbLoadedSnapshot || loadDbBaseline() || remoteObj;

          let candidate = localObj;
          let label = 'salvo automaticamente';

          if (remoteChanged) {
            const mergedResult = mergeStatesThreeWay(baseObj, localObj, remoteObj);
            lastMergedResult = mergedResult;
            if (mergedResult.conflictCount > 0) {
              markDbSync(`conflito pendente: ${mergedResult.conflictCount}`);
              pauseDbAutoSync('conflito real', `Autosync pausado: ${mergedResult.conflictCount} conflito(s) real(is). Use Salvar no BD/Mesclar manualmente.`);
              return false;
            }
            candidate = mergedResult.merged;
            label = mergedResult.autoMergedCount > 0
              ? `fila mesclada automaticamente (${mergedResult.autoMergedCount})`
              : 'fila reprocessada no BD mais atual';
          }

          // Janela segura: evita que duas abas/usuários gravem em cima da mesma baseline.
          await autosyncRaceGuardDelay();
          const beforeWriteRemote = await readSelectedDbSnapshot({ retries: 0 });
          const beforeHash = String(beforeWriteRemote?.meta?.hash || '');
          const originalRemoteHash = String(remote?.meta?.hash || '');
          if (beforeHash && originalRemoteHash && beforeHash !== originalRemoteHash) {
            markDbSync(`outra sessão salvou; reprocessando fila (${attempt}/${maxAttempts})`);
            await sleep(220 + (userDelayHash() % 480));
            continue;
          }

          await writeStateToSelectedDb(candidate, {
            backupReason: remoteChanged ? `queue-merge-${reason}` : `queue-${reason}`,
            backupBeforeWrite:false
          });

          clearDbOperationQueue();
          clearDbAutoSyncPause();
          dbLoadedSnapshot = normalizeDbStateOnly(candidate);
          persistDbBaseline(dbLoadedSnapshot);
          dbAutoSavePending = false;
          dbAutoSaveDirtySince = 0;
          markDbSync(label);
          if (remoteChanged || queueCount > 1) {
            toast(remoteChanged
              ? 'Autosync: fila mesclada e salva no BD mais atual.'
              : 'Autosync: fila salva com segurança.');
          }
          return true;
        }

        markDbSync('fila aguardando janela segura');
        dbAutoSavePending = true;
        toast('Autosync: outra sessão está salvando. Sua alteração ficou na fila e será tentada novamente.');
        return false;
      } catch (e) {
        console.warn('[Autosync] Falha:', e);
        markDbSync('falha no autosync; fila preservada');
        if (e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) {
          // Mantém os dados locais intactos; só pausa a escrita automática.
          pauseDbAutoSync('vínculo do BD inválido', 'Autosync pausado: selecione o BD novamente. Seus dados locais foram mantidos.');
        }
        return false;
      } finally {
        dbAutoSaveRunning = false;
        dbAutoSaveStartedAt = 0;
        if (dbAutoSavePending && dbAutoSyncEnabled && dbFileHandle && dbBinding.mode === 'rw') {
          dbAutoSavePending = false;
          scheduleDbAutoSave('pending');
        }
      }
    };

    scheduleDbAutoSave = (reason='change') => {
      if (!dbAutoSyncEnabled || !dbFileHandle || dbBinding.mode !== 'rw') return;
      if (dbAutoSaveRunning && dbAutoSaveStartedAt && (Date.now() - dbAutoSaveStartedAt > 20000)) {
        console.warn('[Autosync] Autosave travado por mais de 20s; liberando fila.');
        dbAutoSaveRunning = false;
        dbAutoSaveStartedAt = 0;
        dbAutoSavePending = false;
        markDbSync('fila liberada automaticamente');
      }
      if (dbAutoSaveTimer) clearTimeout(dbAutoSaveTimer);
      dbAutoSaveTimer = setTimeout(() => { dbAutoSaveTimer = null; autoMergeAndSaveNow(reason); }, 1200);
    };

    const startDbWatcher = () => {
      if (dbWatcherTimer || !dbFileHandle || dbBinding.mode !== 'rw') return;
      dbWatcherTimer = setInterval(async () => {
        if (!dbAutoSyncEnabled || dbWatcherRunning || dbAutoSaveRunning || !dbFileHandle || dbBinding.mode !== 'rw') return;
        dbWatcherRunning = true;
        try {
          const remote = await readSelectedDbSnapshot({ retries:0 });
          const baselineHash = String(dbBinding.baselineHash || '');
          if (baselineHash && remote.meta.hash && baselineHash !== remote.meta.hash) {
            if (dbAutoSavePending || dbAutoSaveDirtySince || loadDbOperationQueue().length) {
              markDbSync('alteração externa detectada; fila será reprocessada');
              dbAutoSavePending = true;
              scheduleDbAutoSave('watcher-rebase');
            } else {
              const remoteObj = parseSnapshotText(remote.txt);
              suppressDbAutoSave = true;
              try {
                state = remoteObj;
                persist({ skipAutoSave:true });
              } finally { suppressDbAutoSave = false; }
              setDbBinding({
                ...dbBinding,
                lastLoadedAt: new Date().toISOString(),
                baselineHash: String(remote.meta.hash || ''),
                baselineLastModified: Number(remote.meta.lastModified || 0),
                baselineSize: Number(remote.meta.size || String(remote.txt||'').length || 0),
              }, dbFileHandle, remoteObj);
              markDbSync('recarregado automaticamente');
              render();
              toast('Autosync: alteração externa carregada.');
            }
          }
        } catch (e) {
          console.warn('[Watcher] Falha:', e);
          if (e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) {
            pauseDbAutoSync('vínculo do BD inválido', 'Autosync pausado: vínculo do BD inválido. Seus dados locais foram mantidos.');
          }
        } finally { dbWatcherRunning = false; }
      }, 3000);
    };

    const stopDbWatcher = () => {
      if (dbWatcherTimer) clearInterval(dbWatcherTimer);
      dbWatcherTimer = null;
      dbWatcherRunning = false;
    };

    // ─── Modal-based merge conflict resolution ────────────────────────────────
    // Replaces the old prompt()-based approach.  Shows a proper <dialog> so the
    // user can choose Mesclar / Recarregar / Salvar Cópia without the browser
    // blocking-prompt limitation (especially bad on file:// origins).
    const resolveConcurrentSave = (remoteFile, remoteTxt) => new Promise((resolve) => {
      const remoteObj = parseSnapshotText(remoteTxt);
      const localObj  = normalizeImportedState(buildDbExportObject());
      // CORREÇÃO: Se o baseline não existe, sintetizamos uma base aproximada a partir
      // dos itens que são IDÊNTICOS em local e remoto. Itens iguais em ambos os lados
      // entram na base → localChanged=false e remoteChanged=false → são preservados
      // sem conflito. Itens que diferem ficam sem base (b=undefined) → o merge tenta
      // unir campos. Isso é muito mais seguro que usar remoteObj como base, que fazia
      // os campos locais parecerem "iguais à base" e silenciosamente descartava as
      // alterações do usuário local.
      const _savedBaseline = dbLoadedSnapshot || loadDbBaseline();
      let baseObj;
      if (_savedBaseline) {
        baseObj = normalizeImportedState(_savedBaseline);
      } else {
        // Sem baseline: constrói base sintética com itens idênticos em local e remoto
        const synth = {};
        for (const key of (DB_COLLECTION_KEYS || [])) {
          const lArr = Array.isArray(localObj[key]) ? localObj[key] : [];
          const rArr = Array.isArray(remoteObj[key]) ? remoteObj[key] : [];
          const rMap = new Map(rArr.map(x => [String(x.id||''), x]));
          synth[key] = lArr.filter(x => {
            const rid = String(x.id||'');
            return rMap.has(rid) && (JSON.stringify(x) === JSON.stringify(rMap.get(rid)));
          });
        }
        baseObj = normalizeImportedState(synth);
      }

      const dlg         = qs('#mergeModal');
      const subEl       = qs('#mergeModalSub');
      const statsEl     = qs('#mergeModalStats');
      const actionsEl   = qs('#mergeModalActions');
      const progressEl  = qs('#mergeModalProgress');
      const resultEl    = qs('#mergeModalResult');

      const btnMerge    = qs('#mergeModalMerge');
      const btnReload   = qs('#mergeModalReload');
      const btnCopy     = qs('#mergeModalCopy');
      const btnCancel   = qs('#mergeModalCancel');

      // Pre-compute a quick diff summary to inform the user
      const localCounts  = DB_COLLECTION_KEYS.map(k => `${k}: ${(localObj[k]||[]).length}`).join(' • ');
      const remoteCounts = DB_COLLECTION_KEYS.map(k => `${k}: ${(remoteObj[k]||[]).length}`).join(' • ');
      subEl.textContent = `O BD foi alterado por outra sessão desde que você o abriu. Escolha como proceder:`;
      statsEl.style.display = '';
      statsEl.innerHTML = `
        <div style="display:grid;gap:6px">
          <div><b>Sua versão local:</b> ${localCounts}</div>
          <div><b>Versão do arquivo:</b> ${remoteCounts}</div>
          <div class="tiny muted" style="margin-top:4px">Ao Mesclar, itens novos de ambos os lados são preservados. Campos diferentes do mesmo item são unidos automaticamente. Se os dois alterarem o mesmo campo, o app bloqueia o salvamento para evitar sobrescrita.</div>
        </div>`;

      // Reset UI state
      actionsEl.style.display  = '';
      progressEl.style.display = 'none';
      resultEl.style.display   = 'none';
      resultEl.innerHTML       = '';
      [btnMerge, btnReload, btnCopy, btnCancel].forEach(b => { if (b) b.disabled = false; });

      const closeAndResolve = () => {
        // remove listeners to avoid duplicates on next call
        btnMerge.onclick  = null;
        btnReload.onclick = null;
        btnCopy.onclick   = null;
        btnCancel.onclick = null;
        closeDialog(dlg);
        resolve();
      };

      const setLoading = (msg) => {
        actionsEl.style.display  = 'none';
        progressEl.style.display = '';
        progressEl.textContent   = msg || '⏳ Processando…';
        [btnMerge, btnReload, btnCopy, btnCancel].forEach(b => { if (b) b.disabled = true; });
      };

      const showResult = (msg, isError=false) => {
        progressEl.style.display = 'none';
        resultEl.style.display   = '';
        resultEl.innerHTML       = `<div class="${isError ? 'warn' : 'hint tiny'}" style="font-weight:700">${msg}</div>
          <div style="margin-top:10px"><button class="btn primary" type="button" id="mergeModalOk">Fechar</button></div>`;
        const okBtn = qs('#mergeModalOk', resultEl);
        if (okBtn) okBtn.onclick = closeAndResolve;
      };

      btnMerge.onclick = async () => {
        setLoading('⏳ Mesclando versões…');
        try {
          const mergedResult = mergeStatesThreeWay(baseObj, localObj, remoteObj);
          if (mergedResult.conflictCount > 0) {
            const detailLines = (mergedResult.conflicts || []).slice(0, 8).map(c => {
              const keys = [...new Set([...(c.localChangedKeys||[]), ...(c.remoteChangedKeys||[])])].join(', ') || 'sem detalhe';
              const reason = c.reason === 'edit_vs_delete'
                ? 'edição vs exclusão'
                : c.reason === 'duplicate_new_id'
                  ? 'novo item com mesmo ID'
                  : 'mesmo campo alterado';
              return `<li><b>${c.collection}</b> • <span class="mono">${c.id}</span> • ${reason}<br><span class="tiny muted">Campos: ${keys}</span></li>`;
            }).join('');
            const more = mergedResult.conflictCount > 8 ? `<div class="tiny muted" style="margin-top:8px">+ ${mergedResult.conflictCount - 8} conflito(s) adicional(is).</div>` : '';
            showResult(`⚠️ Mesclagem bloqueada para evitar sobrescrita.<br><span class="tiny">${mergedResult.autoMergedCount} item(ns) foram preparados para mesclagem automática, mas ${mergedResult.conflictCount} conflito(s) exigem revisão manual.</span><div style="margin-top:10px;text-align:left"><ol style="padding-left:18px;margin:0">${detailLines}</ol>${more}</div>`, true);
            toast(`Mesclagem bloqueada: ${mergedResult.conflictCount} conflito(s) real(is) detectado(s).`);
            return;
          }
          setLoading('⏳ Gravando no arquivo…');
          await writeStateToSelectedDb(mergedResult.merged, { backupReason:'merge' });
          // Atualiza explicitamente o baseline pós-merge para que o próximo salvamento
          // compare contra a versão mesclada, não contra uma base antiga/local.
          dbLoadedSnapshot = normalizeDbStateOnly(mergedResult.merged);
          persistDbBaseline(dbLoadedSnapshot);
          const r = mergedResult.summary || {};
          const parts = DB_COLLECTION_KEYS
            .filter(k => r[k])
            .map(k => `${k}: ${r[k].merged}`)
            .join(' • ');
          const autoMsg = mergedResult.autoMergedCount > 0
            ? ` | 🔀 ${mergedResult.autoMergedCount} item(ns) unidos automaticamente.`
            : '';
          showResult(`✅ Mesclagem concluída e salva com sucesso!<br><span class="tiny">${parts}${autoMsg}</span>`);
          toast(mergedResult.autoMergedCount > 0
            ? `BD mesclado e salvo com sucesso. ${mergedResult.autoMergedCount} item(ns) unidos automaticamente.`
            : 'BD mesclado e salvo com sucesso.');
        } catch (e) {
          console.error('[Merge] Erro ao mesclar:', e);
          showResult(`❌ Falha na mesclagem: ${e?.message || e}. Tente novamente ou salve uma cópia.`, true);
        }
      };

      btnReload.onclick = () => {
        setLoading('⏳ Recarregando BD…');
        try {
          loadStateFromText(remoteTxt, 'rw', remoteFile?.name || dbBinding.name || 'BD selecionado', dbFileHandle, getDbFileMeta(remoteFile, remoteTxt));
          toast('BD recarregado com a versão mais nova do arquivo.');
          closeAndResolve();
        } catch (e) {
          console.error('[Reload] Erro:', e);
          showResult(`❌ Falha ao recarregar: ${e?.message || e}`, true);
        }
      };

      btnCopy.onclick = () => {
        const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
        downloadFile(JSON.stringify(localObj, null, 2), `CapView_copia_local_${safeName}_${formatDate(new Date())}.json`, 'application/json');
        toast('Cópia local exportada. O arquivo compartilhado não foi alterado.');
        closeAndResolve();
      };

      btnCancel.onclick = () => {
        toast('Salvamento cancelado.');
        closeAndResolve();
      };

      openDialog(dlg);
    });

    const saveToSelectedDb = async (attempt = 0) => {
      if (!dbFileHandle || dbBinding.mode !== 'rw') {
        toast('Nenhum BD em ler/gravar selecionado nesta sessão.');
        return;
      }
      try {
        const granted = await ensureDbHandlePermission('readwrite', { prompt:true });
        if (!granted) {
          toast(dbWriteHelpText());
          return;
        }
        const remote = await readSelectedDbSnapshot();
        const remoteFile = remote.file;
        const remoteTxt = remote.txt;
        const remoteMeta = remote.meta;
        const baselineHash = String(dbBinding.baselineHash || '');
        const unchanged = baselineHash && baselineHash === remoteMeta.hash;
        if (!unchanged) {
          await resolveConcurrentSave(remoteFile, remoteTxt);
          return;
        }
        await writeStateToSelectedDb(buildDbExportObject(), { backupReason:'save' });
        toast('BD salvo no arquivo selecionado.');
      } catch (e) {
        console.error(e);
        if ((e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) && attempt < 1) {
          const recovered = await recoverDbHandleByReselect('O arquivo mudou no disco ou o navegador invalidou a sessão do BD. Selecione o JSON novamente para concluir o salvamento.');
          if (recovered) return await saveToSelectedDb(attempt + 1);
          return;
        }
        alert('Falha ao salvar no BD selecionado. Verifique a permissão do arquivo.');
      }
    };

    const reloadSelectedDb = async (attempt = 0) => {
      if (!dbFileHandle || dbBinding.mode !== 'rw') {
        toast('Nenhum BD em ler/gravar selecionado nesta sessão.');
        return;
      }
      try {
        const remote = await readSelectedDbSnapshot();
        loadStateFromText(remote.txt, 'rw', remote.file?.name || dbBinding.name || 'BD selecionado', dbFileHandle, remote.meta);
        toast('BD recarregado do arquivo selecionado.');
      } catch (e) {
        console.error(e);
        if ((e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) && attempt < 1) {
          const recovered = await recoverDbHandleByReselect('O vínculo com o BD ficou inválido. Selecione o JSON novamente para recarregar.');
          if (recovered) return await reloadSelectedDb(attempt + 1);
          return;
        }
        alert('Falha ao recarregar o BD selecionado.');
      }
    };

    const defineDefaultDb = () => {
      const fileName = 'CapView_DB_Modelo.json';
      const out = normalizeImportedState(buildDbExportObject());
      downloadFile(JSON.stringify(out, null, 2), fileName, 'application/json');
      toast('Modelo de BD exportado.');
    };

    const copyDbPath = async () => {
      if (!dbPathValue) {
        toast('Nenhum caminho salvo.');
        return;
      }
      try {
        await navigator.clipboard.writeText(dbPathValue);
        toast('Caminho copiado.');
      } catch {
        const tmp = document.createElement('textarea');
        tmp.value = dbPathValue;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        tmp.remove();
        toast('Caminho copiado.');
      }
    };

    const dbPathInput = el('input', { type:'text', value: dbPathValue, placeholder:'\\servidor\pasta\arquivo.json' });

    const dbStatusPill = (() => {
      let label = 'Nenhum BD vinculado';
      let cls = 'bg-over';
      if (dbBinding.mode === 'rw') { label = 'BD selecionado (ler/gravar)'; cls = 'bg-ok'; }
      else if (dbBinding.mode === 'ro') { label = 'BD importado (somente leitura)'; cls = 'bg-mid'; }
      return el('span', { class:'pill' }, [el('span', { class:`dot ${cls}` }), label]);
    })();

    const dbMeta = el('div', { class:'grid', style:'gap:8px' }, [
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        dbStatusPill,
        dbBinding.name ? el('span', { class:'tag mono' }, [dbBinding.name]) : el('span', { class:'tag' }, ['Sem arquivo selecionado'])
      ]),
      el('div', { class:'tiny muted' }, [
        dbBinding.lastLoadedAt
          ? `Último carregamento: ${new Date(dbBinding.lastLoadedAt).toLocaleString('pt-BR')} • Schema: ${APP_SCHEMA_VERSION} • Base comparativa: ${dbBinding.baselineHash ? dbBinding.baselineHash.slice(0,8) : '—'}`
          : 'Nesta arquitetura, o vínculo ler/gravar vale para a sessão atual do navegador.'
      ]),
      el('div', { class:'tiny muted' }, [`Autosync: ${dbAutoSyncEnabled ? 'ligado' : (dbAutoSyncPauseReason ? 'pausado' : 'desligado')}${dbAutoSyncPauseReason ? ' • Motivo: ' + dbAutoSyncPauseReason : ''}${dbLastSyncLabel ? ' • Último sync: ' + dbLastSyncLabel : ''}. O app monitora o JSON a cada 3s. Se houver alteração externa enquanto você edita, ele pausa para evitar sobrescrita; ao religar, mescla em cima do BD mais atual.`])
    ]);

    if (dbAutoSyncEnabled && dbFileHandle && dbBinding.mode === 'rw') startDbWatcher();

    const body = el('div', { class:'grid' }, [
      el('div', { class:'hint tiny' }, [
        el('b', {}, ['Banco de Dados por arquivo: ']),
        'use esta aba para apontar o JSON oficial na pasta de rede. Depois de selecionado, o app salva no arquivo e monitora alterações para mesclar o uso simultâneo.'
      ]),
      card('Banco de Dados', null, el('div', { class:'grid' }, [
        dbMeta,
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [
            el('label', {}, ['Banco JSON oficial']),
            el('div', { class:'row' }, [
              button('Selecionar arquivo JSON', 'primary', selectDbReadWrite),
              button('Salvar no BD selecionado', '', saveToSelectedDb),
              button(dbAutoSyncEnabled ? 'Autosync ligado' : (dbAutoSyncPauseReason ? 'Religar e mesclar' : 'Autosync desligado'), dbAutoSyncEnabled ? 'primary' : '', () => {
                dbAutoSyncEnabled = !dbAutoSyncEnabled;
                localStorage.setItem('capview_db_autosync_enabled', dbAutoSyncEnabled ? '1' : '0');
                if (dbAutoSyncEnabled) {
                  const wasPaused = !!dbAutoSyncPauseReason;
                  clearDbAutoSyncPause();
                  startDbWatcher();
                  scheduleDbAutoSave(wasPaused ? 'resume-merge' : 'toggle-on');
                  toast(wasPaused ? 'Autosync religado: mesclando com o BD mais atual.' : 'Autosync ligado.');
                }
                else { stopDbWatcher(); clearDbAutoSyncPause(); toast('Autosync desligado.'); }
                render();
              }),
              button('Recarregar BD selecionado', '', reloadSelectedDb),
            ])
          ])
        ]),
        el('div', { class:'row' }, [
          el('div', { class:'field', style:'flex:1;min-width:320px' }, [el('label', {}, ['Caminho do BD de Rede']), dbPathInput]),
          el('div', { class:'field' }, [el('label', {}, ['Ações']), el('div', { class:'row' }, [
            button('Salvar caminho', '', () => { setDbPathValue(dbPathInput.value); toast('Caminho salvo localmente.'); }),
            button('Copiar', '', copyDbPath),
            button('Limpar dados do sistema', 'danger', confirmClearAllData),
          ])])
        ]),
        el('div', { class:'tiny muted' }, [
          'Fluxo esperado: selecione o JSON oficial pelo botão. O caminho salvo é apenas referência visual/cópia; por segurança do navegador, o app não tenta abrir file:// automaticamente. Ao carregar o BD, feriados já cadastrados são preservados/mesclados e não somem.'
        ])
      ])),
      card('Eventos por usuário — anti-sobrescrita', null, el('div', { class:'grid' }, [
        el('div', { class:'hint tiny' }, [
          el('b', {}, ['Como funciona: ']),
          'selecione uma pasta ', el('span', { class:'mono' }, ['CapViewData']), '. O app cria/usa ', el('span', { class:'mono' }, ['snapshot.json']), ' e ', el('span', { class:'mono' }, ['events/usuario.json']), '. Cada usuário grava no próprio arquivo de eventos; depois o app lê todos e aplica em ordem.'
        ]),
        el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
          el('span', { class:'pill' }, [el('span', { class:`dot ${capviewEventMode.enabled ? 'bg-ok' : 'bg-over'}` }), capviewEventMode.enabled ? 'Modo Eventos ligado' : 'Modo Eventos desligado']),
          el('span', { class:'pill' }, [el('span', { class:`dot ${(capviewEventMode.autoSyncEnabled !== false && capviewEventAutoSyncTimer) ? 'bg-ok' : 'bg-mid'}` }), (capviewEventMode.autoSyncEnabled !== false && capviewEventAutoSyncTimer) ? 'Autosync eventos ativo' : (capviewEventMode.autoSyncEnabled !== false ? 'Autosync pronto' : 'Autosync eventos desligado')]),
          capviewEventMode.folderName ? el('span', { class:'tag mono' }, [capviewEventMode.folderName]) : el('span', { class:'tag' }, ['Nenhuma pasta selecionada']),
          el('span', { class:'tag' }, ['Pendentes aplicados na última leitura: ' + Number(capviewEventMode.pendingReadCount||0)]),
          el('span', { class:'tag' }, ['Outbox local: ' + loadLocalEventOutbox().length])
        ]),
        el('div', { class:'tiny muted' }, [
          (capviewEventMode.lastReadAt ? 'Última leitura: ' + new Date(capviewEventMode.lastReadAt).toLocaleString('pt-BR') : 'Última leitura: —') + ' • ' + (capviewEventMode.lastWriteAt ? 'Última gravação de evento: ' + new Date(capviewEventMode.lastWriteAt).toLocaleString('pt-BR') : 'Última gravação de evento: —') + ' • ' + (capviewEventMode.autoSyncLastTickAt ? 'Último autosync: ' + new Date(capviewEventMode.autoSyncLastTickAt).toLocaleTimeString('pt-BR') : 'Último autosync: —') + (capviewEventMode.lastStatus ? ' • Status: ' + capviewEventMode.lastStatus : '') + (capviewEventMode.autoSyncError ? ' • Erro: ' + capviewEventMode.autoSyncError : '')
        ]),
        el('div', { class:'row' }, [
          button('Selecionar pasta CapViewData', 'primary', selectCapViewDataFolder),
          button('Enviar outbox para /events', '', async () => { const n = await flushLocalEventOutbox(); toast(n + ' evento(s) enviado(s) do outbox.'); render(); }),
          button(capviewEventMode.autoSyncEnabled !== false ? 'Desligar autosync eventos' : 'Ligar autosync eventos', '', toggleEventAutoSync),
          button('Ler / aplicar eventos pendentes', '', () => syncEventsFromFolder()),
          button('Consolidar eventos no snapshot', '', consolidateEventsToSnapshot),
          button('Desligar modo eventos', 'danger', disableEventMode),
        ]),
        el('div', { class:'tiny muted' }, [
          'Uso recomendado: todos apontam para a mesma pasta CapViewData. Ao selecionar, o app cria snapshot.json, cria events/ e inicializa events/seu-usuario.json. Com modo eventos ligado, as alterações NÃO gravam direto no snapshot; primeiro viram evento no arquivo do usuário. O autosync lê /events a cada 4s enquanto a aba está ativa; o botão manual continua como fallback.'
        ])
      ])),
      card('Exportar', null, el('div', { class:'row' }, [
        button('Exportar Snapshot (JSON)', 'primary', exportSnapshot),
        button('Exportar Events (JSONL)', '', exportEvents),
        buildCsvDropdown(),
      ])),
      card('Importar Snapshot', null, el('div', { class:'grid' }, [
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [
            el('label', {}, ['Importar Snapshot (.json)']),
            (() => {
              const inp = el('input', { type:'file', accept:'.json,application/json' });
              inp.addEventListener('change', async () => {
                if (!inp.files || !inp.files[0]) return;
                try { await importSnapshot(inp.files[0]); } catch(e) { console.error(e); alert('Falha ao importar snapshot.'); }
                inp.value='';
              });
              return inp;
            })()
          ])
        ]),
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [
            el('label', {}, ['Importar Snapshot (Adicionar / Mesclar) (.json)']),
            (() => {
              const inp = el('input', { type:'file', accept:'.json,application/json' });
              inp.addEventListener('change', async () => {
                if (!inp.files || !inp.files[0]) return;
                try { await importSnapshotAdd(inp.files[0]); } catch(e) { console.error(e); alert('Falha ao adicionar/mesclar snapshot.'); }
                inp.value='';
              });
              return inp;
            })()
          ])
        ]),
      ])),
      card('Auditoria rápida', null, el('div', { class:'grid' }, [
        el('div', { class:'tiny' }, [`Eventos registrados: `, el('span', { class:'mono' }, [String((state.events||[]).length)])]),
        el('div', { class:'tiny' }, ['(Dica) Para auditoria corporativa, exporte o JSONL semanalmente e mantenha no repositório/pasta de rede.'])
      ]))
    ]);

    return body;
  };

  // ----------------------
  // App shell
  // ----------------------
  const TABS = [
    { id:'dashboard', label:'Dashboard Planilha', icon:'🗓️' },
    { id:'evaluation', label:'Dashboard de Avaliação', icon:'📈' },
    { id:'demands', label:'Demandas', icon:'📋' },
    { id:'resources', label:'Recursos', icon:'👥' },
    { id:'calendar', label:'Bloqueios/Feriados', icon:'📅' },
    { id:'he', label:'Horas Extras (HE)', icon:'⏱️' },
    { id:'windows', label:'Janelas Livres', icon:'🔎' },
    { id:'consolidation', label:'Consolidação', icon:'📦' },
  ];

  const renderTabs = () => {
    const nav = qs('#tabs');
    nav.innerHTML = '';
    for (const t of TABS) {
      nav.appendChild(el('button', {
        class: (activeTab===t.id ? 'active' : ''),
        onclick: () => { activeTab = t.id; render(); }
      }, [el('span', {}, [t.icon]), t.label]));
    }
  };

  const render = () => {
    renderTabs();
    const root = qs('#app');
    root.innerHTML = '';

    let view;
    if (activeTab === 'dashboard') view = viewDashboard();
    else if (activeTab === 'evaluation') view = viewEvaluationDashboard();
    else if (activeTab === 'demands') view = viewDemands();
    else if (activeTab === 'resources') view = viewResources();
    else if (activeTab === 'calendar') view = viewCalendar();
    else if (activeTab === 'he') view = viewOvertime();
    else if (activeTab === 'windows') view = viewWindows();
    else if (activeTab === 'consolidation') view = viewConsolidation();
    else view = el('div', {}, ['Aba inválida.']);

    if (!hasDbBinding()) {
      root.appendChild(el('div', { class:'globalDbWarn', style:'margin-bottom:14px' }, [
        'Nenhum BD Vinculado',
        dbPathValue ? el('span', { class:'tiny', style:'display:block;margin-top:4px' }, ['Caminho salvo: ', el('span', { class:'mono' }, [dbPathValue])]) : el('span', { class:'tiny', style:'display:block;margin-top:4px' }, ['Vá em ', el('b', {}, ['Consolidação']), ' > ', el('b', {}, ['Banco de Dados']), ' e selecione o arquivo da pasta de rede.'])
      ]));
    }

    root.appendChild(view);
  };

  // init
  setUser(userName);

  // modal close handlers
  const dlg = qs('#dayModal');
  qs('#dayModalClose').addEventListener('click', () => { try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } } });
  dlg.addEventListener('close', syncModalBlur);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } syncModalBlur(); });

  const hdlg = qs('#heatModal');
  qs('#heatModalClose').addEventListener('click', () => { try{ hdlg.close(); }catch{ hdlg.removeAttribute('open'); } });
  hdlg.addEventListener('click', (e) => { if (e.target === hdlg) { try{ hdlg.close(); }catch{ hdlg.removeAttribute('open'); } } });
  hdlg.addEventListener('close', syncModalBlur);
  hdlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ hdlg.close(); }catch{ hdlg.removeAttribute('open'); } syncModalBlur(); });

  const mdlg = qs('#monthModal');
  if (mdlg) {
    qs('#monthModalClose').addEventListener('click', () => { try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } });
    mdlg.addEventListener('click', (e) => { if (e.target === mdlg) { try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } } });
    mdlg.addEventListener('close', syncModalBlur);
    mdlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } syncModalBlur(); });
  }

  const edlg = qs('#demandEditModal');
  qs('#demandEditModalClose').addEventListener('click', () => { try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } });
  edlg.addEventListener('click', (e) => { if (e.target === edlg) { try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } } });
  edlg.addEventListener('close', syncModalBlur);
  edlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } syncModalBlur(); });

  const sdg = qs('#demandStagesModal');
  if (sdg) {
    qs('#demandStagesModalClose').addEventListener('click', () => { try{ sdg.close(); }catch{ sdg.removeAttribute('open'); } syncModalBlur(); });
    sdg.addEventListener('click', (e) => { if (e.target === sdg) { try{ sdg.close(); }catch{ sdg.removeAttribute('open'); } syncModalBlur(); } });
    sdg.addEventListener('close', syncModalBlur);
    sdg.addEventListener('cancel', (e) => { e.preventDefault(); try{ sdg.close(); }catch{ sdg.removeAttribute('open'); } syncModalBlur(); });
  }

	  const rpd = qs('#demandReprogramModal');
	  if (rpd) {
	    qs('#demandReprogramModalClose').addEventListener('click', () => { try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); });
	    rpd.addEventListener('click', (e) => { if (e.target === rpd) { try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); } });
	    rpd.addEventListener('close', syncModalBlur);
	    rpd.addEventListener('cancel', (e) => { e.preventDefault(); try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); });
	  }

  const rdlg = qs('#resourceEditModal');
  if (rdlg) {
    qs('#resourceEditModalClose').addEventListener('click', () => { try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); });
    rdlg.addEventListener('click', (e) => { if (e.target === rdlg) { try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); } });
    rdlg.addEventListener('close', syncModalBlur);
    rdlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); });
  }

  const dd = qs('#donutModal');
  if (dd) { dd.addEventListener('close', syncModalBlur); dd.addEventListener('cancel', (e) => { e.preventDefault(); try{ dd.close(); }catch{ dd.removeAttribute('open'); } syncModalBlur(); }); }

  // HE modals: close handlers
  const hed = qs('#heModal');
  if (hed) {
    qs('#heModalClose').addEventListener('click', () => closeHeModal());
    hed.addEventListener('click', (e) => { if (e.target === hed) closeHeModal(); });
    hed.addEventListener('close', syncModalBlur);
    hed.addEventListener('cancel', (e) => { e.preventDefault(); closeHeModal(); });
  }

  const hcd = qs('#heConfirmModal');
  if (hcd) {
    qs('#heConfirmClose').addEventListener('click', () => closeHeConfirm());
    hcd.addEventListener('click', (e) => { if (e.target === hcd) closeHeConfirm(); });
    hcd.addEventListener('close', syncModalBlur);
    hcd.addEventListener('cancel', (e) => { e.preventDefault(); closeHeConfirm(); });
  }

  // Event delegation for HE actions (robusto mesmo com re-render/SPA)
  document.addEventListener('click', (e) => {
    const elBtn = e.target.closest('[data-action]');
    if (!elBtn) return;
    const act = elBtn.getAttribute('data-action');
    if (!act) return;

    if (act === 'he-open') {
      openHeModal({});
      return;
    }

    if (act === 'he-cancel') {
      closeHeModal();
      return;
    }

    if (act === 'he-save') {
      const resourceId = (qs('#heModalResource')?.value || '__ALL__').trim();
      const date = (qs('#heModalDate')?.value || '').trim();
      const horas = Number(qs('#heModalHours')?.value || 0);
      const motivo = (qs('#heModalMotivo')?.value || '').trim();
      const titulo = (qs('#heModalTitulo')?.value || '').trim();
      const predio = (qs('#heModalPredio')?.value || '').trim();
      const focal = (qs('#heModalFocal')?.value || '').trim();
      const prioridade = (qs('#heModalPrioridade')?.value || 'Média').trim();
      const observacoes = (qs('#heModalObs')?.value || '').trim();

      if (!date) return toast('Informe a data da HE.');
      if (!isFinite(horas) || horas <= 0) return toast('Informe as horas da HE (maior que 0).');
      if (!titulo) {
        toast('Informe o título/atividade da HE.');
        try { qs('#heModalTitulo')?.focus(); } catch {}
        return;
      }
      if (!motivo) {
        toast('Motivo é obrigatório.');
        try { qs('#heModalMotivo')?.focus(); } catch {}
        return;
      }

      dispatch('ADD_OVERTIME', {
        id: generateId('id'),
        resourceId: resourceId || '__ALL__',
        date,
        horas,
        motivo,
        titulo,
        atividade: titulo,
        predio,
        focal,
        prioridade,
        observacoes,
        createdAt: Date.now(),
      });
      closeHeModal();
      toast('HE adicionada.');
      render();
      return;
    }

    if (act === 'he-delete') {
      const id = (elBtn.getAttribute('data-id') || '').trim();
      if (!id) return;
      const all = Array.isArray(state.overtimes) ? state.overtimes : [];
      const ot = all.find(x => String(x.id) === String(id));
      if (!ot) return toast('HE não encontrada.');
      hePendingDeleteId = String(id);
      openHeConfirm(ot);
      return;
    }

    if (act === 'he-delete-cancel') {
      closeHeConfirm();
      return;
    }

    if (act === 'he-delete-confirm') {
      if (!hePendingDeleteId) return;
      dispatch('DELETE_OVERTIME', { id: hePendingDeleteId });
      closeHeConfirm();
      toast('HE removida.');
      render();
      return;
    }
  });


  syncModalBlur();



  // ---------------- CSV Export (dropdown) ----------------

  const buildCsvDropdown = () => {
    const root = el('div', { class:'dd', id:'csvDropdown' });
    const btn = el('button', { class:'btn', type:'button', id:'csvBtn' }, ['Exportar CSV ▾']);
    const menu = el('div', { class:'ddMenu', id:'csvMenu', role:'menu' }, [
      el('button', { class:'ddItem', type:'button', 'data-export':'demandas' }, ['Exportar Demandas']),
      el('button', { class:'ddItem', type:'button', 'data-export':'recursos' }, ['Exportar Recursos']),
      el('button', { class:'ddItem', type:'button', 'data-export':'bloqueios' }, ['Exportar Bloqueios']),
      el('button', { class:'ddItem', type:'button', 'data-export':'feriados' }, ['Exportar Feriados']),
      el('button', { class:'ddItem', type:'button', 'data-export':'he' }, ['Exportar HE']),
      el('div', { class:'ddSep' }, []),
      el('button', { class:'ddItem', type:'button', 'data-export':'janelas' }, ['Exportar Janelas Livres por recurso (meses)']),
    ]);

    const close = () => { root.classList.remove('open'); btn.setAttribute('aria-expanded','false'); };
    const open = () => { root.classList.add('open'); btn.setAttribute('aria-expanded','true'); };

    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (root.classList.contains('open')) close(); else open();
    });

    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-export]');
      if (!b) return;
      const key = b.getAttribute('data-export');
      close();
      switch(key){
        case 'demandas': exportDemandasCSV(); break;
        case 'recursos': exportRecursosCSV(); break;
        case 'bloqueios': exportBloqueiosCSV(); break;
        case 'feriados': exportFeriadosCSV(); break;
        case 'he': exportHECSV(); break;
        case 'janelas': exportJanelasPorRecursoMesCSV(); break;
      }
    });

    // close on outside click
    document.addEventListener('click', (e) => {
      if (!root.isConnected) return; // only while in DOM
      if (!root.contains(e.target)) close();
    });

    root.appendChild(btn);
    root.appendChild(menu);
    return root;
  };
  const CSV_SEP = ';';

  const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // normalize newlines (keep deterministic)
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const mustQuote = s.includes('"') || s.includes(CSV_SEP) || s.includes('\n');
    if (s.includes('"')) s = s.replace(/"/g, '""');
    return mustQuote ? `"${s}"` : s;
  };

  const toCSV = (rows, headers) => {
    const out = [];
    out.push(headers.map(csvEscape).join(CSV_SEP));
    for (const r of rows) {
      out.push(headers.map(h => csvEscape(r[h])).join(CSV_SEP));
    }
    return out.join('\n');
  };

  const downloadText = (filename, text, mime='text/csv;charset=utf-8') => {
    try {
      // Excel (principalmente em Windows pt-BR) costuma abrir CSV como ANSI.
      // O BOM UTF-8 ajuda o Excel a detectar acentuação corretamente.
      const BOM = '﻿';
      const blob = new Blob([BOM, text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      console.error(e);
      toast('Falha ao exportar CSV.');
    }
  };

  const exportDemandasCSV = () => {
    const headers = [
      'id','titulo','responsavel','data_inicio','data_fim','status_base','status_atual',
      'percentual_diario','prioridade','observacoes'
    ];
    const rows = (state.demands||[]).map(d => ({
      id: d.id || '',
      titulo: d.titulo || d.nome || '',
      responsavel: d.resourceId || d.responsavel || '',
      data_inicio: d.start || d.data_inicio || '',
      data_fim: d.end || d.data_fim || '',
      status_base: d.status || '',
      status_atual: effectiveStatus ? effectiveStatus(d) : (d.status||''),
      percentual_diario: (d.dailyPercent ?? d.percentual_diario ?? d.percent ?? ''),
      prioridade: d.prioridade || '',
      observacoes: d.obs || d.observacoes || ''
    }));
    downloadText('demandas.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Demandas exportado.');
  };

  const exportRecursosCSV = () => {
    const headers = ['id','nome','tipo','ativo','inicio','fim'];
    const rows = (state.resources||[]).map(r => ({
      id: r.id || '',
      nome: r.nome || '',
      tipo: r.tipo || '',
      ativo: (r.ativo === false) ? 'false' : 'true',
      inicio: r.inicio || '',
      fim: r.fim || ''
    }));
    downloadText('recursos.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Recursos exportado.');
  };

  const exportBloqueiosCSV = () => {
    const headers = ['id','recurso','data','tipo','observacao'];
    const rows = (state.blockings||[]).map(b => ({
      id: b.id || '',
      recurso: b.resourceId || '',
      data: b.date || '',
      tipo: b.tipo || '',
      observacao: b.obs || b.observacao || ''
    }));
    downloadText('bloqueios.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Bloqueios exportado.');
  };

  const exportFeriadosCSV = () => {
    const headers = ['data','descricao'];
    const rows = (state.holidays||[]).map(h => ({
      data: (typeof h === 'string') ? h : (h.date || ''),
      descricao: (typeof h === 'string') ? '' : (h.desc || h.descricao || '')
    }));
    downloadText('feriados.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Feriados exportado.');
  };

  const exportHECSV = () => {
    const headers = ['id','recurso','data','horas','motivo'];
    const rows = (state.overtimes||[]).map(o => ({
      id: o.id || '',
      recurso: o.resourceId || o.recurso || '',
      data: o.date || o.data || '',
      horas: (o.horas ?? o.hours ?? ''),
      motivo: o.motivo || o.obs || ''
    }));
    downloadText('he.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de HE exportado.');
  };

  const monthStatsForExport = (resourceId, y, m0) => {
    const days = getDaysInMonth(y, m0);
    let dias_uteis_contados = 0;
    let dias_com_bloqueio = 0;
    let dias_com_feriado = 0;
    let dias_com_HE = 0;

    // Local, export-safe HE lookup (do not depend on view-scoped helpers).
    const overtimeTotalLocal = (rid, dateStr) => {
      const list = (state.overtimes || state.he || []);
      let sum = 0;
      for (const o of list) {
        const r = (o.resourceId ?? o.recurso_id ?? o.recurso ?? o.resource ?? '');
        const dt = (o.date ?? o.data ?? '');
        if (!r || !dt) continue;
        if (String(r) !== String(rid)) continue;
        if (String(dt) !== String(dateStr)) continue;
        const h = Number(o.horas ?? o.hours ?? 0);
        if (isFinite(h)) sum += h;
      }
      return sum;
    };

    for (const d of days) {
      const dateStr = formatDate(d);
      // Export must not depend on freeHoursInfo() (it may be scoped inside the Janelas view).
      // Eligibility rule (same intent as Janelas Livres): weekends are ignored unless there is HE for that day.
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      const hasHE = (overtimeTotalLocal(resourceId, dateStr) > 0) || (overtimeTotalLocal('__ALL__', dateStr) > 0);
      if (isWeekend && !hasHE) continue;
      dias_uteis_contados += 1;
      if (hasHE) dias_com_HE += 1;
      if (isHoliday(dateStr)) dias_com_feriado += 1;
      if (blockingFor(resourceId, dateStr)) dias_com_bloqueio += 1;
    }

    return { dias_uteis_contados, dias_com_bloqueio, dias_com_feriado, dias_com_HE };
  };

  const exportJanelasPorRecursoMesCSV = () => {
    try {
	      const whLocal = (typeof wh !== 'undefined' && wh) ? wh : {
	        startMonth: '',
	        months: 6,
	        metric: 'pct',
	        dynamicOrder: true,
	        sortDir: 'desc',
	        fixedOrderIds: [],
	        show: 'all',
	        topN: 10,
	      };
      // NOTE: buildMonths/monthlyWindow are scoped inside the Janelas Livres view.
      // Export must be self-contained to avoid ReferenceError when the view isn't mounted.
      const clampMonthsLocal = (n) => {
        const v = Math.max(1, Math.min(36, Number(n || 6)));
        return isFinite(v) ? v : 6;
      };
      const parseStartMonthLocal = (ym) => {
        const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
        if (!m) {
          const now = new Date();
          return { y: now.getFullYear(), m0: now.getMonth() };
        }
        return { y: Number(m[1]), m0: Number(m[2]) - 1 };
      };
      const fmtMonthLabelLocal = (y, m0) => {
        const d = new Date(y, m0, 1);
        return d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      };
      const monthKeyLocal = (y, m0) => `${y}-${String(m0 + 1).padStart(2, '0')}`;
      const addMonthsLocal = (y, m0, delta) => {
        const d = new Date(y, m0 + delta, 1);
        return { y: d.getFullYear(), m0: d.getMonth() };
      };
	      const buildMonthsLocal = () => {
	        const start = whLocal.startMonth || '';
        const { y, m0 } = parseStartMonthLocal(start);
	        const count = clampMonthsLocal(whLocal.months);
        const list = [];
        for (let i = 0; i < count; i++) {
          const mm = addMonthsLocal(y, m0, i);
          list.push({
            y: mm.y,
            m0: mm.m0,
            key: monthKeyLocal(mm.y, mm.m0),
            label: fmtMonthLabelLocal(mm.y, mm.m0),
          });
        }
        return list;
      };
      const monthlyWindowLocal = (resourceId, y, m0) => {
        // Alguns helpers (como freeHoursInfo) podem estar escopados em views.
        // Para o export, garantimos um fallback local equivalente.
        const freeHoursInfoLocal = (typeof freeHoursInfo === 'function') ? freeHoursInfo : ((rid, dObj) => {
          const dateStr = formatDate(dObj);
          const ot = (typeof overtimeInfo === 'function') ? overtimeInfo(rid, dateStr) : { total: 0, items: [] };
          const otHours = Math.max(0, Number(ot.total || 0));
          const res = (state.resources || []).find(r => r.id === rid);
          const blk0 = blockingFor(rid, dateStr);
          const blockedNoHe = isWeekend(dObj) || isHoliday(dateStr) || !!blk0 || isThirdPartyOff(res, dateStr);

          // Regra: dias não úteis não recebem demanda normal. Com HE, só a capacidade extra entra.
          if (blockedNoHe && otHours <= 0) {
            return { dateStr, capacity: 0, allocated: 0, free: 0, eligible: false, overtime: ot };
          }

          // Capacidade base (janelas): dia útil = 9h; dia não útil = 0h; HE soma sobre a data/recurso.
          let base = blockedNoHe ? 0 : HOURS_PER_DAY;

          const capacity = Math.max(0, Number(base || 0)) + otHours;

          // Alocado continua calculado sobre 9h (regra do app)
          const perc = dailyPercentAllocated(rid, dObj);
          const allocated = Math.max(0, Number(perc || 0)) / 100 * HOURS_PER_DAY;
          const free = capacity - allocated;
          return { dateStr, capacity, allocated, free, eligible: true, overtime: ot };
        });
        const days = getDaysInMonth(y, m0);
        let cap = 0;
        let alloc = 0;
        let free = 0;
        let daysZero = 0;
        let daysOver = 0;
        for (const d of days) {
          const info = freeHoursInfoLocal(resourceId, d);
          // Fins de semana sem HE não entram no cálculo mensal de janelas
          if (info.eligible === false) continue;
          cap += info.capacity;
          alloc += info.allocated;
          free += info.free;
          if (info.free <= 0) daysZero += 1;
          if (info.free < 0) daysOver += 1;
        }
        const pct = cap > 0 ? (free / cap) * 100 : 0;
        return {
          y, m0,
          key: monthKeyLocal(y, m0),
          label: fmtMonthLabelLocal(y, m0),
          cap, alloc, free, pct,
          days: days.length,
          daysZero,
          daysOver,
        };
      };

      const months = buildMonthsLocal();
      const resources = (state.resources||[]);

      if (!months.length) {
        toast('Sem meses configurados para exportar.');
        return;
      }
      if (!resources.length) {
        toast('Não há recursos cadastrados para exportar.');
        return;
      }

      // build per resource same logic as heatmap (but export ALL rows, not just current page)
	      const perRes = resources.map(r => {
        const ms = months.map(mm => monthlyWindowLocal(r.id, mm.y, mm.m0));
	        const score = (whLocal.metric === 'pct')
          ? (ms.reduce((a,b)=>a + b.pct, 0) / Math.max(1, ms.length))
          : ms.reduce((a,b)=>a + b.free, 0);
        return { r, ms, score };
      });

	      if (whLocal.dynamicOrder) {
	        const dir = whLocal.sortDir === 'desc' ? -1 : 1;
        perRes.sort((a,b) => (a.score - b.score) * dir);
	      } else if (Array.isArray(whLocal.fixedOrderIds)) {
	        const idx = new Map(whLocal.fixedOrderIds.map((id,i)=>[id,i]));
        perRes.sort((a,b) => (idx.get(a.r.id) ?? 1e9) - (idx.get(b.r.id) ?? 1e9));
      }

	      const allRows = (whLocal.show === 'top') ? perRes.slice(0, Math.max(1, Number(whLocal.topN||10))) : perRes;

      const headers = ['recurso','mes','hh_total','hh_livre','pct_livre','dias_uteis_contados','dias_com_bloqueio','dias_com_feriado','dias_com_HE'];
      const rows = [];

      for (const rr of allRows) {
        for (const m of rr.ms) {
          const stats = monthStatsForExport(rr.r.id, m.y, m.m0);
          rows.push({
            recurso: rr.r.nome,
            mes: m.key,
            hh_total: Number(m.cap||0).toFixed(1),
            hh_livre: Number(m.free||0).toFixed(1),
            pct_livre: Number(Math.max(0,m.pct)||0).toFixed(1),
            dias_uteis_contados: stats.dias_uteis_contados,
            dias_com_bloqueio: stats.dias_com_bloqueio,
            dias_com_feriado: stats.dias_com_feriado,
            dias_com_HE: stats.dias_com_HE,
          });
        }
      }

      downloadText('janelas_por_recurso_mes.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
      toast('CSV de Janelas Livres (Recursos × Meses) exportado.');
    } catch (e) {
      console.error(e);
      toast('Falha ao exportar Janelas Livres. Veja o console (F12) para detalhes.');
    }
  };
  // ----------------------
  // User modal wiring + onboarding
  const wireUserModal = () => {
    const dlg = qs('#userModal');
    const btnOpen = qs('#btnOpenUserModal');
    const closeBtn = qs('#userModalClose');
    const cancelBtn = qs('#userModalCancel');
    const saveBtn = qs('#userModalSave');
    const nameInput = qs('#userModalName');
    const idInput = qs('#userModalId');

        const btnCopy = qs('#btnCopyUserId');
const syncPreview = () => {
      const nm = String(nameInput?.value||'').trim();
      if (!nm) { if (idInput) idInput.value = ''; return; }
      const u = previewUserIdentity(nm);
      if (idInput) idInput.value = u.userId;
    };

    if (nameInput) nameInput.addEventListener('input', syncPreview);

    
    if (btnCopy) btnCopy.addEventListener('click', async () => {
      const val = String(idInput?.value||'').trim();
      if (!val) { toast('Gere o ID digitando seu nome.'); return; }
      try {
        await navigator.clipboard.writeText(val);
        toast('ID copiado.');
      } catch {
        // fallback
        const tmp = document.createElement('textarea');
        tmp.value = val; document.body.appendChild(tmp);
        tmp.select(); document.execCommand('copy');
        tmp.remove();
        toast('ID copiado.');
      }
    });
const tryClose = () => {
      if (dlg?.dataset.force === '1' && !hasUser()) {
        toast('Você precisa definir o usuário para continuar.');
        return;
      }
      closeDialog(dlg);
      document.body.classList.remove('user-modal-open');
      };

    if (btnOpen) btnOpen.addEventListener('click', () => openUserModal(true));
    if (closeBtn) closeBtn.addEventListener('click', tryClose);
    if (cancelBtn) cancelBtn.addEventListener('click', tryClose);
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const nm = String(nameInput?.value||'').trim();
      if (!nm) { toast('Informe seu nome completo.'); return; }
      const u = ensureUserIdentity(nm); // persists to localStorage
      userName = u.displayName; userId = u.userId;
      const hdr = qs('#userName'); if (hdr) hdr.value = userName;
      updateAvatar();
      closeDialog(dlg);
      document.body.classList.remove('user-modal-open');
      toast('Usuário definido com sucesso.');
    });

    if (dlg) dlg.addEventListener('cancel', (e) => {
      if (dlg.dataset.force === '1' && !hasUser()) { e.preventDefault(); }
    });

    if (dlg) dlg.addEventListener('close', () => document.body.classList.remove('user-modal-open'));
  };
  wireUserModal();


  // Mantém múltiplas abas do mesmo navegador alinhadas quando o usuário é definido em outra instância.
  window.addEventListener('storage', (ev) => {
    if (ev.key === USER_KEY) {
      const u = loadUserIdentity();
      userName = u.displayName;
      userId = u.userId;
      updateAvatar();
    }
  });

  // Avatar always opens identity modal
  const avatarClickHandler__capview = () => openUserModal(true);
  qs('#avatar').addEventListener('click', avatarClickHandler__capview);
  qs('#avatar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
    }
  });

qs('#userName').addEventListener('input', (e) => setUser(e.target.value));
  // Initialize user UI (after helpers exist)
  updateAvatar();
  if (!hasUser()) { setTimeout(() => openUserModal(true), 60); }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && eventAutoSyncAvailable()) eventAutoSyncTick('visible');
  });

  render();
})();
