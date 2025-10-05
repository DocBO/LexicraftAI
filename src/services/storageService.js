import { geminiService } from './geminiAPI';

const getBackendBase = () => {
  const base = geminiService.backendBase || process.env.REACT_APP_BACKEND_URL || '';
  return base ? base.replace(/\/$/, '') : '';
};

const request = async (path, options = {}) => {
  const base = getBackendBase();
  if (!base) {
    throw new Error('Backend URL not configured');
  }

  const response = await fetch(`${base}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = 'Request failed';
    try {
      const data = await response.json();
      detail = data?.detail || data?.error || detail;
      if (typeof detail === 'object') {
        detail = JSON.stringify(detail);
      }
    } catch (err) {
      // ignore json parse errors
    }
    throw new Error(detail);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return null;
};

export const storageService = {
  isBackendEnabled() {
    return Boolean(getBackendBase());
  },

  async loadManuscript(workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, chapters: [] };
    }
    return await request(`/api/storage/manuscript?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  async saveManuscript(chapters, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, chapters };
    }
    return await request('/api/storage/manuscript', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId, chapters }),
    });
  },

  async loadScenes(workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, scenes: [] };
    }
    return await request(`/api/storage/scenes?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  async saveScenes(scenes, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, scenes };
    }
    return await request('/api/storage/scenes', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId, scenes }),
    });
  },

  async deleteScenes(chapterId, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, chapterId };
    }
    return await request(`/api/storage/scenes/${encodeURIComponent(chapterId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
  },

  async loadShotList(workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, script: '', shots: [] };
    }
    return await request(`/api/storage/shot-list?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  async saveShotList({ script, shots }, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { workspaceId, script, shots };
    }
    return await request('/api/storage/shot-list', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId, script, shots }),
    });
  },

  async listCharacters(workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return [];
    }
    return await request(`/api/characters?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  async saveCharacter(character, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return character;
    }
    return await request(`/api/characters?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      body: JSON.stringify(character)
    });
  },

  async deleteCharacter(id, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { success: true };
    }
    return await request(`/api/characters/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE'
    });
  },

  async listWorldFacts(workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return [];
    }
    return await request(`/api/worlds?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  async saveWorldFact(fact, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return fact;
    }
    return await request(`/api/worlds?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'POST',
      body: JSON.stringify(fact)
    });
  },

  async deleteWorldFact(id, workspaceId = 'default') {
    if (!this.isBackendEnabled()) {
      return { success: true };
    }
    return await request(`/api/worlds/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE'
    });
  },
  async listProjects() {
    if (!this.isBackendEnabled()) {
      return [{ id: 'default', name: 'Local Workspace' }];
    }
    return await request('/api/projects/');
  },

  async createProject(name) {
    if (!this.isBackendEnabled()) {
      throw new Error('Project management requires backend connectivity');
    }
    return await request('/api/projects/', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  }
};
