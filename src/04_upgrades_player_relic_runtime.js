    // Upgrades
    // -------------------------------------------------------------------------
    /**
     * Calculates economy cost from upgrade level and difficulty modifiers. Keep all pricing logic here for balance consistency.
     */
    function getUpgradeCost(type) {
        const upgrade = UPGRADE_DATA[type];
        const level = upgradeLevels[type] || 0;
        const difficultyCost = getDifficulty().upgradeCost ?? 1;

        // Pricing is deliberately nonlinear. Core upgrades stay approachable,
        // while high-impact research and heavily stacked stats become expensive
        // enough that a complete "god build" should not arrive in the teens.
        const tierMultipliers = {
            core: 1.05,
            advanced: 1.16,
            experimental: 1.32,
            hybrid: 1.26,
            capstone: 1.48,
        };
        const tierMultiplier = tierMultipliers[upgrade.tier] || 1.05;

        // More powerful base items receive a slightly larger initial premium,
        // rather than applying the same flat percentage to every purchase.
        const powerPremium = 1 + clamp((upgrade.baseCost - 70) / 2400, 0, 0.18);

        // Repeated investment into one core stat gains extra cost pressure after
        // the first few levels. This preserves early build formation but slows
        // extreme single-stat rushing.
        const stackPressure = upgrade.tier === "core"
            ? 1 + Math.max(0, level - 2) * 0.055 + Math.max(0, level - 7) * 0.035
            : 1;

        const totalOwnedLevels = Object.values(upgradeLevels).reduce((sum, value) => sum + value, 0);
        const buildMaturityPressure = totalOwnedLevels <= 10
            ? 1
            : 1 + Math.min(0.28, (totalOwnedLevels - 10) * 0.012);

        const rawCost = upgrade.baseCost
            * difficultyCost
            * Math.pow(upgrade.growth, level)
            * tierMultiplier
            * powerPremium
            * stackPressure
            * buildMaturityPressure;

        return Math.max(1, Math.floor(rawCost));
    }

    /**
     * Validates affordability, spends points, applies the upgrade, and refreshes UI. Never deduct currency before validation succeeds.
     */
    function buyUpgrade(type) {
        const data = UPGRADE_DATA[type];
        const lockReason = getResearchLock(type);
        if (lockReason) return;
        if (data.maxLevel && upgradeLevels[type] >= data.maxLevel) return;
        const cost = getUpgradeCost(type);
        if (state.upgradePoints < cost) return;

        captureReconstructionSnapshot(`${data.label} (${cost} pts)`);
        state.upgradePoints -= cost;
        upgradeLevels[type]++;
        applyUpgrade(type);
        playSound("upgrade");
        updateUpgradeButtons();
        writeValidatedSave("upgrade");
    }

    /**
     * Handles the applyUpgrade operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function applyUpgrade(type) {
        const upgradeActions = {
            damage: () => {
                player.damage += 4;
                ui.weapon.textContent = "Heavy";
            },
            fireRate: () => {
                player.fireRate = Math.max(85, player.fireRate - 25);
                ui.weapon.textContent = "Rapid";
            },
            multiShot: () => {
                player.bulletsPerShot++;
                ui.weapon.textContent = "Spread";
            },
            bulletVelocity: () => {
                player.bulletSpeed += 1.15;
                ui.weapon.textContent = "High Velocity";
            },
            explosive: () => {
                player.explosiveLevel++;
                player.explosiveRadius = Math.max(
                    GAMEPLAY_CONSTANTS.explosiveRounds.minimumRadius,
                    GAMEPLAY_CONSTANTS.explosiveRounds.baseRadius + player.explosiveLevel * GAMEPLAY_CONSTANTS.explosiveRounds.radiusPerLevel
                );
                player.explosiveDamageRatio = Math.min(0.8, player.explosiveDamageRatio + 0.06);
                ui.weapon.textContent = "Explosive";
            },
            cannonUnlock: () => {
                player.cannonDamage = Math.max(player.cannonDamage, 34);
                ui.weapon.textContent = "Heavy Cannon Online";
            },
            cannonDamage: () => {
                player.cannonDamage = Math.max(34, player.cannonDamage) + 9;
                ui.weapon.textContent = `Cannon ${player.cannonDamage} damage`;
            },
            cannonRate: () => {
                player.cannonFireRate = Math.max(500, player.cannonFireRate - 110);
                ui.weapon.textContent = `Cannon ${Math.round(player.cannonFireRate)} ms`;
            },
            cannonVelocity: () => {
                player.cannonVelocity = Math.min(6, player.cannonVelocity + 1);
                ui.weapon.textContent = `Cannon velocity +${player.cannonVelocity * 12}%`;
            },
            speed: () => {
                player.speed += 0.28;
                ui.weapon.textContent = "Swift";
            },
            magnet: () => {
                player.pointMagnetRadius += 85;
                player.pointMagnetStrength += 0.055;
                ui.weapon.textContent = "Collector";
            },
            autoMissile: () => {
                player.missileLevel++;
                player.missileDamage += 9;
                player.missileCount = Math.max(1, Math.ceil(player.missileLevel / 3));
                player.missileCooldown = Math.max(520, 950 - player.missileLevel * 18);
                ui.weapon.textContent = `Missiles x${player.missileCount}`;
            },
            damageAura: () => {
                player.auraLevel++;
                player.auraDamage += 22;
                player.auraRadius = 135 + Math.floor((player.auraLevel - 1) / 4) * 28;
                ui.weapon.textContent = `Aura ${player.auraRadius}px / ${player.auraDamage} dmg`;
            },
            riftPower: () => { ui.weapon.textContent = `Rift intensity ${upgradeLevels.riftPower + 1}`; },
            riftFrequency: () => { ui.weapon.textContent = `Rift cascade ${upgradeLevels.riftFrequency + 1}`; },
            healthRegen: () => {
                player.regenLevel++;
                player.regenPerSecond = player.regenLevel * 0.15;
                player.regenAmount = player.regenPerSecond;
                player.regenTickRate = 1000;
                ui.weapon.textContent = `Regen ${player.regenPerSecond.toFixed(2)} HP/s`;
            },
            lifeSteal: () => {
                player.lifeStealLevel++;
                player.lifeStealAmount += 1;
                ui.weapon.textContent = `Life Steal ${player.lifeStealAmount}%`;
            },
            maxHealth: () => {
                player.maxHealth += 15;
                player.health = Math.min(player.maxHealth, player.health + 20);
                ui.weapon.textContent = "Fortified";
            },
            adaptivePlating: () => { player.damageReduction = Math.max(player.damageReduction, 0.10); },
            combatNanobots: () => { player.regenDelayAfterDamage = 1000; player.regenPerSecond += 0.35; },
            livingColony: () => { player.maxShield = Math.max(player.maxShield, Math.floor(player.maxHealth * 0.30)); player.shield = player.maxShield; },
            predictiveTargeting: () => { player.damage = Math.round(player.damage * 1.15); player.bulletSpeed += 1.2; },
            heatManagement: () => { player.fireRate = Math.max(65, Math.round(player.fireRate * 0.85)); },
            autonomousArsenal: () => { player.autonomousArsenal = true; },
            cannonWarhead: () => { ui.weapon.textContent = "Cannon Warhead Online"; },
            cannonCluster: () => { ui.weapon.textContent = "Four-Round Dispersal Online"; },
            cannonQuantum: () => { ui.weapon.textContent = "Quantum Cannon Online"; },
            boostCapacitor: () => { player.speed += 0.35; player.boostDurationMultiplier = 1.5; },
            inertialDampeners: () => { player.speed += 0.25; player.slowResistance = 0.65; },
            zeroPointReactor: () => { player.speed += 0.55; player.pointMagnetRadius += 160; },
            combatHeuristics: () => { player.missileCooldown = Math.max(380, player.missileCooldown * 0.78); player.missileDamage += 18; },
            swarmMatrix: () => { player.missileCount += 2; player.auraRadius += 55; },
            distributedConsciousness: () => { player.missileCount += 3; player.missileDamage += 40; player.auraDamage += 45; },
            adaptiveHull: () => { player.adaptiveHull = true; player.maxHealth += 20; },
            combatAlgorithms: () => { player.autonomousDamageMultiplier = 1.25; player.missileDamage = Math.round(player.missileDamage * 1.25); },
            railAcceleration: () => { player.bulletSpeed += 3; player.damage += 6; },
            livingDrones: () => { player.livingDrones = true; player.regenPerSecond += 0.30; player.missileDamage += 12; },
        };

        upgradeActions[type]?.();
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getUpgradeStatText(type, next = false) {
        const level = upgradeLevels[type] + (next ? 1 : 0);
        const value = (current, increment) => current + (next ? increment : 0);

        const statMap = {
            multiShot: () => `${next ? "Next" : "Current"}: ${value(player.bulletsPerShot, 1)} projectile${value(player.bulletsPerShot, 1) === 1 ? "" : "s"}`,
            damage: () => `${next ? "Next" : "Current"}: ${value(player.damage, 4)} damage`,
            fireRate: () => `${next ? "Next" : "Current"}: ${Math.max(85, value(player.fireRate, -25))} ms delay`,
            bulletVelocity: () => `${next ? "Next" : "Current"}: ${value(player.bulletSpeed, 1.15).toFixed(1)} speed`,
            explosive: () => next
                ? `Next: ${Math.max(
                    GAMEPLAY_CONSTANTS.explosiveRounds.minimumRadius,
                    GAMEPLAY_CONSTANTS.explosiveRounds.baseRadius + (player.explosiveLevel + 1) * GAMEPLAY_CONSTANTS.explosiveRounds.radiusPerLevel
                )}px fixed blast / stronger splash`
                : `Current: ${player.explosiveLevel ? `${player.explosiveRadius}px blast` : "inactive"}`,
            cannonUnlock: () => `${next ? "Next" : "Current"}: ${next || upgradeLevels.cannonUnlock || player.cannonDamage > 0 ? "cannon online" : "offline"}`,
            cannonDamage: () => `${next ? "Next" : "Current"}: ${Math.max(34, player.cannonDamage) + (next ? 9 : 0)} damage`,
            cannonRate: () => `${next ? "Next" : "Current"}: ${Math.max(500, player.cannonFireRate - (next ? 110 : 0))} ms delay`,
            cannonVelocity: () => `${next ? "Next" : "Current"}: +${(player.cannonVelocity + (next ? 1 : 0)) * 12}% shell speed`,
            cannonWarhead: () => `${next ? "Next" : "Current"}: ${next || upgradeLevels.cannonWarhead ? "96px fixed blast" : "inactive"}`,
            cannonCluster: () => `${next ? "Next" : "Current"}: ${next || upgradeLevels.cannonCluster ? "4 explosive sub-rounds" : "inactive"}`,
            cannonQuantum: () => `${next ? "Next" : "Current"}: ${next || upgradeLevels.cannonQuantum ? "Quantum damage" : "Weapon damage"}`,
            speed: () => `${next ? "Next" : "Current"}: ${value(player.speed, 0.28).toFixed(2)} move speed`,
            magnet: () => `${next ? "Next" : "Current"}: ${value(player.pointMagnetRadius, 85)}px range`,
            autoMissile: () => {
                const nextLevel = player.missileLevel + (next ? 1 : 0);
                const count = nextLevel > 0 ? Math.max(1, Math.ceil(nextLevel / 3)) : 0;
                const damage = player.missileDamage + (next ? 9 : 0);
                return `${next ? "Next" : "Current"}: ${count} missile${count === 1 ? "" : "s"} / ${damage} dmg`;
            },
            damageAura: () => {
                const nextLevel = player.auraLevel + (next ? 1 : 0);
                const radius = nextLevel > 0 ? 135 + Math.floor((nextLevel - 1) / 4) * 28 : 0;
                const damage = player.auraDamage + (next ? 22 : 0);
                return `${next ? "Next" : "Current"}: ${damage} dmg / ${radius}px radius`;
            },
            riftPower: () => `${next ? "Next" : "Current"}: ${Math.round((1 + (upgradeLevels.riftPower + (next ? 1 : 0)) * 0.16) * 100)}% quantum damage`,
            riftFrequency: () => `${next ? "Next" : "Current"}: ${upgradeLevels.riftFrequency + (next ? 1 : 0)} cascade investment`,
            healthRegen: () => `${next ? "Next" : "Current"}: ${(player.regenPerSecond + (next ? 0.15 : 0)).toFixed(2)} HP/s`,
            lifeSteal: () => `${next ? "Next" : "Current"}: ${player.lifeStealAmount + (next ? 1 : 0)}% weapon steal`,
            maxHealth: () => `${next ? "Next" : "Current"}: ${value(player.maxHealth, 15)} max HP`,
        };

        return statMap[type]?.() ?? `${next ? "Next" : "Current"}: Level ${level}`;
    }

    /**
     * Rebuilds upgrade-card labels and enabled states from current player data. Inner card elements should remain pointer-transparent.
     */
    function updateUpgradeButtons() {
        ui.menuPoints.textContent = state.upgradePoints;

        for (const button of upgradeButtons) {
            const type = button.dataset.upgrade;
            const data = UPGRADE_DATA[type];
            const cost = getUpgradeCost(type);
            const level = upgradeLevels[type];
            const isRiftDependent = type === "riftPower" || type === "riftFrequency";
            const riftUnlocked = Boolean(relicResearch.relic_purple_01?.awakened || (relicResearch.relic_purple_01?.stage || 0) > 0);
            const cannonUnlocked = Boolean(upgradeLevels.cannonUnlock || player.cannonDamage > 0);
            const isCannonDependent = ["cannonDamage", "cannonRate", "cannonVelocity", "cannonWarhead", "cannonCluster", "cannonQuantum"].includes(type);
            button.hidden = (isRiftDependent && !riftUnlocked) || (isCannonDependent && !cannonUnlocked);
            if (button.hidden) continue;

            const lockReason = getResearchLock(type);
            const maxed = Boolean(data.maxLevel && level >= data.maxLevel);
            const tierLabel = data.tier === "core" ? "CORE" : data.tier.toUpperCase();

            button.className = `upgrade-button upgrade-${data.category} system-${data.system} tier-${data.tier}`;
            button.style.setProperty("--upgrade-accent", data.accent);
            button.disabled = Boolean(lockReason || maxed || state.upgradePoints < cost);
            const stateText = lockReason ? `<span class="research-lock">LOCKED — ${lockReason}</span>`
                : maxed ? `<span class="research-complete">RESEARCH COMPLETE</span>`
                : `<span class="upgrade-next">${getUpgradeStatText(type, true)}</span>`;
            button.innerHTML = `
                <span class="upgrade-icon" aria-hidden="true">${data.icon}</span>
                <span class="upgrade-copy">
                    <span class="research-tier">${tierLabel}${data.system !== "hybrid" ? ` · ${SHIP_SYSTEMS[data.system].label}` : " · HYBRID"}</span>
                    <span class="upgrade-title">${data.label}</span>
                    <span class="upgrade-description">${data.description}</span>
                    <span class="upgrade-stats">${getUpgradeStatText(type)}<br>${stateText}</span>
                    <span class="upgrade-footer"><span class="upgrade-level">LV ${level}${data.maxLevel ? `/${data.maxLevel}` : ""}</span><span class="upgrade-cost">${maxed ? "ONLINE" : `${cost} PTS`}</span></span>
                </span>`;
            button.setAttribute("aria-label", `${data.label}, level ${level}, ${lockReason || (maxed ? "complete" : `costs ${cost} points`)}. ${data.description}`);
        }
        updateSystemInvestmentUI();
    }

    // -------------------------------------------------------------------------
    // Player movement / shooting
    // -------------------------------------------------------------------------
    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getPlayerMoveSpeed(now) {
        let speed = player.speed;
        if (now < player.speedBoostUntil) speed *= 1.45;
        if (now < player.slowUntil) speed *= player.slowMultiplier;
        return speed;
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    let lastPlayerMovementAt = 0;

    function updatePlayer(now) {
        let keyboardX = 0;
        let keyboardY = 0;

        if (keysHeld.w || keysHeld.arrowup) keyboardY--;
        if (keysHeld.s || keysHeld.arrowdown) keyboardY++;
        if (keysHeld.a || keysHeld.arrowleft) keyboardX--;
        if (keysHeld.d || keysHeld.arrowright) keyboardX++;

        // Keyboard remains digital/full-speed. Analog input preserves stick
        // magnitude, so a small thumb movement produces slow movement instead
        // of being normalized immediately to maximum speed.
        const keyboardLength = Math.hypot(keyboardX, keyboardY);
        if (keyboardLength > 0) {
            keyboardX /= keyboardLength;
            keyboardY /= keyboardLength;
        }

        let dx = keyboardX || analogInput.moveX;
        let dy = keyboardY || analogInput.moveY;

        // Clamp combined input to the unit circle without destroying analog
        // magnitude. This also prevents diagonal movement from becoming faster.
        const inputLength = Math.hypot(dx, dy);
        if (inputLength > 1) {
            dx /= inputLength;
            dy /= inputLength;
        }

        // Movement used to be measured in pixels per rendered frame, causing
        // 90/120 Hz mobile displays to move substantially faster than 60 Hz.
        // Normalize to a 60 Hz baseline and cap long-frame catch-up after pauses.
        const elapsedMs = lastPlayerMovementAt > 0 ? now - lastPlayerMovementAt : 1000 / 60;
        lastPlayerMovementAt = now;
        const frameScale = clamp(elapsedMs / (1000 / 60), 0.25, 1.75);

        const speed = getPlayerMoveSpeed(now);
        player.x += dx * speed * frameScale;
        player.y += dy * speed * frameScale;
        keepPlayerInWorld();
    }

    /**
     * Handles the shootPlayerWeapon operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function shootPlayerWeapon(now) {
        if (state.clearPhaseActive) return;
        const effectiveFireRate = now < (player.weaponBoostUntil || 0) ? Math.max(55, player.fireRate * 0.68) : player.fireRate;
        if (now - player.lastShotAt < effectiveFireRate) return;

        player.lastShotAt = now;
        player.volleyCounter++;

        const target = screenToWorld(mouse);
        const aimAngle = Math.atan2(target.y - player.y, target.x - player.x);
        player.lastAimAngle = aimAngle;
        const spread = 0.18;
        const centerOffset = (player.bulletsPerShot - 1) / 2;

        playSound("shoot");

        for (let i = 0; i < player.bulletsPerShot; i++) {
            const angle = aimAngle + (i - centerOffset) * spread;
            createPlayerBullet(angle);
        }
        if (player.autonomousArsenal && player.volleyCounter % 5 === 0) {
            createPlayerBullet(aimAngle - 0.30);
            createPlayerBullet(aimAngle + 0.30);
        }

        if (upgradeLevels.cannonUnlock || player.cannonDamage > 0) {
            const cannonRate = now < (player.weaponBoostUntil || 0)
                ? Math.max(360, player.cannonFireRate * 0.68)
                : player.cannonFireRate;
            if (now - player.lastCannonShotAt >= cannonRate) {
                player.lastCannonShotAt = now;
                createCannonShell(aimAngle);
            }
        }
    }

    function createCannonShell(angle) {
        bullets.push({
            kind: "cannon",
            x: player.x + Math.cos(angle) * 27,
            y: player.y + Math.sin(angle) * 27,
            r: GAMEPLAY_CONSTANTS.cannon.shellRadius,
            dx: Math.cos(angle) * (GAMEPLAY_CONSTANTS.cannon.baseShellSpeed * (1 + player.cannonVelocity * GAMEPLAY_CONSTANTS.cannon.velocityBonusPerLevel)),
            dy: Math.sin(angle) * (GAMEPLAY_CONSTANTS.cannon.baseShellSpeed * (1 + player.cannonVelocity * GAMEPLAY_CONSTANTS.cannon.velocityBonusPerLevel)),
            damage: Math.max(GAMEPLAY_CONSTANTS.cannon.baseDamage, player.cannonDamage),
            damageSource: upgradeLevels.cannonQuantum ? "quantum" : "bullet",
            explosive: Boolean(upgradeLevels.cannonWarhead),
            explosionRadius: GAMEPLAY_CONSTANTS.cannon.warheadRadius,
            explosionDamage: Math.max(12, Math.floor(Math.max(GAMEPLAY_CONSTANTS.cannon.baseDamage, player.cannonDamage) * GAMEPLAY_CONSTANTS.cannon.warheadDamageRatio)),
            cluster: Boolean(upgradeLevels.cannonCluster),
            hitEnemyIds: new Set(),
        });
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createPlayerBullet(angle) {
        bullets.push({
            kind: "primary",
            x: player.x + Math.cos(angle) * 24,
            y: player.y + Math.sin(angle) * 24,
            r: player.explosiveLevel > 0 ? 6 : 5,
            dx: Math.cos(angle) * player.bulletSpeed,
            dy: Math.sin(angle) * player.bulletSpeed,
            damage: player.damage,
            damageSource: "bullet",
            explosive: player.explosiveLevel > 0,
            explosionRadius: player.explosiveRadius,
            explosionDamage: Math.max(2, Math.floor(player.damage * player.explosiveDamageRatio)),
        });
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateAutoMissiles(now) {
        if (player.missileCount <= 0 || state.clearPhaseActive) return;
        if (now - player.lastMissileAt < player.missileCooldown) return;

        const targets = getNearestEnemies(player.missileCount);
        if (targets.length === 0) return;

        player.lastMissileAt = now;
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const angle = Math.atan2(target.y - player.y, target.x - player.x) + (i - (targets.length - 1) / 2) * 0.18;
            missiles.push({
                x: player.x + Math.cos(angle) * 30,
                y: player.y + Math.sin(angle) * 30,
                r: GAMEPLAY_CONSTANTS.cannon.shellRadius,
                dx: Math.cos(angle) * 6.4,
                dy: Math.sin(angle) * 6.4,
                speed: 6.4,
                turnRate: 0.12,
                damage: player.missileDamage,
                explosionRadius: 58 + Math.floor(player.missileLevel / 4) * 6,
                explosionDamage: Math.max(4, Math.floor(player.missileDamage * 0.45)),
                life: 190,
                target,
            });
        }
        playSound("shoot");
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getNearestEnemies(limit) {
        return enemies
            .filter(enemy => enemy && !enemy.dead)
            .sort((a, b) => distance(player, a) - distance(player, b))
            .slice(0, limit);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateMissiles() {
        for (const missile of missiles) {
            if (!missile || missile.dead) continue;

            missile.life--;
            if (missile.life <= 0) {
                missile.dead = true;
                continue;
            }

            if (!missile.target || missile.target.dead) {
                missile.target = getNearestEnemies(1)[0] || null;
            }

            if (missile.target) {
                const desiredAngle = Math.atan2(missile.target.y - missile.y, missile.target.x - missile.x);
                const currentAngle = Math.atan2(missile.dy, missile.dx);
                const angleDelta = Math.atan2(Math.sin(desiredAngle - currentAngle), Math.cos(desiredAngle - currentAngle));
                const nextAngle = currentAngle + clamp(angleDelta, -missile.turnRate, missile.turnRate);
                missile.dx = Math.cos(nextAngle) * missile.speed;
                missile.dy = Math.sin(nextAngle) * missile.speed;
            }

            missile.x += missile.dx;
            missile.y += missile.dy;

            if (isOutsideWorld(missile, 80)) {
                missile.dead = true;
            }
        }

        checkMissileHits();
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkMissileHits() {
        for (const missile of missiles) {
            if (!missile || missile.dead) continue;

            for (let enemyIndex = enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
                const enemy = enemies[enemyIndex];
                if (!enemy || enemy.dead) continue;
                if (distance(missile, enemy) >= missile.r + enemy.r) continue;

                missile.dead = true;
                damageEnemy(enemyIndex, missile.damage, "missile");
                explodeAt(missile.x, missile.y, missile.explosionRadius, missile.explosionDamage, enemy);
                break;
            }
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateDamageAura(now) {
        if (player.auraLevel <= 0 || player.auraRadius <= 0) return;
        if (now - player.lastAuraTickAt < player.auraTickRate) return;

        player.lastAuraTickAt = now;
        let hitSomething = false;

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead) continue;
            if (distance(player, enemy) > player.auraRadius + enemy.r) continue;

            enemy.auraFlashUntil = now + 180;
            damageEnemy(i, player.auraDamage, "aura");
            addDamageNumber(enemy.x, enemy.y - enemy.r - 12, player.auraDamage, "#63d7ff");
            hitSomething = true;
        }

        if (hitSomething) {
            particles.push({
                x: player.x, y: player.y, dx: 0, dy: 0, r: player.auraRadius,
                color: "#63d7ff", life: 16, maxLife: 16, auraRing: true,
            });
        }
    }

    // -------------------------------------------------------------------------
    // Relic runtime systems
    // -------------------------------------------------------------------------
    function getAwakenedRelicStage(id) {
        return relicResearch[id]?.awakened ? Math.max(1, relicResearch[id].stage) : 0;
    }

    function updateRelicSystems(now) {
        updateVerdantCore(now);
        updateAstralLens(now);
        updateGravityHeart(now);
        updateEchoingSwarm(now);
    }

    function updateVerdantCore(now) {
        const stage = getAwakenedRelicStage("relic_green_01");
        relicOrbs.length = 0;
        if (!stage) { relicGreen.appliedStage = 0; return; }
        if (relicGreen.appliedStage !== stage) {
            const previousBonus = relicGreen.appliedStage ? 30 + relicGreen.appliedStage * 25 : 0;
            const newBonus = 30 + stage * 25;
            player.maxHealth += newBonus - previousBonus;
            player.health = Math.min(player.maxHealth, player.health + Math.max(0, newBonus - previousBonus));
            player.maxShield = Math.max(player.maxShield, 35 + stage * 35);
            player.shield = Math.min(player.maxShield, player.shield + 25 + stage * 20);
            relicGreen.appliedStage = stage;
        }
        if (now < relicGreen.nextRepairAt) return;
        relicGreen.nextRepairAt = now + Math.max(4200, 8500 - stage * 1100);
        const heal = 7 + stage * 6;
        const shieldGain = 12 + stage * 10;
        const oldHealth = player.health, oldShield = player.shield;
        player.health = Math.min(player.maxHealth, player.health + heal);
        player.shield = Math.min(player.maxShield, player.shield + shieldGain);
        if (player.health > oldHealth || player.shield > oldShield) {
            particles.push({ x:player.x, y:player.y, dx:0, dy:0, r:player.r*2.1, color:"#62ff9b", life:20, maxLife:20, auraRing:true });
            addDamageNumber(player.x, player.y - 34, `+${Math.floor(player.health-oldHealth)} HP / +${Math.floor(player.shield-oldShield)} SH`, "#62ff9b");
        }
    }

    function updateAstralLens(now) {
        const stage = getAwakenedRelicStage("relic_red_01");
        if (!stage) return;
        const cooldown = Math.max(6500, 12500 - stage * 1900);
        if (now >= relicLaser.nextAt && now >= relicLaser.activeUntil) {
            const aim = screenToWorld(mouse);
            relicLaser.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
            relicLaser.activeUntil = now + 360 + stage * 90;
            relicLaser.nextAt = now + cooldown;
            relicLaser.hitIds = new Set();
            playSound("upgrade");
        }
        if (now >= relicLaser.activeUntil) return;
        const width = 16 + stage * 7;
        const ax = Math.cos(relicLaser.angle), ay = Math.sin(relicLaser.angle);
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead || relicLaser.hitIds.has(enemy)) continue;
            const rx = enemy.x - player.x, ry = enemy.y - player.y;
            const forward = rx * ax + ry * ay;
            const lateral = Math.abs(rx * ay - ry * ax);
            if (forward > 0 && forward < 1500 && lateral < width + enemy.r) {
                relicLaser.hitIds.add(enemy);
                damageEnemy(i, 70 + stage * 45, "weaponRelic");
            }
        }
    }

    function updateGravityHeart(now) {
        // Momentum Veil is event-driven: enemy deaths can drop overdrive fragments.
        // The runtime update only keeps the compatibility pulse dormant.
        relicPulse.visualUntil = 0;
    }

    function updateEchoingSwarm(now) {
        const stage = getAwakenedRelicStage("relic_purple_01");
        relicDrones.length = 0;
        if (!stage) { relicRifts.length = 0; return; }
        const desired = 1 + stage;
        if (now >= nextRelicRiftAt && relicRifts.length < desired) {
            const angle = Math.random() * TWO_PI;
            const distanceFromPlayer = 95 + Math.random() * (85 + stage * 20);
            relicRifts.push({
                // Rifts are fixed tears in world space. They spawn near the ship,
                // but never orbit or follow it after opening.
                x: player.x + Math.cos(angle) * distanceFromPlayer,
                y: player.y + Math.sin(angle) * distanceFromPlayer * .72,
                radius: 34 + stage * 9,
                bornAt: now,
                expiresAt: now + 5000 + stage * 1400 + (upgradeLevels.riftFrequency || 0) * 500,
                nextDamageAt: now,
                spin: Math.random() < .5 ? -1 : 1,
                phase: Math.random() * TWO_PI,
            });
            nextRelicRiftAt = now + Math.max(650, 2300 - stage * 350 - (upgradeLevels.riftFrequency || 0) * 120);
        }
        for (let i=relicRifts.length-1;i>=0;i--) {
            const rift=relicRifts[i];
            if (now >= rift.expiresAt) { relicRifts.splice(i,1); continue; }
            // Deliberately static in world space: only the internal distortion animates.
            if (now < rift.nextDamageAt) continue;
            rift.nextDamageAt = now + Math.max(220, 520 - stage * 70);
            for (let e=enemies.length-1;e>=0;e--) {
                const enemy=enemies[e];
                if (!enemy || enemy.dead || distance(rift,enemy) > rift.radius + enemy.r) continue;
                damageEnemy(e, (10 + stage * 9) * (1 + (upgradeLevels.riftPower || 0) * 0.16), "quantum");
                enemy.riftFlashUntil = now + 160;
            }
        }
    }

    function drawRelicSystems(now = Date.now()) {
        const greenStage = getAwakenedRelicStage("relic_green_01");
        if (greenStage && player.maxShield > 0) {
            const ratio = clamp(player.shield / player.maxShield, 0, 1);
            ctx.save(); ctx.strokeStyle=`rgba(92,255,150,${.18 + ratio*.55})`; ctx.lineWidth=2+greenStage;
            ctx.beginPath(); ctx.arc(player.x-camera.x, player.y-camera.y, player.r*(1.45+ratio*.1), 0, TWO_PI); ctx.stroke(); ctx.restore();
        }
        if (now < relicLaser.activeUntil) {
            const sx = player.x - camera.x, sy = player.y - camera.y;
            const length = 1600;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = "rgba(255,120,90,.9)";
            ctx.lineWidth = 10 + getAwakenedRelicStage("relic_red_01") * 5;
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(relicLaser.angle) * length, sy + Math.sin(relicLaser.angle) * length); ctx.stroke();
            ctx.strokeStyle = "white"; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
        }
        for (const rift of relicRifts) {
            const x=rift.x-camera.x, y=rift.y-camera.y;
            const remaining=clamp((rift.expiresAt-now)/1800,0,1);
            const opening=clamp((now-rift.bornAt)/320,0,1);
            const alpha=Math.min(opening, remaining);
            const pulse=1 + Math.sin(now/210 + rift.phase) * .07;
            ctx.save();
            ctx.translate(x,y);
            ctx.scale(opening * pulse, opening * pulse);
            ctx.globalCompositeOperation="lighter";
            ctx.shadowColor="#c66dff"; ctx.shadowBlur=18 + 8 * pulse;
            ctx.strokeStyle=`rgba(195,95,255,${(.38+.48*alpha)})`; ctx.lineWidth=5;
            ctx.rotate((now-rift.bornAt)/900*rift.spin);
            ctx.beginPath(); ctx.arc(0,0,rift.radius,0,TWO_PI); ctx.stroke();
            ctx.rotate(-(now-rift.bornAt)/520*rift.spin);
            ctx.strokeStyle=`rgba(245,220,255,${.55+.35*alpha})`; ctx.lineWidth=1.5;
            ctx.beginPath(); ctx.arc(0,0,rift.radius*.68,.25,TWO_PI-.65); ctx.stroke();
            ctx.fillStyle=`rgba(75,10,110,${.18+.18*alpha})`;
            ctx.beginPath(); ctx.arc(0,0,rift.radius*.48,0,TWO_PI); ctx.fill();
            ctx.restore();
        }
    }

    // -------------------------------------------------------------------------
