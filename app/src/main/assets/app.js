(function () {
  "use strict";

  // ============= Storage keys =============
  const LS_CURRENT = "cp_current_v1";
  const LS_SCHEMES = "cp_schemes_v1";
  const SS_CURRENT = "cp_current_bk_v1";
  const SS_SCHEMES = "cp_schemes_bk_v1";

  // ============= DOM refs =============
  const trayItems = document.getElementById("trayItems");
  const addBtn = document.getElementById("addBtn");
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
  const storageInfoEl = document.getElementById("storageInfo");
  const importFileInput = document.getElementById("importFileInput");

  // ============= State =============
  let chipCounter = 0;
  let currentSchemeId = null;
  let currentSchemeName = "未命名方案";
  let isDirty = false;
  let storageOK = true;
  let saveErrorCount = 0;

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

  // double-click debounce
  let lastClickTime = 0;
  let lastClickChip = null;

  // ============= Persistence with multi-layer fallback =============
  function lsAvailable() {
    try {
      const k = "__cp_test__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (_) { return false; }
  }
  function ssAvailable() {
    try {
      const k = "__cp_test__";
      sessionStorage.setItem(k, "1");
      sessionStorage.removeItem(k);
      return true;
    } catch (_) { return false; }
  }
  const hasLS = lsAvailable();
  const hasSS = ssAvailable();
  // in-memory mirror as final fallback
  let memCurrent = null;
  let memSchemes = {};

  function getStore(primaryKey, backupKey) {
    if (hasLS) return localStorage;
    if (hasSS) return sessionStorage;
    return null;
  }
  function readAll(key) {
    try {
      const s = getStore(key, null);
      if (s) {
        const raw = s.getItem(key);
        if (raw) return JSON.parse(raw);
      }
      // fallback: sessionStorage
      if (hasSS) {
        const raw = sessionStorage.getItem(key + "_bk");
        if (raw) return JSON.parse(raw);
      }
      // fallback: memory
      if (key === LS_SCHEMES) return memSchemes;
      if (key === LS_CURRENT) return memCurrent;
      return null;
    } catch (_) {
      try { if (key === LS_SCHEMES) return memSchemes; } catch (_) {}
      try { if (key === LS_CURRENT) return memCurrent; } catch (_) {}
      return null;
    }
  }
  function writeAll(key, val) {
    let ok = false;
    try {
      const s = getStore(key, null);
      if (s) { s.setItem(key, JSON.stringify(val)); ok = true; }
    } catch (_) {}
    try {
      if (hasSS) sessionStorage.setItem(key + "_bk", JSON.stringify(val));
    } catch (_) {}
    try {
      if (key === LS_SCHEMES) memSchemes = val;
      if (key === LS_CURRENT) memCurrent = val;
    } catch (_) {}
    if (!ok) {
      saveErrorCount++;
      storageOK = false;
    } else {
      storageOK = true;
    }
    return ok;
  }

  function loadSchemes() {
    var d = readAll(LS_SCHEMES);
    return (d && typeof d === "object") ? d : {};
  }
  function saveSchemes(obj) { return writeAll(LS_SCHEMES, obj); }
  function loadCurrent() {
    return readAll(LS_CURRENT);
  }
  function saveCurrent() {
    const data = serializeState();
    return writeAll(LS_CURRENT, data);
  }
  function genId() {
    return "sc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  // ============= Storage info display =============
  function updateStorageInfo() {
    if (!storageInfoEl) return;
    let info = "";
    if (hasLS) {
      info = "✓ 浏览器本地存储";
    } else if (hasSS) {
      info = "⚠ 会话存储（关闭后失效）";
    } else {
      info = "⚠ 内存存储（关闭后失效）";
    }
    const all = loadSchemes();
    info += " · " + Object.keys(all).length + " 个方案";
    storageInfoEl.textContent = info;
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
        var idNum = parseInt(String(c.id || "").replace(/[^0-9]/g, ""), 10);
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
    x.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (chip.parentNode) chip.parentNode.removeChild(chip);
      markDirty();
      saveCurrent();
    });
    chip.appendChild(x);

    txt.addEventListener("input", function () { markDirty(); saveCurrent(); });

    attachDragHandlers(chip);
    return chip;
  }

  function addChip() {
    const chip = makeChip();
    trayItems.appendChild(chip);
    markDirty();
    saveCurrent();
    var t = chip.querySelector(".chip-text");
    if (t) { chip.classList.add("editing"); t.focus(); }
  }
  addBtn.addEventListener("click", addChip);

  // ============= Drag handlers =============
  function clearLongPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
    if (longPressed) {
      longPressed = false;
      document.querySelectorAll(".chip.show-x").forEach(function (n) { n.classList.remove("show-x"); });
    }
  }

  function isTextTarget(t) { return t && t.classList && t.classList.contains("chip-text"); }
  function isDeleteBtnTarget(t) { return t && t.classList && t.classList.contains("chip-x"); }

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
    var gRect = ghost.getBoundingClientRect();
    ghostW = gRect.width || 60;
    ghostH = gRect.height || 30;

    var chipRect = chip.getBoundingClientRect();
    dragOffsetX = clientX - chipRect.left;
    dragOffsetY = clientY - chipRect.top;

    updateGhost(clientX, clientY);
  }

  function updateGhost(clientX, clientY) {
    if (!ghost) return;
    var x = clientX - dragOffsetX + ghostW / 2;
    var y = clientY - dragOffsetY + ghostH / 2;
    ghost.style.transform = "translate3d(" + x.toFixed(0) + "px, " + y.toFixed(0) + "px, 0) scale(1.05)";
  }

  function updateHover(clientX, clientY) {
    if (!dragChip) return;
    var el = document.elementFromPoint(clientX, clientY);
    if (el !== lastHoverEl) {
      if (lastHoverEl) {
        var lLvl = lastHoverEl.closest && lastHoverEl.closest(".level");
        if (lLvl) lLvl.classList.remove("drag-over");
        var lTray = lastHoverEl.closest && lastHoverEl.closest(".tray");
        if (lTray) lTray.classList.remove("drag-over");
      }
      lastHoverEl = el;
      if (el) {
        var lvl = el.closest && el.closest(".level");
        if (lvl) lvl.classList.add("drag-over");
        var tray = el.closest && el.closest(".tray");
        if (tray) tray.classList.add("drag-over");
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
    var el = document.elementFromPoint(clientX, clientY);
    var target = null;
    if (el) {
      var lvl = el.closest && el.closest(".level");
      if (lvl) target = lvl;
      else {
        var tray = el.closest && el.closest(".tray");
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
    document.querySelectorAll(".level.drag-over, .tray.drag-over").forEach(function (n) {
      n.classList.remove("drag-over");
    });
    dragChip = null;
    dragOriginParent = null;
    dragOriginNext = null;
    lastHoverEl = null;
  }

  function chipText(chip) {
    var t = chip.querySelector(".chip-text");
    return (t && t.textContent.trim()) || "文本";
  }

  function handleDblClick(chip, txt) {
    chip.classList.add("editing");
    txt.focus();
    var range = document.createRange();
    range.selectNodeContents(txt);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function attachDragHandlers(chip) {
    var txt = chip.querySelector(".chip-text");

    chip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (isDeleteBtnTarget(e.target)) return;

      var now = Date.now();
      if (lastClickChip === chip && now - lastClickTime < 350) {
        e.preventDefault();
        e.stopPropagation();
        lastClickTime = 0;
        lastClickChip = null;
        clearLongPress();
        handleDblClick(chip, txt);
        return;
      }
      lastClickTime = now;
      lastClickChip = chip;

      if (isTextTarget(e.target)) return;

      var startX = e.clientX, startY = e.clientY;
      var moved = false;

      function onMove(ev) {
        lastX = ev.clientX; lastY = ev.clientY;
        if (!moved) {
          if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
          moved = true;
          startDrag(chip, ev.clientX, ev.clientY);
          scheduleMove();
        } else {
          scheduleMove();
        }
      }
      function onUp(ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!moved) {
          clearLongPress();
          pressTimer = setTimeout(function () {
            longPressed = true;
            chip.classList.add("show-x");
          }, 500);
        } else {
          endDrag(ev.clientX, ev.clientY);
        }
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    chip.addEventListener("touchstart", function (e) {
      if (isDeleteBtnTarget(e.target)) return;

      var t = e.touches[0];
      if (!t) return;
      var startX = t.clientX, startY = t.clientY;

      var now = Date.now();
      if (lastClickChip === chip && now - lastClickTime < 350) {
        e.preventDefault();
        e.stopPropagation();
        lastClickTime = 0;
        lastClickChip = null;
        clearLongPress();
        handleDblClick(chip, txt);
        return;
      }
      lastClickTime = now;
      lastClickChip = chip;

      if (isTextTarget(e.target)) return;

      var moved = false;
      var tapTimer = 0;

      function onMove(ev) {
        var tt = ev.touches[0]; if (!tt) return;
        lastX = tt.clientX; lastY = tt.clientY;
        if (!moved) {
          if (Math.abs(tt.clientX - startX) < 4 && Math.abs(tt.clientY - startY) < 4) return;
          moved = true;
          clearTimeout(tapTimer);
          startDrag(chip, tt.clientX, tt.clientY);
          scheduleMove();
        } else {
          scheduleMove();
        }
        if (ev.cancelable) ev.preventDefault();
      }
      function onEnd(ev) {
        document.removeEventListener("touchmove", onMove, false);
        document.removeEventListener("touchend", onEnd);
        document.removeEventListener("touchcancel", onEnd);
        clearTimeout(tapTimer);
        if (!moved) {
          tapTimer = setTimeout(function () {
            longPressed = true;
            chip.classList.add("show-x");
          }, 500);
        } else {
          var tt = (ev.changedTouches && ev.changedTouches[0]) || { clientX: startX, clientY: startY };
          endDrag(tt.clientX, tt.clientY);
        }
      }
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    }, { passive: true });

    txt.addEventListener("blur", function () {
      chip.classList.remove("editing");
    });
  }

  document.addEventListener("mousedown", function (e) {
    if (e.target && e.target.classList) {
      if (e.target.classList.contains("chip")) return;
      if (e.target.classList.contains("chip-x")) return;
    }
    clearLongPress();
  }, true);
  document.addEventListener("touchstart", function (e) {
    if (e.target && e.target.classList) {
      if (e.target.classList.contains("chip")) return;
      if (e.target.classList.contains("chip-x")) return;
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

  newBtn.addEventListener("click", function () {
    if (isDirty) {
      if (!confirm("当前方案有未保存修改，是否放弃并新建？")) return;
    }
    applyState({ id: null, name: "未命名方案", corners: { topLeft: "", topRight: "", bottomLeft: "", bottomRight: "" }, chips: [] });
    saveCurrent();
    showToast("已新建空白方案");
  });

  saveBtn.addEventListener("click", function () {
    var data = serializeState();
    if (currentSchemeId) {
      var all = loadSchemes();
      all[currentSchemeId] = { id: currentSchemeId, name: currentSchemeName, corners: data.corners, chips: data.chips, ts: Date.now() };
      var ok = saveSchemes(all);
      markClean();
      showToast(ok ? "已保存" : "保存失败：存储空间不足");
      updateStorageInfo();
    } else {
      var name = prompt("保存为新方案，请输入名称：", currentSchemeName === "未命名方案" ? "" : currentSchemeName);
      if (name === null) return;
      var trimmed = (name || "").trim() || ("方案 " + new Date().toLocaleString());
      var id = genId();
      var all = loadSchemes();
      all[id] = { id: id, name: trimmed, corners: data.corners, chips: data.chips, ts: Date.now() };
      var ok2 = saveSchemes(all);
      currentSchemeId = id;
      currentSchemeName = trimmed;
      markClean();
      updateTitle();
      showToast(ok2 ? ("已保存为「" + trimmed + "」") : "已保存到内存（存储不可用）");
      updateStorageInfo();
    }
  });

  manageBtn.addEventListener("click", function () {
    renderSchemeList();
    updateStorageInfo();
    showModal();
    newNameInput.value = "";
    newNameInput.focus();
  });
  modalClose.addEventListener("click", hideModal);
  modalMask.addEventListener("click", function (e) {
    if (e.target === modalMask) hideModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modalMask.classList.contains("open")) hideModal();
  });

  function doCreate() {
    var name = (newNameInput.value || "").trim();
    if (!name) { newNameInput.focus(); return; }
    var all = loadSchemes();
    if (Object.keys(all).some(function (k) { return all[k].name === name; })) {
      showToast("名称已存在"); return;
    }
    var id = genId();
    var data = serializeState();
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
  newNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); doCreate(); }
  });

  // Export / Import / Clear
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");

  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      var all = loadSchemes();
      var payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        schemes: all
      };
      var json = JSON.stringify(payload, null, 2);
      try {
        var blob = new Blob([json], { type: "application/json;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "classpyramid-schemes-" + new Date().toISOString().slice(0,10) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showToast("已导出 " + Object.keys(all).length + " 个方案");
      } catch (e) {
        // Fallback: open in new window
        var dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(json);
        window.open(dataUri, "_blank");
        showToast("已在新窗口打开 JSON");
      }
    });
  }

  if (importBtn && importFileInput) {
    importBtn.addEventListener("click", function () { importFileInput.click(); });
    importFileInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var payload = JSON.parse(ev.target.result);
          var schemes = payload && payload.schemes;
          if (!schemes || typeof schemes !== "object") {
            showToast("无效的 JSON 格式"); return;
          }
          var all = loadSchemes();
          var added = 0, skipped = 0;
          Object.keys(schemes).forEach(function (k) {
            var s = schemes[k];
            if (!s || !s.name) { skipped++; return; }
            // ensure unique name
            var origName = s.name;
            var n = origName;
            var i = 1;
            while (Object.keys(all).some(function (kk) { return all[kk].name === n; })) {
              n = origName + " (" + (i++) + ")";
            }
            var newId = genId();
            all[newId] = {
              id: newId,
              name: n,
              corners: s.corners || {},
              chips: Array.isArray(s.chips) ? s.chips : [],
              ts: Date.now()
            };
            added++;
          });
          saveSchemes(all);
          renderSchemeList();
          updateStorageInfo();
          showToast("导入完成 +" + added + (skipped ? " / 跳过 " + skipped : ""));
        } catch (err) {
          showToast("JSON 解析失败");
        }
        importFileInput.value = "";
      };
      reader.readAsText(file, "utf-8");
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", function () {
      if (!confirm("确定清空所有方案？此操作不可恢复（建议先导出备份）。")) return;
      if (!confirm("再次确认：清空后无法找回，确认继续？")) return;
      try {
        if (hasLS) { localStorage.removeItem(LS_SCHEMES); localStorage.removeItem(LS_CURRENT); }
        if (hasSS) { sessionStorage.removeItem(SS_SCHEMES); sessionStorage.removeItem(SS_CURRENT); }
      } catch (_) {}
      memSchemes = {};
      memCurrent = null;
      currentSchemeId = null;
      currentSchemeName = "未命名方案";
      clearChips();
      for (var i = 0; i < 3; i++) trayItems.appendChild(makeChip());
      document.querySelectorAll(".corner-box").forEach(function (n) { n.textContent = ""; });
      markClean();
      updateTitle();
      renderSchemeList();
      updateStorageInfo();
      showToast("已清空所有数据");
    });
  }

  function renderSchemeList() {
    var all = loadSchemes();
    var items = Object.values(all).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (items.length === 0) {
      schemeListEl.innerHTML = '<div class="scheme-empty">暂无方案，输入名称后点击「创建」</div>';
      return;
    }
    schemeListEl.innerHTML = "";
    items.forEach(function (sc) {
      var row = document.createElement("div");
      row.className = "scheme-item" + (sc.id === currentSchemeId ? " current" : "");
      var info = document.createElement("div");
      info.className = "scheme-info";
      var nm = document.createElement("div");
      nm.className = "scheme-name";
      nm.textContent = sc.name;
      var meta = document.createElement("div");
      meta.className = "scheme-meta";
      var dt = new Date(sc.ts || 0);
      var lvlCount = (sc.chips || []).filter(function (c) { return c.loc && c.loc.indexOf("level:") === 0; }).length;
      meta.textContent = dt.getFullYear() + "-" + pad(dt.getMonth()+1) + "-" + pad(dt.getDate()) + " " +
                        pad(dt.getHours()) + ":" + pad(dt.getMinutes()) +
                        " · " + (sc.chips ? sc.chips.length : 0) + " 块 · " + lvlCount + " 已归类";
      info.appendChild(nm); info.appendChild(meta);
      var actions = document.createElement("div");
      actions.className = "scheme-actions";

      var loadB = document.createElement("button");
      loadB.className = "tb-btn small primary";
      loadB.textContent = "加载";
      loadB.addEventListener("click", function () {
        applyState(sc);
        saveCurrent();
        hideModal();
        showToast("已加载「" + sc.name + "」");
      });

      var renB = document.createElement("button");
      renB.className = "tb-btn small";
      renB.textContent = "重命名";
      renB.addEventListener("click", function () {
        var newName = prompt("新名称：", sc.name);
        if (newName === null) return;
        var trimmed = (newName || "").trim();
        if (!trimmed) return;
        var all2 = loadSchemes();
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

      var delB = document.createElement("button");
      delB.className = "tb-btn small danger";
      delB.textContent = "删除";
      delB.addEventListener("click", function () {
        if (!confirm("确定删除方案「" + sc.name + "」？")) return;
        var all3 = loadSchemes();
        delete all3[sc.id];
        saveSchemes(all3);
        if (sc.id === currentSchemeId) {
          currentSchemeId = null;
          currentSchemeName = "未命名方案";
          updateTitle();
        }
        renderSchemeList();
        updateStorageInfo();
        showToast("已删除");
      });

      actions.appendChild(loadB); actions.appendChild(renB); actions.appendChild(delB);
      row.appendChild(info); row.appendChild(actions);
      schemeListEl.appendChild(row);
    });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  document.querySelectorAll(".corner-box").forEach(function (n) {
    n.addEventListener("input", function () { markDirty(); saveCurrent(); });
  });

  // periodic auto-save every 5s (defensive)
  setInterval(function () {
    if (isDirty) {
      saveCurrent();
      updateStorageInfo();
    }
  }, 5000);

  window.addEventListener("pagehide", saveCurrent);
  window.addEventListener("beforeunload", saveCurrent);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveCurrent();
  });

  // ============= Init =============
  function init() {
    hideModal();
    updateStorageInfo();
    var cur = loadCurrent();
    if (cur && cur.chips) {
      applyState(cur);
    } else {
      for (var i = 0; i < 3; i++) trayItems.appendChild(makeChip());
      markClean();
      updateTitle();
      saveCurrent();
    }
  }
  init();
})();
