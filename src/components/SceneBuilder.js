import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geminiService } from '../services/geminiAPI';
import { storageService } from '../services/storageService';
import { useProject } from '../context/ProjectContext';

const sceneTypes = [
  { value: 'dialogue', label: 'Dialogue Scene' },
  { value: 'action', label: 'Action Scene' },
  { value: 'emotional', label: 'Emotional Scene' },
  { value: 'exposition', label: 'Exposition Scene' },
  { value: 'climax', label: 'Climax Scene' },
  { value: 'transition', label: 'Transition Scene' }
];

const defaultScene = (index = 0, overrides = {}) => ({
  id: `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: overrides.title || `Scene ${index + 1}`,
  type: overrides.type || 'dialogue',
  text: overrides.text || '',
  notes: overrides.notes || '',
  metadata: overrides.metadata || {},
  createdAt: overrides.createdAt || new Date().toISOString(),
  updatedAt: overrides.updatedAt || new Date().toISOString(),
});

const createDefaultStore = () => {
  const firstScene = defaultScene();
  return {
    chapters: {
      standalone: {
        chapterTitle: 'Standalone Scenes',
        outline: '',
        scenes: [firstScene],
      }
    },
    currentChapterId: 'standalone',
    currentSceneId: firstScene.id,
  };
};

const SceneBuilder = () => {
  const { activeProject } = useProject();
  const backendEnabled = storageService.isBackendEnabled();
  const sceneSeedKey = useMemo(() => `scene_builder_seed_${activeProject}`, [activeProject]);
  const storeKey = useMemo(() => `scene_builder_store_${activeProject}`, [activeProject]);

  const [sceneStore, setSceneStore] = useState(() => {
    try {
      const cached = localStorage.getItem(storeKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.chapters) {
          return normalizeStore(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to load cached scenes', err);
    }
    return createDefaultStore();
  });
  const [analysisMap, setAnalysisMap] = useState({});
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seedAppliedRef = useRef(false);
  const persistTimerRef = useRef(null);
  const suppressPersistRef = useRef(false);

  const activeChapterId = sceneStore.currentChapterId;
  const activeSceneId = sceneStore.currentSceneId;
  const currentChapter = sceneStore.chapters[activeChapterId] || sceneStore.chapters.standalone;
  const currentScenes = currentChapter?.scenes || [];
  const activeScene = currentScenes.find(scene => scene.id === activeSceneId) || currentScenes[0];

  useEffect(() => {
    const validIds = new Set(
      Object.values(sceneStore.chapters).flatMap(chapter => chapter.scenes.map(scene => scene.id))
    );
    setAnalysisMap(prev => {
      const filtered = Object.fromEntries(
        Object.entries(prev).filter(([sceneId]) => validIds.has(sceneId))
      );
      return filtered;
    });
  }, [sceneStore]);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(sceneStore));
    } catch (err) {
      console.warn('Failed to cache scenes locally', err);
    }
    if (backendEnabled && !suppressPersistRef.current) {
      scheduleBackendPersist(sceneStore);
    }
    suppressPersistRef.current = false;
  }, [sceneStore, backendEnabled, storeKey]);

  useEffect(() => {
    let cancelled = false;
    suppressPersistRef.current = true;
    seedAppliedRef.current = false;
    try {
      const cached = localStorage.getItem(storeKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.chapters) {
          setSceneStore(normalizeStore(parsed));
        }
      }
    } catch (err) {
      console.warn('Failed to load cached scenes for project', err);
    }
    return () => {
      cancelled = true;
    };
  }, [storeKey]);

  useEffect(() => {
    let cancelled = false;
    if (!backendEnabled) return () => { cancelled = true; };
    const loadScenes = async () => {
      try {
        const response = await storageService.loadScenes(activeProject);
        if (cancelled || !response?.scenes) return;
        const grouped = groupScenesByChapter(response.scenes);
        if (!Object.keys(grouped).length) return;
        suppressPersistRef.current = true;
        setSceneStore(prev => mergeBackendScenes(prev, grouped));
      } catch (err) {
        console.warn('Failed to load scenes from backend', err);
      }
    };
    loadScenes();
    return () => {
      cancelled = true;
    };
  }, [backendEnabled, activeProject]);

  useEffect(() => {
    let cancelled = false;

    const applyChapters = (chapters) => {
      if (cancelled || !Array.isArray(chapters)) return;
      suppressPersistRef.current = true;
      setSceneStore(prev => mergeChaptersFromList(prev, chapters));
    };

    if (backendEnabled) {
      storageService
        .loadManuscript(activeProject)
        .then(response => applyChapters(response?.chapters || []))
        .catch(err => console.warn('Failed to load manuscript for scenes', err));
    } else {
      try {
        const cached = localStorage.getItem(`manuscript_chapters_${activeProject}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            applyChapters(parsed);
          }
        }
      } catch (err) {
        console.warn('Failed to read manuscript cache', err);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [backendEnabled, activeProject]);

  useEffect(() => {
    try {
      const cachedSeed = localStorage.getItem(sceneSeedKey);
      if (!cachedSeed) return;
      const parsed = JSON.parse(cachedSeed);
      if (!parsed || seedAppliedRef.current) return;
      suppressPersistRef.current = true;
      integrateSeed(parsed);
      seedAppliedRef.current = true;
    } catch (err) {
      console.warn('Failed to apply scene seed', err);
    }
  }, [sceneSeedKey]);

  const scheduleBackendPersist = (store) => {
    if (!backendEnabled) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => persistScenesToBackend(store), 800);
  };

  const persistScenesToBackend = async (store) => {
    const payload = [];
    Object.entries(store.chapters).forEach(([chapterId, chapter]) => {
      const numericId = Number(chapterId);
      if (!Number.isInteger(numericId)) return;
      chapter.scenes.forEach((scene, index) => {
        payload.push({
          chapterId: numericId,
          title: scene.title,
          sceneType: scene.type,
          text: scene.text,
          notes: scene.notes,
          ordering: index,
          metadata: scene.metadata || {},
        });
      });
    });
    try {
      await storageService.saveScenes(payload, activeProject);
    } catch (err) {
      console.warn('Failed to persist scenes to backend', err);
    }
  };

  useEffect(() => () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
  }, []);

  const integrateSeed = (seed) => {
    const chapterId = seed.chapterId ? String(seed.chapterId) : 'standalone';
    setSceneStore(prev => {
      const existingChapter = prev.chapters[chapterId];
    const baseScene = normalizeScene({
      id: null,
      title: seed.title ? `${seed.title} – Scene ${existingChapter ? existingChapter.scenes.length + 1 : 1}` : undefined,
      type: 'dialogue',
      text: '',
      notes: '',
    }, existingChapter ? existingChapter.scenes.length : 0);
    const scenes = existingChapter ? [...existingChapter.scenes, baseScene] : [baseScene];
    const reindexed = reindexScenes(seed.title || existingChapter?.chapterTitle, scenes);
      const updated = {
        ...prev,
        chapters: {
          ...prev.chapters,
          [chapterId]: {
            chapterTitle: seed.title || existingChapter?.chapterTitle || 'Untitled Chapter',
            outline: seed.outline || existingChapter?.outline || '',
            scenes: reindexed,
          },
        },
        currentChapterId: chapterId,
        currentSceneId: reindexed[reindexed.length - 1].id,
      };
    try {
      localStorage.removeItem(sceneSeedKey);
    } catch (err) {
      console.warn('Failed to clear seed key', err);
    }
      return updated;
    });
  };

  const selectChapter = (chapterId) => {
    setSceneStore(prev => {
      const chapter = prev.chapters[chapterId];
      if (!chapter) {
        const fallbackScene = defaultScene();
        const nextStore = {
          ...prev,
          chapters: {
            ...prev.chapters,
            [chapterId]: {
              chapterTitle: Number.isInteger(Number(chapterId)) ? `Chapter ${chapterId}` : 'Standalone Scenes',
              outline: '',
              scenes: [fallbackScene],
            },
          },
          currentChapterId: chapterId,
          currentSceneId: fallbackScene.id,
        };
        return nextStore;
      }
      const nextSceneId = chapter.scenes[0]?.id || defaultScene().id;
      return {
        ...prev,
        currentChapterId: chapterId,
        currentSceneId: nextSceneId,
      };
    });
  };

  const selectScene = (sceneId) => {
    setSceneStore(prev => ({
      ...prev,
      currentSceneId: sceneId,
    }));
  };

  const updateScene = (sceneId, updater) => {
    setSceneStore(prev => {
      const chapter = prev.chapters[prev.currentChapterId];
      if (!chapter) return prev;
      const rawScenes = chapter.scenes.map(scene =>
        scene.id === sceneId
          ? { ...scene, ...updater, updatedAt: new Date().toISOString() }
          : scene
      );
      const scenes = reindexScenes(chapter.chapterTitle, rawScenes);
      return {
        ...prev,
        chapters: {
          ...prev.chapters,
          [prev.currentChapterId]: {
            ...chapter,
            scenes,
          },
        },
      };
    });
  };

  const addScene = () => {
    setSceneStore(prev => {
      const chapter = prev.chapters[prev.currentChapterId] || { chapterTitle: 'Untitled Chapter', outline: '', scenes: [] };
      const newScene = defaultScene(chapter.scenes.length, {
        title: chapter.chapterTitle ? `${chapter.chapterTitle} – Scene ${chapter.scenes.length + 1}` : undefined,
      });
      const scenes = reindexScenes(chapter.chapterTitle, [...chapter.scenes, newScene]);
      return {
        ...prev,
        chapters: {
          ...prev.chapters,
          [prev.currentChapterId]: {
            ...chapter,
            scenes,
          },
        },
        currentSceneId: newScene.id,
      };
    });
  };

  const removeScene = (sceneId) => {
    setSceneStore(prev => {
      const chapter = prev.chapters[prev.currentChapterId];
      if (!chapter) return prev;
      const filtered = chapter.scenes.filter(scene => scene.id !== sceneId);
      const scenes = reindexScenes(
        chapter.chapterTitle,
        filtered.length ? filtered : [defaultScene()]
      );
      const nextSceneId = scenes[0].id;
      setAnalysisMap(map => {
        const { [sceneId]: removed, ...rest } = map;
        return rest;
      });
      return {
        ...prev,
        chapters: {
          ...prev.chapters,
          [prev.currentChapterId]: {
            ...chapter,
            scenes,
          },
        },
        currentSceneId: nextSceneId,
      };
    });
  };

  const clearSeed = () => {
    try {
      localStorage.removeItem(sceneSeedKey);
    } catch (err) {
      console.warn('Failed to clear scene seed', err);
    }
    seedAppliedRef.current = false;
  };

  const analyzeScene = async () => {
    if (!activeScene?.text.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await geminiService.analyzeScene(activeScene.text, activeScene.type);
      if (response.success) {
        setAnalysisMap(prev => ({ ...prev, [activeScene.id]: response.analysis }));
      }
    } catch (err) {
      setError('Failed to analyze scene: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const analysis = activeScene ? analysisMap[activeScene.id] : null;

  const getRatingColor = (rating) => {
    if (rating >= 80) return '#22c55e';
    if (rating >= 60) return '#eab308';
    if (rating >= 40) return '#f97316';
    return '#ef4444';
  };

  const getRatingLabel = (rating) => {
    if (rating >= 80) return 'Excellent';
    if (rating >= 60) return 'Good';
    if (rating >= 40) return 'Fair';
    return 'Needs Work';
  };

  return (
    <div className="component scene-builder">
      <h2>🎪 Interactive Scene Builder</h2>

      {error && <div className="error-message">{error}</div>}

      <div className="scene-builder-tab">
          <div className="scene-header">
            <div>
              <h3>{currentChapter?.chapterTitle || 'Scenes'}</h3>
              {currentChapter?.outline && <p className="chapter-outline-sm">{currentChapter.outline}</p>}
            </div>
            <div className="scene-header-actions">
              <select
                className="scene-type-select"
                value={activeChapterId}
                onChange={(e) => selectChapter(e.target.value)}
              >
                {Object.entries(sceneStore.chapters).map(([id, chapter]) => (
                  <option key={id} value={id}>
                    {chapter.chapterTitle || (Number.isInteger(Number(id)) ? `Chapter ${id}` : 'Standalone Scenes')}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button tertiary"
                onClick={() => setShowGuidelines(prev => !prev)}
              >
                {showGuidelines ? 'Hide Guidelines' : 'Show Guidelines'}
              </button>
              <button className="button secondary" onClick={addScene}>Add Scene</button>
            </div>
          </div>

          <div className="scene-layout">
            <aside className="scene-list">
              {currentScenes.map(scene => (
                <button
                  key={scene.id}
                  className={`scene-card ${scene.id === activeSceneId ? 'active' : ''}`}
                  onClick={() => selectScene(scene.id)}
                >
                  <div className="scene-card-header">
                    <span className="scene-card-title">{scene.title}</span>
                    <span className="scene-card-type">{sceneTypes.find(t => t.value === scene.type)?.label || scene.type}</span>
                  </div>
                    <div className="scene-card-preview">
                      {scene.text
                        ? `${scene.text.substring(0, 90)}${scene.text.length > 90 ? '…' : ''}`
                        : <em>No scene text yet</em>}
                    </div>
                </button>
              ))}
            </aside>

            <div className="scene-editor">
              {activeScene ? (
                <>
                  <div className="scene-editor-toolbar">
                    <input
                      type="text"
                      value={activeScene.title}
                      onChange={(e) => updateScene(activeScene.id, { title: e.target.value })}
                      className="scene-title-input"
                      placeholder="Scene title"
                    />
                    <div className="toolbar-actions">
                      <select
                        value={activeScene.type}
                        onChange={(e) => updateScene(activeScene.id, { type: e.target.value })}
                        className="scene-type-select"
                      >
                        {sceneTypes.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                      <button className="button tertiary" onClick={() => removeScene(activeScene.id)}>
                        Remove Scene
                      </button>
                    </div>
                  </div>

                  {showGuidelines && (
                    <details className="scene-guidelines" open>
                      <summary>📋 {sceneTypes.find(t => t.value === activeScene.type)?.label} Guidelines</summary>
                      <SceneGuidelines sceneType={activeScene.type} />
                    </details>
                  )}

                  <textarea
                    value={activeScene.text}
                    onChange={(e) => updateScene(activeScene.id, { text: e.target.value })}
                    className="scene-textarea"
                    placeholder="Draft the scene..."
                  />

                  <textarea
                    value={activeScene.notes}
                    onChange={(e) => updateScene(activeScene.id, { notes: e.target.value })}
                    className="scene-notes"
                    placeholder="Notes, beats, or reminders..."
                  />

                  <div className="scene-footer">
                    <span className="word-count">📊 {activeScene.text.split(' ').filter(Boolean).length} words</span>
                    <button
                      onClick={analyzeScene}
                      disabled={loading || !activeScene.text.trim()}
                      className="button"
                    >
                      {loading ? '🔄 Analyzing Scene...' : '⚡ Analyze Conflict & Tension'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="scene-empty-state">
                  <p>Select or create a scene to begin writing.</p>
                  <button className="button" onClick={addScene}>Add Scene</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {analysis && (
        <div className="scene-analysis-tab">
          <div className="analysis-overview">
            <h3>📊 Scene Analysis Results</h3>

            <div className="rating-grid">
              <RatingCard label="⚔️ Conflict Level" rating={analysis.conflictLevel} getRatingColor={getRatingColor} getRatingLabel={getRatingLabel} />
              <RatingCard label="⚡ Tension Rating" rating={analysis.tensionRating} getRatingColor={getRatingColor} getRatingLabel={getRatingLabel} />
              <RatingCard label="🏃 Pace Rating" rating={analysis.paceRating} getRatingColor={getRatingColor} getRatingLabel={getRatingLabel} />
              <RatingCard label="💬 Dialogue Quality" rating={analysis.dialogueQuality} getRatingColor={getRatingColor} getRatingLabel={getRatingLabel} />
            </div>
          </div>

          <div className="analysis-details">
            {!!analysis.conflictTypes?.length && (
              <div className="analysis-section">
                <h4>⚔️ Conflict Types Detected</h4>
                <div className="conflict-types">
                  {analysis.conflictTypes.map((type, index) => (
                    <span key={index} className="conflict-tag">{renderSimple(type)}</span>
                  ))}
                </div>
              </div>
            )}

            {!!analysis.tensionTechniques?.length && (
              <div className="analysis-section">
                <h4>⚡ Tension Techniques Used</h4>
                <div className="tension-techniques">
                  {analysis.tensionTechniques.map((technique, index) => (
                    <span key={index} className="technique-tag">{renderSimple(technique)}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="strengths-improvements">
              {!!analysis.strengths?.length && (
                <div className="strengths-section">
                  <h4>✅ Strengths</h4>
                  <ul>
                    {analysis.strengths.map((strength, index) => (
                      <li key={index}>{renderRichText(strength)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!!analysis.improvements?.length && (
                <div className="improvements-section">
                  <h4>🛠 Improvements</h4>
                  <ul>
                    {analysis.improvements.map((improvement, index) => (
                      <li key={index}>{renderRichText(improvement)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {!!analysis.suggestions?.length && (
              <div className="suggestions-section">
                <h4>🧭 Suggestions</h4>
                <ul>
                  {analysis.suggestions.map((suggestion, index) => (
                    <li key={index}>{renderRichText(suggestion)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const RatingCard = ({ label, rating, getRatingColor, getRatingLabel }) => (
  <div className="rating-card">
    <div className="rating-circle" style={{ backgroundColor: getRatingColor(rating) }}>
      <span className="rating-number">{rating}</span>
    </div>
    <div className="rating-info">
      <h4>{label}</h4>
      <p>{getRatingLabel(rating)}</p>
    </div>
  </div>
);

const SceneGuidelines = ({ sceneType }) => {
  const guidelines = {
    dialogue: [
      'Ensure each character has a clear objective in the scene.',
      'Use subtext to reveal deeper motivations or secrets.',
      'Balance dialogue with physical beats to keep the scene dynamic.',
      'End with a hook or shift in power dynamics.',
    ],
    action: [
      'Keep sentences tight to maintain pace and energy.',
      'Focus on sensory detail to immerse the reader.',
      'Show the physical cost or stakes of the confrontation.',
      'Let the outcome change the direction of the story.',
    ],
    emotional: [
      'Explore the protagonist\'s internal conflict in depth.',
      'Use setting details to mirror or contrast emotions.',
      'Reveal backstory organically through reactions.',
      'End with a choice or realization that propels the story forward.',
    ],
    exposition: [
      'Blend exposition with conflict to avoid info-dumps.',
      'Use character perspective to filter the information shared.',
      'Introduce new questions alongside answers.',
      'Tie the exposition to an emotional beat.',
    ],
    climax: [
      'Ensure stakes are clear and at their highest.',
      'Force the protagonist to make an irreversible decision.',
      'Deliver on promises made earlier in the story.',
      'Show how the outcome transforms the characters.',
    ],
    transition: [
      'Bridge the previous scene\'s outcome to the next goal.',
      'Highlight how characters are processing recent events.',
      'Seed new conflicts or questions.',
      'Keep it brief and purposeful to maintain momentum.',
    ],
  };

  const tips = guidelines[sceneType] || guidelines.dialogue || [];

  return (
    <ul className="guidelines-list">
      {tips.map((tip, index) => (
        <li key={index}>{renderRichText(tip)}</li>
      ))}
    </ul>
  );
};

function normalizeStore(store) {
  if (!store || typeof store !== 'object') return createDefaultStore();
  const normalized = { ...store };
  normalized.chapters = normalized.chapters || {};
  Object.entries(normalized.chapters).forEach(([id, chapter]) => {
    const scenes = Array.isArray(chapter.scenes) && chapter.scenes.length
      ? reindexScenes(chapter.chapterTitle, chapter.scenes)
      : [defaultScene()];
    normalized.chapters[id] = {
      chapterTitle: chapter.chapterTitle || 'Untitled Chapter',
      outline: chapter.outline || '',
      scenes,
    };
  });
  if (!Object.keys(normalized.chapters).length) {
    return createDefaultStore();
  }
  normalized.currentChapterId = normalized.currentChapterId || Object.keys(normalized.chapters)[0];
  const currentScenes = normalized.chapters[normalized.currentChapterId].scenes;
  normalized.currentSceneId = normalized.currentSceneId || currentScenes[0].id;
  return normalized;
}

function groupScenesByChapter(scenes) {
  const grouped = {};
  scenes.forEach(scene => {
    const id = String(scene.chapterId);
    if (!grouped[id]) {
      grouped[id] = {
        chapterTitle: scene.chapterTitle || `Chapter ${scene.chapterId}`,
        outline: scene.chapterOutline || '',
        scenes: [],
      };
    }
    grouped[id].scenes.push(normalizeScene(scene, scene.ordering ?? grouped[id].scenes.length));
  });
  return grouped;
}

function mergeBackendScenes(store, grouped) {
  const merged = {
    chapters: { ...store.chapters },
    currentChapterId: store.currentChapterId,
    currentSceneId: store.currentSceneId,
  };
  Object.entries(grouped).forEach(([id, chapter]) => {
    const reindexed = reindexScenes(chapter.chapterTitle, chapter.scenes);
    chapter.scenes = reindexed;
    merged.chapters[id] = chapter;
  });
  if (!merged.chapters[merged.currentChapterId]) {
    merged.currentChapterId = Object.keys(merged.chapters)[0];
  }
  const scenes = merged.chapters[merged.currentChapterId].scenes;
  merged.currentSceneId = scenes[0]?.id || defaultScene().id;
  return merged;
}

function normalizeScene(scene, index = 0) {
  const baseId = scene.id || scene.dbId || `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let metadata = scene.metadata || {};
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (err) {
      metadata = {};
    }
  }
  return {
    id: String(baseId),
    title: scene.title || `Scene ${index + 1}`,
    type: scene.type || scene.sceneType || 'dialogue',
    text: scene.text || '',
    notes: scene.notes || '',
    metadata,
    ordering: typeof scene.ordering === 'number' ? scene.ordering : index,
    createdAt: scene.createdAt || new Date().toISOString(),
    updatedAt: scene.updatedAt || new Date().toISOString(),
  };
}

function reindexScenes(chapterTitle, scenes) {
  return scenes.map((scene, index) => {
    const normalized = normalizeScene(scene, index);
    const defaultTitle = `Scene ${index + 1}`;
    const chapterDefault = chapterTitle ? `${chapterTitle} – Scene ${index + 1}` : defaultTitle;
    const shouldRenumber =
      !scene.title ||
      scene.title === defaultTitle ||
      (chapterTitle && scene.title === chapterDefault) ||
      /^Scene \d+$/.test(scene.title);
    return {
      ...normalized,
      title: shouldRenumber ? chapterDefault : normalized.title,
      ordering: index,
    };
  });
}

function mergeChaptersFromList(store, chapters) {
  const updated = {
    chapters: { ...store.chapters },
    currentChapterId: store.currentChapterId,
    currentSceneId: store.currentSceneId,
  };

  const keep = new Set(['standalone']);

  chapters.forEach(chapter => {
    if (!chapter || chapter.id === undefined || chapter.id === null) {
      return;
    }
    const id = String(chapter.id);
    keep.add(id);
    const existing = updated.chapters[id];
    const baseScenes = existing?.scenes?.length ? existing.scenes : [defaultScene()];
    updated.chapters[id] = {
      chapterTitle: chapter.title || existing?.chapterTitle || `Chapter ${id}`,
      outline: chapter.outline || existing?.outline || '',
      scenes: reindexScenes(chapter.title || existing?.chapterTitle, baseScenes),
    };
  });

  Object.keys(updated.chapters).forEach(id => {
    if (!keep.has(id)) {
      delete updated.chapters[id];
    }
  });

  if (!updated.chapters.standalone) {
    updated.chapters.standalone = {
      chapterTitle: 'Standalone Scenes',
      outline: '',
      scenes: [defaultScene()],
    };
  }
  updated.chapters.standalone.scenes = reindexScenes(
    updated.chapters.standalone.chapterTitle,
    updated.chapters.standalone.scenes
  );

  if (!updated.chapters[updated.currentChapterId]) {
    const fallback = [...keep].find(id => id !== 'standalone') || 'standalone';
    updated.currentChapterId = fallback;
  }

  const scenes = updated.chapters[updated.currentChapterId]?.scenes || [defaultScene()];
  updated.currentSceneId = scenes.find(scene => scene.id === updated.currentSceneId)?.id || scenes[0].id;

  return updated;
}

function renderRichText(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (entry.description || entry.example || entry.type) {
    return (
      <>
        {entry.type && <strong>{entry.type}: </strong>}
        {entry.description}
        {entry.example && <em> — Example: {entry.example}</em>}
      </>
    );
  }
  if (entry.text) {
    return entry.text;
  }
  return JSON.stringify(entry);
}

function renderSimple(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (entry.description) {
    return entry.type ? `${entry.type}: ${entry.description}` : entry.description;
  }
  if (entry.text) return entry.text;
  return JSON.stringify(entry);
}

export default SceneBuilder;
