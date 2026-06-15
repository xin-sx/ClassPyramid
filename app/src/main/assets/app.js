(function () {
  "use strict";

  const trayItems = document.getElementById("trayItems");
  const addBtn = document.getElementById("addBtn");
  const diamond = document.getElementById("diamond");

  let chipCounter = 0;

  function makeChip() {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.setAttribute("draggable", "true");
    chip.dataset.id = "chip-" + ++chipCounter;

    const txt = document.createElement("span");
    txt.className = "chip-text";
    txt.setAttribute("contenteditable", "true");
    txt.setAttribute("data-placeholder", "文本");
    chip.appendChild(txt);

    attachDragHandlers(chip);
    return chip;
  }

  addBtn.addEventListener("click", function () {
    const chip = makeChip();
    trayItems.appendChild(chip);
  });

  // Attach handlers to the 3 default chips
  Array.prototype.forEach.call(trayItems.querySelectorAll(".chip"), function (c) {
    attachDragHandlers(c);
  });

  // ----- Drag & Drop (mouse + touch) -----
  let dragChip = null;
  let ghost = null;
  let offsetX = 0, offsetY = 0;

  function startDrag(chip, clientX, clientY, evt) {
    if (evt && evt.target && evt.target.classList && evt.target.classList.contains("chip-text")) {
      // ignore drag if user is editing text
      return;
    }
    dragChip = chip;
    chip.classList.add("dragging");

    const rect = chip.getBoundingClientRect();
    offsetX = clientX - rect.left;
    offsetY = clientY - rect.top;

    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = chipText(chip);
    ghost.style.left = clientX + "px";
    ghost.style.top = clientY + "px";
    document.body.appendChild(ghost);

    if (evt && evt.cancelable) evt.preventDefault();
  }

  function moveDrag(clientX, clientY) {
    if (!dragChip || !ghost) return;
    ghost.style.left = clientX + "px";
    ghost.style.top = clientY + "px";
    // clear all drag-over states
    document.querySelectorAll(".level.drag-over").forEach(function (n) {
      n.classList.remove("drag-over");
    });
    const el = document.elementFromPoint(clientX, clientY);
    if (el) {
      const lvl = el.closest && el.closest(".level");
      const tray = el.closest && el.closest("#trayItems");
      if (lvl) lvl.classList.add("drag-over");
      if (tray) tray.classList.add("drag-over");
    }
  }

  function endDrag(clientX, clientY) {
    if (!dragChip || !ghost) return;
    let target = null;
    const el = document.elementFromPoint(clientX, clientY);
    if (el) {
      const lvl = el.closest && el.closest(".level");
      if (lvl) {
        target = lvl;
      } else {
        const tray = el.closest && el.closest("#trayItems");
        if (tray) target = tray;
      }
    }
    if (target && target.classList.contains("level")) {
      // place chip into the level
      // adjust visual: shrink style for placed chips
      dragChip.classList.add("placed");
      target.appendChild(dragChip);
    } else if (target && target.id === "trayItems") {
      dragChip.classList.remove("placed");
      trayItems.appendChild(dragChip);
    } else {
      // dropped outside; revert to original parent
      const orig = dragChip.dataset.origin === "level"
        ? findOriginalLevel(dragChip)
        : trayItems;
      if (orig) {
        if (orig.classList && orig.classList.contains("level")) {
          dragChip.classList.add("placed");
        } else {
          dragChip.classList.remove("placed");
        }
        orig.appendChild(dragChip);
      } else {
        trayItems.appendChild(dragChip);
      }
    }
    cleanup();
  }

  function cleanup() {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    if (dragChip) {
      dragChip.classList.remove("dragging");
      document.querySelectorAll(".level.drag-over").forEach(function (n) {
        n.classList.remove("drag-over");
      });
    }
    dragChip = null;
  }

  function findOriginalLevel(chip) {
    // If the chip was already in a level we keep it there.
    // We stored nothing, so just return current parent if it's a level.
    const p = chip.parentNode;
    if (p && p.classList && p.classList.contains("level")) return p;
    return null;
  }

  function chipText(chip) {
    const t = chip.querySelector(".chip-text");
    return (t && t.textContent.trim()) || "文本";
  }

  function attachDragHandlers(chip) {
    // Mouse
    chip.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      // skip if user clicked on the editable text
      if (e.target.classList && e.target.classList.contains("chip-text")) return;
      const startX = e.clientX, startY = e.clientY;
      let moved = false;
      const onMove = function (ev) {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
          moved = true;
          startDrag(chip, ev.clientX, ev.clientY, ev);
        } else {
          moveDrag(ev.clientX, ev.clientY);
        }
      };
      const onUp = function (ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (moved) {
          endDrag(ev.clientX, ev.clientY);
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Touch
    chip.addEventListener("touchstart", function (e) {
      if (e.target.classList && e.target.classList.contains("chip-text")) return;
      const t = e.touches[0];
      const startX = t.clientX, startY = t.clientY;
      let moved = false;
      const onMove = function (ev) {
        const tt = ev.touches[0];
        if (!moved) {
          if (Math.abs(tt.clientX - startX) < 6 && Math.abs(tt.clientY - startY) < 6) return;
          moved = true;
          startDrag(chip, tt.clientX, tt.clientY, ev);
        } else {
          moveDrag(tt.clientX, tt.clientY);
        }
        if (ev.cancelable) ev.preventDefault();
      };
      const onEnd = function (ev) {
        document.removeEventListener("touchmove", onMove, { passive: false });
        document.removeEventListener("touchend", onEnd);
        document.removeEventListener("touchcancel", onEnd);
        if (moved) {
          const tt = (ev.changedTouches && ev.changedTouches[0]) || { clientX: startX, clientY: startY };
          endDrag(tt.clientX, tt.clientY);
        }
      };
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    }, { passive: true });

    // Native HTML5 drag (desktop fallback)
    chip.addEventListener("dragstart", function (e) {
      if (e.target.classList && e.target.classList.contains("chip-text")) {
        e.preventDefault();
        return;
      }
      dragChip = chip;
      chip.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", chip.dataset.id || ""); } catch (_) {}
    });
    chip.addEventListener("dragend", function () {
      cleanup();
    });
  }

  // Native HTML5 drop targets (desktop)
  Array.prototype.forEach.call(document.querySelectorAll(".level"), function (lvl) {
    lvl.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      lvl.classList.add("drag-over");
    });
    lvl.addEventListener("dragleave", function () {
      lvl.classList.remove("drag-over");
    });
    lvl.addEventListener("drop", function (e) {
      e.preventDefault();
      lvl.classList.remove("drag-over");
      if (dragChip) {
        dragChip.classList.add("placed");
        lvl.appendChild(dragChip);
        cleanup();
      }
    });
  });
  trayItems.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  trayItems.addEventListener("drop", function (e) {
    e.preventDefault();
    if (dragChip) {
      dragChip.classList.remove("placed");
      trayItems.appendChild(dragChip);
      cleanup();
    }
  });
})();
