/**
 * Gestor de Persistencia, Roster y Sincronización Offline-First para Field Medic
 */
class EpisodeStorage {
    constructor(currentSessionId) {
        this.currentSessionId = currentSessionId || 'MED-ALFA';
        this.STORAGE_KEY_EPISODE = `tvc_medic_active_episode`;
        this.STORAGE_KEY_QUEUE = `tvc_medic_sync_queue`;
        this.STORAGE_KEY_ROSTER = `tvc_medic_roster_cache`;
    }

    // ==================== ROSTER OFFLINE-FIRST ====================
    async fetchAndCacheRoster() {
        try {
            const res = await fetch('/api/medic/roster');
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem(this.STORAGE_KEY_ROSTER, JSON.stringify(data));
                console.log("[Storage] Roster offline actualizado:", data.total_jugadores, "miembros.");
                return data;
            }
        } catch (e) {
            console.warn("[Storage] Sin conexión para actualizar roster, operando con caché local.");
        }
        return this.getRosterCache();
    }

    getRosterCache() {
        const stored = localStorage.getItem(this.STORAGE_KEY_ROSTER);
        if (!stored) return { roster: {}, medicos: ["ADMIN", "MED-ADMIN"] };
        try {
            return JSON.parse(stored);
        } catch (e) {
            return { roster: {}, medicos: ["ADMIN", "MED-ADMIN"] };
        }
    }

    lookupMember(token) {
        if (!token) return null;
        const clean = token.trim();
        const upper = clean.toUpperCase();
        const cache = this.getRosterCache();
        const roster = cache.roster || {};

        if (roster[upper]) return roster[upper];
        if (roster[clean]) return roster[clean];

        // Búsqueda por subcadena o clave case-insensitive
        const keys = Object.keys(roster);
        for (const k of keys) {
            if (k.toUpperCase() === upper) return roster[k];
        }

        return null;
    }

    isMedic(token) {
        if (!token) return false;
        const upper = token.trim().toUpperCase();

        if (upper === 'ADMIN' || upper === 'MED-ADMIN') return true;
        if (upper.startsWith('MED-') || upper.startsWith('SAN-') || upper.includes('MEDIC')) return true;

        const member = this.lookupMember(token);
        if (member && member.is_medic) return true;

        const cache = this.getRosterCache();
        if (cache.medicos && (cache.medicos.includes(upper) || cache.medicos.includes(token.trim()))) {
            return true;
        }

        return false;
    }

    // ==================== RECURSOS DE REANIMACIÓN POR MÉDICO ====================
    getMedicReanimations(medicoUid, defaultVal = 3) {
        const key = `tvc_medic_reanim_${(medicoUid || 'GENERIC').toUpperCase()}`;
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            return parseInt(stored, 10);
        }
        // Admin tiene cupo ilimitado o muy alto
        const initVal = (medicoUid && medicoUid.toUpperCase().includes('ADMIN')) ? 99 : defaultVal;
        this.setMedicReanimations(medicoUid, initVal);
        return initVal;
    }

    setMedicReanimations(medicoUid, val) {
        const key = `tvc_medic_reanim_${(medicoUid || 'GENERIC').toUpperCase()}`;
        localStorage.setItem(key, val.toString());
    }

    decrementMedicReanimation(medicoUid) {
        let current = this.getMedicReanimations(medicoUid);
        current = Math.max(0, current - 1);
        this.setMedicReanimations(medicoUid, current);
        return current;
    }

    // Soporte legacy
    getLocalReanimations(defaultVal = 3) {
        return this.getMedicReanimations(this.currentSessionId, defaultVal);
    }

    setLocalReanimations(val) {
        this.setMedicReanimations(this.currentSessionId, val);
    }

    decrementReanimation() {
        return this.decrementMedicReanimation(this.currentSessionId);
    }

    // ==================== EPISODIO EN CURSO ====================
    saveCurrentEpisode(episodeData) {
        localStorage.setItem(this.STORAGE_KEY_EPISODE, JSON.stringify(episodeData));
    }

    getCurrentEpisode() {
        const data = localStorage.getItem(this.STORAGE_KEY_EPISODE);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }

    clearCurrentEpisode() {
        localStorage.removeItem(this.STORAGE_KEY_EPISODE);
    }

    // ==================== COLA DE SINCRONIZACIÓN OFFLINE ====================
    enqueueForSync(episodeData) {
        let queue = this.getSyncQueue();
        if (!queue.some(item => item.episode_id === episodeData.episode_id)) {
            queue.push(episodeData);
            localStorage.setItem(this.STORAGE_KEY_QUEUE, JSON.stringify(queue));
        }
    }

    getSyncQueue() {
        const data = localStorage.getItem(this.STORAGE_KEY_QUEUE);
        if (!data) return [];
        try {
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }

    removeFromQueue(episodeId) {
        let queue = this.getSyncQueue();
        queue = queue.filter(item => item.episode_id !== episodeId);
        localStorage.setItem(this.STORAGE_KEY_QUEUE, JSON.stringify(queue));
    }

    async flushSyncQueue() {
        let queue = this.getSyncQueue();
        if (queue.length === 0) return;

        for (const item of [...queue]) {
            try {
                const res = await fetch('/api/medico/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.reanimaciones_disponibles !== undefined && item.medico_uid) {
                        this.setMedicReanimations(item.medico_uid, data.reanimaciones_disponibles);
                    }
                    this.removeFromQueue(item.episode_id);
                }
            } catch (err) {
                console.warn("[Storage] Sin cobertura para sincronizar episodio:", item.episode_id);
                break;
            }
        }
    }
}

window.EpisodeStorage = EpisodeStorage;
