    // Background generation
    // -------------------------------------------------------------------------
    /**
     * Handles the generateBackgroundDetails operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function generateBackgroundDetails() {
        backgroundPanels.length = 0;
        backgroundStars.length = 0;

        for (let i = 0; i < 95; i++) {
            backgroundPanels.push({
                x: Math.random() * WORLD.width,
                y: Math.random() * WORLD.height,
                w: randomRange(90, 320),
                h: randomRange(50, 200),
                glow: Math.random(),
                phase: randomRange(0, TWO_PI),
            });
        }

        for (let i = 0; i < 360; i++) {
            backgroundStars.push({
                x: Math.random() * WORLD.width,
                y: Math.random() * WORLD.height,
                r: randomRange(0.6, 2.4),
                alpha: randomRange(0.15, 0.6),
                phase: randomRange(0, TWO_PI),
            });
        }

        // The arena's largest background structures are fragments of a dormant
        // command chassis. Across each 20-wave chapter they converge until the
        // giga-boss reveals that the scenery was part of its body all along.
        backgroundBossFragments.length = 0;
        const targetLayout = [
            { x: -250, y: -120, w: 190, h: 54, rotation: -0.32 },
            { x: 250, y: -120, w: 190, h: 54, rotation: 0.32 },
            { x: -315, y: 0, w: 175, h: 48, rotation: -0.08 },
            { x: 315, y: 0, w: 175, h: 48, rotation: 0.08 },
            { x: -245, y: 125, w: 185, h: 50, rotation: 0.28 },
            { x: 245, y: 125, w: 185, h: 50, rotation: -0.28 },
            { x: -105, y: -205, w: 84, h: 180, rotation: -0.12 },
            { x: 105, y: -205, w: 84, h: 180, rotation: 0.12 },
            { x: -105, y: 205, w: 84, h: 180, rotation: 0.12 },
            { x: 105, y: 205, w: 84, h: 180, rotation: -0.12 },
            { x: 0, y: -300, w: 120, h: 100, rotation: 0 },
            { x: 0, y: 300, w: 120, h: 100, rotation: Math.PI },
        ];

        targetLayout.forEach((target, index) => {
            const angle = (index / targetLayout.length) * TWO_PI + randomRange(-0.24, 0.24);
            const distanceFromCenter = randomRange(900, 1550);
            backgroundBossFragments.push({
                startX: WORLD.width * 0.5 + Math.cos(angle) * distanceFromCenter,
                startY: WORLD.height * 0.5 + Math.sin(angle) * distanceFromCenter,
                startRotation: randomRange(-Math.PI, Math.PI),
                targetX: target.x,
                targetY: target.y,
                targetRotation: target.rotation,
                w: target.w,
                h: target.h,
                phase: randomRange(0, TWO_PI),
            });
        });
    }

    // -------------------------------------------------------------------------
    // Drawing helpers
    // -------------------------------------------------------------------------
    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCircle(context, x, y, radius, fillStyle) {
        context.fillStyle = fillStyle;
        context.beginPath();
        context.arc(x, y, radius, 0, TWO_PI);
        context.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawSciFiBackground() {
        // drawGame() applies CAMERA_ZOOM before this function. Therefore every
        // screen-filling background primitive must use logical visible-world
        // dimensions, not raw canvas pixels. Using canvas.width here would fill
        // only CAMERA_ZOOM of the physical screen and produce a lighter block in
        // the top-left on mobile.
        const viewWidth = getVisibleWorldWidth();
        const viewHeight = getVisibleWorldHeight();
        const gradient = ctx.createRadialGradient(
            viewWidth / 2,
            viewHeight / 2,
            80,
            viewWidth / 2,
            viewHeight / 2,
            Math.max(viewWidth, viewHeight) * 0.75
        );

        const backgroundHue = getBackgroundHue();
        gradient.addColorStop(0, `hsl(${backgroundHue}, 42%, 15%)`);
        gradient.addColorStop(0.55, `hsl(${(backgroundHue + 18) % 360}, 34%, 9%)`);
        gradient.addColorStop(1, `hsl(${(backgroundHue + 34) % 360}, 28%, 4%)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewWidth, viewHeight);

        drawBackgroundAurora(backgroundHue);
        drawBackgroundStars(backgroundHue);
        drawBackgroundGrid();
        drawBackgroundPanels();
        drawBackgroundBossAssembly();
        drawWorldBounds();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function getBackgroundHue() {
        const chapterProgress = getBackgroundRevealProgress();
        const chapterIndex = Math.floor((Math.max(1, state.wave) - 1) / 20);
        const timeDrift = (performance.now() / 1000) * 0.7;
        return (202 + chapterProgress * 82 + chapterIndex * 31 + timeDrift) % 360;
    }

    function drawBackgroundAurora(hue) {
        const viewWidth = getVisibleWorldWidth();
        const viewHeight = getVisibleWorldHeight();
        const now = performance.now();
        const pulse = 0.5 + 0.5 * Math.sin(now / 2400);
        const centerX = viewWidth * (0.5 + Math.sin(now / 7000) * 0.08);
        const centerY = viewHeight * (0.5 + Math.cos(now / 8200) * 0.07);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
            const radius = Math.max(viewWidth, viewHeight) * (0.24 + i * 0.15 + pulse * 0.015);
            const aurora = ctx.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius);
            aurora.addColorStop(0, `hsla(${(hue + i * 28) % 360}, 85%, 58%, ${0.028 - i * 0.005})`);
            aurora.addColorStop(0.58, `hsla(${(hue + 42 + i * 20) % 360}, 78%, 48%, ${0.014 - i * 0.002})`);
            aurora.addColorStop(1, `hsla(${hue}, 70%, 30%, 0)`);
            ctx.fillStyle = aurora;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, TWO_PI);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawBackgroundStars(hue) {
        const now = performance.now();
        for (const star of backgroundStars) {
            if (!isInView(star, 10)) continue;
            const screen = worldToScreen(star);
            const twinkle = 0.72 + Math.sin(now / 520 + star.phase) * 0.28;
            drawCircle(ctx, screen.x, screen.y, star.r * (0.9 + twinkle * 0.12), `hsla(${(hue + 18) % 360}, 85%, 78%, ${star.alpha * twinkle})`);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBackgroundGrid() {
        const gridSize = 120;
        const startX = Math.floor(camera.x / gridSize) * gridSize;
        const startY = Math.floor(camera.y / gridSize) * gridSize;

        const hue = getBackgroundHue();
        const pulse = 0.09 + (0.025 * (0.5 + 0.5 * Math.sin(performance.now() / 1700)));
        ctx.strokeStyle = `hsla(${hue}, 82%, 68%, ${pulse})`;
        ctx.lineWidth = 1;

        for (let x = startX; x <= camera.x + getVisibleWorldWidth() + gridSize; x += gridSize) {
            const sx = x - camera.x;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, getVisibleWorldHeight());
            ctx.stroke();
        }

        for (let y = startY; y <= camera.y + getVisibleWorldHeight() + gridSize; y += gridSize) {
            const sy = y - camera.y;
            ctx.beginPath();
            ctx.moveTo(0, sy);
            ctx.lineTo(getVisibleWorldWidth(), sy);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBackgroundPanels() {
        for (const panel of backgroundPanels) {
            const screen = worldToScreen(panel);
            if (screen.x + panel.w < -50 || screen.x > getVisibleWorldWidth() + 50 || screen.y + panel.h < -50 || screen.y > getVisibleWorldHeight() + 50) continue;

            const revealFade = 1 - getBackgroundRevealProgress() * 0.48;
            const hue = getBackgroundHue();
            const shimmer = 0.82 + Math.sin(performance.now() / 1100 + panel.phase) * 0.18;
            ctx.fillStyle = `hsla(${(hue + 8) % 360}, 58%, 27%, ${(0.10 + panel.glow * 0.07) * revealFade * shimmer})`;
            ctx.fillRect(screen.x, screen.y, panel.w, panel.h);

            ctx.strokeStyle = `hsla(${hue}, 88%, 70%, ${(0.13 + panel.glow * 0.15) * revealFade * shimmer})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(screen.x, screen.y, panel.w, panel.h);

            ctx.strokeStyle = `hsla(${(hue + 46) % 360}, 90%, 72%, ${(0.08 + panel.glow * 0.09) * revealFade * shimmer})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(screen.x + 12, screen.y + panel.h * 0.5);
            ctx.lineTo(screen.x + panel.w - 12, screen.y + panel.h * 0.5);
            ctx.moveTo(screen.x + panel.w * 0.5, screen.y + 12);
            ctx.lineTo(screen.x + panel.w * 0.5, screen.y + panel.h - 12);
            ctx.stroke();
        }
    }

    function getBackgroundRevealProgress() {
        // Every twenty waves form one visual chapter. Wave 1 begins scattered;
        // wave 20 is the complete boss reveal. Endless play starts a new cycle.
        const chapterWave = ((Math.max(1, state.wave) - 1) % 20) + 1;
        return clamp((chapterWave - 1) / 19, 0, 1);
    }

    function smoothReveal(value) {
        return value * value * (3 - 2 * value);
    }

    function drawBackgroundBossAssembly() {
        if (!backgroundBossFragments.length) return;

        const progress = smoothReveal(getBackgroundRevealProgress());
        const finalBoss = enemies.find(enemy => enemy && !enemy.dead && enemy.type === "gigaBoss");
        const anchor = finalBoss
            ? { x: finalBoss.x, y: finalBoss.y }
            : { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
        const now = performance.now();
        const hue = 202 + progress * 82;
        const screenAnchor = worldToScreen(anchor);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        // A faint central silhouette becomes readable only near the reveal.
        if (progress > 0.68) {
            const silhouetteAlpha = (progress - 0.68) / 0.32;
            const pulse = 0.88 + Math.sin(now / 520) * 0.08;
            const coreRadius = 82 + progress * 42;
            const coreGradient = ctx.createRadialGradient(
                screenAnchor.x, screenAnchor.y, 8,
                screenAnchor.x, screenAnchor.y, coreRadius * 1.7
            );
            coreGradient.addColorStop(0, `hsla(${hue}, 95%, 72%, ${0.14 * silhouetteAlpha})`);
            coreGradient.addColorStop(0.45, `hsla(${hue + 24}, 88%, 50%, ${0.07 * silhouetteAlpha})`);
            coreGradient.addColorStop(1, `hsla(${hue + 40}, 80%, 30%, 0)`);
            ctx.fillStyle = coreGradient;
            ctx.beginPath();
            ctx.arc(screenAnchor.x, screenAnchor.y, coreRadius * 1.7 * pulse, 0, TWO_PI);
            ctx.fill();

            ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.15 * silhouetteAlpha})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(screenAnchor.x, screenAnchor.y, coreRadius, now / 2400, now / 2400 + Math.PI * 1.55);
            ctx.stroke();
        }

        for (const fragment of backgroundBossFragments) {
            const x = fragment.startX + (anchor.x + fragment.targetX - fragment.startX) * progress;
            const y = fragment.startY + (anchor.y + fragment.targetY - fragment.startY) * progress;
            const rotation = fragment.startRotation + (fragment.targetRotation - fragment.startRotation) * progress;
            const screen = worldToScreen({ x, y });
            if (screen.x < -420 || screen.x > getVisibleWorldWidth() + 420 || screen.y < -420 || screen.y > getVisibleWorldHeight() + 420) continue;

            const wake = Math.sin(now / 620 + fragment.phase) * (1 - progress) * 8;
            const alpha = 0.12 + progress * 0.34;
            ctx.save();
            ctx.translate(screen.x, screen.y + wake);
            ctx.rotate(rotation);

            const panelGradient = ctx.createLinearGradient(-fragment.w / 2, 0, fragment.w / 2, 0);
            panelGradient.addColorStop(0, `hsla(${hue + 18}, 70%, 22%, ${alpha * 0.45})`);
            panelGradient.addColorStop(0.5, `hsla(${hue}, 76%, 38%, ${alpha})`);
            panelGradient.addColorStop(1, `hsla(${hue + 38}, 72%, 20%, ${alpha * 0.5})`);
            ctx.fillStyle = panelGradient;
            ctx.strokeStyle = `hsla(${hue}, 96%, 72%, ${0.18 + progress * 0.48})`;
            ctx.lineWidth = 2 + progress * 1.5;

            ctx.beginPath();
            ctx.moveTo(-fragment.w * 0.5, -fragment.h * 0.22);
            ctx.lineTo(-fragment.w * 0.34, -fragment.h * 0.5);
            ctx.lineTo(fragment.w * 0.36, -fragment.h * 0.42);
            ctx.lineTo(fragment.w * 0.5, 0);
            ctx.lineTo(fragment.w * 0.34, fragment.h * 0.5);
            ctx.lineTo(-fragment.w * 0.38, fragment.h * 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = `hsla(${hue + 38}, 100%, 78%, ${0.12 + progress * 0.34})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-fragment.w * 0.32, 0);
            ctx.lineTo(fragment.w * 0.32, 0);
            ctx.moveTo(0, -fragment.h * 0.3);
            ctx.lineTo(0, fragment.h * 0.3);
            ctx.stroke();
            ctx.restore();
        }

        // At the final boss, energy braces reveal that every fragment is linked
        // to the enemy core rather than being unrelated arena decoration.
        if (progress > 0.84) {
            const linkAlpha = (progress - 0.84) / 0.16;
            ctx.strokeStyle = `hsla(${hue + 20}, 100%, 76%, ${0.08 + linkAlpha * 0.18})`;
            ctx.lineWidth = 1.5;
            for (const fragment of backgroundBossFragments) {
                const x = fragment.startX + (anchor.x + fragment.targetX - fragment.startX) * progress;
                const y = fragment.startY + (anchor.y + fragment.targetY - fragment.startY) * progress;
                const screen = worldToScreen({ x, y });
                ctx.beginPath();
                ctx.moveTo(screenAnchor.x, screenAnchor.y);
                ctx.lineTo(screen.x, screen.y);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawWorldBounds() {
        const screen = worldToScreen({ x: 0, y: 0 });

        ctx.strokeStyle = "rgba(255, 90, 90, 0.6)";
        ctx.lineWidth = 6;
        ctx.strokeRect(screen.x, screen.y, WORLD.width, WORLD.height);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(screen.x + 8, screen.y + 8, WORLD.width - 16, WORLD.height - 16);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawShipShadow(radius) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
        ctx.beginPath();
        ctx.ellipse(-2, 5, radius * 1.15, radius * 0.62, 0, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEngineFlame(x, y, size, color = "rgba(99, 215, 255, 0.75)") {
        const flicker = 0.8 + Math.sin(Date.now() / 75 + x * 2) * 0.22;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - size * flicker, y - size * 0.36);
        ctx.lineTo(x - size * 1.45 * flicker, y);
        ctx.lineTo(x - size * flicker, y + size * 0.36);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawThrusterPair(radius, color) {
        drawEngineFlame(-radius * 0.82, -radius * 0.36, radius * 0.55, color);
        drawEngineFlame(-radius * 0.82, radius * 0.36, radius * 0.55, color);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    /**
     * Draws permanent visual hardware earned through Ship Reconstruction.
     *
     * IMPORTANT:
     * - These decorations are presentation-only and never change collision size.
     * - Investment is clamped for visual readability so extreme endless builds
     *   do not grow beyond the player sprite.
     * - Relic stages add a small extra flourish after awakening.
     */
    function drawShipResearchHardware(radius, now) {
        const green = Math.min(12, getSystemInvestment("green"));
        const red = Math.min(12, getSystemInvestment("red"));
        const blue = Math.min(12, getSystemInvestment("blue"));
        const purple = Math.min(12, getSystemInvestment("purple"));

        // Weapon AI: a forward cannon that gains length, width, rails, and a hot core.
        if (red > 0) {
            const length = radius * (0.5 + red * 0.075);
            const width = 2.6 + red * 0.24;
            ctx.save();
            ctx.strokeStyle = "rgba(255,122,102,0.96)";
            ctx.fillStyle = "rgba(76,24,28,0.95)";
            ctx.lineWidth = 1.2;
            ctx.fillRect(radius * 0.42, -width / 2, length, width);
            ctx.strokeRect(radius * 0.42, -width / 2, length, width);
            if (red >= 3) {
                ctx.fillStyle = "rgba(255,210,180,0.9)";
                ctx.fillRect(radius * 0.62, -width * 0.18, length * 0.72, width * 0.36);
            }
            if (red >= 6) {
                ctx.strokeStyle = "rgba(255,105,82,0.9)";
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(radius * 0.48, -width * 0.8);
                ctx.lineTo(radius * 0.48 + length * 0.92, -width * 0.8);
                ctx.moveTo(radius * 0.48, width * 0.8);
                ctx.lineTo(radius * 0.48 + length * 0.92, width * 0.8);
                ctx.stroke();
            }
            if (red >= 9) {
                const pulse = 0.55 + Math.sin(now / 90) * 0.25;
                ctx.fillStyle = `rgba(255,238,215,${pulse})`;
                ctx.beginPath();
                ctx.arc(radius * 0.48 + length, 0, 2.5 + red * 0.08, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Nanobots: layered green armor plates and repair nodes around the hull.
        if (green > 0) {
            const plateScale = 0.72 + green * 0.022;
            ctx.save();
            ctx.strokeStyle = `rgba(92,255,148,${0.38 + green * 0.025})`;
            ctx.lineWidth = 1.5 + green * 0.08;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(-radius * 0.55, side * radius * 0.34);
                ctx.lineTo(-radius * 0.9 * plateScale, side * radius * 0.82);
                ctx.lineTo(radius * 0.02, side * radius * 0.58);
                ctx.stroke();
            }
            const nodeCount = Math.min(4, 1 + Math.floor(green / 3));
            ctx.fillStyle = "rgba(89,255,150,0.92)";
            for (let i = 0; i < nodeCount; i++) {
                const y = (i - (nodeCount - 1) / 2) * radius * 0.34;
                ctx.beginPath();
                ctx.arc(-radius * 0.28, y, 1.8 + green * 0.05, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Anti-gravity: larger stabilizer fins and brighter secondary thrusters.
        if (blue > 0) {
            const fin = radius * (0.34 + blue * 0.025);
            ctx.save();
            ctx.fillStyle = "rgba(72,174,230,0.5)";
            ctx.strokeStyle = "rgba(104,222,255,0.9)";
            ctx.lineWidth = 1.2;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(-radius * 0.34, side * radius * 0.54);
                ctx.lineTo(-radius * 0.88, side * (radius * 0.54 + fin));
                ctx.lineTo(radius * 0.06, side * radius * 0.68);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            if (blue >= 3) {
                const glow = 0.45 + Math.sin(now / 110) * 0.18;
                ctx.fillStyle = `rgba(105,226,255,${glow})`;
                ctx.beginPath();
                ctx.arc(-radius * 0.9, -radius * 0.35, 2 + blue * 0.12, 0, TWO_PI);
                ctx.arc(-radius * 0.9, radius * 0.35, 2 + blue * 0.12, 0, TWO_PI);
                ctx.fill();
            }
            ctx.restore();
        }

        // Quantum: floating processor nodes orbit just outside the hull.
        if (purple > 0) {
            const count = Math.min(4, 1 + Math.floor(purple / 3));
            const orbit = radius * (1.16 + purple * 0.012);
            ctx.save();
            for (let i = 0; i < count; i++) {
                const a = now / (720 - purple * 18) + i * TWO_PI / count;
                const x = Math.cos(a) * orbit;
                const y = Math.sin(a) * orbit * 0.68;
                ctx.fillStyle = "rgba(196,123,255,0.9)";
                ctx.strokeStyle = "rgba(244,220,255,0.95)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x, y, 2.5 + purple * 0.07, 0, TWO_PI);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function drawPlayerShip(angle, screen) {
        const radius = player.r;
        const moving = keysHeld.w || keysHeld.a || keysHeld.s || keysHeld.d || keysHeld.arrowup || keysHeld.arrowleft || keysHeld.arrowdown || keysHeld.arrowright || Math.hypot(analogInput.moveX, analogInput.moveY) > 0.08;
        const flameColor = moving ? "rgba(99, 215, 255, 0.96)" : "rgba(99, 215, 255, 0.58)";

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(angle);
        drawShipShadow(radius);
        drawThrusterPair(radius, flameColor);

        const now = Date.now();
        const speedActive = now < player.speedBoostUntil;
        const slowActive = now < player.slowUntil;
        const healthFlash = now < player.healthFlashUntil;
        const damageFlash = now < player.damageFlashUntil;
        const pulse = 0.5 + 0.5 * Math.sin(now / 85);

        let hullColor = "#6aa9ff";
        if (speedActive) hullColor = "#27bfff";
        if (healthFlash) hullColor = "#36ff7a";
        if (damageFlash) hullColor = "#ff3d3d";

        if (slowActive) {
            ctx.shadowColor = "#b36bff";
            ctx.shadowBlur = 18 + pulse * 12;
            ctx.strokeStyle = `rgba(179,107,255,${0.55 + pulse * 0.35})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.55, 0, TWO_PI);
            ctx.stroke();
        }

        if (speedActive) {
            ctx.shadowColor = "#63d7ff";
            ctx.shadowBlur = 20 + pulse * 16;
        } else if (healthFlash) {
            ctx.shadowColor = "#36ff7a";
            ctx.shadowBlur = 24 + pulse * 12;
        } else if (damageFlash) {
            ctx.shadowColor = "#ff3030";
            ctx.shadowBlur = 24 + pulse * 14;
        }

        ctx.fillStyle = hullColor;
        ctx.strokeStyle = "rgba(220, 245, 255, 0.88)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.55, 0);
        ctx.lineTo(radius * 0.22, -radius * 0.68);
        ctx.lineTo(-radius * 0.92, -radius * 1.02);
        ctx.lineTo(-radius * 0.52, -radius * 0.28);
        ctx.lineTo(-radius * 1.16, 0);
        ctx.lineTo(-radius * 0.52, radius * 0.28);
        ctx.lineTo(-radius * 0.92, radius * 1.02);
        ctx.lineTo(radius * 0.22, radius * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "rgba(215, 246, 255, 0.96)";
        ctx.beginPath();
        ctx.ellipse(radius * 0.42, 0, radius * 0.38, radius * 0.24, 0, 0, TWO_PI);
        ctx.fill();

        ctx.fillStyle = "rgba(10, 32, 58, 0.42)";
        ctx.fillRect(-radius * 0.26, -radius * 0.12, radius * 0.85, radius * 0.24);

        // Draw progression hardware after the base hull so every branch remains
        // visible. This is intentionally cosmetic only.
        drawShipResearchHardware(radius, now);
        ctx.restore();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPlayerWorldHealthBar(screen) {
        if (!PLATFORM_PROFILE.isMobilePerformance) return;

        const width = player.r * 3.2;
        const height = 5;
        const x = screen.x - width / 2;
        const y = screen.y - player.r * 1.75;
        const ratio = clamp(player.health / Math.max(1, player.maxHealth), 0, 1);

        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
        ctx.fillStyle = ratio > 0.55 ? "#4cff83" : ratio > 0.25 ? "#ffd85c" : "#ff4f5e";
        ctx.fillRect(x, y, width * ratio, height);
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }

    function drawPlayer() {
        const target = screenToWorld(mouse);
        const angle = Math.atan2(target.y - player.y, target.x - player.x);
        const screen = worldToScreen(player);
        drawPlayerShip(angle, screen);
        drawPlayerWorldHealthBar(screen);
    }


    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawRoundedRectPath(context, x, y, width, height, radius) {
        const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.lineTo(x + width - safeRadius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
        context.lineTo(x + width, y + height - safeRadius);
        context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
        context.lineTo(x + safeRadius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
        context.lineTo(x, y + safeRadius);
        context.quadraticCurveTo(x, y, x + safeRadius, y);
        context.closePath();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPlayerBullets() {
        for (const bullet of bullets) {
            if (!isInView(bullet, 30)) continue;
            const screen = worldToScreen(bullet);

            const angle = Math.atan2(bullet.dy, bullet.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            const isCannon = bullet.kind === "cannon";
            ctx.fillStyle = isCannon ? "#fff4c7" : bullet.explosive ? "#ffb000" : "#ffe066";
            ctx.shadowColor = isCannon ? "#ffd97a" : bullet.explosive ? "#ff9d00" : "#fff1a8";
            ctx.shadowBlur = isCannon ? 6 : bullet.explosive ? 12 : 8;
            drawRoundedRectPath(
                ctx,
                -bullet.r * (isCannon ? 2.35 : 1.8),
                -bullet.r * (isCannon ? 0.55 : 0.45),
                bullet.r * (isCannon ? 4.7 : 3.6),
                bullet.r * (isCannon ? 1.1 : 0.9),
                bullet.r * 0.45
            );
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            if (bullet.explosive) {
                ctx.strokeStyle = "rgba(255,180,0,0.35)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, bullet.r + 4, 0, TWO_PI);
                ctx.stroke();
            }
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMissiles() {
        for (const missile of missiles) {
            if (!missile || missile.dead || !isInView(missile, 40)) continue;
            const screen = worldToScreen(missile);
            const angle = Math.atan2(missile.dy, missile.dx);

            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            ctx.fillStyle = "#ffef8a";
            ctx.beginPath();
            ctx.moveTo(11, 0);
            ctx.lineTo(-8, -6);
            ctx.lineTo(-5, 0);
            ctx.lineTo(-8, 6);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 130, 40, 0.72)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-8, 0);
            ctx.lineTo(-20, 0);
            ctx.stroke();
            ctx.restore();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDamageAura() {
        if (player.auraLevel <= 0 || player.auraRadius <= 0) return;

        const screen = worldToScreen(player);
        const now = Date.now();
        const pulse = 1 + Math.sin(now / 185) * 0.04;
        const radius = player.auraRadius * pulse;

        const gradient = ctx.createRadialGradient(screen.x, screen.y, player.r + 8, screen.x, screen.y, radius);
        gradient.addColorStop(0, "rgba(99, 215, 255, 0.13)");
        gradient.addColorStop(0.72, "rgba(99, 215, 255, 0.045)");
        gradient.addColorStop(1, "rgba(99, 215, 255, 0.0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
        ctx.fill();

        ctx.strokeStyle = "rgba(99, 215, 255, 0.74)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = "rgba(190, 245, 255, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius * 0.72, 0, TWO_PI);
        ctx.stroke();

        const particleCount = Math.min(18, 8 + player.auraLevel);
        for (let i = 0; i < particleCount; i++) {
            const angle = now / (560 + i * 19) + (TWO_PI / particleCount) * i;
            const orbitRadius = radius * (0.32 + (i % 4) * 0.16);
            const px = screen.x + Math.cos(angle) * orbitRadius;
            const py = screen.y + Math.sin(angle) * orbitRadius;
            const particlePulse = 1 + Math.sin(now / 130 + i) * 0.35;
            drawCircle(ctx, px, py, 2.2 * particlePulse, "rgba(155, 238, 255, 0.82)");
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCarrierMissiles() {
        for (const missile of carrierMissiles) {
            if (!missile || missile.dead || !isInView(missile, 50)) continue;
            const screen = worldToScreen(missile);
            const angle = Math.atan2(missile.dy, missile.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            const roleColor = missile.role === "interceptor" ? "#55d7ff" : missile.mode === "orbit" ? "#b86bff" : "#ff8a4c";
            ctx.shadowColor = roleColor;
            ctx.shadowBlur = 12;
            ctx.fillStyle = missile.role === "interceptor" ? "#b8f6ff" : missile.mode === "orbit" ? "#e0b8ff" : "#ffcf66";
            ctx.beginPath();
            ctx.moveTo(16, 0);
            ctx.lineTo(-10, -8);
            ctx.lineTo(-5, 0);
            ctx.lineTo(-10, 8);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = roleColor;
            ctx.fillRect(-17, -3, 8, 6);
            ctx.restore();

            const ratio = clamp(missile.health / missile.maxHealth, 0, 1);
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(screen.x - 14, screen.y - 18, 28, 4);
            ctx.fillStyle = "#7cffd4";
            ctx.fillRect(screen.x - 14, screen.y - 18, 28 * ratio, 4);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyBullets() {
        for (const bullet of enemyBullets) {
            if (!isInView(bullet, 30)) continue;
            const screen = worldToScreen(bullet);
            if (bullet.isBomb) {
                const remaining = Math.max(0, bullet.explodeAt - Date.now());
                const pulse = 0.72 + Math.sin(performance.now() / Math.max(45, remaining / 8)) * 0.22;
                ctx.save();
                ctx.fillStyle = `rgba(255,120,55,${pulse})`;
                ctx.strokeStyle = "rgba(255,225,155,.9)";
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(screen.x, screen.y, bullet.r, 0, TWO_PI); ctx.fill(); ctx.stroke();
                ctx.strokeStyle = `rgba(255,95,45,${0.28 + pulse * 0.35})`;
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(screen.x, screen.y, bullet.blastRadius, 0, TWO_PI); ctx.stroke();
                ctx.restore();
                continue;
            }

            const angle = Math.atan2(bullet.dy, bullet.dx);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(angle);
            ctx.fillStyle = bullet.color;
            ctx.shadowColor = bullet.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.ellipse(0, 0, bullet.r * 1.55, bullet.r * 0.82, 0, 0, TWO_PI);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, bullet.r + 3, 0, TWO_PI);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawParticles() {
        for (const particle of particles) {
            if (!particle || particle.dead || !isInView(particle, 50)) continue;
            const screen = worldToScreen(particle);
            const alpha = clamp(particle.life / particle.maxLife, 0, 1);
            if (particle.auraRing) {
                ctx.strokeStyle = hexToRgba(particle.color, 0.55 * alpha);
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, particle.r * (1 + (1 - alpha) * 0.08), 0, TWO_PI);
                ctx.stroke();
            } else {
                drawCircle(ctx, screen.x, screen.y, particle.r, hexToRgba(particle.color, 0.76 * alpha));
            }
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDamageNumbers() {
        ctx.save();
        ctx.textAlign = "center";
        ctx.lineWidth = 5;
        for (const number of damageNumbers) {
            if (!number || number.dead || !isInView(number, 80)) continue;
            const screen = worldToScreen(number);
            const alpha = clamp(number.life / number.maxLife, 0, 1);
            const age = 1 - alpha;
            const settle = clamp(age / 0.22, 0, 1);
            const scale = (number.startScale || 1.85) + ((number.settleScale || 1) - (number.startScale || 1.85)) * (1 - Math.pow(1 - settle, 3));
            const baseSize = number.text.length > 5 ? 20 : 24;
            ctx.font = `bold ${Math.round(baseSize * scale)}px Arial, sans-serif`;
            const fade = age < 0.38 ? 1 : clamp((1 - age) / 0.62, 0, 1);
            ctx.globalAlpha = fade;
            ctx.strokeStyle = number.outline || "rgba(0,0,0,0.82)";
            ctx.fillStyle = number.color;
            if (number.category === "quantum") {
                ctx.save();
                ctx.globalAlpha = fade * 0.24;
                ctx.lineWidth = 9;
                ctx.strokeStyle = number.color;
                ctx.strokeText(number.text, screen.x, screen.y);
                ctx.restore();
                ctx.globalAlpha = fade;
            }
            ctx.lineWidth = number.category === "weapon" ? 5 : 4;
            ctx.strokeText(number.text, screen.x, screen.y);
            ctx.fillText(number.text, screen.x, screen.y);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    /**
     * Handles the hexToRgba operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function hexToRgba(hex, alpha) {
        const normalized = hex.replace("#", "");
        if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;
        const value = Number.parseInt(normalized, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawExplosions() {
        for (const explosion of explosions) {
            const screen = worldToScreen(explosion);
            const t = explosion.life / explosion.maxLife;
            const radius = explosion.radius * (1.15 - t * 0.15);

            if (explosion.supportPulse) {
                // Healing uses cool green concentric rings and medical glyphs,
                // never the orange flash language reserved for explosions.
                drawCircle(ctx, screen.x, screen.y, radius * 0.72, `rgba(80, 255, 150, ${0.08 * t})`);
                ctx.strokeStyle = `rgba(105, 255, 170, ${0.78 * t})`;
                ctx.lineWidth = 2;
                for (const scale of [0.42, 0.72, 1]) {
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, radius * scale, 0, TWO_PI);
                    ctx.stroke();
                }
                ctx.fillStyle = `rgba(205,255,220,${0.85 * t})`;
                ctx.fillRect(screen.x - 3, screen.y - 12, 6, 24);
                ctx.fillRect(screen.x - 12, screen.y - 3, 24, 6);
            } else {
                drawCircle(ctx, screen.x, screen.y, radius, `rgba(255, 150, 40, ${0.22 * t})`);
                ctx.strokeStyle = `rgba(255, 230, 120, ${0.8 * t})`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
                ctx.stroke();
            }
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPointOrbs() {
        for (const orb of pointOrbs) {
            if (!orb || orb.dead || !isInView(orb, 40)) continue;

            const screen = worldToScreen(orb);
            const pulse = 1 + Math.sin(Date.now() / 120) * 0.16;

            if (orb.magnetized) {
                const playerScreen = worldToScreen(player);
                ctx.strokeStyle = "rgba(255, 244, 150, 0.34)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(screen.x, screen.y);
                ctx.lineTo(playerScreen.x, playerScreen.y);
                ctx.stroke();
            }

            drawCircle(ctx, screen.x, screen.y, orb.r * pulse, "#ffe066");

            ctx.strokeStyle = orb.magnetized ? "rgba(255, 255, 210, 0.85)" : "rgba(255, 224, 102, 0.45)";
            ctx.lineWidth = orb.magnetized ? 3 : 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, orb.r * pulse + (orb.magnetized ? 7 : 4), 0, TWO_PI);
            ctx.stroke();
        }
    }


    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawLifeStealOrbs() {
        const now = Date.now();
        for (const orb of lifeStealOrbs) {
            if (!orb || orb.dead || !isInView(orb, 50)) continue;
            const screen = worldToScreen(orb);
            const alpha = clamp(orb.life / 150, 0.25, 1);
            const pulse = 1 + Math.sin(now / 90 + orb.x) * 0.18;

            drawCircle(ctx, screen.x, screen.y, orb.r * pulse, `rgba(124,255,155,${0.85 * alpha})`);
            ctx.strokeStyle = `rgba(220,255,225,${0.58 * alpha})`;
            ctx.lineWidth = orb.magnetized ? 3 : 2;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, orb.r * pulse + (orb.magnetized ? 8 : 4), 0, TWO_PI);
            ctx.stroke();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPickups() {
        for (const pickup of pickups) {
            if (!isInView(pickup, 40)) continue;

            const screen = worldToScreen(pickup);
            const pulse = 1 + Math.sin(Date.now() / 140) * 0.12;

            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.scale(pulse, pulse);

            if (pickup.magnetized) {
                ctx.strokeStyle = pickup.type === "health" ? "rgba(54, 255, 122, 0.70)" : "rgba(99, 215, 255, 0.70)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, pickup.r + 6, 0, TWO_PI);
                ctx.stroke();
            }

            drawPickupIcon(pickup);
            ctx.restore();
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawPickupIcon(pickup) {
        const drawActions = {
            health: () => {
                drawCircle(ctx, 0, 0, pickup.r, "#36ff7a");
                ctx.fillStyle = "#063b18";
                ctx.fillRect(-3, -8, 6, 16);
                ctx.fillRect(-8, -3, 16, 6);
            },
            speed: () => {
                ctx.fillStyle = "#63d7ff";
                ctx.strokeStyle = "rgba(225,250,255,0.95)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(3, -15);
                ctx.lineTo(-6, -2);
                ctx.lineTo(0, -2);
                ctx.lineTo(-4, 15);
                ctx.lineTo(8, 1);
                ctx.lineTo(2, 1);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            },
            overdrive: () => {
                ctx.save(); ctx.rotate(Date.now()/420); ctx.strokeStyle="#dffcff"; ctx.fillStyle="#58cfff"; ctx.lineWidth=2;
                ctx.beginPath(); for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2?6:13;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
                drawCircle(ctx,0,0,4,"#ffffff");
            },
            harm: () => {
                drawCircle(ctx, 0, 2, pickup.r, "#ff3030");
                ctx.fillStyle = "#2a0505";
                ctx.beginPath();
                ctx.arc(-4, 0, 2.6, 0, TWO_PI);
                ctx.arc(4, 0, 2.6, 0, TWO_PI);
                ctx.fill();
                ctx.strokeStyle = "#2a0505";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(-5, 7);
                ctx.lineTo(-2, 4);
                ctx.lineTo(0, 7);
                ctx.lineTo(2, 4);
                ctx.lineTo(5, 7);
                ctx.stroke();
                ctx.strokeStyle = "#ffd37a";
                ctx.beginPath();
                ctx.moveTo(4, -9);
                ctx.quadraticCurveTo(8, -14, 11, -10);
                ctx.stroke();
            },
            slow: () => {
                drawCircle(ctx, 0, 0, pickup.r, "#b36bff");
                ctx.fillStyle = "#21003f";
                ctx.beginPath();
                ctx.moveTo(0, 10);
                ctx.lineTo(-8, -1);
                ctx.lineTo(-3, -1);
                ctx.lineTo(-3, -9);
                ctx.lineTo(3, -9);
                ctx.lineTo(3, -1);
                ctx.lineTo(8, -1);
                ctx.closePath();
                ctx.fill();
            },
        };

        drawActions[pickup.type]?.();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyShip(enemy, screen) {
        const radius = enemy.r;
        const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const flashActive = enemy.auraFlashUntil && Date.now() < enemy.auraFlashUntil;

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(angle);
        drawShipShadow(radius);

        const engineColor = enemy.type === "runner"
            ? "rgba(255, 179, 71, 0.9)"
            : enemy.type === "fighter"
                ? "rgba(85, 215, 255, 0.95)"
                : enemy.type === "carrier"
                    ? "rgba(255, 170, 70, 0.75)"
                    : enemy.type === "dodger"
                        ? "rgba(124, 255, 212, 0.86)"
                        : "rgba(255, 95, 130, 0.72)";
        drawThrusterPair(radius, engineColor);

        const color = flashActive ? "#9beeff" : enemy.color;
        const stroke = flashActive ? "rgba(210, 250, 255, 0.95)" : "rgba(255, 255, 255, 0.42)";

        if (enemy.type === "runner") drawRunnerShip(radius, color, stroke);
        else if (enemy.type === "tank") drawTankShip(radius, color, stroke);
        else if (enemy.type === "miniTank") drawMiniTankShip(radius, color, stroke);
        else if (enemy.type === "fighter") drawFighterShip(radius, color, stroke);
        else if (enemy.type === "carrier") drawCarrierShip(radius, color, stroke);
        else if (enemy.type === "aegis") drawMiniTankShip(radius, color, stroke);
        else if (enemy.type === "brute") drawBruteShip(radius, color, stroke);
        else if (enemy.type === "dodger") drawDodgerShip(radius, color, stroke);
        else if (enemy.type === "boss") drawBossShip(radius, color, stroke);
        else if (enemy.type === "gigaBoss") drawGigaBossShip(radius, color, stroke);
        else drawNormalShip(radius, color, stroke);

        drawEvolutionHullOverlay(enemy, radius);
        ctx.restore();

        if (flashActive) {
            ctx.strokeStyle = "rgba(99, 215, 255, 0.95)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, enemy.r + 5, 0, TWO_PI);
            ctx.stroke();
            drawCircle(ctx, screen.x, screen.y, enemy.r + 2, "rgba(99, 215, 255, 0.18)");
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEvolutionHullOverlay(enemy, radius) {
        const generation = enemy.generation || 1;
        if (generation < 2 || !["normal", "runner", "brute", "tank", "fighter", "dodger"].includes(enemy.type)) return;

        const accents = ["#ffffff", "#ffffff", "#78dcff", "#ffb35f", "#c88cff", "#f4fbff"];
        const accent = accents[Math.min(5, generation)];
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        ctx.lineWidth = 1.5 + generation * 0.35;
        ctx.globalAlpha = 0.72;

        // Each generation materially changes the silhouette: side armor at II,
        // engine fins at III, forward weapon prongs at IV, and twin cores at V.
        if (generation >= 2) {
            ctx.fillRect(-radius * 0.18, -radius * 0.92, radius * 0.42, radius * 0.16);
            ctx.fillRect(-radius * 0.18, radius * 0.76, radius * 0.42, radius * 0.16);
        }
        if (generation >= 3) {
            ctx.beginPath();
            ctx.moveTo(-radius * 0.45, -radius * 0.72);
            ctx.lineTo(-radius * 1.02, -radius * 1.02);
            ctx.lineTo(-radius * 0.72, -radius * 0.36);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-radius * 0.45, radius * 0.72);
            ctx.lineTo(-radius * 1.02, radius * 1.02);
            ctx.lineTo(-radius * 0.72, radius * 0.36);
            ctx.closePath(); ctx.fill();
        }
        if (generation >= 4) {
            ctx.beginPath();
            ctx.moveTo(radius * 0.62, -radius * 0.34);
            ctx.lineTo(radius * 1.28, -radius * 0.18);
            ctx.lineTo(radius * 0.70, -radius * 0.02);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(radius * 0.62, radius * 0.34);
            ctx.lineTo(radius * 1.28, radius * 0.18);
            ctx.lineTo(radius * 0.70, radius * 0.02);
            ctx.stroke();
        }
        if (generation >= 5) {
            drawCircle(ctx, radius * 0.10, -radius * 0.28, Math.max(3, radius * 0.12), accent);
            drawCircle(ctx, radius * 0.10, radius * 0.28, Math.max(3, radius * 0.12), accent);
            ctx.strokeRect(-radius * 0.58, -radius * 0.58, radius * 0.98, radius * 1.16);
        }
        ctx.restore();
    }

    function drawNormalShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.15, 0);
        ctx.lineTo(radius * 0.12, -radius * 0.72);
        ctx.lineTo(-radius * 0.95, -radius * 0.52);
        ctx.lineTo(-radius * 0.62, 0);
        ctx.lineTo(-radius * 0.95, radius * 0.52);
        ctx.lineTo(radius * 0.12, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius, "rgba(45, 0, 12, 0.48)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawRunnerShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.75, 0);
        ctx.lineTo(-radius * 0.3, -radius * 0.46);
        ctx.lineTo(-radius * 1.15, -radius * 0.16);
        ctx.lineTo(-radius * 0.3, 0);
        ctx.lineTo(-radius * 1.15, radius * 0.16);
        ctx.lineTo(-radius * 0.3, radius * 0.46);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius * 0.72, "rgba(60, 24, 0, 0.52)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawTankShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.08, 0);
        ctx.lineTo(radius * 0.45, -radius * 0.68);
        ctx.lineTo(-radius * 0.92, -radius * 0.78);
        ctx.lineTo(-radius * 1.12, 0);
        ctx.lineTo(-radius * 0.92, radius * 0.78);
        ctx.lineTo(radius * 0.45, radius * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 3);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMiniTankShip(radius, color, stroke) {
        drawTankShip(radius, color, stroke);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 0.2, -radius * 0.88);
        ctx.lineTo(radius * 0.78, -radius * 0.88);
        ctx.moveTo(radius * 0.2, radius * 0.88);
        ctx.lineTo(radius * 0.78, radius * 0.88);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawFighterShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.55, 0);
        ctx.lineTo(radius * 0.1, -radius * 0.72);
        ctx.lineTo(-radius * 0.95, -radius * 0.26);
        ctx.lineTo(-radius * 0.35, 0);
        ctx.lineTo(-radius * 0.95, radius * 0.26);
        ctx.lineTo(radius * 0.1, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawCockpit(radius * 0.8, "rgba(0, 32, 58, 0.62)");
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCarrierShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 1.18, 0);
        ctx.lineTo(radius * 0.55, -radius * 0.74);
        ctx.lineTo(-radius * 0.8, -radius * 0.95);
        ctx.lineTo(-radius * 1.18, -radius * 0.48);
        ctx.lineTo(-radius * 0.98, 0);
        ctx.lineTo(-radius * 1.18, radius * 0.48);
        ctx.lineTo(-radius * 0.8, radius * 0.95);
        ctx.lineTo(radius * 0.55, radius * 0.74);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 6);
        ctx.fillStyle = "rgba(255, 190, 75, 0.82)";
        ctx.fillRect(radius * 0.05, -radius * 0.13, radius * 0.88, radius * 0.26);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBruteShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.25, 0);
        ctx.lineTo(radius * 0.28, -radius * 0.72);
        ctx.lineTo(-radius * 1.02, -radius * 0.66);
        ctx.lineTo(-radius * 0.8, radius * 0.66);
        ctx.lineTo(radius * 0.28, radius * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(40,0,24,0.55)";
        ctx.fillRect(-radius * 0.38, -radius * 0.9, radius * 0.62, radius * 0.24);
        ctx.fillRect(-radius * 0.38, radius * 0.66, radius * 0.62, radius * 0.24);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDodgerShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(radius * 1.42, 0);
        ctx.lineTo(radius * 0.05, -radius * 0.86);
        ctx.lineTo(-radius * 0.52, -radius * 0.28);
        ctx.lineTo(-radius * 1.08, 0);
        ctx.lineTo(-radius * 0.52, radius * 0.28);
        ctx.lineTo(radius * 0.05, radius * 0.86);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.beginPath();
        ctx.moveTo(-radius * 0.24, 0);
        ctx.lineTo(radius * 0.72, 0);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBossShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(radius * 1.18, 0);
        ctx.lineTo(radius * 0.34, -radius * 0.82);
        ctx.lineTo(-radius * 1.04, -radius * 0.92);
        ctx.lineTo(-radius * 0.76, 0);
        ctx.lineTo(-radius * 1.04, radius * 0.92);
        ctx.lineTo(radius * 0.34, radius * 0.82);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 5);
        ctx.fillStyle = "rgba(255, 235, 59, 0.88)";
        ctx.fillRect(radius * 0.08, -radius * 0.1, radius * 0.9, radius * 0.2);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawGigaBossShip(radius, color, stroke) {
        ctx.fillStyle = color;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(radius * 1.15, 0);
        ctx.lineTo(radius * 0.65, -radius * 0.58);
        ctx.lineTo(-radius * 0.88, -radius * 0.92);
        ctx.lineTo(-radius * 1.22, -radius * 0.28);
        ctx.lineTo(-radius * 0.98, 0);
        ctx.lineTo(-radius * 1.22, radius * 0.28);
        ctx.lineTo(-radius * 0.88, radius * 0.92);
        ctx.lineTo(radius * 0.65, radius * 0.58);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawHullWindows(radius, 7);
        ctx.fillStyle = "rgba(255, 32, 32, 0.86)";
        ctx.beginPath();
        ctx.arc(radius * 0.28, 0, radius * 0.16, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawCockpit(radius, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(radius * 0.34, 0, radius * 0.28, radius * 0.2, 0, 0, TWO_PI);
        ctx.fill();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawHullWindows(radius, count) {
        ctx.fillStyle = "rgba(230, 245, 255, 0.72)";
        const start = -((count - 1) * radius * 0.18) / 2;
        for (let i = 0; i < count; i++) {
            ctx.fillRect(-radius * 0.18, start + i * radius * 0.18 - radius * 0.035, radius * 0.26, radius * 0.07);
        }
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemies() {
        for (const enemy of enemies) {
            if (!isInView(enemy, 100)) continue;

            const screen = worldToScreen(enemy);
            if (enemy.type === "aegis") drawAegisField(enemy, screen);
            drawEnemyShip(enemy, screen);

            if (enemy.type === "boss" || enemy.type === "gigaBoss") drawBossDetails(enemy, screen);
            if (enemy.type === "miniTank") {
                drawMiniTankDetails(enemy, screen);
                ctx.save();
                ctx.textAlign = "center";
                ctx.font = "bold 11px system-ui";
                ctx.fillStyle = enemy.miniBossRole === "healer" ? "#72f0a6" : enemy.miniBossRole === "sniper" ? "#ffcf70" : "#d9b5ff";
                ctx.fillText((enemy.miniBossRole || "superTank").toUpperCase(), screen.x, screen.y - enemy.r - 18);
                ctx.restore();
            }
            if (enemy.quantumImmune) {
                ctx.save();
                const flash = enemy.quantumFlashUntil && enemy.quantumFlashUntil > Date.now();
                ctx.strokeStyle = flash ? "rgba(130,245,255,.98)" : "rgba(70,205,255,.68)";
                ctx.lineWidth = flash ? 5 : 2;
                ctx.setLineDash([3, 6]);
                ctx.beginPath(); ctx.arc(screen.x, screen.y, enemy.r + 10, 0, TWO_PI); ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#86ecff";
                ctx.fillText("Q-NULL", screen.x, screen.y - enemy.r - 14);
                ctx.restore();
            }
            if ((enemy.generation || 1) > 1 && !["boss", "gigaBoss", "carrier", "aegis"].includes(enemy.type)) {
                const generationAlpha = 0.22 + Math.min(0.46, enemy.generation * 0.08);
                ctx.save();
                ctx.strokeStyle = `rgba(145,205,255,${generationAlpha})`;
                ctx.lineWidth = 1 + Math.min(3, enemy.generation - 1);
                ctx.setLineDash([5, 7]);
                ctx.beginPath(); ctx.arc(screen.x, screen.y, enemy.r + 7 + enemy.generation * 2, 0, TWO_PI); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "rgba(170,225,255,.92)";
                ctx.font = "bold 9px system-ui";
                ctx.textAlign = "center";
                ctx.fillText(`GEN ${enemy.generation}`, screen.x, screen.y - enemy.r - 12);
                if (enemy.blinkChargeUntil) {
                    ctx.strokeStyle = "rgba(120,235,255,.95)"; ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.arc(screen.x, screen.y, enemy.r + 13, 0, TWO_PI); ctx.stroke();
                }
                ctx.restore();
            }
            if (enemy.type === "carrier" && enemy.launchChargeUntil) {
                const remaining = Math.max(0, enemy.launchChargeUntil - Date.now());
                const pulse = 0.55 + Math.sin(Date.now() / 90) * 0.25;
                ctx.save();
                ctx.strokeStyle = `rgba(90,220,255,${pulse})`;
                ctx.lineWidth = 5;
                ctx.beginPath(); ctx.arc(screen.x, screen.y, enemy.r + 12 + remaining / 160, 0, TWO_PI); ctx.stroke();
                ctx.fillStyle = "rgba(120,235,255,.85)";
                ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
                ctx.fillText("DEPLOYING", screen.x, screen.y - enemy.r - 22);
                ctx.restore();
            }

            drawEnemyHealthBar(enemy, screen);
        }
    }

    function drawAegisField(enemy, screen) {
        const radius = enemy.shieldRadius || 255;
        const playerInside = isPlayerInsideAegis(enemy);
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(70,165,255,${playerInside ? 0.035 : 0.075})`;
        ctx.strokeStyle = `rgba(105,205,255,${0.48 + pulse * 0.28})`;
        ctx.lineWidth = playerInside ? 2 : 4;
        ctx.setLineDash([14, 9]);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(190,235,255,${0.22 + pulse * 0.18})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius - 7, 0, TWO_PI);
        ctx.stroke();
        ctx.fillStyle = playerInside ? "rgba(190,245,255,.9)" : "rgba(100,205,255,.92)";
        ctx.font = "bold 12px monospace";
        ctx.textAlign = "center";
        ctx.fillText(playerInside ? "GENERATOR EXPOSED" : "AEGIS FIELD", screen.x, screen.y - radius - 12);
        ctx.restore();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawMiniTankDetails(enemy, screen) {
        ctx.strokeStyle = "rgba(213, 139, 255, 0.86)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + 7, 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + 13, 0, TWO_PI);
        ctx.stroke();

        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(screen.x - 18, screen.y - 4, 36, 8);
        ctx.fillStyle = "#f0d4ff";
        ctx.fillRect(screen.x - 3, screen.y - 20, 6, 40);
        ctx.fillRect(screen.x - 20, screen.y - 3, 40, 6);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawBossDetails(enemy, screen) {
        const isGigaBoss = enemy.type === "gigaBoss";

        ctx.strokeStyle = isGigaBoss ? "rgba(255,255,255,0.98)" : "rgba(255, 230, 80, 0.95)";
        ctx.lineWidth = isGigaBoss ? 6 : 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + (isGigaBoss ? 11 : 7), 0, TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = isGigaBoss ? "rgba(255, 40, 40, 0.9)" : "rgba(255, 90, 90, 0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, enemy.r + (isGigaBoss ? 22 : 14), 0, TWO_PI);
        ctx.stroke();

        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(screen.x - 22, screen.y - 5, 44, 10);

        ctx.fillStyle = isGigaBoss ? "#ff2020" : "#ffeb3b";
        ctx.fillRect(screen.x - 4, screen.y - 24, 8, 48);
        ctx.fillRect(screen.x - 24, screen.y - 4, 48, 8);
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawDodgerDetails(screen) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screen.x - 8, screen.y);
        ctx.lineTo(screen.x + 8, screen.y);
        ctx.moveTo(screen.x, screen.y - 8);
        ctx.lineTo(screen.x, screen.y + 8);
        ctx.stroke();
    }

    /**
     * Renders a visual element on the canvas. Do not change gameplay state from rendering code.
     */
    function drawEnemyHealthBar(enemy, screen) {
        const healthPercent = Math.max(0, enemy.health / enemy.maxHealth);

        ctx.fillStyle = "#111";
        ctx.fillRect(screen.x - enemy.r, screen.y - enemy.r - 12, enemy.r * 2, 5);

        ctx.fillStyle = "#7cff7c";
        ctx.fillRect(screen.x - enemy.r, screen.y - enemy.r - 12, enemy.r * 2 * healthPercent, 5);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimap() {
        const width = minimap.width;
        const height = minimap.height;
        const scaleX = width / WORLD.width;
        const scaleY = height / WORLD.height;

        minimapCtx.clearRect(0, 0, width, height);
        minimapCtx.fillStyle = "rgba(8, 12, 22, 0.98)";
        minimapCtx.fillRect(0, 0, width, height);

        if (!PLATFORM_PROFILE.isMobilePerformance) drawMinimapGrid(width, height);
        drawMinimapCameraView(scaleX, scaleY);
        drawMinimapEntities(scaleX, scaleY);

        minimapCtx.strokeStyle = "rgba(255, 90, 90, 0.55)";
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(1, 1, width - 2, height - 2);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapGrid(width, height) {
        minimapCtx.strokeStyle = "rgba(90, 200, 255, 0.18)";
        minimapCtx.lineWidth = 1;

        for (let x = 0; x <= width; x += width / 6) {
            minimapCtx.beginPath();
            minimapCtx.moveTo(x, 0);
            minimapCtx.lineTo(x, height);
            minimapCtx.stroke();
        }

        for (let y = 0; y <= height; y += height / 4) {
            minimapCtx.beginPath();
            minimapCtx.moveTo(0, y);
            minimapCtx.lineTo(width, y);
            minimapCtx.stroke();
        }
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapCameraView(scaleX, scaleY) {
        minimapCtx.strokeStyle = "rgba(255,255,255,0.48)";
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(
            camera.x * scaleX,
            camera.y * scaleY,
            getVisibleWorldWidth() * scaleX,
            getVisibleWorldHeight() * scaleY
        );
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEntities(scaleX, scaleY) {
        for (const orb of pointOrbs) drawMinimapPointOrb(orb, scaleX, scaleY);
        for (const orb of lifeStealOrbs) drawCircle(minimapCtx, orb.x * scaleX, orb.y * scaleY, 2.2, "#7cff9b");
        for (const pickup of pickups) drawMinimapPickup(pickup, scaleX, scaleY);
        for (const enemy of enemies) drawMinimapEnemy(enemy, scaleX, scaleY);
        if (!PLATFORM_PROFILE.isMobilePerformance) {
            for (const bullet of enemyBullets) drawMinimapEnemyBullet(bullet, scaleX, scaleY);
            for (const missile of carrierMissiles) if (missile && !missile.dead) drawCircle(minimapCtx, missile.x * scaleX, missile.y * scaleY, 2.5, "#ffcf66");
        }
        drawMinimapPlayer(scaleX, scaleY);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPointOrb(orb, scaleX, scaleY) {
        if (!orb || orb.dead) return;
        drawCircle(minimapCtx, orb.x * scaleX, orb.y * scaleY, 2, "#ffe066");
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPickup(pickup, scaleX, scaleY) {
        const colors = {
            health: "#36ff7a",
            speed: "#63d7ff",
            overdrive: "#8cecff",
            harm: "#ff3030",
            slow: "#b36bff",
        };

        drawCircle(minimapCtx, pickup.x * scaleX, pickup.y * scaleY, 2, colors[pickup.type]);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEnemy(enemy, scaleX, scaleY) {
        const radius = enemy.type === "gigaBoss" ? 7 : enemy.type === "boss" ? 5 : enemy.type === "carrier" ? 5 : enemy.type === "miniTank" ? 4 : 3;
        const x = enemy.x * scaleX;
        const y = enemy.y * scaleY;

        drawCircle(minimapCtx, x, y, radius, enemy.color);

        if (enemy.type === "boss" || enemy.type === "gigaBoss" || enemy.type === "miniTank") {
            minimapCtx.strokeStyle = enemy.type === "gigaBoss" ? "#ffffff" : enemy.type === "miniTank" ? "#d58bff" : "#ffeb3b";
            minimapCtx.lineWidth = enemy.type === "gigaBoss" ? 2 : 1;
            minimapCtx.beginPath();
            minimapCtx.arc(x, y, enemy.type === "gigaBoss" ? 10 : enemy.type === "miniTank" ? 8 : 7, 0, TWO_PI);
            minimapCtx.stroke();
        }
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapEnemyBullet(bullet, scaleX, scaleY) {
        minimapCtx.fillStyle = "#ff79c6";
        minimapCtx.fillRect(bullet.x * scaleX - 1, bullet.y * scaleY - 1, 2, 2);
    }

    /**
     * Draws one minimap layer. Keep this cheaper than main-scene rendering because it may run frequently.
     */
    function drawMinimapPlayer(scaleX, scaleY) {
        const x = player.x * scaleX;
        const y = player.y * scaleY;

        drawCircle(minimapCtx, x, y, 4, "#6aa9ff");

        minimapCtx.strokeStyle = "white";
        minimapCtx.lineWidth = 1.5;
        minimapCtx.beginPath();
        minimapCtx.arc(x, y, 6, 0, TWO_PI);
        minimapCtx.stroke();
    }

    // -------------------------------------------------------------------------
