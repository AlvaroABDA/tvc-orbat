/**
 * Gestor de Persistencia y Sincronización Offline-First para Field Medic
 */
class EpisodeStorage {
    constructor(sanitarioId) {
        this.sanitarioId = sanitarioId;
        this.STORAGE_KEY_EPISODE = `tvc_medic_episode_${sanitarioId}`;
        this.STORAGE_KEY_QUEUE = `tvc_medic_sync_queue_${sanitarioId}`;
        this.STORAGE_KEY_REANIM = `tvc_medic_reanim_${sanitarioId}`;
    }

    // Inicializar o recuperar contador de reanimaciones local
    getLocalReanimations(defaultVal = 3) {
        const stored = localStorage.getItem(this.STORAGE_KEY_REANIM);
        if (stored !== null) {
            return parseInt(stored, 10);
        }
        this.setLocalReanimations(defaultVal);
        return defaultVal;
    }

    setLocalReanimations(val) {
        localStorage.setItem(this.STORAGE_KEY_REANIM, val.toString());
    }

    decrementReanimation() {
        let current = this.getLocalReanimations();
        current = Math.max(0, current - 1);
        this.setLocalReanimations(current);
        return current;
    }

    // Guardar episodio actual en curso
    saveCurrentEpisode(episodeData) {
        localStorage.setItem(this.STORAGE_KEY_EPISODE, JSON.stringify(episodeData));
    }

    // Obtener episodio en curso si existe
    getCurrentEpisode() {
        const data = localStorage.getItem(this.STORAGE_KEY_EPISODE);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }

    // Limpiar episodio actual una vez finalizado y archivado
    clearCurrentEpisode() {
        localStorage.removeItem(this.STORAGE_KEY_EPISODE);
    }

    // Encolar episodio en la cola offline para sincronización
    enqueueForSync(episodeData) {
        let queue = this.getSyncQueue();
        // Evitar duplicados en la cola por ID
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

    // Intentar vaciar la cola de sincronización hacia el servidor
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
                    if (data.reanimaciones_disponibles !== undefined) {
                        this.setLocalReanimations(data.reanimaciones_disponibles);
                    }
                    this.removeFromQueue(item.episode_id);
                }
            } catch (err) {
                console.warn("Sin cobertura para sincronizar episodio:", item.episode_id);
                break; // Parar reintentos si no hay red
            }
        }
    }
}

window.EpisodeStorage = EpisodeStorage;
