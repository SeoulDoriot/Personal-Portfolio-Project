/* ============================================================
   Seoul OS — interactions
   ============================================================ */
(function () {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none)").matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const THEME_KEY = "seoul-os-theme";

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- light / dark theme system ---------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let dragStartX = 0;
  let dragStarted = false;
  let didDrag = false;

  const getSavedTheme = () => {
    try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
  };
  const getCurrentTheme = () => root.dataset.theme === "dark" ? "dark" : "light";

  function setTheme(theme, shouldSave = true) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    root.classList.toggle("theme-dark", nextTheme === "dark");
    root.classList.toggle("theme-light", nextTheme === "light");
    root.dataset.theme = nextTheme;
    if (themeToggle) {
      const isDark = nextTheme === "dark";
      themeToggle.setAttribute("aria-checked", String(isDark));
      themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    }
    if (shouldSave) {
      try { localStorage.setItem(THEME_KEY, nextTheme); } catch (_) {}
    }
  }

  setTheme(getSavedTheme() || (systemTheme.matches ? "dark" : "light"), Boolean(getSavedTheme()));

  const syncSystemTheme = (event) => {
    if (!getSavedTheme()) setTheme(event.matches ? "dark" : "light", false);
  };
  if (systemTheme.addEventListener) {
    systemTheme.addEventListener("change", syncSystemTheme);
  } else {
    systemTheme.addListener(syncSystemTheme);
  }

  if (themeToggle) {
    themeToggle.addEventListener("pointerdown", (event) => {
      dragStartX = event.clientX;
      dragStarted = true;
      didDrag = false;
      themeToggle.setPointerCapture?.(event.pointerId);
    });

    themeToggle.addEventListener("pointermove", (event) => {
      if (!dragStarted) return;
      const dx = event.clientX - dragStartX;
      if (Math.abs(dx) > 12) didDrag = true;
    });

    themeToggle.addEventListener("pointerup", (event) => {
      if (!dragStarted) return;
      dragStarted = false;
      themeToggle.releasePointerCapture?.(event.pointerId);
      if (didDrag) {
        const rect = themeToggle.getBoundingClientRect();
        setTheme(event.clientX > rect.left + rect.width / 2 ? "dark" : "light");
      }
    });

    themeToggle.addEventListener("click", () => {
      if (didDrag) {
        didDrag = false;
        return;
      }
      setTheme(getCurrentTheme() === "dark" ? "light" : "dark");
    });
  }

  /* ---------- cursor glow ---------- */
  const glow = document.getElementById("cursorGlow");
  let gx = window.innerWidth / 2, gy = window.innerHeight / 2;
  let tgx = gx, tgy = gy;
  if (!isTouch && !reduceMotion) {
    window.addEventListener("pointermove", (e) => { tgx = e.clientX; tgy = e.clientY; }, { passive: true });
    (function loopGlow() {
      gx = lerp(gx, tgx, 0.16); gy = lerp(gy, tgy, 0.16);
      glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
      requestAnimationFrame(loopGlow);
    })();
  } else {
    glow.style.display = "none";
  }

  /* ---------- nav shadow on scroll ---------- */
  const nav = document.getElementById("nav");
  const onScrollNav = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  onScrollNav();
  window.addEventListener("scroll", onScrollNav, { passive: true });

  /* ---------- hero parallax + tilt (Seoul Core) ---------- */
  const scene = document.getElementById("coreScene");
  const stage = document.getElementById("coreStage");
  const ship = document.getElementById("spaceCompanion");
  const gravityStatus = document.getElementById("gravityStatus");
  const missionPopup = document.getElementById("missionPopup");
  const missionClose = document.getElementById("missionClose");
  // every ring node + floating chip drifts with the mouse, by depth
  const driftItems = Array.from(document.querySelectorAll(".node, .chip-float"));
  const gravityItems = driftItems.map((item) => {
    const cs = getComputedStyle(item);
    return {
      item,
      baseX: parseFloat(cs.getPropertyValue("--x")) || 0,
      baseY: parseFloat(cs.getPropertyValue("--y")) || 0,
      pull: item.classList.contains("chip-float") ? 34 : 18,
    };
  });
  const hero = document.getElementById("hero");
  const heroCanvas = document.getElementById("particle-canvas");
  let mx = 0, my = 0, cmx = 0, cmy = 0;
  let rawHX = -9999, rawHY = -9999;   // cursor coordinates
  let cursorX = window.innerWidth / 2, cursorY = window.innerHeight / 2;
  let hasPointer = false;
  let gravityPower = 0, targetGravityPower = 0;
  let scatterPower = 0, targetScatterPower = 0;
  let boostUntil = 0, scatterUntil = 0;
  let statusTimer = 0;

  // New spaceship physics helper functions & variables
  function lerpAngle(a, b, t) {
    let diff = (b - a) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return a + diff * t;
  }

  function getViewportMargin() {
    return Math.max(120, Math.min(window.innerWidth, window.innerHeight) * 0.18);
  }

  function randomEdgePoint(margin, side = null) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const chosenSide = side ?? Math.floor(Math.random() * 4);

    if (chosenSide === 0) return { x: -margin, y: Math.random() * h };
    if (chosenSide === 1) return { x: w + margin, y: Math.random() * h };
    if (chosenSide === 2) return { x: Math.random() * w, y: -margin };
    return { x: Math.random() * w, y: h + margin };
  }

  function generateNewPath(previousEnd = null) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = getViewportMargin();
    const startSide = previousEnd ? null : Math.floor(Math.random() * 4);
    const exitSide = (startSide ?? Math.floor(Math.random() * 4));
    const start = randomEdgePoint(margin, startSide);
    const end = randomEdgePoint(margin, (exitSide + Math.floor(Math.random() * 3) + 1) % 4);
    const travelX = end.x - start.x;
    const travelY = end.y - start.y;
    const distance = Math.max(240, Math.hypot(travelX, travelY));
    const bendStrength = distance * (0.12 + Math.random() * 0.16) * (Math.random() < 0.5 ? -1 : 1);
    const normalX = -travelY / distance;
    const normalY = travelX / distance;

    const center1 = 0.28 + Math.random() * 0.18;
    const center2 = 0.62 + Math.random() * 0.16;
    const drift1 = bendStrength * (0.4 + Math.random() * 0.6);
    const drift2 = bendStrength * (0.4 + Math.random() * 0.6);

    let P1 = {
      x: start.x + travelX * center1 + normalX * drift1,
      y: start.y + travelY * center1 + normalY * drift1,
    };
    let P2 = {
      x: start.x + travelX * center2 - normalX * drift2,
      y: start.y + travelY * center2 - normalY * drift2,
    };

    // Occasionally arc near Seoul Core, but keep it a broad curve instead of an orbit.
    if (Math.random() < 0.42 && stage && hero) {
      const stageRect = stage.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const coreX = stageRect.left - heroRect.left + stageRect.width / 2;
      const coreY = stageRect.top - heroRect.top + stageRect.height / 2;
      const control = Math.random() < 0.5 ? P1 : P2;
      const pull = 0.45 + Math.random() * 0.25;
      control.x = control.x * (1 - pull) + (coreX + (Math.random() - 0.5) * 260) * pull;
      control.y = control.y * (1 - pull) + (coreY + (Math.random() - 0.5) * 220) * pull;
    }

    const isTablet = w > 640 && w <= 1024;
    const baseSpeed = (isTablet ? 0.00042 : 0.00062) + Math.random() * 0.00026;

    return {
      P0: start,
      P1,
      P2,
      P3: end,
      u: 0,
      speed: baseSpeed,
      fadeIn: true,
      fade: 0,
      delayFrames: Math.floor(18 + Math.random() * 45),
      offscreenExitDelay: Math.floor(10 + Math.random() * 26),
      targetRotation: (Math.random() - 0.5) * 24,
    };
  }

  function getBezierPoint(path, u) {
    const P0 = path.P0;
    const P1 = path.P1;
    const P2 = path.P2;
    const P3 = path.P3;
    const mt = 1 - u;
    
    const x = mt*mt*mt * P0.x + 3 * mt*mt * u * P1.x + 3 * mt * u*u * P2.x + u*u*u * P3.x;
    const y = mt*mt*mt * P0.y + 3 * mt*mt * u * P1.y + 3 * mt * u*u * P2.y + u*u*u * P3.y;
    
    const tx = -3*mt*mt * P0.x + 3*(3*u*u - 4*u + 1)*P1.x + 3*(2*u - 3*u*u)*P2.x + 3*u*u * P3.x;
    const ty = -3*mt*mt * P0.y + 3*(3*u*u - 4*u + 1)*P1.y + 3*(2*u - 3*u*u)*P2.y + 3*u*u * P3.y;
    
    return { x, y, tx, ty };
  }

  let sparks = [];
  const SPARK_COLORS = [
    'rgba(52, 214, 255, ALPHA)', // cyan
    'rgba(255, 134, 31, ALPHA)', // orange
    'rgba(124, 92, 255, ALPHA)', // purple
    'rgba(255, 226, 122, ALPHA)'  // yellow
  ];

  let shipState = 'idle'; // 'idle', 'pull', 'escape', 'mission'
  let shipX = 0;
  let shipY = 0;
  let shipVelX = 0;
  let shipVelY = 0;
  let shipTilt = 0;
  let shipScale = 0.68;
  let shipThrust = 0;
  let shipOpacity = 0;
  let boostTimer = 0;
  let missionTimer = 0;
  let missionStartAngle = 0;
  let currentPath = null;
  let respawnDelay = 0;
  let respawnSource = null;
  let shipVisible = false;

  const showStatus = (text, duration = 1200) => {
    if (!gravityStatus) return;
    window.clearTimeout(statusTimer);
    gravityStatus.textContent = text;
    gravityStatus.classList.add("is-visible");
    statusTimer = window.setTimeout(() => gravityStatus.classList.remove("is-visible"), duration);
  };

  const openMission = () => {
    if (!missionPopup) return;
    missionPopup.classList.add("is-open");
    missionPopup.setAttribute("aria-hidden", "false");
  };

  const closeMission = () => {
    if (!missionPopup) return;
    missionPopup.classList.remove("is-open");
    missionPopup.setAttribute("aria-hidden", "true");
  };

  const triggerMission = () => {
    if (reduceMotion || window.innerWidth <= 640) {
      openMission();
      return;
    }
    
    shipState = 'mission';
    missionTimer = 90; // 90 frames (~1.5s)
    
    if (stage && hero) {
      const stageRect = stage.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const coreX = stageRect.left - heroRect.left + stageRect.width / 2;
      const coreY = stageRect.top - heroRect.top + stageRect.height / 2;
      
      const dx = shipX - coreX;
      const dy = shipY - coreY;
      missionStartAngle = Math.atan2(dy, dx);
    }
    
    stage?.classList.add("mission-boost");
    
    // Open the popup at 650ms during the slingshot zoom-off
    window.setTimeout(() => {
      openMission();
    }, 650);
    
    window.setTimeout(() => {
      stage?.classList.remove("mission-boost");
    }, 1500);
  };

  ship?.addEventListener("click", triggerMission);
  missionClose?.addEventListener("click", closeMission);
  missionPopup?.addEventListener("click", (e) => {
    if (e.target === missionPopup) closeMission();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMission();
  });

  if (!reduceMotion && stage) {
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === 'touch') {
        hasPointer = false;
        rawHX = -9999;
        rawHY = -9999;
        return;
      }
      cursorX = e.clientX;
      cursorY = e.clientY;
      hasPointer = true;
      mx = (e.clientX / window.innerWidth - 0.5) * 2;   // -1..1
      my = (e.clientY / window.innerHeight - 0.5) * 2;
      rawHX = e.clientX;
      rawHY = e.clientY;
    }, { passive: true });
    
    stage.addEventListener("pointerleave", () => {
      rawHX = -9999;
      rawHY = -9999;
      hasPointer = false;
    }, { passive: true });

    currentPath = generateNewPath();
    shipX = currentPath.P0.x;
    shipY = currentPath.P0.y;
    shipOpacity = 0;
    shipVisible = false;

    (function loopParallax() {
      const now = performance.now();
      cmx = lerp(cmx, mx, 0.08);
      cmy = lerp(cmy, my, 0.08);
      const rect = stage.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      
      const heroRect = hero ? hero.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const localX = cursorX - heroRect.left;
      const localY = cursorY - heroRect.top;
      
      const coreX = (cursorX - rect.left) - cx;
      const coreY = (cursorY - rect.top) - cy;
      
      const coreCenterX = rect.left - heroRect.left + rect.width / 2;
      const coreCenterY = rect.top - heroRect.top + rect.height / 2;
      
      const isMobile = window.innerWidth <= 640;
      const isTablet = window.innerWidth > 640 && window.innerWidth <= 1024;
      
      // Update gravity well values based on shipState proximity to cursor
      const hasMouse = hasPointer && rawHX !== -9999;
      const mDist = hasMouse ? Math.hypot(localX - shipX, localY - shipY) : 9999;
      
      let targetPower = 0;
      if (hasMouse) {
        if (shipState === 'escape' || shipState === 'mission') {
          targetPower = 1.0;
        } else if (shipState === 'pull') {
          targetPower = 0.4 + (1 - clamp(mDist / 220, 0, 1)) * 0.6;
        } else {
          targetPower = 0.35;
        }
      }
      targetGravityPower = targetPower;
      gravityPower = lerp(gravityPower, targetGravityPower, 0.12);
      targetScatterPower = now < scatterUntil ? 0.55 : 0;
      scatterPower = lerp(scatterPower, targetScatterPower, 0.11);

      stage.style.setProperty("--gravity-power", gravityPower.toFixed(3));
      stage.classList.toggle("gravity-active", gravityPower > 0.08);
      
      // tilt the whole core system
      scene.style.transform =
        `rotateY(${cmx * (13 + gravityPower * 3)}deg) rotateX(${-cmy * (11 + gravityPower * 2)}deg) translateZ(0)`;
        
      // nodes + chips drift by depth (parallax)
      const strengthScale = window.innerWidth < 1025 ? 0.58 : 1;
      for (const { item, baseX, baseY, pull } of gravityItems) {
        const depth = parseFloat(item.dataset.depth) || 20;
        item.style.setProperty("--tx", `${cmx * depth * -0.6}px`);
        item.style.setProperty("--ty", `${cmy * depth * -0.6}px`);
        const dx = coreX - baseX;
        const dy = coreY - baseY;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const localPull = gravityPower * clamp(1 - dist / 360, 0, 1) * strengthScale;
        const pullX = (dx / dist) * pull * localPull;
        const pullY = (dy / dist) * pull * localPull;
        const outDist = Math.max(1, Math.hypot(baseX, baseY));
        const scatter = scatterPower * (item.classList.contains("chip-float") ? 34 : 16);
        item.style.setProperty("--gx", `${pullX.toFixed(2)}px`);
        item.style.setProperty("--gy", `${pullY.toFixed(2)}px`);
        item.style.setProperty("--scatter-x", `${((baseX / outDist) * scatter).toFixed(2)}px`);
        item.style.setProperty("--scatter-y", `${((baseY / outDist) * scatter).toFixed(2)}px`);
      }

      // Spaceship physics state machine
      if (ship) {
        const fadeStep = 0.05;
        if (isMobile) {
          shipState = 'idle';
          const t = now * 0.0008;
          const orbitRadiusX = 85;
          const orbitRadiusY = 65;
          const targetX = coreCenterX + Math.cos(t) * orbitRadiusX;
          const targetY = coreCenterY + Math.sin(t * 1.3) * orbitRadiusY;
          
          shipX = lerp(shipX, targetX, 0.05);
          shipY = lerp(shipY, targetY, 0.05);
          
          const dx = targetX - shipX;
          const dy = targetY - shipY;
          const targetTilt = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          shipTilt = lerpAngle(shipTilt, targetTilt, 0.1);
          
          shipScale = 0.46;
          shipThrust = 0.12 + Math.abs(Math.sin(now * 0.003)) * 0.05;
          shipOpacity = lerp(shipOpacity, 1, 0.06);
          
        } else {
          if (respawnDelay > 0) {
            respawnDelay--;
            shipVisible = false;
            shipOpacity = lerp(shipOpacity, 0, 0.12);
            shipThrust = 0;
            shipScale = 0.64;
            shipVelX *= 0.92;
            shipVelY *= 0.92;
            if (respawnDelay === 0) {
              currentPath = generateNewPath(respawnSource);
              shipX = currentPath.P0.x;
              shipY = currentPath.P0.y;
              shipVelX = 0;
              shipVelY = 0;
              shipTilt = currentPath.targetRotation;
              shipState = 'idle';
              shipVisible = true;
            }
          }

          if (shipState === 'mission') {
            missionTimer--;
            if (missionTimer <= 0) {
              shipState = 'idle';
              currentPath = generateNewPath({ x: shipX, y: shipY });
              shipX = currentPath.P0.x;
              shipY = currentPath.P0.y;
              shipVelX = 0;
              shipVelY = 0;
            } else {
              const progress = (90 - missionTimer) / 90;
              const orbitR = 140;
              
              if (progress < 0.7) {
                const angle = missionStartAngle + progress * 3 * Math.PI;
                const targetX = coreCenterX + Math.cos(angle) * orbitR;
                const targetY = coreCenterY + Math.sin(angle) * orbitR;
                
                shipX = lerp(shipX, targetX, 0.25);
                shipY = lerp(shipY, targetY, 0.25);
                
                const vx = targetX - shipX;
                const vy = targetY - shipY;
                const targetTilt = Math.atan2(vy, vx) * 180 / Math.PI + 90;
                shipTilt = lerpAngle(shipTilt, targetTilt, 0.22);
                shipThrust = 1.25;
                shipScale = 0.72;
                shipOpacity = lerp(shipOpacity, 1, 0.12);
              } else {
                const shootProgress = (progress - 0.7) / 0.3;
                const angle = missionStartAngle + 0.7 * 3 * Math.PI;
                const tx = -Math.sin(angle);
                const ty = Math.cos(angle);
                
                const targetX = coreCenterX + Math.cos(angle) * orbitR + tx * shootProgress * 700;
                const targetY = coreCenterY + Math.sin(angle) * orbitR + ty * shootProgress * 700;
                
                shipX = lerp(shipX, targetX, 0.15);
                shipY = lerp(shipY, targetY, 0.15);
                
                const targetTilt = Math.atan2(ty, tx) * 180 / Math.PI + 90;
                shipTilt = lerpAngle(shipTilt, targetTilt, 0.2);
                shipThrust = 1.4;
                shipScale = 0.78;
                shipOpacity = lerp(shipOpacity, 1, 0.15);
              }
            }
            
          } else {
            if (!currentPath) {
              currentPath = generateNewPath();
              shipX = currentPath.P0.x;
              shipY = currentPath.P0.y;
            }

            currentPath.u += currentPath.speed;
            const pathPoint = getBezierPoint(currentPath, Math.min(currentPath.u, 1));
            const gravityThreshold = 220;
            const escapeThreshold = 65;

            const nearEnd = currentPath.u > 0.86;
            const pastEnd = currentPath.u >= 1;

            if (pastEnd) {
              const endPoint = getBezierPoint(currentPath, 1);
              const offscreenExit = Math.abs(endPoint.x) > window.innerWidth + getViewportMargin() * 0.35 || Math.abs(endPoint.y) > window.innerHeight + getViewportMargin() * 0.35;
              if (offscreenExit && respawnDelay === 0) {
                respawnSource = endPoint;
                respawnDelay = currentPath.offscreenExitDelay + Math.floor(Math.random() * 18);
              }
            }
            
            if (shipState === 'escape') {
              boostTimer--;
              if (boostTimer <= 0) {
                shipState = 'idle';
              }
              
              const dx = shipX - localX;
              const dy = shipY - localY;
              const dist = Math.hypot(dx, dy) || 1;
              
              const boostAcc = 0.45;
              shipVelX += (dx / dist) * boostAcc;
              shipVelY += (dy / dist) * boostAcc;
              
              const toPathX = pathPoint.x - shipX;
              const toPathY = pathPoint.y - shipY;
              shipVelX += toPathX * 0.003;
              shipVelY += toPathY * 0.003;
              
              shipVelX *= 0.94;
              shipVelY *= 0.94;
              
              shipX += shipVelX;
              shipY += shipVelY;
              
              const targetTilt = Math.atan2(shipVelY, shipVelX) * 180 / Math.PI + 90;
              shipTilt = lerpAngle(shipTilt, targetTilt, 0.12);
              
              shipThrust = 1.3;
              shipScale = 0.72;
              shipOpacity = lerp(shipOpacity, 1, 0.16);
              shipX += (Math.random() - 0.5) * 0.5;
              shipY += (Math.random() - 0.5) * 0.5;
              
            } else if (shipState === 'pull') {
              if (mDist < escapeThreshold) {
                shipState = 'escape';
                boostTimer = 70;
                showStatus("ESCAPE BOOST ACTIVATED!");
              } else if (mDist > gravityThreshold + 30 || !hasMouse) {
                shipState = 'idle';
              } else {
                const dx = localX - shipX;
                const dy = localY - shipY;
                const pullFactor = (1 - mDist / gravityThreshold);
                const pullStrength = isTablet ? 0.08 : 0.15;
                
                shipVelX += (dx / mDist) * pullFactor * pullStrength;
                shipVelY += (dy / mDist) * pullFactor * pullStrength;
                
                const toPathX = pathPoint.x - shipX;
                const toPathY = pathPoint.y - shipY;
                shipVelX += toPathX * 0.008;
                shipVelY += toPathY * 0.008;
                
                shipVelX *= 0.93;
                shipVelY *= 0.93;
                
                shipX += shipVelX;
                shipY += shipVelY;
                
                const targetTilt = Math.atan2(dy, dx) * 180 / Math.PI + 90;
                shipTilt = lerpAngle(shipTilt, targetTilt, 0.12);
                
                shipThrust = 0.4 + pullFactor * 0.65;
                shipScale = 0.68 + pullFactor * 0.06;
                shipOpacity = lerp(shipOpacity, 1, 0.12);
                shipX += (Math.random() - 0.5) * (pullFactor * 0.35);
                shipY += (Math.random() - 0.5) * (pullFactor * 0.35);
              }
              
            } else {
              if (hasMouse && mDist < gravityThreshold) {
                shipState = 'pull';
                showStatus("GRAVITY ZONE DETECTED");
              } else {
                const dx = pathPoint.x - shipX;
                const dy = pathPoint.y - shipY;
                
                const spring = 0.0075;
                const damp = 0.055;
                shipVelX += dx * spring - shipVelX * damp;
                shipVelY += dy * spring - shipVelY * damp;
                const cruise = Math.max(0.4, Math.min(1.8, Math.hypot(shipVelX, shipVelY)));
                shipVelX *= 0.985;
                shipVelY *= 0.985;
                
                shipX += shipVelX;
                shipY += shipVelY;
                
                const targetTilt = Math.atan2(shipVelY, shipVelX) * 180 / Math.PI + 90;
                shipTilt = lerpAngle(shipTilt, targetTilt, 0.09);
                
                shipThrust = 0.11 + Math.abs(Math.sin(now * 0.0012)) * 0.07;
                shipScale = 0.68;
                shipOpacity = lerp(shipOpacity, currentPath.fadeIn ? 1 : 0.96, currentPath.fadeIn ? 0.07 : 0.03);
                currentPath.fadeIn = false;
              }
            }

            if (nearEnd && !pastEnd) {
              const tailFade = clamp(1 - (currentPath.u - 0.86) / 0.14, 0, 1);
              shipOpacity = Math.min(shipOpacity, 0.72 + tailFade * 0.28);
            }
          }
        }
        
        // Spawn sparks in global sparks array
        const shipViewportX = shipX;
        const shipViewportY = shipY - window.scrollY;
        const tiltRad = (shipTilt * Math.PI) / 180;
        const tailDist = 26 * shipScale;
        const tailViewportX = shipViewportX - Math.sin(tiltRad) * tailDist;
        const tailViewportY = shipViewportY + Math.cos(tiltRad) * tailDist;
        
        let spawnSpark = false;
        let sparksToSpawn = 1;
        
        if (!isMobile) {
          if (shipState === 'escape' || shipState === 'mission') {
            spawnSpark = true;
            sparksToSpawn = 2;
          } else if (shipState === 'pull') {
            spawnSpark = Math.random() < 0.45;
          } else {
            spawnSpark = Math.random() < 0.15;
          }
        }
        
        if (spawnSpark) {
          const isBoost = (shipState === 'escape' || shipState === 'mission');
          const shootSpeed = isBoost ? 3.8 : 1.6;
          
          for (let k = 0; k < sparksToSpawn; k++) {
            const vx = Math.sin(tiltRad) * shootSpeed + (Math.random() - 0.5) * 0.9;
            const vy = -Math.cos(tiltRad) * shootSpeed + (Math.random() - 0.5) * 0.9;
            
            sparks.push({
              x: tailViewportX,
              y: tailViewportY,
              vx: vx,
              vy: vy,
              color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
              alpha: 1.0,
              size: Math.random() * 2.2 + (isBoost ? 2.2 : 1.4),
              decay: Math.random() * 0.024 + 0.016
            });
          }
        }
        
        // Update styling properties directly on space-companion element
        ship.style.setProperty("--ship-x", `${shipX.toFixed(2)}px`);
        ship.style.setProperty("--ship-y", `${shipY.toFixed(2)}px`);
        ship.style.setProperty("--ship-tilt", `${shipTilt.toFixed(2)}deg`);
        ship.style.setProperty("--ship-scale", `${shipScale.toFixed(3)}`);
        ship.style.setProperty("--ship-thrust", shipThrust.toFixed(3));
        ship.style.setProperty("--ship-opacity", shipOpacity.toFixed(3));
        ship.style.setProperty("--ship-glow", shipState === 'escape' || shipState === 'mission' ? '1' : (shipState === 'pull' ? '0.7' : '0.35'));
      }
      requestAnimationFrame(loopParallax);
    })();
  }

  /* ---------- hero fade/rise on scroll ---------- */
  if (stage && !reduceMotion) {
    window.addEventListener("scroll", () => {
      const p = Math.min(1, window.scrollY / window.innerHeight);
      stage.style.transform = `translateY(${-p * 120}px)`;
      stage.style.opacity = String(1 - p * 1.1);
      hero.style.opacity = String(1 - p * 0.6);
    }, { passive: true });
  }

  /* ---------- constellation starfield + gravity (merged) ----------
     Faint FAR stars (flat backdrop) + brighter NEAR stars that link to neighbours
     into drifting constellations. The cursor brightens/enlarges nearby stars and
     their lines (hover bloom); during a gravity boost every star is also pulled
     toward the cursor (mission feel) and the lines brighten with the pull. */
  /* ---------- full-screen fixed constellation background ---------- */
  const particleCanvas = document.getElementById("particle-canvas");
  const pCtx = particleCanvas ? particleCanvas.getContext("2d") : null;
  let pStars = [];
  let pWidth = window.innerWidth;
  let pHeight = window.innerHeight;

  function resizeParticleCanvas() {
    if (!particleCanvas) return;
    pWidth = window.innerWidth;
    pHeight = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    particleCanvas.width = pWidth * dpr;
    particleCanvas.height = pHeight * dpr;
    if (pCtx) pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let starCount = 80;
    if (pWidth <= 640) {
      starCount = 35;
    } else if (pWidth <= 1024) {
      starCount = 55;
    }

    pStars = [];
    for (let i = 0; i < starCount; i++) {
      pStars.push({
        x: Math.random() * pWidth,
        y: Math.random() * pHeight,
        radius: Math.random() * 0.9 + 0.6,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        alpha: Math.random() * 0.32 + 0.18,
        pulseSpeed: Math.random() * 0.015 + 0.005,
        pulseOffset: Math.random() * Math.PI * 2,
        k: Math.random() * 0.2 + 0.08
      });
    }
  }

  if (particleCanvas && !reduceMotion) {
    resizeParticleCanvas();
    window.addEventListener("resize", resizeParticleCanvas);

    (function drawConstellation() {
      const now = performance.now();
      if (!pCtx) return;
      pCtx.clearRect(0, 0, pWidth, pHeight);

      const isDark = document.documentElement.classList.contains("theme-dark");

      // Update and draw stars
      for (const s of pStars) {
        s.x += s.vx;
        s.y += s.vy;

        if (s.x < 0) s.x = pWidth;
        else if (s.x > pWidth) s.x = 0;
        if (s.y < 0) s.y = pHeight;
        else if (s.y > pHeight) s.y = 0;

        const parallaxX = cmx * s.k * 30;
        const parallaxY = cmy * s.k * 30;

        const dist = Math.hypot(s.x + parallaxX - cursorX, s.y + parallaxY - cursorY);
        let hoverGlow = 0;
        if (hasPointer && rawHX !== -9999 && dist < 120) {
          hoverGlow = Math.pow(1 - dist / 120, 2);
        }

        const pulseVal = Math.sin(now * s.pulseSpeed + s.pulseOffset) * 0.2 + 0.8;

        let finalAlpha = s.alpha * pulseVal + hoverGlow * 0.45;
        let finalRadius = s.radius * (0.8 + pulseVal * 0.2) + hoverGlow * 1.5;

        if (isDark) {
          finalAlpha *= 1.25;
          finalRadius *= 1.1;
        }
        finalAlpha = Math.min(finalAlpha, 0.9);

        pCtx.beginPath();
        pCtx.arc(s.x + parallaxX, s.y + parallaxY, finalRadius, 0, Math.PI * 2);
        pCtx.fillStyle = `rgba(90, 130, 255, ${finalAlpha})`;
        pCtx.fill();
      }

      // Draw connection lines
      const linkDist = 120;
      pCtx.lineWidth = 0.5;
      for (let i = 0; i < pStars.length; i++) {
        const s1 = pStars[i];
        const s1X = s1.x + cmx * s1.k * 30;
        const s1Y = s1.y + cmy * s1.k * 30;
        for (let j = i + 1; j < pStars.length; j++) {
          const s2 = pStars[j];
          const s2X = s2.x + cmx * s2.k * 30;
          const s2Y = s2.y + cmy * s2.k * 30;
          const dist = Math.hypot(s1X - s2X, s1Y - s2Y);
          if (dist < linkDist) {
            let opacity = (1 - dist / linkDist) * 0.08;
            if (hasPointer && rawHX !== -9999) {
              const m1 = Math.hypot(s1X - cursorX, s1Y - cursorY);
              const m2 = Math.hypot(s2X - cursorX, s2Y - cursorY);
              const mouseClose = Math.min(m1, m2);
              if (mouseClose < 100) {
                opacity += (1 - mouseClose / 100) * 0.10;
              }
            }

            if (isDark) opacity *= 1.3;
            opacity = Math.min(opacity, 0.22);

            pCtx.strokeStyle = `rgba(110, 140, 255, ${opacity})`;
            pCtx.beginPath();
            pCtx.moveTo(s1X, s1Y);
            pCtx.lineTo(s2X, s2Y);
            pCtx.stroke();
          }
        }
      }

      // Update and draw sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.alpha -= s.decay;
        s.size *= 0.96;
        if (s.alpha <= 0 || s.size < 0.2) {
          sparks.splice(i, 1);
          continue;
        }

        pCtx.beginPath();
        pCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        pCtx.fillStyle = s.color.replace("ALPHA", s.alpha.toFixed(2));
        pCtx.fill();
      }

      requestAnimationFrame(drawConstellation);
    })();
  }

  /* ---------- stacked-card deck engine ----------
     Desktop/tablet: scroll-driven depth. Each card eases up as it enters,
     then recedes (scale down + dim + blur + tilt) as the next card slides
     over it — a true premium "card deck" stack. Mobile: simple IO fade. */
  const cards = Array.from(document.querySelectorAll(".stack-card"));
  const skins = cards.map((c) => c.querySelector(".card-skin"));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const deckActive = () => window.matchMedia("(min-width: 641px)").matches && !reduceMotion;

  function updateDeck() {
    const vh = window.innerHeight;
    const motionScale = document.querySelector(".deck[data-deck-motion='staggered']") ? 1.18 : 1;
    // pass 1: read every untransformed section rect (sections pin at top:0)
    const rects = cards.map((c) => c.getBoundingClientRect());
    const tops = rects.map((r) => r.top);
    // pass 2: write transforms onto the inner card skins
    for (let i = 0; i < cards.length; i++) {
      const skin = skins[i];
      const thisH = rects[i].height || vh;

      // A card TALLER than the viewport leaves the screen by scrolling through,
      // not by being covered in place. The cover-fade/recede would make it vanish
      // while it's still on screen (the empty gap above the next section), so such
      // cards scroll normally at full opacity — no fade, no recede, no blur.
      // (Short cards below keep the full deck stacking + gentle blur.)
      if (thisH > vh + 24) {
        cards[i].style.position = "relative";
        skin.style.transform = "";
        skin.style.opacity = "";
        skin.style.filter = "";
        continue;
      }
      cards[i].style.position = "";   // restore CSS sticky for normal-height cards

      // entrance: 0 a viewport below → 1 once the section reaches the top (pinned)
      const enter = easeOut(clamp((vh - tops[i]) / vh, 0, 1));
      // cover: how far the NEXT section has risen up over this one (0 → 1 = fully covered).
      // normalize by THIS card's height so a freshly-pinned card reads as crisp (cover 0)
      // now that cards are content-height and can be shorter than the viewport.
      // raw linear progress of the next card covering this one (0 → 1)
      const coverRaw = i < cards.length - 1 ? clamp((thisH - tops[i + 1]) / vh, 0, 1) : 0;
      const cover = easeOut(coverRaw);   // eased — used for the depth feel (scale / tilt / blur)

      // rise in, then recede behind the incoming card — the "deck" depth
      const scale = (0.94 + 0.06 * enter) * (1 - 0.12 * cover);
      const ty = ((1 - enter) * 44 - cover * 34) * motionScale;
      const rx = cover * 6;                       // tilt back into the stack
      // opacity fades on the RAW (linear) progress so the card disappears slowly &
      // steadily as you scroll to the next section — reaching 0 only once fully
      // covered, instead of dropping out fast/early
      const opacity = (0.4 + 0.6 * enter) * (1 - coverRaw);

      // blur builds slowly & gently: holds sharp through the early part of the cover,
      // then eases IN (quadratic) so it ramps up gradually instead of snapping fast
      const bt = clamp((cover - 0.3) / 0.7, 0, 1);
      const coverBlur = bt * bt;   // ease-in = stays low longer, then a gentle build

      skin.style.transform =
        `translateY(${ty.toFixed(2)}px) scale(${scale.toFixed(4)}) rotateX(${rx.toFixed(2)}deg)`;
      skin.style.opacity = opacity.toFixed(3);
      skin.style.filter = coverBlur > 0.004 ? `blur(${(coverBlur * 7).toFixed(2)}px) brightness(${(1 - coverBlur * 0.16).toFixed(3)})` : "none";
    }
  }

  function resetDeck() {
    cards.forEach((c) => { c.style.position = ""; });
    skins.forEach((s) => { s.style.transform = ""; s.style.opacity = ""; s.style.filter = ""; });
  }

  function onDeckScroll() {
    if (deckActive()) updateDeck();
  }

  if (deckActive()) updateDeck();
  window.addEventListener("scroll", onDeckScroll, { passive: true });
  window.addEventListener("resize", () => { if (deckActive()) updateDeck(); else resetDeck(); });

  // mobile fallback: simple fade-in reveal
  const cardIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("in"); });
  }, { threshold: 0.18 });
  cards.forEach((c) => cardIO.observe(c));

  /* ---------- orbit journey scroll system ---------- */
  const orbitJourney = document.getElementById("orbit-journey");
  if (orbitJourney) {
    const orbitRoute = orbitJourney.querySelector(".orbit-route");
    const orbitTraveler = orbitJourney.querySelector("#orbitTraveler");
    const orbitPlanets = Array.from(orbitJourney.querySelectorAll(".orbit-planet"));
    const orbitCards = Array.from(orbitJourney.querySelectorAll(".orbit-card"));
    const orbitDesktop = () => window.matchMedia("(min-width: 981px)").matches && !reduceMotion;
    let orbitActive = -1;
    let orbitTargetProgress = 0;
    let orbitSmoothProgress = 0;
    let orbitRaf = 0;

    const orbitEase = (t) => {
      const p = clamp(t, 0, 1);
      return p * p * (3 - 2 * p);
    };

    const mix = (a, b, t) => a + (b - a) * t;

    function setOrbitActive(nextIndex) {
      if (nextIndex === orbitActive) return;
      if (orbitActive >= 0) {
        orbitCards[orbitActive]?.classList.add("is-leaving");
        window.setTimeout(() => orbitCards[orbitActive]?.classList.remove("is-leaving"), 420);
      }
      orbitActive = nextIndex;
      orbitPlanets.forEach((planet, index) => planet.classList.toggle("is-active", index === orbitActive));
      orbitCards.forEach((card, index) => card.classList.toggle("is-active", index === orbitActive));
    }

    function positionPlanet(planet, index, progress) {
      const count = Math.max(1, orbitPlanets.length);
      const segment = 1 / count;
      const start = index * segment;
      const end = start + segment;
      const prewarm = clamp((progress - start + 0.08) / 0.08, 0, 1);
      let x = 0;
      let y = 180;
      let scale = 0.42 + prewarm * 0.16;
      let opacity = prewarm * 0.34;
      let rotate = progress * 420 + index * 23;
      let z = 4;
      let state = "waiting";

      const doneSlotX = -190 + index * 48;
      const doneSlotY = -150 + index * 34;

      if (progress >= start && progress <= end) {
        const local = clamp((progress - start) / segment, 0, 1);
        const orbitPart = clamp(local / 0.78, 0, 1);
        const exitPart = orbitEase(clamp((local - 0.72) / 0.28, 0, 1));
        const angle = Math.PI / 2 - orbitPart * Math.PI * 2.45;
        const radiusX = 145 + index * 10;
        const radiusY = 76 + index * 5;
        const orbitX = Math.cos(angle) * radiusX;
        const orbitY = Math.sin(angle) * radiusY;
        x = mix(orbitX, doneSlotX, exitPart);
        y = mix(orbitY, doneSlotY, exitPart);
        scale = mix(0.92 + Math.sin(orbitPart * Math.PI) * 0.18, 0.62, exitPart);
        opacity = 1;
        rotate = progress * 920 + index * 35;
        z = 10;
        state = "active";
      } else if (progress > end) {
        const drift = progress * Math.PI * 10 + index * 1.4;
        x = doneSlotX + Math.cos(drift) * 16;
        y = doneSlotY + Math.sin(drift * 0.86) * 9;
        scale = 0.58;
        opacity = 0.58;
        rotate = progress * 520 + index * 41;
        z = 6 + index;
        state = "done";
      }

      planet.classList.toggle("is-done", state === "done");
      planet.classList.toggle("is-waiting", state === "waiting");
      planet.style.setProperty("--planet-x", `${x.toFixed(2)}px`);
      planet.style.setProperty("--planet-y-pos", `${y.toFixed(2)}px`);
      planet.style.setProperty("--planet-scale", scale.toFixed(3));
      planet.style.setProperty("--planet-opacity", opacity.toFixed(3));
      planet.style.setProperty("--planet-rotate", `${rotate.toFixed(2)}deg`);
      planet.style.setProperty("--planet-z", z);
    }

    function renderOrbitJourney(progress) {
      if (!orbitDesktop()) {
        orbitPlanets.forEach((planet, index) => {
          planet.classList.toggle("is-active", index === 0);
          planet.classList.remove("is-done", "is-waiting");
          planet.removeAttribute("style");
        });
        orbitCards.forEach((card, index) => card.classList.toggle("is-active", index === 0));
        return;
      }

      const activeIndex = clamp(Math.floor(progress * orbitPlanets.length), 0, orbitPlanets.length - 1);
      setOrbitActive(activeIndex);

      orbitPlanets.forEach((planet, index) => positionPlanet(planet, index, progress));
      if (orbitRoute) orbitRoute.style.setProperty("--orbit-spin", `${(progress * 860).toFixed(2)}deg`);
      if (orbitTraveler) orbitTraveler.style.setProperty("--orbit-spin", `${(progress * 520).toFixed(2)}deg`);
    }

    function animateOrbitJourney() {
      orbitRaf = 0;
      orbitSmoothProgress += (orbitTargetProgress - orbitSmoothProgress) * 0.2;
      if (Math.abs(orbitTargetProgress - orbitSmoothProgress) < 0.0008) {
        orbitSmoothProgress = orbitTargetProgress;
      }

      renderOrbitJourney(orbitSmoothProgress);

      if (Math.abs(orbitTargetProgress - orbitSmoothProgress) > 0.0008) {
        orbitRaf = window.requestAnimationFrame(animateOrbitJourney);
      }
    }

    function updateOrbitJourney() {
      if (!orbitDesktop()) {
        renderOrbitJourney(0);
        return;
      }

      const rect = orbitJourney.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      orbitTargetProgress = clamp(-rect.top / travel, 0, 1);
      if (!orbitRaf) orbitRaf = window.requestAnimationFrame(animateOrbitJourney);
    }

    orbitPlanets.forEach((planet, index) => {
      planet.addEventListener("mouseenter", () => planet.classList.add("is-hovered"));
      planet.addEventListener("mouseleave", () => planet.classList.remove("is-hovered"));
      planet.addEventListener("focus", () => setOrbitActive(index));
    });

    if (!isTouch && !reduceMotion) {
      orbitCards.forEach((card) => {
        card.addEventListener("pointermove", (event) => {
          if (!card.classList.contains("is-active")) return;
          const rect = card.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          card.style.setProperty("--orbit-tilt-x", `${(px * 7).toFixed(2)}deg`);
          card.style.setProperty("--orbit-tilt-y", `${(-py * 6).toFixed(2)}deg`);
        });
        card.addEventListener("pointerleave", () => {
          card.style.setProperty("--orbit-tilt-x", "0deg");
          card.style.setProperty("--orbit-tilt-y", "0deg");
        });
      });
    }

    updateOrbitJourney();
    window.addEventListener("scroll", updateOrbitJourney, { passive: true });
    window.addEventListener("resize", updateOrbitJourney);
  }

  /* ---------- selected work scroll-linked reveal ---------- */
  const workSection = document.getElementById("projects");
  if (workSection) {
    const workCards = Array.from(workSection.querySelectorAll(".work-track .project"));
    const workRail = workSection.querySelector(".work-rail");
    const workCta = workSection.querySelector(".work-cta");
    const revealEase = (t) => {
      const p = clamp(t, 0, 1);
      return p * p * (3 - 2 * p);
    };
    let targetCardProgress = 0;
    let targetCtaProgress = 0;
    let currentCardProgress = 0;
    let currentCtaProgress = 0;
    let workSmoothRaf = 0;

    function setWorkItem(el, progress, distance, varPrefix) {
      const eased = revealEase(progress);
      el.style.setProperty(`--${varPrefix}-opacity`, eased.toFixed(3));
      el.style.setProperty(`--${varPrefix}-x`, `${(distance * (1 - eased)).toFixed(2)}px`);
    }

    function measureWorkReveal() {
      const vh = window.innerHeight || 1;
      const railTop = workRail ? workRail.getBoundingClientRect().top : workSection.getBoundingClientRect().top;
      targetCardProgress = clamp((vh * 1.08 - railTop) / (vh * 0.82), 0, 1);

      if (workCta) {
        const ctaTop = workCta.getBoundingClientRect().top;
        targetCtaProgress = clamp((vh * 1.04 - ctaTop) / (vh * 0.7), 0, 1);
      } else {
        targetCtaProgress = 1;
      }
    }

    function renderWorkReveal(cardProgress, ctaProgress) {
      workCards.forEach((card, index) => {
        const local = (cardProgress - index * 0.055) / 0.55;
        setWorkItem(card, local, -220, "work-card");
      });

      if (workCta) {
        setWorkItem(workCta, ctaProgress, 220, "work-cta");
      }

      workSection.classList.toggle("is-work-settled", cardProgress >= 0.995 && ctaProgress >= 0.995);
    }

    function smoothWorkReveal() {
      workSmoothRaf = 0;
      currentCardProgress += (targetCardProgress - currentCardProgress) * 0.08;
      currentCtaProgress += (targetCtaProgress - currentCtaProgress) * 0.08;

      if (Math.abs(targetCardProgress - currentCardProgress) < 0.001) currentCardProgress = targetCardProgress;
      if (Math.abs(targetCtaProgress - currentCtaProgress) < 0.001) currentCtaProgress = targetCtaProgress;

      renderWorkReveal(currentCardProgress, currentCtaProgress);

      if (
        Math.abs(targetCardProgress - currentCardProgress) > 0.001 ||
        Math.abs(targetCtaProgress - currentCtaProgress) > 0.001
      ) {
        workSmoothRaf = window.requestAnimationFrame(smoothWorkReveal);
      }
    }

    function updateWorkReveal() {
      measureWorkReveal();
      if (!workSmoothRaf) workSmoothRaf = window.requestAnimationFrame(smoothWorkReveal);
    }

    if (reduceMotion) {
      workSection.classList.add("is-work-settled");
      workCards.forEach((card) => setWorkItem(card, 1, -220, "work-card"));
      if (workCta) setWorkItem(workCta, 1, 220, "work-cta");
    } else {
      measureWorkReveal();
      currentCardProgress = targetCardProgress;
      currentCtaProgress = targetCtaProgress;
      renderWorkReveal(currentCardProgress, currentCtaProgress);
      window.addEventListener("scroll", updateWorkReveal, { passive: true });
      window.addEventListener("resize", updateWorkReveal);
    }
  }

  /* ---------- timeline dots light as they enter ---------- */
  const items = document.querySelectorAll(".t-item");
  const tIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("lit"); });
  }, { threshold: 0.6, rootMargin: "0px 0px -10% 0px" });
  items.forEach((i) => tIO.observe(i));

  /* ---------- stagger skill pills & socials ---------- */
  document.querySelectorAll(".pill").forEach((p, i) => p.style.setProperty("--pi", i % 6));
  document.querySelectorAll(".social").forEach((s, i) => s.style.setProperty("--si", i));

  /* ---------- project card hover tilt ---------- */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll(".project").forEach((card) => {
      const hue = card.dataset.hue || "265";
      card.style.setProperty("--hue", hue);
      card.addEventListener("pointermove", (e) => {
        const workParent = card.closest(".work");
        if (workParent && !workParent.classList.contains("is-work-settled")) return;
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          `perspective(700px) rotateY(${px * 9}deg) rotateX(${-py * 9}deg) translateY(-6px)`;
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    });
  } else {
    document.querySelectorAll(".project").forEach((card) => card.style.setProperty("--hue", card.dataset.hue || "265"));
  }

  /* ---------- smooth anchor focus (a11y) ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (id.length > 1) {
        const el = document.querySelector(id);
        if (el) { e.preventDefault(); el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }
      }
    });
  });
})();
