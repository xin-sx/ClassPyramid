(function () {
  "use strict";

  // ============= Storage keys =============
  const LS_CURRENT = "cp_current_v1";
  const LS_SCHEMES = "cp_schemes_v1";

  // ============= DOM refs =============
  const trayItems = document.getElementById("trayItems");
  const addBtn = document.getElementById("addBtn");
  const schemeTitle = document.getElementById("schemeTitle");
  const dirtyDot = document.getElementById("dirtyDot");
  const storageInfoEl = document.getElementById("storageInfo");
  const resetBtn = document.getElementById("resetBtn");
  const saveBtn = document.getElementById("saveBtn");
  const manageBtn = document.getElementById("manageBtn");
  const modalMask = document.getElementById("modalMask");
  const modalClose = document.getElementById("modalClose");
  const newNameInput = document.getElementById("newNameInput");
  const createSchemeBtn = document.getElementById("createSchemeBtn");
  const schemeListEl = document.getElementById("schemeList");
  const toastEl = document.getElementById("toast");
  const importFileInput = document.getElementById("importFileInput");

  // ============= State =============
  let chipCounter = 0;
  let currentSchemeId = null;
  let currentSchemeName = "未命名方案";
  let isDirty = false;

  // drag state
  let dragChip = null;
  let ghost = null;
  let ghostW = 0, ghostH = 0;
  let dragOriginParent = null;
  let dragOriginNext = null;
  let dragOffsetX = 0, dragOffsetY = 0;
  let lastX = 0, lastY = 0;
  let rafId = 0;
  let lastHoverEl = null;
  let pressTimer = 0;
  let longPressed = false;
  let lastClickTime = 0;
  let lastClickChip = null;

  // ============= Persistence (multi-layer fallback) =============
  function lsAvailable() {
    try { localStorage.setItem("__t__", "1"); localStorage.removeItem("__t__"); return true; } catch (_) { return false; }
  }
  function ssAvailable() {
    try { sessionStorage.setItem("__t__", "1"); sessionStorage.removeItem("__t__"); return true; } catch (_) { return false; }
  }
  const hasLS = lsAvailable();
  const hasSS = ssAvailable();
  let memCurrent = null;
  let memSchemes = {};

  function readAll(key) {
    try {
      if (hasLS) { const v = localStorage.getItem(key); if (v) return JSON.parse(v); }
      if (hasSS) { const v = sessionStorage.getItem(key + "_bk"); if (v) return JSON.parse(v); }
    } catch (_) {}
    if (key === LS_SCHEMES) return memSchemes;
    if (key === LS_CURRENT) return memCurrent;
    return null;
  }
  function writeAll(key, val) {
    let ok = false;
    try { if (hasLS) { localStorage.setItem(key, JSON.stringify(val)); ok = true; } } catch (_) {}
    try { if (hasSS) sessionStorage.setItem(key + "_bk", JSON.stringify(val)); } catch (_) {}
    try { if (key === LS_SCHEMES) memSchemes = val; if (key === LS_CURRENT) memCurrent = val; } catch (_) {}
    return ok;
  }
  function loadSchemes() { const d = readAll(LS_SCHEMES); return (d && typeof d === "object") ? d : {}; }
  function saveSchemes(obj) { return writeAll(LS_SCHEMES, obj); }
  function loadCurrent() { return readAll(LS_CURRENT); }
  function saveCurrent() { return writeAll(LS_CURRENT, serializeState()); }
  function genId() { return "sc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }

  function updateStorageInfo() {
    if (!storageInfoEl) return;
    const schemes = Object.keys(loadSchemes()).length;
    if (hasLS) storageInfoEl.textContent = "✓本地·" + schemes + "个方案";
    else if (hasSS) storageInfoEl.textContent = "⚠会话·" + schemes + "个方案";
    else storageInfoEl.textContent = "⚠内存·" + schemes + "个方案";
  }

  // ============= State <-> DOM =============
  function serializeState() {
    const corners = {};
    document.querySelectorAll(".corner-box").forEach(function (n) {
      corners[n.dataset.key] = n.textContent || "";
    });
    const chips = [];
    document.querySelectorAll(".chip").forEach(function (c) {
      const parent = c.parentNode;
      let loc = "tray";
      if (parent && parent.classList && parent.classList.contains("level")) {
        loc = "level:" + (parent.dataset.level || "");
      }
      const t = c.querySelector(".chip-text");
      chips.push({ id: c.dataset.id, text: t ? t.textContent : "", loc: loc });
    });
    return { id: currentSchemeId, name: currentSchemeName, corners: corners, chips: chips, ts: Date.now() };
  }

  function clearChips() {
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
  }

  function setCornerText(key, text) {
    const el = document.querySelector('.corner-box[data-key="' + key + '"]');
    if (el) el.textContent = text || "";
  }

  function applyState(data) {
    if (!data) return;
    currentSchemeId = data.id || null;
    currentSchemeName = data.name || "未命名方案";
    if (data.corners) Object.keys(data.corners).forEach(function (k) { setCornerText(k, data.corners[k]); });
    clearChips();
    chipCounter = 0;
    if (Array.isArray(data.chips)) {
      data.chips.forEach(function (c) {
        const chip = makeChip();
        const t = chip.querySelector(".chip-text");
        if (t) t.textContent = c.text || "";
        const idNum = parseInt(String(c.id || "").replace(/[^0-9]/g, ""), 10);
        if (!isNaN(idNum) && idNum > chipCounter) chipCounter = idNum;
        if (c.loc && c.loc.indexOf("level:") === 0) {
          const lvl = c.loc.split(":")[1];
          const target = document.querySelector('.level[data-level="' + lvl + '"]');
          if (target) { chip.classList.add("placed"); target.appendChild(chip); return; }
        }
        trayItems.appendChild(chip);
      });
    }
    markClean();
    updateTitle();
  }

  function updateTitle() {
    schemeTitle.textContent = currentSchemeName || "未命名方案";
    dirtyDot.style.display = isDirty ? "" : "none";
  }
  function markDirty() { if (!isDirty) { isDirty = true; updateTitle(); } }
  function markClean() { isDirty = false; updateTitle(); }

  // ============= Chip creation =============
  function makeChip() {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.setAttribute("draggable", "false");
    chip.dataset.id = "chip-" + (++chipCounter);
    const txt = document.createElement("span");
    txt.className = "chip-text";
    txt.setAttribute("contenteditable", "true");
    txt.setAttribute("data-placeholder", "文本");
    chip.appendChild(txt);
    const x = document.createElement("span");
    x.className = "chip-x";
    x.textContent = "×";
    x.addEventListener("click", function (e) {
      e.stopPropagation(); e.preventDefault();
      if (chip.parentNode) chip.parentNode.removeChild(chip);
      markDirty(); saveCurrent();
    });
    chip.appendChild(x);
    txt.addEventListener("input", function () { markDirty(); saveCurrent(); });
    attachDragHandlers(chip);
    return chip;
  }

  function addChip() {
    const chip = makeChip();
    trayItems.appendChild(chip);
    markDirty(); saveCurrent();
    const t = chip.querySelector(".chip-text");
    if (t) { chip.classList.add("editing"); t.focus(); }
  }
  addBtn.addEventListener("click", addChip);

  // ============= Drag =============
  function clearLongPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
    if (longPressed) { longPressed = false; document.querySelectorAll(".chip.show-x").forEach(function (n) { n.classList.remove("show-x"); }); }
  }
  function isTextTarget(t) { return t && t.classList && t.classList.contains("chip-text"); }
  function isDeleteBtnTarget(t) { return t && t.classList && t.classList.contains("chip-x"); }
  function chipText(chip) { const t = chip.querySelector(".chip-text"); return (t && t.textContent.trim()) || "文本"; }

  function startDrag(chip, clientX, clientY) {
    clearLongPress();
    dragChip = chip;
    chip.classList.add("dragging");
    chip.classList.remove("show-x");
    dragOriginParent = chip.parentNode;
    dragOriginNext = chip.nextSibling;
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = chipText(chip);
    document.body.appendChild(ghost);
    const gRect = ghost.getBoundingClientRect();
    ghostW = gRect.width || 60; ghostH = gRect.height || 32;
    const chipRect = chip.getBoundingClientRect();
    dragOffsetX = clientX - chipRect.left;
    dragOffsetY = clientY - chipRect.top;
    updateGhost(clientX, clientY);
  }
  function updateGhost(clientX, clientY) {
    if (!ghost) return;
    const x = clientX - dragOffsetX + ghostW / 2;
    const y = clientY - dragOffsetY + ghostH / 2;
    ghost.style.transform = "translate3d(" + x.toFixed(0) + "px, " + y.toFixed(0) + "px, 0) scale(1.05)";
  }
  function updateHover(clientX, clientY) {
    if (!dragChip) return;
    const el = document.elementFromPoint(clientX, clientY);
    if (el !== lastHoverEl) {
      if (lastHoverEl) {
        const lLvl = lastHoverEl.closest && lastHoverEl.closest(".level");
        if (lLvl) lLvl.classList.remove("drag-over");
        const lTray = lastHoverEl.closest && lastHoverEl.closest(".tray");
        if (lTray) lTray.classList.remove("drag-over");
      }
      lastHoverEl = el;
      if (el) {
        const lvl = el.closest && el.closest(".level");
        if (lvl) lvl.classList.add("drag-over");
        const tray = el.closest && el.closest(".tray");
        if (tray) tray.classList.add("drag-over");
      }
    }
  }
  function scheduleMove() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; updateGhost(lastX, lastY); updateHover(lastX, lastY); });
  }
  function endDrag(clientX, clientY) {
    if (!dragChip) return;
    const el = document.elementFromPoint(clientX, clientY);
    let target = null;
    if (el) {
      const lvl = el.closest && el.closest(".level");
      if (lvl) target = lvl;
      else { const tray = el.closest && el.closest(".tray"); if (tray) target = trayItems; }
    }
    if (target && target.classList && target.classList.contains("level")) {
      dragChip.classList.add("placed"); target.appendChild(dragChip);
    } else if (target === trayItems) {
      dragChip.classList.remove("placed"); trayItems.appendChild(dragChip);
    } else {
      if (dragOriginParent) {
        if (dragOriginParent.classList && dragOriginParent.classList.contains("level")) dragChip.classList.add("placed");
        else dragChip.classList.remove("placed");
        if (dragOriginNext && dragOriginNext.parentNode === dragOriginParent) dragOriginParent.insertBefore(dragChip, dragOriginNext);
        else dragOriginParent.appendChild(dragChip);
      } else { trayItems.appendChild(dragChip); }
    }
    cleanup();
    markDirty(); saveCurrent();
  }
  function cleanup() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    if (dragChip) dragChip.classList.remove("dragging");
    document.querySelectorAll(".level.drag-over, .tray.drag-over").forEach(function (n) { n.classList.remove("drag-over"); });
    dragChip = null; dragOriginParent = null; dragOriginNext = null; lastHoverEl = null;
  }
  function handleDblClick(chip, txt) {
    chip.classList.add("editing"); txt.focus();
    const range = document.createRange(); range.selectNodeContents(txt);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function attachDragHandlers(chip) {
    const txt = chip.querySelector(".chip-text");
    chip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (isDeleteBtnTarget(e.target)) return;
      const now = Date.now();
      if (lastClickChip === chip && now - lastClickTime < 350) {
        e.preventDefault(); e.stopPropagation();
        lastClickTime = 0; lastClickChip = null;
        clearLongPress(); handleDblClick(chip, txt); return;
      }
      lastClickTime = now; lastClickChip = chip;
      if (isTextTarget(e.target)) return;
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      function onMove(ev) {
        lastX = ev.clientX; lastY = ev.clientY;
        if (!moved) {
          if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
          moved = true; startDrag(chip, ev.clientX, ev.clientY); scheduleMove();
        } else scheduleMove();
      }
      function onUp(ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!moved) {
          clearLongPress();
          pressTimer = setTimeout(function () { longPressed = true; chip.classList.add("show-x"); }, 500);
        } else endDrag(ev.clientX, ev.clientY);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    chip.addEventListener("touchstart", function (e) {
      if (isDeleteBtnTarget(e.target)) return;
      const t = e.touches[0]; if (!t) return;
      const startX = t.clientX, startY = t.clientY;
      const now = Date.now();
      if (lastClickChip === chip && now - lastClickTime < 350) {
        e.preventDefault(); e.stopPropagation();
        lastClickTime = 0; lastClickChip = null;
        clearLongPress(); handleDblClick(chip, txt); return;
      }
      lastClickTime = now; lastClickChip = chip;
      if (isTextTarget(e.target)) return;
      let moved = false; let tapTimer = 0;
      function onMove(ev) {
        const tt = ev.touches[0]; if (!tt) return;
        lastX = tt.clientX; lastY = tt.clientY;
        if (!moved) {
          if (Math.abs(tt.clientX - startX) < 4 && Math.abs(tt.clientY - startY) < 4) return;
          moved = true; clearTimeout(tapTimer);
          startDrag(chip, tt.clientX, tt.clientY); scheduleMove();
        } else scheduleMove();
        if (ev.cancelable) ev.preventDefault();
      }
      function onEnd(ev) {
        document.removeEventListener("touchmove", onMove, false);
        document.removeEventListener("touchend", onEnd);
        document.removeEventListener("touchcancel", onEnd);
        clearTimeout(tapTimer);
        if (!moved) {
          tapTimer = setTimeout(function () { longPressed = true; chip.classList.add("show-x"); }, 500);
        } else {
          const tt = (ev.changedTouches && ev.changedTouches[0]) || { clientX: startX, clientY: startY };
          endDrag(tt.clientX, tt.clientY);
        }
      }
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    }, { passive: true });
    txt.addEventListener("blur", function () { chip.classList.remove("editing"); });
  }
  document.addEventListener("mousedown", function (e) {
    if (e.target && e.target.classList) {
      if (e.target.classList.contains("chip") || e.target.classList.contains("chip-x")) return;
    }
    clearLongPress();
  }, true);
  document.addEventListener("touchstart", function (e) {
    if (e.target && e.target.classList) {
      if (e.target.classList.contains("chip") || e.target.classList.contains("chip-x")) return;
    }
    clearLongPress();
  }, { passive: true, capture: true });

  // ============= Modal / Toolbar =============
  function showModal() { modalMask.classList.add("open"); }
  function hideModal() { modalMask.classList.remove("open"); }
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (showToast._t) clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  // ============ RESET: clear current canvas ============
  resetBtn.addEventListener("click", function () {
    if (isDirty) {
      if (!confirm("当前方案有未保存修改，是否放弃并重设？")) return;
    }
    currentSchemeId = null;
    currentSchemeName = "未命名方案";
    clearChips();
    document.querySelectorAll(".corner-box").forEach(function (n) { n.textContent = ""; });
    for (let i = 0; i < 3; i++) trayItems.appendChild(makeChip());
    markClean();
    updateTitle();
    saveCurrent();
    showToast("已重设");
  });

  // ============ SAVE: save current state as a named scheme ============
  saveBtn.addEventListener("click", function () {
    const data = serializeState();
    const all = loadSchemes();
    if (currentSchemeId && all[currentSchemeId]) {
      all[currentSchemeId] = { id: currentSchemeId, name: currentSchemeName, corners: data.corners, chips: data.chips, ts: Date.now() };
      saveSchemes(all);
      markClean();
      showToast("已保存「" + currentSchemeName + "」");
    } else {
      const name = prompt("保存为新方案，请输入名称：", currentSchemeName === "未命名方案" ? "" : currentSchemeName);
      if (name === null) return;
      const trimmed = (name || "").trim() || ("方案 " + new Date().toLocaleString());
      const id = genId();
      all[id] = { id: id, name: trimmed, corners: data.corners, chips: data.chips, ts: Date.now() };
      saveSchemes(all);
      currentSchemeId = id;
      currentSchemeName = trimmed;
      markClean();
      updateTitle();
      updateStorageInfo();
      showToast("已保存为「" + trimmed + "」");
    }
  });

  // ============ MANAGE: open scheme panel ============
  manageBtn.addEventListener("click", function () {
    renderSchemeList();
    updateStorageInfo();
    showModal();
    newNameInput.value = "";
    newNameInput.focus();
  });
  modalClose.addEventListener("click", hideModal);
  modalMask.addEventListener("click", function (e) { if (e.target === modalMask) hideModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modalMask.classList.contains("open")) hideModal(); });

  function doCreate() {
    const name = (newNameInput.value || "").trim();
    if (!name) { newNameInput.focus(); return; }
    const all = loadSchemes();
    if (Object.keys(all).some(function (k) { return all[k].name === name; })) { showToast("名称已存在"); return; }
    const id = genId();
    const data = serializeState();
    all[id] = { id: id, name: name, corners: data.corners, chips: data.chips, ts: Date.now() };
    saveSchemes(all);
    currentSchemeId = id;
    currentSchemeName = name;
    markClean();
    updateTitle();
    newNameInput.value = "";
    renderSchemeList();
    updateStorageInfo();
    showToast("已保存为「" + name + "」");
  }
  createSchemeBtn.addEventListener("click", doCreate);
  newNameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doCreate(); } });

  // ============ EXPORT / IMPORT / CLEAR ============
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");
  if (exportBtn) exportBtn.addEventListener("click", function () {
    const all = loadSchemes();
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), schemes: all }, null, 2);
    try {
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "classpyramid-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast("已导出 " + Object.keys(all).length + " 个方案");
    } catch (e) {
      window.open("data:application/json;charset=utf-8," + encodeURIComponent(json), "_blank");
      showToast("已在新窗口打开 JSON");
    }
  });
  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", function () { importFileInput.click(); });
    importFileInput.addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const payload = JSON.parse(ev.target.result);
          const schemes = payload && payload.schemes;
          if (!schemes || typeof schemes !== "object") { showToast("无效的 JSON"); return; }
          const all = loadSchemes();
          let added = 0, skipped = 0;
          Object.keys(schemes).forEach(function (k) {
            const s = schemes[k];
            if (!s || !s.name) { skipped++; return; }
            let n = s.name, i = 1;
            while (Object.keys(all).some(function (kk) { return all[kk].name === n; })) n = s.name + " (" + (i++) + ")";
            const newId = genId();
            all[newId] = { id: newId, name: n, corners: s.corners || {}, chips: Array.isArray(s.chips) ? s.chips : [], ts: Date.now() };
            added++;
          });
          saveSchemes(all);
          renderSchemeList();
          updateStorageInfo();
          showToast("导入 +" + added + (skipped ? " / 跳过 " + skipped : ""));
        } catch (err) { showToast("JSON 解析失败"); }
        importFileInput.value = "";
      };
      reader.readAsText(file, "utf-8");
    });
  }
  if (clearAllBtn) clearAllBtn.addEventListener("click", function () {
    if (!confirm("确定清空所有方案？此操作不可恢复（建议先导出）。")) return;
    if (!confirm("再次确认：清空后无法找回？")) return;
    try { if (hasLS) { localStorage.removeItem(LS_SCHEMES); localStorage.removeItem(LS_CURRENT); } } catch (_) {}
    memSchemes = {}; memCurrent = null;
    currentSchemeId = null; currentSchemeName = "未命名方案";
    clearChips();
    for (let i = 0; i < 3; i++) trayItems.appendChild(makeChip());
    document.querySelectorAll(".corner-box").forEach(function (n) { n.textContent = ""; });
    markClean(); updateTitle();
    renderSchemeList(); updateStorageInfo();
    showToast("已清空");
  });

  function renderSchemeList() {
    const all = loadSchemes();
    const items = Object.values(all).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (items.length === 0) { schemeListEl.innerHTML = '<div class="scheme-empty">暂无方案</div>'; return; }
    schemeListEl.innerHTML = "";
    items.forEach(function (sc) {
      const row = document.createElement("div");
      row.className = "scheme-item" + (sc.id === currentSchemeId ? " current" : "");
      const info = document.createElement("div");
      info.className = "scheme-info";
      const nm = document.createElement("div");
      nm.className = "scheme-name"; nm.textContent = sc.name;
      const meta = document.createElement("div");
      meta.className = "scheme-meta";
      const dt = new Date(sc.ts || 0);
      const lvlCount = (sc.chips || []).filter(function (c) { return c.loc && c.loc.indexOf("level:") === 0; }).length;
      meta.textContent = dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()) + " " +
                        pad(dt.getHours()) + ":" + pad(dt.getMinutes()) + " · " +
                        (sc.chips ? sc.chips.length : 0) + "块·" + lvlCount + "已归类";
      info.appendChild(nm); info.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "scheme-actions";
      const loadB = mkBtn("加载", "primary small", function () {
        applyState(sc); saveCurrent(); hideModal();
        showToast("已加载「" + sc.name + "」");
      });
      const renB = mkBtn("重命名", "small", function () {
        const newName = prompt("新名称：", sc.name);
        if (newName === null) return;
        const trimmed = (newName || "").trim();
        if (!trimmed) return;
        const all2 = loadSchemes();
        if (Object.keys(all2).some(function (k) { return k !== sc.id && all2[k].name === trimmed; })) { showToast("名称已存在"); return; }
        all2[sc.id].name = trimmed; all2[sc.id].ts = Date.now();
        saveSchemes(all2);
        if (sc.id === currentSchemeId) { currentSchemeName = trimmed; updateTitle(); }
        renderSchemeList(); showToast("已重命名");
      });
      const delB = mkBtn("删除", "small danger", function () {
        if (!confirm("删除方案「" + sc.name + "」？")) return;
        const all3 = loadSchemes();
        delete all3[sc.id];
        saveSchemes(all3);
        if (sc.id === currentSchemeId) { currentSchemeId = null; currentSchemeName = "未命名方案"; updateTitle(); }
        renderSchemeList(); updateStorageInfo();
        showToast("已删除");
      });
      actions.appendChild(loadB); actions.appendChild(renB); actions.appendChild(delB);
      row.appendChild(info); row.appendChild(actions);
      schemeListEl.appendChild(row);
    });
  }
  function mkBtn(text, cls, fn) {
    const b = document.createElement("button");
    b.className = "tb-btn " + cls; b.textContent = text; b.addEventListener("click", fn);
    return b;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  document.querySelectorAll(".corner-box").forEach(function (n) {
    n.addEventListener("input", function () { markDirty(); saveCurrent(); });
  });

  // 5s auto-save (defensive)
  setInterval(function () { if (isDirty) { saveCurrent(); updateStorageInfo(); } }, 5000);
  window.addEventListener("pagehide", saveCurrent);
  window.addEventListener("beforeunload", saveCurrent);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") saveCurrent(); });

  // ============ Init ============
  function init() {
    hideModal();
    updateStorageInfo();
    const cur = loadCurrent();
    if (cur && cur.chips) applyState(cur);
    else { for (let i = 0; i < 3; i++) trayItems.appendChild(makeChip()); markClean(); updateTitle(); saveCurrent(); }
  }
  init();
})();
