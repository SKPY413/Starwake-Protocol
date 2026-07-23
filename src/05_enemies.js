    // Enemies
    // -------------------------------------------------------------------------
    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    let nextBossCommandId = 1;

    // Enemy technology advances in ten-wave generations. Mutations are assigned
    // selectively so later combat gains new decisions without making every unit
    // visually or mechanically identical.
    function getEnemyGeneration() {
        return Math.max(
            1,
            Math.min(
                GAMEPLAY_CONSTANTS.evolution.maxGeneration,
                1 + Math.floor((state.wave - 1) / GAMEPLAY_CONSTANTS.evolution.wavesPerGeneration)
            )
        );
    }

    function getEnemyMutationPool(type, generation) {
        const pool = [];
        if (generation >= 2 && ["normal", "runner", "dodger", "fighter"].includes(type)) pool.push("blink");
        if (generation >= 2 && ["fighter", "dodger"].includes(type)) pool.push("bomb");
        if (generation >= 3 && ["normal", "brute", "fighter", "dodger"].includes(type)) pool.push("burst");
        if (generation >= 3 && ["brute", "tank", "miniTank", "fighter"].includes(type)) pool.push("spread");
        return pool;
    }

    function assignEnemyMutations(type, generation) {
        if (["boss", "gigaBoss", "carrier", "aegis"].includes(type)) return [];
        const pool = getEnemyMutationPool(type, generation);
        if (!pool.length) return [];
        const desired = generation >= GAMEPLAY_CONSTANTS.evolution.multiMutationGeneration ? 2 : 1;
        const mutations = [];
        while (pool.length && mutations.length < desired) {
            const index = Math.floor(Math.random() * pool.length);
            mutations.push(pool.splice(index, 1)[0]);
        }
        return mutations;
    }

    function makeEnemy(type, position) {
        const stats = getEnemyStats(type);
        const generation = getEnemyGeneration();
        const enemy = {
            type,
            x: position.x,
            y: position.y,
            color: ENEMY_COLORS[type],
            generation,
            mutations: assignEnemyMutations(type, generation),
            lastHitAt: 0,
            lastShotAt: 0,
            nextBlinkAt: performance.now() + randomRange(3800, 7200),
            blinkChargeUntil: 0,
            blinkTargetX: 0,
            blinkTargetY: 0,
            nextBombAt: performance.now() + randomRange(3800, 6500),
            ...stats,
        };

        // Evolved low-tier hulls become physically larger each generation so
        // players can identify dangerous mutations before they fire. This also
        // slightly increases their collision footprint, matching the visual size.
        const evolvedLowTier = ["normal", "runner", "brute", "tank", "fighter", "dodger"].includes(type);
        if (evolvedLowTier && generation > 1) {
            const generationScale = GAMEPLAY_CONSTANTS.evolution.hullScaleByGeneration[generation] || GAMEPLAY_CONSTANTS.evolution.hullScaleByGeneration.at(-1);
            enemy.evolutionScale = generationScale;
            enemy.r = Math.round(enemy.r * generationScale);
        } else {
            enemy.evolutionScale = 1;
        }

        // Late-game Quantum Null adaptation. These enemies force the player to
        // rely on primary weapons or conventional autonomous systems instead of
        // allowing Rift Tearer to solve every formation.
        if (state.wave >= GAMEPLAY_CONSTANTS.evolution.quantumNullStartWave && !["boss", "gigaBoss", "aegis"].includes(type)) {
            const nullChance = Math.min(
                GAMEPLAY_CONSTANTS.evolution.quantumNullMaxChance,
                GAMEPLAY_CONSTANTS.evolution.quantumNullBaseChance +
                    (state.wave - GAMEPLAY_CONSTANTS.evolution.quantumNullStartWave) * GAMEPLAY_CONSTANTS.evolution.quantumNullChancePerWave
            );
            enemy.quantumImmune = Math.random() < nullChance;
        }

        if (type === "miniTank") {
            const roles = ["healer", "superTank", "sniper"];
            enemy.miniBossRole = roles[Math.floor(Math.random() * roles.length)];
            enemy.nextSupportAt = performance.now() + randomRange(1800, 3200);

            if (enemy.miniBossRole === "healer") {
                enemy.color = "#72f0a6";
                enemy.health = Math.round(enemy.health * 0.82);
                enemy.maxHealth = enemy.health;
                enemy.shootCooldown = 2100;
                enemy.healRadius = GAMEPLAY_CONSTANTS.healer.radius;
            } else if (enemy.miniBossRole === "superTank") {
                enemy.color = "#b878ff";
                enemy.health = Math.round(enemy.health * 1.85);
                enemy.maxHealth = enemy.health;
                enemy.speed *= 0.62;
                enemy.shootCooldown = 1750;
            } else {
                enemy.color = "#ffcf70";
                enemy.health = Math.round(enemy.health * 0.72);
                enemy.maxHealth = enemy.health;
                enemy.speed *= 0.82;
                enemy.shootCooldown = 2500;
                enemy.sniperRange = 1120;
            }
        }

        if (type === "boss" || type === "gigaBoss") {
            enemy.commandId = nextBossCommandId++;
            enemy.commandNextAt = 0;
            enemy.commandPoints = 0;
            enemy.commandPhaseMask = 0;
        }

        return enemy;
    }

    /**
     * Builds final enemy stats from base archetype values plus difficulty and wave scaling. Return fresh data; do not mutate shared constants.
     */
    function getEnemyStats(type) {
        const wave = state.wave;
        const difficulty = getDifficulty();
        const scaledWave = 1 + Math.max(0, wave - 1) * difficulty.enemyGrowth;

        const statsByType = {
            normal: {
                r: 18,
                speed: 1.45 + scaledWave * 0.14,
                health: 30 + scaledWave * 10,
                damage: 12,
                reward: 12,
            },
            runner: {
                r: 13,
                speed: 2.7 + scaledWave * 0.18,
                health: 18 + scaledWave * 6,
                damage: 12,
                reward: 18,
            },
            brute: {
                r: 23,
                speed: 1.25 + scaledWave * 0.1,
                health: 65 + scaledWave * 16,
                damage: 22,
                reward: 30,
                shootCooldown: Math.max(1100, 2100 - scaledWave * 35),
            },
            tank: {
                r: 30,
                speed: 0.85 + scaledWave * 0.06,
                health: 110 + scaledWave * 24,
                damage: 30,
                reward: 45,
            },
            miniTank: {
                r: 42,
                speed: 0.72 + scaledWave * 0.045,
                health: 360 + scaledWave * 42,
                damage: 36,
                reward: 115 + scaledWave * 6,
                shootCooldown: Math.max(850, 1850 - scaledWave * 32),
            },
            fighter: {
                r: 16,
                speed: 2.65 + scaledWave * 0.11,
                health: 28 + scaledWave * 7,
                damage: 16,
                reward: 28,
                shootCooldown: Math.max(520, 1150 - scaledWave * 20),
                orbitRadius: 250 + Math.random() * 90,
                orbitDirection: Math.random() < 0.5 ? -1 : 1,
                orbitPhase: Math.random() * TWO_PI,
            },
            aegis: {
                r: 34,
                speed: 0.42 + scaledWave * 0.018,
                health: 720 + scaledWave * 78,
                damage: 12,
                reward: 150 + scaledWave * 8,
                shieldRadius: GAMEPLAY_CONSTANTS.aegis.shieldRadius,
            },
            carrier: {
                r: 62,
                speed: 0.24 + scaledWave * 0.012,
                health: (2350 + scaledWave * 260) * (wave <= 15 ? 0.90 : 1),
                damage: 48,
                reward: 230 + scaledWave * 12,
                // The carrier cannon is intentionally independent from its missile factory.
                shootCooldown: Math.max(620, 1250 - scaledWave * 16),
                missileInitialVolleyPending: true,
                nextMissileVolleyAt: 0,
                launchChargeUntil: 0,
                pendingLaunchCount: 0,
                carrierOrbitDirection: Math.random() < 0.5 ? -1 : 1,
                carrierOrbitPhase: Math.random() * TWO_PI,
            },
            dodger: {
                r: 15,
                speed: 2.15 + scaledWave * 0.13,
                health: 22 + scaledWave * 8,
                damage: 14,
                reward: 25,
                dashRange: 360,
                dashDuration: 260,
                dashCooldown: 950,
                dashUntil: 0,
                nextDashAt: 0,
                dashVectorX: 0,
                dashVectorY: 0,
                speedMultiplier: 1,
            },
            boss: {
                r: 54,
                speed: 0.72 + scaledWave * 0.035,
                health: 900 + scaledWave * 145,
                damage: 42,
                reward: 260 + scaledWave * 18,
                shootCooldown: Math.max(900, 1700 - scaledWave * 25),
                commandNextAt: 0,
                commandPoints: 0,
                commandPhaseMask: 0,
                commandId: 0,
            },
            gigaBoss: {
                r: 78,
                speed: 0.48 + scaledWave * 0.025,
                health: 2600 + scaledWave * 260,
                damage: 65,
                reward: 750 + scaledWave * 35,
                shootCooldown: Math.max(650, 1450 - scaledWave * 22),
                commandNextAt: 0,
                commandPoints: 0,
                commandPhaseMask: 0,
                commandId: 0,
            },
        };

        const stats = { ...statsByType[type] };

        stats.health = Math.max(1, Math.round(stats.health * difficulty.enemyHealth));
        stats.maxHealth = stats.health;
        const damageRamp = 1 + Math.max(0, wave - 1) * difficulty.damageGrowth;
        stats.damage = Math.max(1, Math.round(stats.damage * difficulty.enemyDamage * damageRamp));
        // Global playtester accessibility pass: all enemies retain their relative archetype/difficulty
        // differences, but move at 60% of the previous final speed. Tune this single multiplier
        // rather than editing every archetype independently.
        stats.speed *= difficulty.enemySpeed * 0.60;
        stats.reward = Math.max(1, Math.round(stats.reward * difficulty.enemyReward));

        return stats;
    }

    /**
     * Selects an archetype using wave gates and weighted chances. Preserve readable unlock rules so early-wave pacing stays tunable.
     */
    function chooseEnemyType() {
        const spawnNumber = state.enemiesSpawned;
        const difficulty = getDifficulty();
        const unlock = baseWave => Math.max(1, baseWave + difficulty.typeUnlockOffset);

        if (isGigaBossWave() && spawnNumber === 0) return "gigaBoss";
        if (isGigaBossWave() && (spawnNumber === 1 || spawnNumber === 2)) return "boss";
        if (isBossWave() && spawnNumber === 0) return "boss";
        if (state.wave >= unlock(35) && spawnNumber > 7 && spawnNumber % 22 === 0 && !enemies.some(enemy => enemy && !enemy.dead && enemy.type === "aegis")) return "aegis";
        if (state.wave >= unlock(14) && spawnNumber > 5 && spawnNumber % 18 === 0) return "carrier";

        // Waves 20-40 should read as armies led by occasional specialists, not
        // a parade of mini-bosses. Preserve their roles while cutting density.
        const reducedMiniBossWindow = state.wave >= 20 && state.wave <= 40;
        const miniBossInterval = reducedMiniBossWindow ? 28 : 14;
        const miniBossChance = difficulty.miniTankChance * (reducedMiniBossWindow ? 0.35 : 1);
        if (state.wave >= unlock(10) && spawnNumber > 2 && spawnNumber % miniBossInterval === 0) return "miniTank";
        if (state.wave >= unlock(11) && Math.random() < miniBossChance) return "miniTank";

        // Weighted selection avoids overlapping roll thresholds. The old ordered
        // threshold chain made tanks unreachable once dodgers unlocked, which is
        // why some low-tier enemies appeared to vanish from later waves.
        const pool = [{ type: "normal", weight: 24 }];
        if (state.wave >= unlock(3)) pool.push({ type: "runner", weight: 20 });
        if (state.wave >= unlock(4)) pool.push({ type: "tank", weight: 14 });
        if (state.wave >= unlock(5)) pool.push({ type: "brute", weight: 17 });
        if (state.wave >= unlock(6)) pool.push({ type: "dodger", weight: 14 });
        if (state.wave >= unlock(8)) pool.push({ type: "fighter", weight: 11 });

        const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const entry of pool) {
            roll -= entry.weight;
            if (roll <= 0) return entry.type;
        }
        return "normal";
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnEnemy() {
        const position = getSpawnPosition();
        const enemyType = chooseEnemyType();
        const enemy = makeEnemy(enemyType, position);
        enemies.push(enemy);

        if (enemyType === "boss" || enemyType === "gigaBoss") {
            playSound("bossSpawn");
        } else if (enemyType === "miniTank" || enemyType === "carrier") {
            playSound("miniBossSpawn");
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getSpawnPosition() {
        const margin = 140;
        const side = Math.floor(Math.random() * 4);
        let x;
        let y;

        if (side === 0) {
            x = camera.x + Math.random() * getVisibleWorldWidth();
            y = camera.y - margin;
        } else if (side === 1) {
            x = camera.x + getVisibleWorldWidth() + margin;
            y = camera.y + Math.random() * getVisibleWorldHeight();
        } else if (side === 2) {
            x = camera.x + Math.random() * getVisibleWorldWidth();
            y = camera.y + getVisibleWorldHeight() + margin;
        } else {
            x = camera.x - margin;
            y = camera.y + Math.random() * getVisibleWorldHeight();
        }

        const position = pushSpawnAwayFromPlayer({
            x: clamp(x, 40, WORLD.width - 40),
            y: clamp(y, 40, WORLD.height - 40),
        });

        return position;
    }

    /**
     * Handles the pushSpawnAwayFromPlayer operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function pushSpawnAwayFromPlayer(position) {
        const minimumDistance = getDifficulty().minimumSpawnDistance || 480;
        if (distance(position, player) >= minimumDistance) return position;

        const angle = Math.atan2(position.y - player.y, position.x - player.x);
        return {
            x: clamp(player.x + Math.cos(angle) * minimumDistance, 40, WORLD.width - 40),
            y: clamp(player.y + Math.sin(angle) * minimumDistance, 40, WORLD.height - 40),
        };
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateEnemySpawning() {
        if (state.clearPhaseActive) return;
        state.spawnTimer++;
        const spawnDelay = Math.max(9, (42 - state.wave * 1.5) * getDifficulty().spawnDelay);

        const difficultyConcurrentCap = getDifficulty().maxConcurrent || PERFORMANCE_LIMITS.maxEnemies;
        const concurrentCap = Math.min(PERFORMANCE_LIMITS.maxEnemies, Math.round(difficultyConcurrentCap * (PLATFORM_PROFILE.spawnMultiplier || 1)));

        if (state.enemiesSpawned < state.enemiesToSpawn && state.spawnTimer > spawnDelay && enemies.length < concurrentCap) {
            spawnEnemy();
            state.enemiesSpawned++;
            state.spawnTimer = 0;
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateEnemyEvolution(enemy, now) {
        const mutations = enemy.mutations || [];

        if (mutations.includes("blink")) {
            if (enemy.blinkChargeUntil && now >= enemy.blinkChargeUntil) {
                enemy.x = clamp(enemy.blinkTargetX, enemy.r, WORLD.width - enemy.r);
                enemy.y = clamp(enemy.blinkTargetY, enemy.r, WORLD.height - enemy.r);
                enemy.blinkChargeUntil = 0;
                enemy.nextBlinkAt = now + randomRange(5800, 9000);
                spawnPickupBurst(enemy.x, enemy.y, "#8cecff", 14, false);
                explosions.push({ x: enemy.x, y: enemy.y, radius: 72, life: 9, maxLife: 9, harmless: true });
            } else if (!enemy.blinkChargeUntil && now >= enemy.nextBlinkAt) {
                const healthRatio = enemy.health / Math.max(1, enemy.maxHealth);
                const closeDanger = distance(enemy, player) < 230;
                if (healthRatio < 0.58 || closeDanger) {
                    const away = Math.atan2(enemy.y - player.y, enemy.x - player.x) + randomRange(-0.55, 0.55);
                    const blinkDistance = randomRange(190, 310);
                    enemy.blinkTargetX = enemy.x + Math.cos(away) * blinkDistance;
                    enemy.blinkTargetY = enemy.y + Math.sin(away) * blinkDistance;
                    enemy.blinkChargeUntil = now + 330;
                } else {
                    enemy.nextBlinkAt = now + 1200;
                }
            }
        }

        if (mutations.includes("bomb") && now >= enemy.nextBombAt && distance(enemy, player) < 620) {
            enemy.nextBombAt = now + randomRange(6200, 9200);
            enemyBullets.push({
                x: enemy.x, y: enemy.y, r: 11, dx: 0, dy: 0,
                damage: Math.max(10, Math.round(enemy.damage * 0.90)),
                color: "#ff9d46", isBomb: true,
                bornAt: now,
                armedAt: now + 520,
                explodeAt: now + 2450,
                triggerRadius: 130,
                blastRadius: 112,
            });
        }
    }

    function updateEnemies(now) {
        updateEnemySpawning();

        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;

            updateEnemyEvolution(enemy, now);
            const movement = getEnemyMovement(enemy, now);
            const speedMultiplier = (enemy.speedMultiplier || 1) * (now < (enemy.relicSlowUntil || 0) ? 0.55 : 1);
            const evolutionMoveMultiplier = enemy.blinkChargeUntil ? 0.18 : 1;

            enemy.x = clamp(enemy.x + movement.x * enemy.speed * speedMultiplier * evolutionMoveMultiplier, enemy.r, WORLD.width - enemy.r);
            enemy.y = clamp(enemy.y + movement.y * enemy.speed * speedMultiplier * evolutionMoveMultiplier, enemy.r, WORLD.height - enemy.r);
        }

        resolveEnemyCrowding();

        for (const enemy of enemies) {
            if (!enemy || enemy.dead) continue;
            if (enemy.type === "carrier") updateCarrierSystems(enemy, now);
            if (enemy.type === "miniTank") updateMiniBossSystems(enemy, now);
            if (enemy.type === "boss" || enemy.type === "gigaBoss") updateBossCommandSystems(enemy, now);
            if (canEnemyShoot(enemy)) shootEnemy(enemy, now);
            damagePlayerOnTouch(enemy, now);
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getEnemyMovement(enemy, now) {
        let dx = player.x - enemy.x;
        let dy = player.y - enemy.y;
        const length = Math.hypot(dx, dy);

        if (length > 0) {
            dx /= length;
            dy /= length;
        }

        if (enemy.type === "miniTank") {
            const desired = enemy.miniBossRole === "sniper" ? 720 : enemy.miniBossRole === "healer" ? 420 : 250;
            if (length < desired - 55) return addEnemySeparationSteering(enemy, -dx, -dy);
            if (length > desired + 80) return addEnemySeparationSteering(enemy, dx, dy);
            return addEnemySeparationSteering(enemy, -dy * 0.22, dx * 0.22);
        }
        if (enemy.type === "dodger") {
            return getDodgerMovement(enemy, dx, dy, now);
        }
        if (enemy.type === "fighter") {
            return getFighterMovement(enemy, dx, dy, now);
        }
        if (enemy.type === "aegis") {
            const desired = 330;
            if (length < desired - 45) return addEnemySeparationSteering(enemy, -dx, -dy);
            if (length > desired + 80) return addEnemySeparationSteering(enemy, dx, dy);
            return addEnemySeparationSteering(enemy, -dy * 0.28, dx * 0.28);
        }
        if (enemy.type === "carrier") {
            if (enemy.launchChargeUntil && now < enemy.launchChargeUntil) return { x: 0, y: 0 };
            return getCarrierMovement(enemy, dx, dy, now);
        }

        return addEnemySeparationSteering(enemy, dx, dy);
    }

    /**
     * Handles the addEnemySeparationSteering operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addEnemySeparationSteering(enemy, baseX, baseY) {
        const separation = getEnemySeparationVector(enemy);
        if (!separation.active) return { x: baseX, y: baseY };

        return normalizeVector(
            baseX + separation.x * separation.weight,
            baseY + separation.y * separation.weight
        );
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getEnemySeparationVector(enemy) {
        let pushX = 0;
        let pushY = 0;
        let strongestPush = 0;

        for (const other of enemies) {
            if (!other || other.dead || other === enemy) continue;

            const dx = enemy.x - other.x;
            const dy = enemy.y - other.y;
            const dist = Math.hypot(dx, dy) || 0.001;
            const avoidDistance = enemy.r + other.r + 34;

            if (dist >= avoidDistance) continue;

            const pressure = 1 - dist / avoidDistance;
            const sizeBias = clamp(other.r / Math.max(1, enemy.r), 0.55, 2.4);

            pushX += (dx / dist) * pressure * sizeBias;
            pushY += (dy / dist) * pressure * sizeBias;
            strongestPush = Math.max(strongestPush, pressure);
        }

        const normalized = normalizeVector(pushX, pushY);
        return {
            x: normalized.x,
            y: normalized.y,
            weight: 1.25 + strongestPush * 2.4,
            active: strongestPush > 0,
        };
    }

    /**
     * Handles the resolveEnemyCrowding operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function resolveEnemyCrowding() {
        const aliveCount = enemies.reduce((count, enemy) => count + (enemy && !enemy.dead ? 1 : 0), 0);
        const passes = aliveCount > 70 ? 1 : 2;
        let testedPairs = 0;

        for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i < enemies.length; i++) {
                const a = enemies[i];
                if (!a || a.dead) continue;

                for (let j = i + 1; j < enemies.length; j++) {
                    if (++testedPairs > PERFORMANCE_LIMITS.maxCrowdingPairs) return;
                    const b = enemies[j];
                    if (!b || b.dead) continue;

                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const roughRange = a.r + b.r + 8;
                    if (Math.abs(dx) > roughRange || Math.abs(dy) > roughRange) continue;

                    const dist = Math.hypot(dx, dy) || 0.001;
                    const minDist = a.r + b.r + 3;

                    if (dist >= minDist) continue;

                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = (minDist - dist) * 0.54;

                    const aMass = a.r * a.r;
                    const bMass = b.r * b.r;
                    const totalMass = aMass + bMass;
                    const aMove = overlap * (bMass / totalMass);
                    const bMove = overlap * (aMass / totalMass);

                    a.x = clamp(a.x - nx * aMove, a.r, WORLD.width - a.r);
                    a.y = clamp(a.y - ny * aMove, a.r, WORLD.height - a.r);
                    b.x = clamp(b.x + nx * bMove, b.r, WORLD.width - b.r);
                    b.y = clamp(b.y + ny * bMove, b.r, WORLD.height - b.r);
                }
            }
        }
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getFighterMovement(enemy, baseX, baseY, now) {
        const dist = distance(enemy, player);
        const tangentX = -baseY * enemy.orbitDirection;
        const tangentY = baseX * enemy.orbitDirection;
        const desiredRadius = enemy.orbitRadius;
        const radialError = clamp((dist - desiredRadius) / Math.max(1, desiredRadius), -1, 1);
        const radialWeight = dist < desiredRadius ? -0.9 : 0.9;
        const wobble = Math.sin(now / 260 + enemy.orbitPhase) * 0.22;

        return addEnemySeparationSteering(
            enemy,
            tangentX + baseX * radialError * radialWeight + tangentY * wobble,
            tangentY + baseY * radialError * radialWeight - tangentX * wobble
        );
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    /**
     * Keeps carriers at support range while they strafe around the player.
     * The missile screen provides defense; the carrier itself should not blindly ram.
     */
    function getCarrierMovement(enemy, baseX, baseY, now) {
        const dist = distance(enemy, player);
        const tangentX = -baseY * enemy.carrierOrbitDirection;
        const tangentY = baseX * enemy.carrierOrbitDirection;
        const wobble = Math.sin(now / 700 + enemy.carrierOrbitPhase) * 0.16;

        let radial = 0;
        if (dist < 500) radial = -1.35;
        else if (dist > 780) radial = 0.72;
        else radial = clamp((dist - 640) / 260, -0.28, 0.28);

        return addEnemySeparationSteering(
            enemy,
            tangentX * 0.88 + baseX * radial + tangentY * wobble,
            tangentY * 0.88 + baseY * radial - tangentX * wobble
        );
    }

    function getDodgerMovement(enemy, baseX, baseY, now) {
        enemy.speedMultiplier = 1;

        const evasion = getDodgerBulletEvasion(enemy);
        if (evasion.threatened) {
            enemy.dashUntil = 0;
            return normalizeVector(
                baseX * 0.18 + evasion.x * evasion.weight,
                baseY * 0.18 + evasion.y * evasion.weight
            );
        }

        // Dodgers deliberately orbit toward the rear hemisphere of the player's
        // current firing line. They still evade imminent bullets, but their
        // default intent is now to flank rather than simply rush head-on.
        const aimAngle = Number.isFinite(player.lastAimAngle)
            ? player.lastAimAngle
            : Math.atan2(enemy.y - player.y, enemy.x - player.x);
        const preferredSide = enemy.flankSide || (enemy.flankSide = Math.random() < 0.5 ? -1 : 1);
        const rearAngle = aimAngle + Math.PI + preferredSide * 0.42;
        const flankRadius = 250 + Math.min(90, (enemy.generation || 1) * 18);
        const targetX = player.x + Math.cos(rearAngle) * flankRadius;
        const targetY = player.y + Math.sin(rearAngle) * flankRadius;
        const toFlank = normalizeVector(targetX - enemy.x, targetY - enemy.y);
        const playerDistance = distance(enemy, player);

        if (playerDistance <= enemy.dashRange && now >= enemy.nextDashAt) {
            enemy.dashUntil = now + enemy.dashDuration;
            enemy.nextDashAt = now + enemy.dashCooldown + randomRange(0, 420);
            enemy.dashVectorX = toFlank.x;
            enemy.dashVectorY = toFlank.y;
        }

        if (now < enemy.dashUntil) {
            enemy.speedMultiplier = 2.35;
            return { x: enemy.dashVectorX, y: enemy.dashVectorY };
        }

        const orbitX = -baseY * preferredSide;
        const orbitY = baseX * preferredSide;
        const flankWeight = playerDistance > flankRadius + 70 ? 0.82 : 0.42;
        return addEnemySeparationSteering(
            enemy,
            toFlank.x * flankWeight + orbitX * 0.72,
            toFlank.y * flankWeight + orbitY * 0.72
        );
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getDodgerBulletEvasion(enemy) {
        let dodgeX = 0;
        let dodgeY = 0;
        let strongestThreat = 0;

        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;

            const relativeX = enemy.x - bullet.x;
            const relativeY = enemy.y - bullet.y;
            const velocitySizeSq = bullet.dx * bullet.dx + bullet.dy * bullet.dy;
            if (velocitySizeSq <= 0.01) continue;

            const framesUntilClosest = clamp(
                (relativeX * bullet.dx + relativeY * bullet.dy) / velocitySizeSq,
                0,
                34
            );

            const predictedBulletX = bullet.x + bullet.dx * framesUntilClosest;
            const predictedBulletY = bullet.y + bullet.dy * framesUntilClosest;
            const predictedDistance = Math.hypot(enemy.x - predictedBulletX, enemy.y - predictedBulletY);
            const currentDistance = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
            const dangerRadius = enemy.r + bullet.r + 42;

            if (currentDistance > 280 || predictedDistance > dangerRadius) continue;

            const bulletSpeed = Math.sqrt(velocitySizeSq);
            const bulletDirX = bullet.dx / bulletSpeed;
            const bulletDirY = bullet.dy / bulletSpeed;
            const perpX = -bulletDirY;
            const perpY = bulletDirX;

            const sideChoice = ((enemy.x - bullet.x) * perpX + (enemy.y - bullet.y) * perpY) >= 0 ? 1 : -1;
            const urgency = 1 - clamp(predictedDistance / dangerRadius, 0, 1);
            const threatWeight = 1.3 + urgency * 3.2;

            dodgeX += perpX * sideChoice * threatWeight;
            dodgeY += perpY * sideChoice * threatWeight;
            strongestThreat = Math.max(strongestThreat, urgency);
        }

        const normalized = normalizeVector(dodgeX, dodgeY);
        return {
            x: normalized.x,
            y: normalized.y,
            weight: 1.5 + strongestThreat * 2.1,
            threatened: strongestThreat > 0,
        };
    }

    /**
     * Normalizes external or computed input into the safe format expected by downstream code.
     */
    function normalizeVector(x, y) {
        const length = Math.hypot(x, y);
        return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
    }

    /**
     * Returns the reinforcement doctrine for bosses. Summons are bounded by both
     * a per-boss cap and the platform enemy cap, so command behavior creates a
     * tactical battle instead of an infinite spawn leak.
     */
    function getBossCommandProfile(enemy) {
        const difficultyProfiles = {
            easy:       { interval: 10500, activeCap: 5,  pointsPerOrder: 34, phaseBurst: 18 },
            medium:     { interval: 8600,  activeCap: 7,  pointsPerOrder: 46, phaseBurst: 24 },
            hard:       { interval: 7000,  activeCap: 10, pointsPerOrder: 62, phaseBurst: 32 },
            impossible: { interval: 5600,  activeCap: 13, pointsPerOrder: 82, phaseBurst: 42 },
        };
        const base = difficultyProfiles[state.difficulty] || difficultyProfiles.medium;
        const lateWave = Math.max(0, state.wave - 10);
        const gigaMultiplier = enemy.type === "gigaBoss" ? 1.55 : 1;
        return {
            interval: Math.max(3800, base.interval - lateWave * 90),
            activeCap: Math.min(20, Math.round((base.activeCap + Math.floor(lateWave / 8)) * gigaMultiplier)),
            pointsPerOrder: Math.round((base.pointsPerOrder + lateWave * 1.6) * gigaMultiplier),
            phaseBurst: Math.round(base.phaseBurst * gigaMultiplier),
        };
    }

    function countBossSummons(enemy) {
        return enemies.reduce((count, candidate) => count + (
            candidate && !candidate.dead && candidate.commandOwnerId === enemy.commandId ? 1 : 0
        ), 0);
    }

    /**
     * Weights reinforcement types against the player's visible build. This is a
     * soft response, not a hard counter: every order still contains variety.
     */
    function chooseBossSummonType(enemy) {
        const redInvestment = getSystemInvestment("red");
        const greenInvestment = getSystemInvestment("green");
        const blueInvestment = getSystemInvestment("blue");
        const purpleInvestment = getSystemInvestment("purple");
        const options = [
            { type: "runner", cost: 8, weight: 1.4 + purpleInvestment * 0.12 },
            { type: "fighter", cost: 15, weight: 1.2 + greenInvestment * 0.10 },
            { type: "brute", cost: 22, weight: 0.9 + greenInvestment * 0.13 },
            { type: "dodger", cost: 18, weight: 0.9 + redInvestment * 0.11 },
            { type: "tank", cost: 27, weight: 0.65 + redInvestment * 0.08 },
        ];

        if (state.wave >= 18 || enemy.type === "gigaBoss") {
            options.push({ type: "carrier", cost: 48, weight: 0.22 + redInvestment * 0.045 + blueInvestment * 0.025 });
        }

        const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const option of options) {
            roll -= option.weight;
            if (roll <= 0) return option;
        }
        return options[0];
    }

    function getBossSummonPosition(enemy, index = 0) {
        const angle = Math.random() * TWO_PI + index * 1.7;
        const radius = enemy.r + 100 + Math.random() * 90;
        return {
            x: clamp(enemy.x + Math.cos(angle) * radius, 40, WORLD.width - 40),
            y: clamp(enemy.y + Math.sin(angle) * radius, 40, WORLD.height - 40),
        };
    }

    function spawnBossReinforcement(enemy, type, index = 0) {
        if (enemies.length >= PERFORMANCE_LIMITS.maxEnemies) return false;
        const summon = makeEnemy(type, getBossSummonPosition(enemy, index));
        summon.commandOwnerId = enemy.commandId;
        summon.isBossSummon = true;
        // Summons are worth less than natural wave enemies, preventing bosses
        // from becoming renewable point farms.
        summon.reward = Math.max(1, Math.round(summon.reward * 0.38));
        enemies.push(summon);
        return true;
    }

    function issueBossReinforcementOrder(enemy, pointBudget, activeRoom) {
        let remaining = pointBudget;
        let spawned = 0;
        let attempts = 0;
        while (activeRoom > 0 && attempts++ < 18) {
            const option = chooseBossSummonType(enemy);
            if (option.cost > remaining) {
                const affordable = [
                    { type: "runner", cost: 8 },
                    { type: "fighter", cost: 15 },
                    { type: "dodger", cost: 18 },
                    { type: "brute", cost: 22 },
                ].filter(item => item.cost <= remaining);
                if (!affordable.length) break;
                const fallback = affordable[Math.floor(Math.random() * affordable.length)];
                if (!spawnBossReinforcement(enemy, fallback.type, spawned)) break;
                remaining -= fallback.cost;
            } else {
                if (!spawnBossReinforcement(enemy, option.type, spawned)) break;
                remaining -= option.cost;
            }
            spawned++;
            activeRoom--;
        }
        return spawned;
    }

    /**
     * Bosses operate as battlefield commanders. Timed orders rebuild escorts,
     * while 75/50/25-percent health thresholds grant one-time distress bursts.
     */
    function updateBossCommandSystems(enemy, now) {
        const profile = getBossCommandProfile(enemy);
        const activeSummons = countBossSummons(enemy);
        const difficultyCap = getDifficulty().maxConcurrent || PERFORMANCE_LIMITS.maxEnemies;
        const platformCap = Math.min(PERFORMANCE_LIMITS.maxEnemies, Math.round(difficultyCap * (PLATFORM_PROFILE.spawnMultiplier || 1)));
        const room = Math.max(0, Math.min(profile.activeCap - activeSummons, platformCap - enemies.length));
        if (room <= 0) return;

        if (!enemy.commandNextAt) enemy.commandNextAt = now + profile.interval * 0.45;

        const healthRatio = enemy.health / Math.max(1, enemy.maxHealth);
        const thresholds = [0.75, 0.50, 0.25];
        for (let i = 0; i < thresholds.length; i++) {
            const mask = 1 << i;
            if (healthRatio <= thresholds[i] && !(enemy.commandPhaseMask & mask)) {
                enemy.commandPhaseMask |= mask;
                issueBossReinforcementOrder(enemy, profile.phaseBurst, room);
                playSound("miniBossSpawn");
                enemy.commandNextAt = Math.max(enemy.commandNextAt, now + 2600);
                return;
            }
        }

        if (now < enemy.commandNextAt) return;
        issueBossReinforcementOrder(enemy, profile.pointsPerOrder, room);
        enemy.commandNextAt = now + profile.interval * randomRange(0.88, 1.12);
    }

    /**
     * Handles the canEnemyShoot operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function updateMiniBossSystems(enemy, now) {
        if (enemy.miniBossRole !== "healer" || now < (enemy.nextSupportAt || 0)) return;
        enemy.nextSupportAt = now + randomRange(3600, 4800);
        const radius = enemy.healRadius || GAMEPLAY_CONSTANTS.healer.radius;
        let healed = 0;
        for (const ally of enemies) {
            if (!ally || ally.dead || ally === enemy || distance(enemy, ally) > radius) continue;
            if (ally.health >= ally.maxHealth) continue;
            const amount = Math.max(10, Math.round(ally.maxHealth * 0.12));
            ally.health = Math.min(ally.maxHealth, ally.health + amount);
            ally.auraFlashUntil = Date.now() + 260;
            healed++;
            if (healed >= 7) break;
        }
        if (healed > 0) {
            spawnPickupBurst(enemy.x, enemy.y, "#72f0a6", 12, false);
            explosions.push({ x: enemy.x, y: enemy.y, radius, life: 12, maxLife: 12, harmless: true, supportPulse: true });
        }
    }

    function canEnemyShoot(enemy) {
        return enemy.type === "brute" || enemy.type === "miniTank" || enemy.type === "fighter" || enemy.type === "carrier" || enemy.type === "boss" || enemy.type === "gigaBoss" ||
            (enemy.mutations || []).includes("burst") || (enemy.mutations || []).includes("spread");
    }

    /**
     * Handles the shootEnemy operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function shootEnemy(enemy, now) {
        // Mutation-only shooters (normal, runner, dodger, etc.) do not always
        // have a native shootCooldown. Using an undefined cooldown made the
        // comparison fail and eventually poisoned lastShotAt with NaN, allowing
        // them to fire every simulation frame around Generation III.
        const hasEvolutionWeapon = (enemy.mutations || []).includes("burst") || (enemy.mutations || []).includes("spread");
        const nativeCooldown = Number.isFinite(enemy.shootCooldown) ? enemy.shootCooldown : null;
        const shootCooldown = nativeCooldown ?? (hasEvolutionWeapon ? randomRange(1450, 1900) : 1600);
        if (!Number.isFinite(enemy.lastShotAt)) enemy.lastShotAt = now;
        if (now - enemy.lastShotAt < shootCooldown) return;
        if (distance(enemy, player) > (enemy.miniBossRole === "sniper" ? (enemy.sniperRange || 1120) : 760)) return;

        const activeEnemyProjectiles = enemyBullets.reduce((count, projectile) => count + (projectile && !projectile.dead && !projectile.isBomb ? 1 : 0), 0);
        const enemyProjectileBudget = Math.min(PERFORMANCE_LIMITS.maxEnemyBullets, 150);
        if (activeEnemyProjectiles >= enemyProjectileBudget) {
            enemy.lastShotAt = now - Math.max(0, shootCooldown - 260);
            return;
        }

        enemy.lastShotAt = now;
        playSound("enemyShoot");

        if (enemy.type === "carrier") {
            shootCarrierCannon(enemy);
            return;
        }

        const baseAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const bossTier = enemy.type === "boss" ? Math.max(1, Math.floor(state.wave / 10)) : 0;
        const mutations = enemy.mutations || [];
        const evolvedBurst = mutations.includes("burst");
        const evolvedSpread = mutations.includes("spread");
        const shotCount = enemy.type === "gigaBoss" ? 11 : enemy.type === "boss" ? Math.min(9, 3 + bossTier * 2) : enemy.type === "miniTank" ? (enemy.miniBossRole === "sniper" ? 1 : enemy.miniBossRole === "healer" ? 2 : 3) : enemy.type === "fighter" ? 2 : evolvedSpread ? 3 : evolvedBurst ? 2 : 1;
        const spread = enemy.type === "gigaBoss" ? 0.24 : enemy.type === "boss" ? Math.min(0.28, 0.13 + bossTier * 0.025) : enemy.type === "miniTank" ? (enemy.miniBossRole === "sniper" ? 0 : enemy.miniBossRole === "healer" ? 0.09 : 0.14) : enemy.type === "fighter" ? 0.08 : evolvedSpread ? 0.18 : evolvedBurst ? 0.045 : 0;
        // Mutation-only shooters use the local finite cooldown above. Never
        // offset lastShotAt with enemy.shootCooldown here: many basic archetypes
        // intentionally lack that property, which previously produced NaN and a
        // continuous line of projectiles.
        const centerOffset = (shotCount - 1) / 2;

        for (let i = 0; i < shotCount && activeEnemyProjectiles + i < enemyProjectileBudget; i++) {
            createEnemyBullet(enemy, baseAngle + (i - centerOffset) * spread);
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function createEnemyBullet(enemy, angle) {
        const isGigaBoss = enemy.type === "gigaBoss";
        const isBoss = enemy.type === "boss";
        const isMiniTank = enemy.type === "miniTank";
        const isCarrier = enemy.type === "carrier";
        const hasEvolutionWeapon = (enemy.mutations || []).includes("burst") || (enemy.mutations || []).includes("spread");
        const baseSpeed = isGigaBoss ? 5.8 : isBoss ? 5.2 : isCarrier ? 5.35 : isMiniTank ? (enemy.miniBossRole === "sniper" ? 8.6 : 4.9) : 4.6;
        const speed = baseSpeed * (hasEvolutionWeapon ? 1.10 : 1);

        enemyBullets.push({
            x: enemy.x + Math.cos(angle) * (enemy.r + 8),
            y: enemy.y + Math.sin(angle) * (enemy.r + 8),
            r: isGigaBoss ? 11 : isBoss ? 8 : isCarrier ? 7 : isMiniTank ? (enemy.miniBossRole === "sniper" ? 5 : 7) : (hasEvolutionWeapon ? 8 : 6),
            dx: Math.cos(angle) * speed,
            dy: Math.sin(angle) * speed,
            damage: isGigaBoss ? 28 : isBoss ? 18 : isCarrier ? Math.round(13 * getDifficulty().enemyDamage) : isMiniTank ? (enemy.miniBossRole === "sniper" ? Math.max(24, Math.round(enemy.damage * 0.92)) : enemy.miniBossRole === "superTank" ? 16 : 11) : Math.max(7, Math.round((enemy.damage || 12) * (hasEvolutionWeapon ? 0.72 : 0.62))),
            color: isGigaBoss ? "#ffffff" : isBoss ? "#ff3535" : isCarrier ? "#62d9ff" : isMiniTank ? (enemy.miniBossRole === "sniper" ? "#ffcf70" : enemy.miniBossRole === "healer" ? "#72f0a6" : "#b878ff") : (enemy.generation >= 4 ? "#c68cff" : "#ff79c6"),
        });
    }

    /**
     * Returns carrier doctrine values. Missile counts rise sharply because carriers
     * enter after the player has had time to assemble a powerful build.
     */
    function getCarrierDoctrine() {
        const scalingWaves = Math.max(0, state.wave - GAMEPLAY_CONSTANTS.carrier.scalingStartWave);
        const manufactureCooldown = Math.max(
            GAMEPLAY_CONSTANTS.carrier.manufactureMinimumMs,
            GAMEPLAY_CONSTANTS.carrier.manufactureBaseMs * Math.pow(GAMEPLAY_CONSTANTS.carrier.manufactureTimeScalePerWave, scalingWaves)
        );
        const stockpileCap = Math.min(
            GAMEPLAY_CONSTANTS.carrier.stockpileMaximum,
            Math.max(
                GAMEPLAY_CONSTANTS.carrier.stockpileMinimum,
                Math.round(GAMEPLAY_CONSTANTS.carrier.stockpileBase * Math.pow(GAMEPLAY_CONSTANTS.carrier.stockpileScalePerWave, scalingWaves))
            )
        );
        return {
            manufactureCooldown,
            stockpileCap,
            // Each two-second manufacturing cycle produces a rack rather than one
            // missile. This lets the carrier build a meaningful reserve while the
            // player remains outside its aggression radius.
            manufactureBatch: Math.min(
                GAMEPLAY_CONSTANTS.carrier.manufactureBatchMaximum,
                GAMEPLAY_CONSTANTS.carrier.manufactureBatchBase + Math.floor(scalingWaves / GAMEPLAY_CONSTANTS.carrier.manufactureBatchStepWaves)
            ),
            initialStockpile: Math.min(
                stockpileCap,
                GAMEPLAY_CONSTANTS.carrier.initialStockpileBase + Math.floor(scalingWaves * GAMEPLAY_CONSTANTS.carrier.initialStockpilePerWave)
            ),
            aggressionRadius: GAMEPLAY_CONSTANTS.carrier.aggressionRadius,
            disengageRadius: GAMEPLAY_CONSTANTS.carrier.disengageRadius,
            launchBatch: GAMEPLAY_CONSTANTS.carrier.launchBatch,
            batchCooldown: GAMEPLAY_CONSTANTS.carrier.launchBatchCooldownMs,
            protectionRatio: GAMEPLAY_CONSTANTS.carrier.protectionRatio,
            attackRatio: GAMEPLAY_CONSTANTS.carrier.attackRatio,
            orbitRatio: GAMEPLAY_CONSTANTS.carrier.orbitRatio,
            cannonShots: 0,
            cannonSpread: 0,
        };
    }

    /**
     * Runs the carrier's missile factory independently from its cannon.
     * The first salvo is intentionally immediate and large.
     */
    function updateCarrierSystems(enemy, now) {
        const doctrine = getCarrierDoctrine();
        if (!enemy.carrierStockpileInitialized) {
            enemy.missileStockpile = doctrine.initialStockpile;
            enemy.carrierStockpileInitialized = true;
        }
        enemy.missileStockpile = Math.max(0, Math.min(doctrine.stockpileCap, enemy.missileStockpile || 0));
        enemy.nextMissileManufactureAt = enemy.nextMissileManufactureAt || (now + doctrine.manufactureCooldown);
        enemy.nextStockpileLaunchAt = enemy.nextStockpileLaunchAt || 0;

        if (now >= enemy.nextMissileManufactureAt && enemy.missileStockpile < doctrine.stockpileCap) {
            enemy.missileStockpile = Math.min(doctrine.stockpileCap, enemy.missileStockpile + doctrine.manufactureBatch);
            enemy.nextMissileManufactureAt = now + doctrine.manufactureCooldown;
        }

        const playerDistance = distance(enemy, player);
        enemy.carrierAggressive = playerDistance <= doctrine.aggressionRadius
            || (enemy.carrierAggressive && playerDistance < doctrine.disengageRadius);

        if (!enemy.carrierAggressive || enemy.missileStockpile <= 0 || now < enemy.nextStockpileLaunchAt) return;
        const roomGlobal = Math.max(0, PERFORMANCE_LIMITS.maxCarrierMissiles - carrierMissiles.filter(m => m && !m.dead).length);
        const launchCount = Math.min(doctrine.launchBatch, enemy.missileStockpile, roomGlobal);
        if (launchCount <= 0) return;

        launchCarrierVolley(enemy, launchCount);
        enemy.missileStockpile -= launchCount;
        enemy.nextStockpileLaunchAt = now + doctrine.batchCooldown;
    }

    /**
     * Fires the carrier's own plasma cannon. Missile defense does not replace direct pressure.
     */
    function shootCarrierCannon(enemy) {
        // Intentionally empty: close-range stockpiled missiles are the carrier's offense.
    }

    /**
     * Creates one coordinated volley. Exactly half the salvo receives interceptor duty;
     * the remainder orbit before periodically diving at the player.
     */
    function launchCarrierVolley(enemy, count) {
        if (count <= 0) return;
        const doctrine = getCarrierDoctrine();
        const interceptorCount = Math.floor(count * doctrine.protectionRatio);
        const attackerCount = Math.floor(count * doctrine.attackRatio);
        for (let i = 0; i < count; i++) {
            const role = i < interceptorCount
                ? "interceptor"
                : i < interceptorCount + attackerCount
                    ? "attacker"
                    : "orbit";
            launchCarrierMissile(enemy, role, i, count);
        }
    }

    /**
     * Creates a missile that launches outward, forms a ring around the player, then performs
     * its assigned job. Interceptors consume bullets without sacrificing themselves.
     */
    function launchCarrierMissile(enemy, role = "attacker", index = 0, volleySize = 1) {
        if (carrierMissiles.filter(m => m && !m.dead).length >= PERFORMANCE_LIMITS.maxCarrierMissiles) return;
        const launchAngle = (TWO_PI * index / Math.max(1, volleySize)) + Math.random() * 0.14;
        const difficultySpeed = state.difficulty === "impossible" ? 0.75 : state.difficulty === "hard" ? 0.4 : 0;
        const orbitRing = index % 2;
        const now = performance.now();
        const health = 24 + state.wave * 2.5;
        carrierMissiles.push({
            owner: enemy,
            role,
            mode: "launch",
            x: enemy.x + Math.cos(launchAngle) * (enemy.r + 14),
            y: enemy.y + Math.sin(launchAngle) * (enemy.r + 14),
            dx: Math.cos(launchAngle) * 3.2,
            dy: Math.sin(launchAngle) * 3.2,
            speed: 3.35 + difficultySpeed,
            turnRate: 0.052 + difficultySpeed * 0.012,
            r: 11,
            health,
            maxHealth: health,
            damage: Math.round((20 + state.wave * 0.72) * getDifficulty().enemyDamage),
            life: 1500,
            launchedAt: now,
            modeUntil: now + 420 + Math.random() * 180,
            orbitAngle: launchAngle,
            orbitDirection: index % 2 === 0 ? 1 : -1,
            orbitRadius: 235 + orbitRing * 82 + Math.random() * 26,
            orbitSpeed: 0.012 + Math.random() * 0.004,
            diveAt: now + (role === "attacker" ? 1200 : role === "orbit" ? 2600 : 999999),
            diveEndsAt: 0,
            retargetAt: 0,
            targetBullet: null,
            interceptCooldownUntil: 0,
        });
    }

    /**
     * Finds a nearby player projectile worth intercepting. Prefer bullets approaching the
     * carrier or player, then fall back to nearest distance.
     */
    function findCarrierInterceptionTarget(missile) {
        let best = null;
        let bestScore = Infinity;
        const owner = missile.owner && !missile.owner.dead ? missile.owner : null;

        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;
            const dx = bullet.x - missile.x;
            const dy = bullet.y - missile.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 720) continue;

            // Favor bullets travelling toward the carrier. A negative radial dot
            // means the projectile is closing on the protected ship; bullets
            // already escaping the carrier receive a large penalty so drones do
            // not turn around and appear to flee from the actual threat.
            let closingBonus = 0;
            let ownerDist = dist;
            if (owner) {
                const toOwnerX = owner.x - bullet.x;
                const toOwnerY = owner.y - bullet.y;
                ownerDist = Math.hypot(toOwnerX, toOwnerY);
                const ownerLen = Math.max(1, ownerDist);
                const towardOwner = (bullet.dx * toOwnerX + bullet.dy * toOwnerY) / ownerLen;
                closingBonus = towardOwner > 0 ? -Math.min(220, towardOwner * 42) : 260;
            }

            const score = dist * 0.72 + ownerDist * 0.38 + closingBonus;
            if (score < bestScore) {
                bestScore = score;
                best = bullet;
            }
        }
        return best;
    }

    /**
     * Steers a missile toward a point using bounded angular acceleration.
     */
    function steerCarrierMissile(missile, targetX, targetY, speedMultiplier = 1) {
        const desired = Math.atan2(targetY - missile.y, targetX - missile.x);
        const current = Math.atan2(missile.dy, missile.dx);
        const delta = ((desired - current + Math.PI * 3) % TWO_PI) - Math.PI;
        const next = current + clamp(delta, -missile.turnRate, missile.turnRate);
        missile.dx = Math.cos(next) * missile.speed * speedMultiplier;
        missile.dy = Math.sin(next) * missile.speed * speedMultiplier;
    }

    /**
     * Advances the carrier swarm. Attack missiles orbit before diving; interceptors leave
     * formation only when a player bullet is available, then return to the ring.
     */
    function updateCarrierMissiles(now = performance.now()) {
        for (const missile of carrierMissiles) {
            if (!missile || missile.dead) continue;
            missile.life--;
            if (missile.life <= 0) { missile.dead = true; continue; }

            if (missile.owner && missile.owner.dead) {
                missile.role = "attacker";
                missile.mode = "dive";
                missile.diveEndsAt = now + 1800;
            }

            if (missile.mode === "launch" && now >= missile.modeUntil) missile.mode = "orbit";

            if (missile.role === "interceptor" && now >= missile.interceptCooldownUntil) {
                if (!missile.targetBullet || missile.targetBullet.dead || now >= missile.retargetAt) {
                    missile.targetBullet = findCarrierInterceptionTarget(missile);
                    missile.retargetAt = now + 130;
                }
                if (missile.targetBullet && !missile.targetBullet.dead) missile.mode = "intercept";
                else if (missile.mode === "intercept") missile.mode = "orbit";
            }

            if ((missile.role === "attacker" || missile.role === "orbit") && missile.mode === "orbit" && now >= missile.diveAt) {
                missile.mode = "dive";
                missile.diveEndsAt = now + (missile.role === "attacker" ? 1150 : 850);
            }

            if (missile.mode === "intercept" && missile.targetBullet && !missile.targetBullet.dead) {
                const target = missile.targetBullet;
                const separation = Math.hypot(target.x - missile.x, target.y - missile.y);

                // Use only a short, distance-bounded lead. The old fixed seven-frame
                // prediction could put the aim point behind a fast projectile and make
                // the interceptor visibly peel away. Close threats are chased directly.
                const leadFrames = separation > 260 ? 3.2 : separation > 120 ? 1.6 : 0;
                const originalTurnRate = missile.turnRate;
                missile.turnRate = Math.max(originalTurnRate, separation < 150 ? 0.15 : 0.105);
                steerCarrierMissile(
                    missile,
                    target.x + target.dx * leadFrames,
                    target.y + target.dy * leadFrames,
                    separation < 160 ? 1.58 : 1.38
                );
                missile.turnRate = originalTurnRate;
            } else if (missile.mode === "dive") {
                steerCarrierMissile(missile, player.x, player.y, 1.24);
                if (now >= missile.diveEndsAt) {
                    missile.mode = "orbit";
                    missile.diveAt = now + 1500 + Math.random() * 1300;
                }
            } else if (missile.mode === "launch") {
                // Preserve the radial launch vector briefly for a readable opening burst.
            } else {
                missile.orbitAngle += missile.orbitDirection * missile.orbitSpeed;
                const wobble = Math.sin(now / 310 + missile.orbitAngle * 2.2) * 18;
                const targetRadius = missile.orbitRadius + wobble;
                steerCarrierMissile(
                    missile,
                    player.x + Math.cos(missile.orbitAngle) * targetRadius,
                    player.y + Math.sin(missile.orbitAngle) * targetRadius,
                    0.96
                );
            }

            missile.x += missile.dx;
            missile.y += missile.dy;

            // Interceptor capture is resolved here, immediately after movement, so
            // fast opposing projectiles cannot tunnel through one another between
            // the later broad collision passes. The missile survives and returns to
            // the carrier's defensive ring after physically meeting the bullet.
            if (missile.mode === "intercept" && missile.targetBullet && !missile.targetBullet.dead) {
                const target = missile.targetBullet;
                const captureRadius = missile.r + (target.r || 3) + 7;
                if (Math.hypot(target.x - missile.x, target.y - missile.y) <= captureRadius) {
                    target.dead = true;
                    missile.targetBullet = null;
                    missile.mode = "orbit";
                    missile.interceptCooldownUntil = now + 180;
                    missile.diveAt = 999999999;
                    explosions.push({ x: missile.x, y: missile.y, radius: 18, life: 7, maxLife: 7, harmless: true });
                }
            }

            if (distance(missile, player) < missile.r + player.r) {
                missile.dead = true;
                damagePlayer(missile.damage);
                explosions.push({ x: missile.x, y: missile.y, radius: 46, life: 14, maxLife: 14 });
            } else if (isOutsideWorld(missile, 160)) {
                missile.dead = true;
            }
        }
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkPlayerBulletsVsCarrierMissiles() {
        for (const bullet of bullets) {
            if (!bullet || bullet.dead) continue;
            for (const missile of carrierMissiles) {
                if (!missile || missile.dead) continue;
                if (distance(bullet, missile) >= bullet.r + missile.r) continue;
                bullet.dead = true;

                // Interceptors are defensive drones: they erase the projectile and return
                // to orbit instead of taking conventional collision damage.
                if (missile.role === "interceptor" && missile.mode === "intercept") {
                    missile.targetBullet = null;
                    missile.mode = "orbit";
                    missile.interceptCooldownUntil = performance.now() + 260;
                    missile.diveAt = 999999999;
                    explosions.push({ x: bullet.x, y: bullet.y, radius: 18, life: 7, maxLife: 7, harmless: true });
                    break;
                }

                missile.health -= bullet.damage;
                addDamageNumber(missile.x, missile.y, bullet.damage, "#b8f6ff");
                if (missile.health <= 0) {
                    missile.dead = true;
                    explosions.push({ x: missile.x, y: missile.y, radius: 42, life: 14, maxLife: 14 });
                    playSound("explosion");
                }
                break;
            }
        }
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damagePlayerOnTouch(enemy, now) {
        if (distance(player, enemy) >= player.r + enemy.r) return;
        if (enemy.lastHitAt && now - enemy.lastHitAt <= 700) return;

        enemy.lastHitAt = now;
        damagePlayer(enemy.damage);

        if (enemy.type === "runner") {
            burstRunnerIntoBullets(enemy);
            enemy.dead = true;
        }
    }

    /**
     * Player damage has exactly two types:
     * - weapon: regular player fire and the weapon relic
     * - quantum: every damaging Quantum upgrade and the Rift relic
     */
    function classifyPlayerDamage(source) {
        switch (source) {
            case "missile":
            case "aura":
            case "rift":
            case "quantum":
            case "drone":
            case "ability": // compatibility for older saved/runtime sources
            case "quantumRelic":
                return "quantum";
            case "weaponRelic":
            case "relic": // legacy weapon-relic source
            case "bullet":
            case "explosion":
            case "weapon":
            default:
                return "weapon";
        }
    }


    function getProtectingAegis(enemy) {
        if (!enemy || enemy.dead) return null;
        for (const generator of enemies) {
            if (!generator || generator.dead || generator.type !== "aegis") continue;
            const radius = generator.shieldRadius || GAMEPLAY_CONSTANTS.aegis.shieldRadius;
            if (distance(enemy, generator) <= radius + enemy.r) return generator;
        }
        return null;
    }

    function isPlayerInsideAegis(generator) {
        return !!generator && distance(player, generator) <= (generator.shieldRadius || GAMEPLAY_CONSTANTS.aegis.shieldRadius) + player.r;
    }

    function isEnemyAegisProtected(enemy) {
        const generator = getProtectingAegis(enemy);
        return !!generator && !isPlayerInsideAegis(generator);
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damageEnemy(index, amount, source = "bullet") {
        const enemy = enemies[index];
        if (!enemy) return false;

        if (isEnemyAegisProtected(enemy)) {
            enemy.shieldFlashUntil = Date.now() + 120;
            return false;
        }

        const damageClass = classifyPlayerDamage(source);
        if (damageClass === "quantum" && enemy.quantumImmune) {
            enemy.quantumFlashUntil = Date.now() + 180;
            addDamageNumber(enemy.x, enemy.y - enemy.r, "NULL", "#72e8ff", {
                category: "quantum", outline: "rgba(8,45,74,0.96)", startScale: 1.35, settleScale: 0.88, drift: "quantum"
            });
            return false;
        }
        const style = PLAYER_DAMAGE_STYLE[damageClass];
        enemy.health -= amount;
        playerDamageTotals[damageClass] += Math.max(0, Number(amount) || 0);
        addDamageNumber(enemy.x, enemy.y - enemy.r, amount, style.color, {
            category: damageClass,
            outline: style.outline,
            startScale: style.startScale,
            settleScale: style.settleScale,
            drift: style.drift,
        });
        playSound("hit");

        if (enemy.health > 0) return false;

        spawnDeathParticles(enemy);
        explosions.push({
            x: enemy.x,
            y: enemy.y,
            radius: Math.max(28, enemy.r * 1.65),
            life: enemy.type === "gigaBoss" ? 20 : enemy.type === "boss" ? 17 : 13,
            maxLife: enemy.type === "gigaBoss" ? 20 : enemy.type === "boss" ? 17 : 13,
            harmless: true,
        });
        playSound("explosion");
        if (enemy.type === "boss" || enemy.type === "gigaBoss" || enemy.type === "miniTank") addScreenShake(enemy.type === "gigaBoss" ? 28 : enemy.type === "boss" ? 20 : 13);
        dropPointOrbs(enemy);
        spawnLifeStealOrbs(enemy, source);
        spawnPickupDrops(enemy.x, enemy.y, enemy.type);
        enemy.dead = true;
        return true;
    }

    /**
     * Handles the burstRunnerIntoBullets operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function burstRunnerIntoBullets(enemy) {
        const shotCount = 12;
        const speed = 5.2 + Math.min(3, state.wave * 0.08);

        explosions.push({ x: enemy.x, y: enemy.y, radius: 58, life: 12, maxLife: 12 });
        spawnDeathParticles(enemy, 14);
        addScreenShake(8);
        playSound("explosion");

        for (let i = 0; i < shotCount; i++) {
            const angle = (TWO_PI / shotCount) * i + randomRange(-0.08, 0.08);
            enemyBullets.push({
                x: enemy.x + Math.cos(angle) * (enemy.r + 8),
                y: enemy.y + Math.sin(angle) * (enemy.r + 8),
                r: 6,
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                damage: 8 + Math.floor(state.wave * 0.25),
                color: "#ff79c6",
            });
        }
    }

    /**
     * Applies damage through the shared combat rules. Route new damage sources here to preserve effects and death handling.
     */
    function damagePlayer(amount) {
        const reducedAmount = Math.max(1, amount * (1 - player.damageReduction));
        if (player.shield > 0) {
            const absorbed = Math.min(player.shield, reducedAmount);
            player.shield -= absorbed;
            if (absorbed > 0 && ui.playerShieldBarWrap) {
                ui.playerShieldBarWrap.classList.remove("shield-hit");
                void ui.playerShieldBarWrap.offsetWidth;
                ui.playerShieldBarWrap.classList.add("shield-hit");
            }
            amount = reducedAmount - absorbed;
        } else {
            amount = reducedAmount;
        }
        if (amount <= 0) return;
        player.health -= amount;
        player.lastDamageAt = performance.now();
        player.regenAccumulator = 0;
        state.damageFlash = 1;
        playSound("playerHit");

        if (player.health <= 0) {
            gameOver();
        }
    }

    // -------------------------------------------------------------------------
