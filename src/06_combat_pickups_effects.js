    // Bullets, collisions, and explosions
    // -------------------------------------------------------------------------
    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateBullets(now) {
        updateEnemyBombs(now);
        updateProjectileList(bullets, 40);
        updateMissiles();
        updateProjectileList(enemyBullets, 60);
        updateCarrierMissiles();
        checkEnemyBulletHits();
        checkPlayerBulletsVsCarrierMissiles();
        checkPlayerBulletHits();
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateEnemyBombs(now) {
        // Bomb timestamps are created from the main loop's Date.now() clock.
        // Never compare them to performance.now(); mixing the two clock origins
        // prevents mines from arming or reaching their fuse deadline.
        for (const bomb of enemyBullets) {
            if (!bomb || bomb.dead || !bomb.isBomb) continue;
            const armed = now >= (bomb.armedAt || bomb.bornAt || 0);
            const proximityTriggered = armed && distance(bomb, player) <= (bomb.triggerRadius || 100) + player.r;
            const timerTriggered = now >= bomb.explodeAt;
            if (!proximityTriggered && !timerTriggered) continue;

            bomb.dead = true;
            explosions.push({ x: bomb.x, y: bomb.y, radius: bomb.blastRadius, life: 16, maxLife: 16 });
            spawnPickupBurst(bomb.x, bomb.y, "#ff7a45", 10, true);
            addScreenShake(6);
            playSound("explosion");
            if (distance(bomb, player) < bomb.blastRadius + player.r) {
                damagePlayer(bomb.damage);
                addDamageNumber(player.x, player.y - 28, `-${bomb.damage}`, "#ff7a45");
            }
        }
    }

    function updateProjectileList(projectiles, despawnMargin) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const projectile = projectiles[i];
            if (!projectile || projectile.dead || projectile.isBomb) continue;

            projectile.x += projectile.dx;
            projectile.y += projectile.dy;

            if (isOutsideWorld(projectile, despawnMargin)) {
                projectile.dead = true;
            }
        }
    }

    /**
     * Returns a boolean predicate and should not mutate state.
     */
    function isOutsideWorld(pos, margin) {
        return pos.x < -margin ||
            pos.x > WORLD.width + margin ||
            pos.y < -margin ||
            pos.y > WORLD.height + margin;
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkEnemyBulletHits() {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const bullet = enemyBullets[i];
            if (!bullet || bullet.dead || bullet.isBomb) continue;
            let interceptedByDrone = false;
            for (const drone of relicDrones) {
                if (drone.dead || distance(drone, bullet) >= 10 + bullet.r) continue;
                drone.health -= bullet.damage;
                bullet.dead = true;
                if (drone.health <= 0) drone.dead = true;
                interceptedByDrone = true;
                break;
            }
            if (interceptedByDrone) continue;
            if (distance(player, bullet) >= player.r + bullet.r) continue;

            bullet.dead = true;
            damagePlayer(bullet.damage);
        }
    }

    /**
     * Evaluates a gameplay condition and applies the corresponding transition or collision result.
     */
    function checkPlayerBulletHits() {
        for (let bulletIndex = bullets.length - 1; bulletIndex >= 0; bulletIndex--) {
            const bullet = bullets[bulletIndex];
            if (!bullet || bullet.dead) continue;

            for (let enemyIndex = enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
                const enemy = enemies[enemyIndex];
                if (!enemy || enemy.dead) continue;
                if (distance(bullet, enemy) >= bullet.r + enemy.r) continue;

                if (bullet.kind === "cannon") {
                    const enemyKey = enemy.id ?? enemy;
                    if (bullet.hitEnemyIds?.has(enemyKey)) continue;
                    bullet.hitEnemyIds?.add(enemyKey);
                    const cannonSource = bullet.damageSource || "bullet";
                    damageEnemy(enemyIndex, bullet.damage, cannonSource);
                    if (bullet.explosive) {
                        explodeAt(bullet.x, bullet.y, bullet.explosionRadius || GAMEPLAY_CONSTANTS.cannon.warheadRadius, bullet.explosionDamage || Math.floor(bullet.damage * GAMEPLAY_CONSTANTS.cannon.warheadDamageRatio), enemy, cannonSource);
                    }
                    if (bullet.cluster) {
                        spawnCannonClusterRounds(bullet.x, bullet.y, cannonSource, bullet.damage);
                    }
                    bullet.dead = true;
                } else {
                    bullet.dead = true;
                    damageEnemy(enemyIndex, bullet.damage, bullet.damageSource || "bullet");
                    if (bullet.explosive) {
                        explodeAt(bullet.x, bullet.y, Math.max(GAMEPLAY_CONSTANTS.explosiveRounds.minimumRadius, bullet.explosionRadius || 0), bullet.explosionDamage, enemy, bullet.damageSource || "explosion");
                    }
                }

                break;
            }
        }
    }

    function spawnCannonClusterRounds(x, y, damageSource, parentDamage) {
        const baseAngle = Math.PI * 0.25;
        for (let i = 0; i < GAMEPLAY_CONSTANTS.cannon.clusterCount; i++) {
            const angle = baseAngle + i * (Math.PI / 2);
            bullets.push({
                kind: "cannonFragment",
                x,
                y,
                r: GAMEPLAY_CONSTANTS.cannon.clusterRadius,
                dx: Math.cos(angle) * GAMEPLAY_CONSTANTS.cannon.clusterSpeed,
                dy: Math.sin(angle) * GAMEPLAY_CONSTANTS.cannon.clusterSpeed,
                damage: Math.max(6, Math.floor(parentDamage * GAMEPLAY_CONSTANTS.cannon.clusterDamageRatio)),
                damageSource,
                explosive: true,
                explosionRadius: GAMEPLAY_CONSTANTS.cannon.clusterExplosionRadius,
                explosionDamage: Math.max(5, Math.floor(parentDamage * GAMEPLAY_CONSTANTS.cannon.clusterExplosionDamageRatio)),
            });
        }
    }

    /**
     * Handles the explodeAt operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function explodeAt(x, y, radius, damage, directlyHitEnemy, damageSource = "explosion") {
        const effectiveRadius = Math.max(1, Number(radius) || 0);
        if (effectiveRadius <= 0) return;

        explosions.push({ x, y, radius: effectiveRadius, life: 14, maxLife: 14 });
        // Explosive rounds intentionally do not shake the screen and do not use
        // the full enemy-death explosion SFX. The compact plasma impact scales with
        // weapon level and remains stable when many splash hits occur at once.
        playSound("explosiveImpact");

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (!enemy || enemy.dead || enemy === directlyHitEnemy) continue;
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist >= effectiveRadius + enemy.r) continue;

            const falloff = 1 - Math.min(1, dist / effectiveRadius);
            const finalDamage = Math.max(1, Math.floor(damage * (0.45 + falloff * 0.55)));
            damageEnemy(i, finalDamage, damageSource);
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateExplosions() {
        for (let i = explosions.length - 1; i >= 0; i--) {
            explosions[i].life--;
            if (explosions[i].life <= 0) explosions.splice(i, 1);
        }
    }


    // -------------------------------------------------------------------------
    // Health regen and life steal
    // -------------------------------------------------------------------------
    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateHealthRegen(now) {
        if (player.regenLevel <= 0 || player.regenPerSecond <= 0) return;
        if (player.health <= 0 || player.health >= player.maxHealth) return;

        if (now - player.lastDamageAt < player.regenDelayAfterDamage) {
            player.lastRegenTickAt = now;
            return;
        }

        if (!player.lastRegenTickAt) {
            player.lastRegenTickAt = now;
            return;
        }

        const elapsed = now - player.lastRegenTickAt;
        if (elapsed < 250) return;

        player.lastRegenTickAt = now;
        player.regenAccumulator += player.regenPerSecond * (elapsed / 1000);

        const wholeHeal = Math.floor(player.regenAccumulator);
        if (wholeHeal <= 0) return;

        player.regenAccumulator -= wholeHeal;
        const previousHealth = player.health;
        player.health = Math.min(player.maxHealth, player.health + wholeHeal);
        const healed = Math.max(0, Math.floor(player.health - previousHealth));

        if (healed > 0) {
            player.regenGlowUntil = now + 420;
            addDamageNumber(player.x, player.y - 42, `+${healed}`, "#7cff9b");
            particles.push({
                x: player.x,
                y: player.y,
                dx: randomRange(-0.22, 0.22),
                dy: randomRange(-1.1, -0.45),
                r: randomRange(1.8, 3.7),
                color: "#7cff9b",
                life: 26,
                maxLife: 26,
            });
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnLifeStealOrbs(enemy, source = "bullet") {
        if (player.lifeStealLevel <= 0 || player.lifeStealAmount <= 0) return;

        const orbCount = clamp(
            Math.ceil(enemy.r / 18) + Math.floor(player.lifeStealLevel / 2),
            1,
            enemy.type === "gigaBoss" ? 12 : enemy.type === "boss" ? 8 : 5
        );
        const enemyMultiplier = enemy.type === "gigaBoss" ? 2.2 : enemy.type === "boss" ? 1.55 : enemy.type === "miniTank" ? 1.25 : 1;
        const sourceMultiplier = source === "aura" ? 0.35 : source === "missile" ? 0.5 : source === "explosion" ? 0.4 : 1;
        const totalHeal = Math.max(1, Math.floor(player.lifeStealAmount * enemyMultiplier * sourceMultiplier));

        for (let i = 0; i < orbCount; i++) {
            const angle = Math.random() * TWO_PI;
            const value = i === orbCount - 1
                ? Math.max(1, totalHeal - Math.floor(totalHeal / orbCount) * (orbCount - 1))
                : Math.max(1, Math.floor(totalHeal / orbCount));

            lifeStealOrbs.push({
                x: enemy.x + Math.cos(angle) * randomRange(0, enemy.r + 10),
                y: enemy.y + Math.sin(angle) * randomRange(0, enemy.r + 10),
                r: enemy.type === "boss" || enemy.type === "gigaBoss" ? 7 : 5,
                value,
                life: 150,
                dx: Math.cos(angle) * randomRange(0.8, 2.6),
                dy: Math.sin(angle) * randomRange(0.8, 2.6),
            });
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updateLifeStealOrbs(now) {
        for (const orb of lifeStealOrbs) {
            if (!orb || orb.dead) continue;
            orb.life--;
            if (orb.life <= 0) {
                orb.dead = true;
                continue;
            }

            orb.x += orb.dx;
            orb.y += orb.dy;
            orb.dx *= 0.90;
            orb.dy *= 0.90;

            const distToPlayer = distance(player, orb);
            const pullRadius = 580 + player.lifeStealLevel * 28;
            if (distToPlayer < pullRadius) {
                const pull = 0.065 + (1 - distToPlayer / pullRadius) * 0.22;
                orb.x += (player.x - orb.x) * pull;
                orb.y += (player.y - orb.y) * pull;
                orb.magnetized = true;
            }

            if (distance(player, orb) < player.r + orb.r + 3) {
                const previousHealth = player.health;
                player.health = Math.min(player.maxHealth, player.health + orb.value);
                const healed = Math.max(0, Math.floor(player.health - previousHealth));
                if (healed > 0) {
                    addDamageNumber(player.x, player.y - 38, `+${healed}`, "#7cff9b");
                    player.regenGlowUntil = now + 420;
                }
                orb.dead = true;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Point orbs
    // -------------------------------------------------------------------------
    /**
     * Handles the dropPointOrbs operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function dropPointOrbs(enemy) {
        let remainingValue = enemy.reward;
        const orbCount = clamp(Math.ceil(enemy.reward / 35), 1, enemy.type === "gigaBoss" ? 28 : enemy.type === "boss" ? 16 : 6);

        for (let i = 0; i < orbCount; i++) {
            const orbsLeft = orbCount - i;
            const value = i === orbCount - 1 ? remainingValue : Math.max(1, Math.floor(remainingValue / orbsLeft));
            remainingValue -= value;

            const angle = Math.random() * TWO_PI;
            const distanceFromEnemy = randomRange(8, enemy.r + 34);

            pointOrbs.push({
                x: enemy.x + Math.cos(angle) * distanceFromEnemy,
                y: enemy.y + Math.sin(angle) * distanceFromEnemy,
                r: enemy.type === "boss" || enemy.type === "gigaBoss" ? 7 : 5,
                value,
                life: 1800,
                dx: Math.cos(angle) * randomRange(0.5, 2.1),
                dy: Math.sin(angle) * randomRange(0.5, 2.1),
            });
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePointOrbs(now) {
        for (const orb of pointOrbs) {
            if (!orb || orb.dead) continue;

            orb.life--;
            if (orb.life <= 0) {
                orb.dead = true;
                continue;
            }

            orb.x += orb.dx;
            orb.y += orb.dy;
            orb.dx *= 0.94;
            orb.dy *= 0.94;

            orb.x = clamp(orb.x, orb.r, WORLD.width - orb.r);
            orb.y = clamp(orb.y, orb.r, WORLD.height - orb.r);

            const distToPlayer = distance(player, orb);
            const clearBoost = state.clearPhaseActive ? 1.9 : 1;
            const magnetRadius = player.pointMagnetRadius * clearBoost;
            const magnetStrength = player.pointMagnetStrength * (state.clearPhaseActive ? 1.85 : 1);
            orb.magnetized = distToPlayer < magnetRadius;
            if (orb.magnetized) {
                const pull = (1 - distToPlayer / magnetRadius) * magnetStrength;
                orb.x += (player.x - orb.x) * pull;
                orb.y += (player.y - orb.y) * pull;
                orb.trailLife = 8;
            }

            if (distToPlayer < player.r + orb.r) {
                collectPointOrb(orb);
            }
        }
    }

    /**
     * Handles the collectPointOrb operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function collectPointOrb(orb) {
        state.score += orb.value;
        state.upgradePoints += orb.value;
        addDamageNumber(player.x, player.y - 28, `+${orb.value}`, "#ffe066");
        orb.dead = true;
        playSound("pickup");
    }

    // -------------------------------------------------------------------------
    // Pickups
    // -------------------------------------------------------------------------
    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnPickupDrops(x, y, enemyType) {
        const dropRates = getDropRates(enemyType);

        maybeDropPickup("health", x, y, dropRates.health, enemyType);
        maybeDropPickup("speed", x, y, dropRates.speed, enemyType, 34);
        const momentumStage = getAwakenedRelicStage("relic_blue_01");
        if (momentumStage) maybeDropPickup("overdrive", x, y, 0.018 + momentumStage * 0.014, enemyType, 54);
        maybeDropPickup("harm", x, y, dropRates.harm, enemyType, 46);
        maybeDropPickup("slow", x, y, dropRates.slow, enemyType, 46);
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getDropRates(enemyType) {
        const isWaveFiveOrLater = state.wave >= 5;
        const healthMultiplier = isWaveFiveOrLater ? 0.35 : 1;
        const rates = { health: 0.09 * healthMultiplier, speed: 0.055, harm: 0.045, slow: 0.035 };

        if (enemyType === "gigaBoss") return { health: 0.7, speed: 1, harm: 0.5, slow: 0.5 };
        if (enemyType === "boss") return { health: 0.65, speed: 1, harm: 0.25, slow: 0.25 };

        if (enemyType === "tank" || enemyType === "miniTank" || enemyType === "brute") {
            rates.health += 0.07 * healthMultiplier;
            rates.speed += 0.035;
            rates.harm += 0.03;
            rates.slow += 0.025;
        }

        if (enemyType === "dodger") {
            rates.speed += 0.06;
            rates.slow += 0.055;
        }

        return rates;
    }

    /**
     * Handles the maybeDropPickup operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function maybeDropPickup(type, x, y, probability, enemyType, spread = 0) {
        if (!chance(probability)) return;

        const offset = spread / 2;
        pickups.push({
            type,
            x: x + randomRange(-offset, offset),
            y: y + randomRange(-offset, offset),
            r: 12,
            life: type === "health" || type === "speed" ? 900 : 720,
            ...getPickupStats(type, enemyType),
        });
    }

    /**
     * Returns derived data without mutating shared state. Keep this helper deterministic where practical.
     */
    function getPickupStats(type, enemyType) {
        const isBoss = enemyType === "boss";
        const isGigaBoss = enemyType === "gigaBoss";

        const stats = {
            health: { amount: isGigaBoss ? 90 : isBoss ? 55 : 22 },
            speed: { duration: isGigaBoss ? 12000 : isBoss ? 9000 : 5500 },
            overdrive: { duration: (isGigaBoss ? 15000 : isBoss ? 11500 : 6500) + getAwakenedRelicStage("relic_blue_01") * 1800 },
            harm: { amount: isGigaBoss ? 45 : isBoss ? 30 : 14 },
            slow: {
                duration: isGigaBoss ? 9000 : isBoss ? 7000 : 4200,
                multiplier: 0.55,
            },
        };

        return stats[type];
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePickups(now) {
        for (let i = pickups.length - 1; i >= 0; i--) {
            const pickup = pickups[i];
            if (!pickup || pickup.dead) continue;

            pickup.life--;

            if (pickup.life <= 0) {
                pickup.dead = true;
                continue;
            }

            updatePickupMagnet(pickup);

            if (distance(player, pickup) >= player.r + pickup.r) continue;

            applyPickup(pickup, now);
            pickup.dead = true;
        }
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePickupMagnet(pickup) {
        const canMagnetize = pickup.type === "health" || pickup.type === "speed" || pickup.type === "overdrive";
        pickup.magnetized = false;
        if (!canMagnetize || player.pointMagnetRadius <= 0) return;

        const momentumStage = getAwakenedRelicStage("relic_blue_01");
        const clearBoost = state.clearPhaseActive ? (1.9 + momentumStage * 0.8) : 1;
        const relicPickupBoost = pickup.type === "overdrive" ? 1.5 + momentumStage * 0.25 : 1;
        const magnetRadius = player.pointMagnetRadius * 0.5 * clearBoost * relicPickupBoost;
        const distToPlayer = distance(player, pickup);
        if (distToPlayer >= magnetRadius) return;

        const magnetStrength = player.pointMagnetStrength * (state.clearPhaseActive ? 1.65 : 1);
        const pull = (1 - distToPlayer / magnetRadius) * magnetStrength;
        pickup.x += (player.x - pickup.x) * pull;
        pickup.y += (player.y - pickup.y) * pull;
        pickup.magnetized = true;
    }

    /**
     * Handles the applyPickup operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function applyPickup(pickup, now) {
        const pickupActions = {
            health: () => {
                const previousHealth = player.health;
                player.health = Math.min(player.maxHealth, player.health + pickup.amount);
                const healed = Math.max(0, Math.floor(player.health - previousHealth));
                const excess = Math.max(0, previousHealth + pickup.amount - player.maxHealth);
                if (player.maxShield > 0 && excess > 0) player.shield = Math.min(player.maxShield, player.shield + excess);
                if (player.adaptiveHull) player.speedBoostUntil = Math.max(player.speedBoostUntil, now + 1800);
                player.healthFlashUntil = now + 850;
                addDamageNumber(player.x, player.y - 32, `+${healed || pickup.amount}`, "#36ff7a");
                spawnPickupBurst(pickup.x, pickup.y, "#36ff7a", 10, false);
                playSound("healthPickup");
            },
            speed: () => {
                player.speedBoostUntil = Math.max(player.speedBoostUntil, now + pickup.duration * player.boostDurationMultiplier);
                spawnPickupBurst(pickup.x, pickup.y, "#63d7ff", 8, false);
                playSound("speedPickup");
            },
            overdrive: () => {
                player.speedBoostUntil = Math.max(player.speedBoostUntil, now + pickup.duration);
                player.weaponBoostUntil = Math.max(player.weaponBoostUntil || 0, now + pickup.duration);
                spawnPickupBurst(pickup.x, pickup.y, "#8cecff", 14, false);
                addDamageNumber(player.x, player.y - 32, "OVERDRIVE", "#8cecff");
                playSound("speedPickup");
            },
            harm: () => {
                playSound("harmPickup");
                spawnPickupBurst(pickup.x, pickup.y, "#ff3030", 18, true);
                player.damageFlashUntil = now + 900;
                damagePlayer(pickup.amount);
                addDamageNumber(player.x, player.y - 32, `-${pickup.amount}`, "#ff3030");
            },
            slow: () => {
                player.slowUntil = Math.max(player.slowUntil, now + pickup.duration);
                player.slowMultiplier = 1 - (1 - pickup.multiplier) * player.slowResistance;
                spawnPickupBurst(pickup.x, pickup.y, "#b36bff", 10, false);
                playSound("slowPickup");
            },
        };

        pickupActions[pickup.type]?.();
    }


    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnPickupBurst(x, y, color, count = 10, explosive = false) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * TWO_PI;
            const speed = randomRange(explosive ? 1.8 : 0.8, explosive ? 5.2 : 2.8);
            particles.push({
                x, y,
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                r: randomRange(2, explosive ? 5.5 : 4),
                color,
                life: Math.floor(randomRange(18, explosive ? 34 : 26)),
                maxLife: explosive ? 34 : 26,
            });
        }
        if (explosive) {
            explosions.push({ x, y, radius: 42, life: 12, maxLife: 12, harmless: true });
        }
    }

    // -------------------------------------------------------------------------
    // Polish effects: particles, damage numbers, screen shake
    // -------------------------------------------------------------------------
    /**
     * Handles the addScreenShake operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addScreenShake(amount) {
        state.screenShake = Math.max(state.screenShake, amount);
    }

    /**
     * Advances this subsystem by one simulation step. Respect paused/ended state and avoid unnecessary allocations.
     */
    function updatePolishEffects() {
        state.screenShake *= state.screenShakeDecay;
        if (state.screenShake < 0.08) state.screenShake = 0;

        for (const particle of particles) {
            if (!particle || particle.dead) continue;
            particle.life--;
            if (particle.life <= 0) {
                particle.dead = true;
                continue;
            }
            particle.x += particle.dx;
            particle.y += particle.dy;
            particle.dx *= 0.94;
            particle.dy *= 0.94;
            particle.r *= 0.985;
        }

        for (const number of damageNumbers) {
            if (!number || number.dead) continue;
            number.life--;
            if (number.life <= 0) {
                number.dead = true;
                continue;
            }
            number.x += number.dx;
            number.y += number.dy;
            if (number.drift === "quantum") {
                number.x += Math.sin(number.life * 0.75) * 0.55;
                number.y -= 1.45;
            } else if (number.drift === "energy") {
                number.phase += 0.34;
                number.x += Math.sin(number.phase) * 0.22;
                number.dy *= 0.965;
            } else {
                number.dy -= 0.006;
            }
        }
    }

    /**
     * Creates a new runtime object for this subsystem. Initialize every field explicitly so later scaling changes remain predictable.
     */
    function spawnDeathParticles(enemy, forcedCount = null) {
        const count = forcedCount ?? (enemy.type === "gigaBoss" ? 34 : enemy.type === "boss" ? 24 : enemy.type === "miniTank" ? 18 : 8);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * TWO_PI;
            const speed = randomRange(0.8, enemy.type === "gigaBoss" || enemy.type === "boss" ? 4.8 : 3.1);
            particles.push({
                x: enemy.x + Math.cos(angle) * randomRange(0, enemy.r),
                y: enemy.y + Math.sin(angle) * randomRange(0, enemy.r),
                dx: Math.cos(angle) * speed,
                dy: Math.sin(angle) * speed,
                r: randomRange(2.2, enemy.type === "gigaBoss" ? 7 : 4.8),
                color: enemy.color,
                life: Math.floor(randomRange(22, 46)),
                maxLife: 46,
            });
        }
    }

    /**
     * Handles the addDamageNumber operation. Keep its responsibilities narrow and update this comment when behavior changes.
     */
    function addDamageNumber(x, y, value, color = "#ffffff", options = {}) {
        const isAbility = options.drift === "energy";
        damageNumbers.push({
            x: x + randomRange(-8, 8),
            y: y + randomRange(-6, 4),
            dx: randomRange(isAbility ? -0.18 : -0.35, isAbility ? 0.18 : 0.35),
            dy: randomRange(isAbility ? -1.05 : -1.35, isAbility ? -0.62 : -0.75),
            text: String(value),
            color,
            outline: options.outline || "rgba(0,0,0,0.82)",
            category: options.category || "neutral",
            drift: options.drift || "punch",
            phase: Math.random() * TWO_PI,
            life: 26,
            maxLife: 26,
            startScale: options.startScale || 1.72,
            settleScale: options.settleScale || 0.92,
        });
    }

    // -------------------------------------------------------------------------
