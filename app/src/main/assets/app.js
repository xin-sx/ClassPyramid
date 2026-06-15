(function () {
  "use strict";

  // ============= Storage keys =============
  const LS_CURRENT = "cp_current_v1";
  const LS_SCHEMES = "cp_schemes_v1";

  // ============= DOM refs =============
  const trayItems = document.getElementById("trayItems");
  const addBtn = document.getElementById("addBtn");
  const diamond = document.getElementById("diamond");
  const schemeTitle = document.getElementById("schemeTitle");
  const dirtyDot = document.getElementById("dirtyDot");
  const newBtn = document.getElementById("newBtn");
  const saveBtn = document.getElementById("saveBtn");
  const manageBtn = document.getElementById("manageBtn");
  const modalMask = document.getElementById("modalMask");
  const modalClose = document.getElementById("modalClose");
  const newNameInput = document.getElementById("newNameInput");
  const createSchemeBtn = document.getElementById("createSchemeBtn");
  const schemeListEl = document.getElementById("schemeList");
  const toastEl = document.getElementById("toast");

  // ============= State =============
  let chipCounter = 0;
  let currentSchemeId = null;  // null = unsaved working state
  let currentSchemeName = "未命名方案";
  let isDirty = false;

  // drag state
  let dragChip = null;
  let ghost = null;
  let ghostW = 0, ghostH = 0;
  let dragOriginParent = null;   // parent node before drag started
  let dragOriginNext = null;     // nextSibling before drag started
  let dragOffsetX = 0, dragOffsetY = 0;
  let lastX = 0, lastY = 0;
  let rafId = 0;
  let lastHoverEl = null;
  let pressTimer = 0;            // long-press timer for showing delete X
  let longPressed = false;

  // ============= Persistence =============
  function loadSchemes() {
    try {
      const raw = localStorage.getItem(LS_SCHEMES);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : {};
    } catch (_) { return {}; }
  }
  function saveSchemes(obj) {
    try { localStorage.setItem(LS_SCHEMES, JSON.stringify(obj)); } catch (_) {}
  }
  function loadCurrent() {
    try {
      const raw = localStorage.getItem(LS_CURRENT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveCurrent() {
    const data = serializeState();
    try { localStorage.setItem(LS_CURRENT, JSON.stringify(data)); } catch (_) {}
  }
  function genId() {
    return "sc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
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
    return {
      id: currentSchemeId,
      name: currentSchemeName,
      corners: corners,
      chips: chips,
      ts: Date.now()
    };
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
    if (data.corners) {
      Object.keys(data.corners).forEach(function (k) { setCornerText(k, data.corners[k]); });
    }
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
          if (target) {
            chip.classList.add("placed");
            target.appendChild(chip);
            return;
          }
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

    // delete X
    const x = document.createElement("span");
    x.className = "chip-x";
    x.textContent = "×";
    x.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    x.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      if (chip.parentNode) chip.parentNode.removeChild(chip);
      markDirty();
      saveCurrent();
    });
    chip.appendChild(x);

    // editing text -> mark dirty
    txt.addEventListener("input", function () { markDirty(); saveCurrent(); });
    txt.addEventListener("focus", function () { clearLongPress(); });

    attachDragHandlers(chip);
    return chip;
  }

  function addChip() {
    const chip = makeChip();
    trayItems.appendChild(chip);
    markDirty();
    saveCurrent();
  }
  addBtn.addEventListener("click", addChip);

  // ============= Drag handlers (mouse + touch unified) =============
  function clearLongPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
    if (longPressed) {
      longPressed = false;
      document.querySelectorAll(".chip.show-x").forEach(function (n) { n.classList.remove("show-x"); });
    }
  }

  function isTextEditableTarget(t) {
    return t && t.classList && t.classList.contains("chip-text");
  }
  function isDeleteBtnTarget(t) {
    return t && t.classList && t.classList.contains("chip-x");
  }

  function startDrag(chip, clientX, clientY) {
    dragChip = chip;
    chip.classList.add("dragging");
    dragOriginParent = chip.parentNode;
    dragOriginNext = chip.nextSibling;

    // build ghost (transform-based, GPU)
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = chipText(chip);
    document.body.appendChild(ghost);
    const gRect = ghost.getBoundingClientRect();
    ghostW = gRect.width || 60;
    ghostH = gRect.height || 32;

    // position ghost at pointer
    updateGhost(clientX, clientY);
  }

  function updateGhost(clientX, clientY) {
    if (!ghost) return;
    const x = clientX - dragOffsetX + ghostW / 2;
    const y = clientY - dragOffsetY + ghostH / 2;
    ghost.style.transform = "translate3d(" + x.toFixed(0) + "px, " + y.toFixed(0) + "px, 0) scale(1.05)";
  }

  function updateHover(clientX, clientY) {
    if (dragChip) {
      const el = document.elementFromPoint(clientX, clientY);
      if (el !== lastHoverEl) {
        if (lastHoverEl) {
          const lLvl = lastHoverEl.closest && lastHoverEl.closest(".level");
          if (lLvl) lLvl.classList.remove("drag-over");
          const lTray = lastHoverEl.closest && lastHoverEl.closest("#tray");
          if (lTray) lTray.classList.remove("drag-over");
        }
        lastHoverEl = el;
        if (el) {
          const lvl = el.closest && el.closest(".level");
          if (lvl) lvl.classList.add("drag-over");
          const tray = el.closest && el.closest("#tray");
          if (tray) tray.classList.add("drag-over");
        }
      }
    }
  }

  function scheduleMove() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      updateGhost(lastX, lastY);
      updateHover(lastX, lastY);
    });
  }

  function endDrag(clientX, clientY) {
    if (!dragChip) return;
    const el = document.elementFromPoint(clientX, clientY);
    let target = null;
    if (el) {
      const lvl = el.closest && el.closest(".level");
      if (lvl) target = lvl;
      else {
        const tray = el.closest && el.closest("#tray");
        if (tray) target = trayItems;
      }
    }
    if (target && target.classList && target.classList.contains("level")) {
      dragChip.classList.add("placed");
      target.appendChild(dragChip);
    } else if (target === trayItems) {
      dragChip.classList.remove("placed");
      trayItems.appendChild(dragChip);
    } else {
      // revert
      if (dragOriginParent) {
        if (dragOriginParent.classList && dragOriginParent.classList.contains("level")) {
          dragChip.classList.add("placed");
        } else {
          dragChip.classList.remove("placed");
        }
        if (dragOriginNext && dragOriginNext.parentNode === dragOriginParent) {
          dragOriginParent.insertBefore(dragChip, dragOriginNext);
        } else {
          dragOriginParent.appendChild(dragChip);
        }
      } else {
        trayItems.appendChild(dragChip);
      }
    }
    cleanup();
    markDirty();
    saveCurrent();
  }

  function cleanup() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    if (dragChip) dragChip.classList.remove("dragging");
    document.querySelectorAll(".level.drag-over, #tray.drag-over").forEach(function (n) {
      n.classList.remove("drag-over");
    });
    dragChip = null;
    dragOriginParent = null;
    dragOriginNext = null;
    lastHoverEl = null;
  }

  function chipText(chip) {
    const t = chip.querySelector(".chip-text");
    return (t && t.textContent.trim()) || "文本";
  }

  function attachDragHandlers(chip) {
    // shared start: record offset, set up listeners
    function onDown(clientX, clientY, target, kind) {
      if (isDeleteBtnTarget(target)) return;
      if (isTextEditableTarget(target)) {
        // not dragging, but still enable long-press for delete X
        clearLongPress();
        pressTimer = setTimeout(function () {
          longPressed = true;
          document.querySelectorAll(".chip.show-x").forEach(function (n) {
            if (n !== chip) n.classList.remove("show-x");
          });
          chip.classList.add("show-x");
        }, 500);
        return;
      }
      const startX = clientX, startY = clientY;
      const rect = chip.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
      let moved = false;

      function onMove(ev, cX, cY) {
        lastX = cX; lastY = cY;
        if (!moved) {
          if (Math.abs(cX - startX) < 4 && Math.abs(cY - startY) < 4) return;
          moved = true;
          clearLongPress();
          startDrag(chip, cX, cY);
          scheduleMove();
        } else {
          scheduleMove();
        }
      }
      function onEnd(ev, cX, cY) {
        detach();
        if (moved) {
          endDrag(cX, cY);
        } else {
          // tap without move -> long-press toggle
          clearLongPress();
          pressTimer = setTimeout(function () {
            longPressed = true;
            document.querySelectorAll(".chip.show-x").forEach(function (n) {
              if (n !== chip) n.classList.remove("show-x");
            });
            chip.classList.add("show-x");
          }, 500);
        }
      }

      function onMouseMove(ev) { onMove(ev, ev.clientX, ev.clientY); }
      function onMouseUp(ev) { onEnd(ev, ev.clientX, ev.clientY); }
      function onTouchMove(ev) {
        const t = ev.touches[0]; if (!t) return;
        onMove(ev, t.clientX, t.clientY);
        if (ev.cancelable) ev.preventDefault();
      }
      function onTouchEnd(ev) {
        const t = (ev.changedTouches && ev.changedTouches[0]) || { clientX: startX, clientY: startY };
        onEnd(ev, t.clientX, t.clientY);
      }

      function detach() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("touchmove", onTouchMove, false);
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", onTouchEnd);
      }

      if (kind === "mouse") {
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      } else {
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchcancel", onTouchEnd);
      }
    }

    chip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      onDown(e.clientX, e.clientY, e.target, "mouse");
    });
    chip.addEventListener("touchstart", function (e) {
      const t = e.touches[0]; if (!t) return;
      onDown(t.clientX, t.clientY, e.target, "touch");
    }, { passive: true });
  }

  // Dismiss long-press delete-X when tapping elsewhere
  document.addEventListener("mousedown", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("chip")) return;
    if (e.target && e.target.classList && e.target.classList.contains("chip-x")) return;
    clearLongPress();
  }, true);
  document.addEventListener("touchstart", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("chip")) return;
    if (e.target && e.target.classList && e.target.classList.contains("chip-x")) return;
    clearLongPress();
  }, { passive: true, capture: true });

  // ============= Toolbar / Schemes =============
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (showToast._t) clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  newBtn.addEventListener("click", function () {
    if (isDirty) {
      if (!confirm("当前方案有未保存修改，是否放弃并新建？")) return;
    }
    applyState({ id: null, name: "未命名方案", corners: { topLeft: "", topRight: "", bottomLeft: "", bottomRight: "" }, chips: [] });
    saveCurrent();
  });

  saveBtn.addEventListener("click", function () {
    const data = serializeState();
    if (currentSchemeId) {
      // overwrite
      const all = loadSchemes();
      all[currentSchemeId] = { id: currentSchemeId, name: currentSchemeName, corners: data.corners, chips: data.chips, ts: Date.now() };
      saveSchemes(all);
      markClean();
      showToast("已保存");
    } else {
      const name = prompt("保存为新方案，请输入名称：", currentSchemeName === "未命名方案" ? "" : currentSchemeName);
      if (name === null) return;
      const trimmed = (name || "").trim() || ("方案 " + new Date().toLocaleString());
      const id = genId();
      const all = loadSchemes();
      all[id] = { id: id, name: trimmed, corners: data.corners, chips: data.chips, ts: Date.now() };
      saveSchemes(all);
      currentSchemeId = id;
      currentSchemeName = trimmed;
      markClean();
      updateTitle();
      showToast("已保存为「" + trimmed + "」");
    }
  });

  function showModal() {
    modalMask.classList.add("open");
  }
  function hideModal() {
    modalMask.classList.remove("open");
  }
  manageBtn.addEventListener("click", function () {
    renderSchemeList();
    showModal();
    newNameInput.value = "";
    newNameInput.focus();
  });
  modalClose.addEventListener("click", hideModal);
  modalMask.addEventListener("click", function (e) {
    if (e.target === modalMask) hideModal();
  });
  // ESC key closes modal
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modalMask.classList.contains("open")) hideModal();
  });

  function doCreate() {
    const name = (newNameInput.value || "").trim();
    if (!name) { newNameInput.focus(); return; }
    const all = loadSchemes();
    if (Object.keys(all).some(function (k) { return all[k].name === name; })) {
      showToast("名称已存在");
      return;
    }
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
    showToast("已保存为「" + name + "」");
  }
  createSchemeBtn.addEventListener("click", doCreate);
  newNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); doCreate(); }
  });

  function renderSchemeList() {
    const all = loadSchemes();
    const items = Object.values(all).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (items.length === 0) {
      schemeListEl.innerHTML = '<div class="scheme-empty">暂无方案，输入名称后点击「创建」</div>';
      return;
    }
    schemeListEl.innerHTML = "";
    items.forEach(function (sc) {
      const row = document.createElement("div");
      row.className = "scheme-item" + (sc.id === currentSchemeId ? " current" : "");
      const info = document.createElement("div");
      info.className = "scheme-info";
      const nm = document.createElement("div");
      nm.className = "scheme-name";
      nm.textContent = sc.name;
      const meta = document.createElement("div");
      meta.className = "scheme-meta";
      const dt = new Date(sc.ts || 0);
      const lvlCount = (sc.chips || []).filter(function (c) { return c.loc && c.loc.indexOf("level:") === 0; }).length;
      meta.textContent = dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0") + " " +
                        String(dt.getHours()).padStart(2,"0") + ":" + String(dt.getMinutes()).padStart(2,"0") +
                        " · " + (sc.chips ? sc.chips.length : 0) + " 块 · " + lvlCount + " 已归类";
      info.appendChild(nm); info.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "scheme-actions";
      const loadB = document.createElement("button");
      loadB.className = "tb-btn small primary";
      loadB.textContent = "加载";
      loadB.addEventListener("click", function () {
        applyState(sc);
        saveCurrent();
        hideModal();
        showToast("已加载「" + sc.name + "」");
      });
      const renB = document.createElement("button");
      renB.className = "tb-btn small";
      renB.textContent = "重命名";
      renB.addEventListener("click", function () {
        const newName = prompt("新名称：", sc.name);
        if (newName === null) return;
        const trimmed = (newName || "").trim();
        if (!trimmed) return;
        const all2 = loadSchemes();
        if (Object.keys(all2).some(function (k) { return k !== sc.id && all2[k].name === trimmed; })) {
          showToast("名称已存在"); return;
        }
        all2[sc.id].name = trimmed;
        all2[sc.id].ts = Date.now();
        saveSchemes(all2);
        if (sc.id === currentSchemeId) { currentSchemeName = trimmed; updateTitle(); }
        renderSchemeList();
        showToast("已重命名");
      });
      const delB = document.createElement("button");
      delB.className = "tb-btn small danger";
      delB.textContent = "删除";
      delB.addEventListener("click", function () {
        if (!confirm("确定删除方案「" + sc.name + "」？")) return;
        const all3 = loadSchemes();
        delete all3[sc.id];
        saveSchemes(all3);
        if (sc.id === currentSchemeId) {
          currentSchemeId = null;
          currentSchemeName = "未命名方案";
          updateTitle();
        }
        renderSchemeList();
        showToast("已删除");
      });
      actions.appendChild(loadB); actions.appendChild(renB); actions.appendChild(delB);
      row.appendChild(info); row.appendChild(actions);
      schemeListEl.appendChild(row);
    });
  }

  // corner text changes -> mark dirty and save
  document.querySelectorAll(".corner-box").forEach(function (n) {
    n.addEventListener("input", function () { markDirty(); saveCurrent(); });
  });

  // Save before page unload
  window.addEventListener("pagehide", saveCurrent);
  window.addEventListener("beforeunload", saveCurrent);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveCurrent();
  });

  // ============= Init =============
  function init() {
    // Ensure modal is hidden on startup (defensive)
    hideModal();

    const cur = loadCurrent();
    if (cur && cur.chips) {
      applyState(cur);
    } else {
      // first run: 3 default chips
      for (let i = 0; i < 3; i++) trayItems.appendChild(makeChip());
      markClean();
      updateTitle();
      saveCurrent();
    }
  }
  init();
})();
