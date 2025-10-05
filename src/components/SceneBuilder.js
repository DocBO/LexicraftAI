import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const defaultChapterMetadata = () => ({
  mainCharacters: [],
  supportingCharacters: [],
  hooks: [],
  beats: [],
});

const createDefaultStore = () => {
  const firstScene = defaultScene();
  return {
    chapters: {
      standalone: {
        chapterTitle: 'Standalone Scenes',
        outline: '',
        scenes: [firstScene],
        metadata: defaultChapterMetadata(),
      }
    },
    currentChapterId: 'standalone',
    currentSceneId: firstScene.id,
  };
};

const normalizeChapterMetadata = (metadata) => {
  const normalizeList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .map(item => {
        if (!item) return null;
        if (typeof item === 'string') {
          const name = item.trim();
          if (!name) return null;
          return { name, description: '' };
        }
        const name = String(item.name || '').trim();
        if (!name) return null;
        return {
          name,
          description: String(item.description || '').trim(),
        };
      })
      .filter(Boolean);
  };

  if (!metadata || typeof metadata !== 'object') {
    return defaultChapterMetadata();
  }

  const normalized = {
    mainCharacters: normalizeList(metadata.mainCharacters),
    supportingCharacters: normalizeList(metadata.supportingCharacters),
    hooks: Array.isArray(metadata.hooks) ? metadata.hooks : [],
    beats: Array.isArray(metadata.beats) ? metadata.beats : [],
  };

  if (typeof metadata.number === 'number') {
    normalized.number = metadata.number;
  }

  return normalized;
};

const SceneBuilder = () => {
  const { activeProject } = useProject();
  const backendEnabled = storageService.isBackendEnabled();
  const sceneSeedKey = useMemo(() => `scene_builder_seed_${activeProject}`, [activeProject]);
  const storeKey = useMemo(() => `scene_builder_store_${activeProject}`, [activeProject]);
  const promptStoreKey = useMemo(() => `scene_builder_prompts_${activeProject}`, [activeProject]);

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
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeMessage, setComposeMessage] = useState('');
  const [draftMap, setDraftMap] = useState({});
  const [manuscriptChapters, setManuscriptChapters] = useState([]);
  const [chapterPrompts, setChapterPrompts] = useState({});
  const [actionPrompt, setActionPrompt] = useState('');
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineMessage, setRefineMessage] = useState('');
  const [promptPreview, setPromptPreview] = useState('');
  const [responsePreview, setResponsePreview] = useState('');
  const [previewContext, setPreviewContext] = useState('');
  const seedAppliedRef = useRef(false);
  const persistTimerRef = useRef(null);
  const suppressPersistRef = useRef(false);

  const activeChapterId = sceneStore.currentChapterId;
  const activeSceneId = sceneStore.currentSceneId;
  const currentChapter = sceneStore.chapters[activeChapterId] || sceneStore.chapters.standalone;
  const currentScenes = currentChapter?.scenes || [];
  const activeScene = currentScenes.find(scene => scene.id === activeSceneId) || currentScenes[0];
  const scenesWithContent = currentScenes.filter(scene => {
    const text = scene.text ? scene.text.trim() : '';
    const notes = scene.notes ? scene.notes.trim() : '';
    return Boolean(text || notes);
  });
  const currentDraft = draftMap[activeChapterId];
  const isLinkedChapter = Number.isInteger(Number(activeChapterId));
  const canDraftChapter = scenesWithContent.length > 0 && !composeLoading;
  const previewWordCount = currentDraft ? countDraftWords(currentDraft, currentDraft.prompt || '') : 0;
  const appliedPromptText = (currentDraft?.prompt || actionPrompt || '').trim();
  const chapterMetadata = normalizeChapterMetadata(currentChapter?.metadata);

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
      setManuscriptChapters(chapters.map(chapter => ({ ...chapter })));
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
    setComposeMessage('');
    setPlanMessage('');
    setRefineMessage('');
    setPromptPreview('');
    setResponsePreview('');
    setPreviewContext('');
  }, [activeChapterId]);

  useEffect(() => {
    setRefineMessage('');
    setRefineLoading(false);
  }, [activeSceneId]);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(promptStoreKey);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        setChapterPrompts(parsed);
      }
    } catch (err) {
      console.warn('Failed to load scene builder prompts', err);
    }
  }, [promptStoreKey]);

  useEffect(() => {
    const prompt = (chapterPrompts && chapterPrompts[activeChapterId]) || '';
    setActionPrompt(prompt);
  }, [activeChapterId, chapterPrompts]);

  useEffect(() => {
    setChapterPrompts(prev => {
      const chapters = sceneStore?.chapters ? Object.keys(sceneStore.chapters) : [];
      const validIds = new Set(chapters);
      validIds.add('standalone');

      let mutated = false;
      const next = { ...prev };
      Object.keys(next).forEach(key => {
        if (!validIds.has(key)) {
          delete next[key];
          mutated = true;
        }
      });

      if (!mutated) {
        return prev;
      }

      try {
        localStorage.setItem(promptStoreKey, JSON.stringify(next));
      } catch (err) {
        console.warn('Failed to prune scene prompts', err);
      }

      return next;
    });
  }, [sceneStore, promptStoreKey]);

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
      const seedMetadata = normalizeChapterMetadata(seed.metadata);
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
              metadata: seedMetadata.mainCharacters.length || seedMetadata.supportingCharacters.length
                ? seedMetadata
                : normalizeChapterMetadata(existingChapter?.metadata),
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

  const handleActionPromptChange = useCallback((value) => {
    setActionPrompt(value);
    if (!activeChapterId) {
      return;
    }

    setChapterPrompts(prev => {
      const prevValue = prev[activeChapterId] ?? '';
      const trimmed = value.trim();

      if (!trimmed && !prevValue) {
        return prev;
      }

      const next = { ...prev };
      if (trimmed) {
        if (prevValue === value) {
          return prev;
        }
        next[activeChapterId] = value;
      } else {
        delete next[activeChapterId];
      }

      try {
        localStorage.setItem(promptStoreKey, JSON.stringify(next));
      } catch (err) {
        console.warn('Failed to persist scene prompt', err);
      }

      return next;
    });
  }, [activeChapterId, promptStoreKey]);

  const selectChapter = (chapterId) => {
    setSceneStore(prev => {
      const existingChapter = prev.chapters[chapterId];
      if (!existingChapter) {
        const fallbackScene = defaultScene();
        const nextStore = {
          ...prev,
          chapters: {
            ...prev.chapters,
            [chapterId]: {
              chapterTitle: Number.isInteger(Number(chapterId)) ? `Chapter ${chapterId}` : 'Standalone Scenes',
              outline: '',
              scenes: [fallbackScene],
              metadata: defaultChapterMetadata(),
            },
          },
          currentChapterId: chapterId,
          currentSceneId: fallbackScene.id,
        };
        return nextStore;
      }
      const normalizedChapter = {
        ...existingChapter,
        metadata: normalizeChapterMetadata(existingChapter.metadata),
      };
      const nextSceneId = normalizedChapter.scenes[0]?.id || defaultScene().id;
      return {
        ...prev,
        currentChapterId: chapterId,
        currentSceneId: nextSceneId,
        chapters: {
          ...prev.chapters,
          [chapterId]: normalizedChapter,
        },
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

  const persistChapterDraft = async (draft, directives = '') => {
    if (!draft || typeof draft !== 'object') {
      return 'Draft composed, but nothing to save yet.';
    }

    if (!isLinkedChapter) {
      return 'Draft ready. Switch to a manuscript chapter to save it automatically.';
    }

    const chapterIdNumber = Number(activeChapterId);
    const safeDraft = normalizeDraftForClient(draft);
    const promptText = directives ? directives.trim() : '';
    const htmlContent = buildChapterHtml(safeDraft, promptText);
    const wordCount = countDraftWords(safeDraft, promptText);
    const chapterTitle = safeDraft.title?.trim()
      || currentChapter?.chapterTitle
      || `Chapter ${chapterIdNumber}`;
    const outline = currentChapter?.outline || safeDraft.summary || '';

    const baseChapters = Array.isArray(manuscriptChapters) ? manuscriptChapters : [];
    let updated = false;
    const nextChapters = baseChapters.map(chapter => {
      if (Number(chapter.id) === chapterIdNumber) {
        updated = true;
        return {
          ...chapter,
          title: chapterTitle,
          outline,
          content: htmlContent,
          wordCount,
          metadata: normalizeChapterMetadata(chapter.metadata || chapterMetadata),
        };
      }
      return chapter;
    });

    if (!updated) {
      nextChapters.push({
        id: chapterIdNumber,
        title: chapterTitle,
        outline,
        content: htmlContent,
        wordCount,
        status: 'draft',
        createdAt: new Date().toISOString(),
        metadata: chapterMetadata,
      });
    }

    setManuscriptChapters(nextChapters);

    const payload = nextChapters.map(stripChapterForPersistence);

    if (backendEnabled) {
      const saved = await storageService.saveManuscript(payload, activeProject);
      if (saved?.chapters) {
        setManuscriptChapters(saved.chapters.map(chapter => ({ ...chapter })));
      }
    } else {
      const key = `manuscript_chapters_${activeProject}`;
      localStorage.setItem(key, JSON.stringify(payload));
    }

    setSceneStore(prev => {
      const chapter = prev.chapters[activeChapterId];
      if (!chapter) return prev;
      if (chapter.chapterTitle === chapterTitle && chapter.outline === outline) {
        return prev;
      }
      return {
        ...prev,
        chapters: {
          ...prev.chapters,
          [activeChapterId]: {
            ...chapter,
            chapterTitle,
            outline,
          },
        },
      };
    });

    return promptText ? 'Chapter draft saved to Manuscript Manager with action prompt.' : 'Chapter draft saved to Manuscript Manager.';
  };

  const planScenesFromOutline = async () => {
    if (!currentChapter?.outline?.trim()) {
      setError('Add a chapter outline before generating scene plans.');
      return;
    }

    if (planLoading) return;

    const hasContent = currentScenes.some(scene => (scene.text && scene.text.trim()) || (scene.notes && scene.notes.trim()));
    if (hasContent) {
      const confirmReplace = window.confirm('Replace existing scenes with a new scene plan? This will overwrite current scene drafts.');
      if (!confirmReplace) {
        return;
      }
    }

    setPlanLoading(true);
    setPlanMessage('');
    setError('');

    try {
      const response = await geminiService.generateScenePlan({
        chapterTitle: currentChapter?.chapterTitle || (isLinkedChapter ? `Chapter ${activeChapterId}` : 'Standalone Scenes'),
        outline: currentChapter.outline,
        desiredScenes: currentScenes.length || undefined,
        directives: actionPrompt,
        mainCharacters: chapterMetadata.mainCharacters,
        supportingCharacters: chapterMetadata.supportingCharacters,
      });

      const scenes = Array.isArray(response?.scenes) ? response.scenes : [];
      if (!response?.success || !scenes.length) {
        throw new Error('No scenes were returned from the planner.');
      }

      setPromptPreview(response.prompt || response.promptPreview || '');
      setResponsePreview(response.responsePreview || '');
      setPreviewContext('Scene Plan');

      const plannedScenes = scenes.map((scene, index) => {
        const beats = Array.isArray(scene.beats) ? scene.beats : [];
        const beatsBlock = beats.length ? `Beats:\n${beats.map(beat => `- ${beat}`).join('\n')}` : '';
        const baseText = scene.text && scene.text.trim()
          ? scene.text.trim()
          : [scene.summary, beatsBlock].filter(Boolean).join('\n\n');

        const characterNotes = [];
        if (chapterMetadata.mainCharacters.length) {
          characterNotes.push(
            `Main: ${chapterMetadata.mainCharacters.map(char => char.name).join(', ')}`
          );
        }
        if (chapterMetadata.supportingCharacters.length) {
          characterNotes.push(
            `Supporting: ${chapterMetadata.supportingCharacters.map(char => char.name).join(', ')}`
          );
        }

        const noteParts = [
          scene.purpose && `Purpose: ${scene.purpose}`,
          scene.tone && `Tone: ${scene.tone}`,
          scene.length && `Suggested Length: ${scene.length}`,
          scene.setting && `Setting: ${scene.setting}`,
          scene.notes,
          characterNotes.length ? characterNotes.join('\n') : '',
        ].filter(Boolean);

        return {
          id: null,
          title: scene.title || `Scene ${index + 1}`,
          type: mapSceneType(scene.type),
          text: baseText,
          notes: noteParts.join('\n'),
          metadata: {
            summary: scene.summary || '',
            purpose: scene.purpose || '',
            beats,
            tone: scene.tone || '',
            length: scene.length || '',
            setting: scene.setting || '',
            plannedAt: new Date().toISOString(),
          },
        };
      });

      const reindexed = reindexScenes(currentChapter?.chapterTitle, plannedScenes);

      setSceneStore(prev => {
        const existingChapter = prev.chapters[activeChapterId];
        const normalizedChapter = existingChapter
          ? {
              ...existingChapter,
              metadata: normalizeChapterMetadata(existingChapter.metadata || chapterMetadata),
            }
          : {
              chapterTitle: 'Untitled Chapter',
              outline: '',
              scenes: [],
              metadata: chapterMetadata,
            };
        return {
          ...prev,
          chapters: {
            ...prev.chapters,
            [activeChapterId]: {
              ...normalizedChapter,
              scenes: reindexed,
            },
          },
          currentSceneId: reindexed[0]?.id || prev.currentSceneId,
        };
      });

      setAnalysisMap(prev => {
        const next = { ...prev };
        currentScenes.forEach(scene => {
          if (scene?.id) {
            delete next[scene.id];
          }
        });
        return next;
      });

      setPlanMessage('Scene plan generated from chapter outline.');
    } catch (err) {
      setError('Failed to generate scene plan: ' + err.message);
    } finally {
      setPlanLoading(false);
    }
  };

  const refineScene = async (mode) => {
    if (!activeScene?.text.trim()) {
      setError('Add scene text before refining.');
      return;
    }

    setRefineLoading(true);
    setRefineMessage('');
    setError('');

    try {
      const response = await geminiService.refineSceneText({
        mode,
        sceneTitle: activeScene.title,
        sceneText: activeScene.text,
        chapterTitle: currentChapter?.chapterTitle || '',
        chapterOutline: currentChapter?.outline || '',
        directives: actionPrompt,
        mainCharacters: chapterMetadata.mainCharacters,
        supportingCharacters: chapterMetadata.supportingCharacters,
      });

      const refined = response?.scene;
      if (!response?.success || !refined?.text) {
        throw new Error('No refined scene returned.');
      }

      updateScene(activeScene.id, {
        title: refined.title || activeScene.title,
        text: refined.text,
        notes: refined.notes ? `${refined.notes}${activeScene.notes ? `\n\n${activeScene.notes}` : ''}` : activeScene.notes,
        metadata: {
          ...(activeScene.metadata || {}),
          beats: Array.isArray(refined.beats) && refined.beats.length ? refined.beats : activeScene.metadata?.beats,
          lastRefinedAt: new Date().toISOString(),
          refineMode: mode,
        },
      });

      setRefineMessage(mode === 'tighten' ? 'Scene tightened successfully.' : 'Scene expanded successfully.');
      setPromptPreview(response.prompt || response.promptPreview || '');
      setResponsePreview(response.responsePreview || '');
      setPreviewContext(mode === 'tighten' ? 'Tighten Scene' : 'Expand Scene');
    } catch (err) {
      setError('Failed to refine scene: ' + err.message);
    } finally {
      setRefineLoading(false);
    }
  };

  const generateChapterDraft = async () => {
    if (!scenesWithContent.length) {
      setError('Add scene text or notes before drafting the chapter.');
      return;
    }

    setComposeLoading(true);
    setComposeMessage('');
    setError('');

    try {
      const promptText = actionPrompt.trim();
      const response = await geminiService.generateChapterDraft({
        chapterTitle: currentChapter?.chapterTitle || (isLinkedChapter ? `Chapter ${activeChapterId}` : 'Standalone Scene Compilation'),
        outline: currentChapter?.outline || '',
        scenes: scenesWithContent.map(scene => ({
          title: scene.title,
          type: scene.type,
          text: scene.text,
          notes: scene.notes,
        })),
        directives: promptText,
        mainCharacters: chapterMetadata.mainCharacters,
        supportingCharacters: chapterMetadata.supportingCharacters,
      });

      if (!response?.success || !response.draft) {
        throw new Error('No draft returned from service');
      }

      const sanitizedDraft = normalizeDraftForClient(response.draft);
      setDraftMap(prev => ({
        ...prev,
        [activeChapterId]: {
          ...sanitizedDraft,
          savedAt: new Date().toISOString(),
          prompt: promptText,
        },
      }));

      const message = await persistChapterDraft(sanitizedDraft, promptText);
      setComposeMessage(promptText ? `${message} Prompt applied.` : message);
      setPromptPreview(response.prompt || response.promptPreview || '');
      setResponsePreview(response.responsePreview || '');
      setPreviewContext('Chapter Draft');
    } catch (err) {
      setError('Failed to compose chapter: ' + err.message);
    } finally {
      setComposeLoading(false);
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
      <div className="scene-builder-header">
        <h2>🎪 Interactive Scene Builder</h2>
        <select
          className="scene-chapter-select"
          value={activeChapterId}
          onChange={(e) => selectChapter(e.target.value)}
        >
          {Object.entries(sceneStore.chapters).map(([id, chapter]) => (
            <option key={id} value={id}>
              {chapter.chapterTitle || (Number.isInteger(Number(id)) ? `Chapter ${id}` : 'Standalone Scenes')}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="scene-builder-tab">
            <div className="scene-header">
              <div>
                <h3>{currentChapter?.chapterTitle || 'Scenes'}</h3>
                {currentChapter?.outline && <p className="chapter-outline-sm">{currentChapter.outline}</p>}
              </div>
              <div className="scene-header-actions">
                <div className="scene-header-spacer" />
                <div className="scene-primary-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={planScenesFromOutline}
                    disabled={planLoading || !currentChapter?.outline?.trim()}
                  >
                    {planLoading ? 'Planning Scenes...' : 'Plan Scenes'}
                  </button>
                  <button className="button secondary" onClick={addScene}>Add Scene</button>
                </div>
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
                    spellCheck={false}
                  />

                  <textarea
                    value={activeScene.notes}
                    onChange={(e) => updateScene(activeScene.id, { notes: e.target.value })}
                    className="scene-notes"
                    placeholder="Notes, beats, or reminders..."
                    spellCheck={false}
                  />

                  <div className="scene-footer">
                    <span className="word-count">📊 {activeScene.text.split(' ').filter(Boolean).length} words</span>
                    <div className="scene-footer-actions">
                      <button
                        onClick={analyzeScene}
                        disabled={loading || !activeScene.text.trim()}
                        className="button"
                      >
                        {loading ? '🔄 Analyzing Scene...' : '⚡ Analyze Conflict & Tension'}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => refineScene('expand')}
                        disabled={refineLoading || !activeScene.text.trim()}
                      >
                        {refineLoading ? 'Refining…' : 'Expand Scene'}
                      </button>
                      <button
                        type="button"
                        className="button tertiary"
                        onClick={() => refineScene('tighten')}
                        disabled={refineLoading || !activeScene.text.trim()}
                      >
                        {refineLoading ? 'Refining…' : 'Tighten Scene'}
                      </button>
                      <button
                        type="button"
                        className="button tertiary"
                        onClick={() => setShowGuidelines(prev => !prev)}
                      >
                        {showGuidelines ? 'Hide Guidelines' : 'Show Guidelines'}
                      </button>
                      <button className="button tertiary" onClick={() => removeScene(activeScene.id)}>
                        Remove Scene
                      </button>
                    </div>
                  </div>
                  {refineMessage && <p className="scene-refine-message">{refineMessage}</p>}
                </>
              ) : (
                <div className="scene-empty-state">
                  <p>Select or create a scene to begin writing.</p>
                  <button className="button" onClick={addScene}>Add Scene</button>
                </div>
              )}
          </div>
        </div>

        <div className="chapter-draft-panel">
          <div className="draft-panel-header">
            <div>
              <h3>📝 Chapter Draft Composer</h3>
              <p className="draft-panel-subtitle">
                Combine every scene in this chapter into a cohesive manuscript draft.
              </p>
            </div>
            <button
              className="button"
              onClick={generateChapterDraft}
              disabled={!canDraftChapter}
            >
              {composeLoading ? 'Crafting Chapter...' : 'Generate Chapter Draft'}
            </button>
          </div>

          {!scenesWithContent.length && (
            <p className="draft-hint">Add scene text or notes before composing the chapter.</p>
          )}

          {!isLinkedChapter && (
            <div className="info-banner">
              Drafts from standalone scenes are preview-only. Switch to a manuscript chapter to save results automatically.
            </div>
          )}

          {composeMessage && <div className="status-message">{composeMessage}</div>}

          {planMessage && <div className="status-message subtle">{planMessage}</div>}

          {appliedPromptText && (
            <p className="draft-hint">Action Prompt: {appliedPromptText}</p>
          )}

          {currentDraft && (
            <div className="draft-preview">
              <div className="draft-preview-header">
                <h4>{currentDraft.title || currentChapter?.chapterTitle || 'Chapter Draft'}</h4>
                <span className="draft-word-count">{previewWordCount.toLocaleString()} words</span>
              </div>
              {currentDraft.summary && (
                <p className="draft-summary">{currentDraft.summary}</p>
              )}
              {Array.isArray(currentDraft.sections) && currentDraft.sections.map((section, index) => (
                <div key={index} className="draft-section">
                  {section.heading && <h5>{section.heading}</h5>}
                  {section.objective && <p className="draft-objective"><em>{section.objective}</em></p>}
                  {Array.isArray(section.text) && section.text.map((paragraph, idx) => (
                    <p key={idx}>{paragraph}</p>
                  ))}
                  {Array.isArray(section.beats) && section.beats.length > 0 && (
                    <ul className="draft-beats">
                      {section.beats.map((beat, beatIdx) => (
                        <li key={beatIdx}>{beat}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {Array.isArray(currentDraft.styleNotes) && currentDraft.styleNotes.length > 0 && (
                <div className="draft-style-notes">
                  <strong>Style Notes</strong>
                  <ul>
                    {currentDraft.styleNotes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {(promptPreview || responsePreview) && (
        <details className="prompt-preview">
          <summary>Prompt Debug{previewContext ? ` — ${previewContext}` : ''}</summary>
          <div className="prompt-preview-body">
            {promptPreview && (
              <>
                <h5>Prompt</h5>
                <pre>{promptPreview}</pre>
              </>
            )}
            {responsePreview && (
              <>
                <h5>Response Preview</h5>
                <pre>{responsePreview}</pre>
              </>
            )}
          </div>
        </details>
      )}

      <div className={`action-prompt-drawer ${isPromptOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="prompt-toggle"
          onClick={() => setIsPromptOpen(prev => !prev)}
          aria-expanded={isPromptOpen}
        >
          {isPromptOpen ? 'Close Action Prompt' : 'Open Action Prompt'}
        </button>
        {isPromptOpen && (
          <div className="prompt-content">
            <label htmlFor="chapter-action-prompt">Chapter Draft Prompt</label>
            <textarea
              id="chapter-action-prompt"
              value={actionPrompt}
              onChange={(e) => handleActionPromptChange(e.target.value)}
              placeholder="Add extra guidance for chapter drafting (e.g., emphasize emotional beats)."
            />
            <div className="prompt-actions">
              <button
                type="button"
                className="button tertiary"
                onClick={() => handleActionPromptChange('')}
              >
                Clear Prompt
              </button>
              <span className="prompt-hint">Applied to chapter drafting for the selected chapter.</span>
            </div>
          </div>
        )}
      </div>

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
      metadata: normalizeChapterMetadata(chapter.metadata),
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
    merged.chapters[id] = {
      chapterTitle: chapter.chapterTitle,
      outline: chapter.outline,
      scenes: reindexed,
      metadata: normalizeChapterMetadata(chapter.metadata),
    };
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
      metadata: normalizeChapterMetadata(chapter.metadata || existing?.metadata),
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
      metadata: defaultChapterMetadata(),
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

function normalizeDraftForClient(draft) {
  if (!draft || typeof draft !== 'object') {
    return { title: '', summary: '', sections: [], styleNotes: [] };
  }

  const title = typeof draft.title === 'string' ? draft.title : '';
  const summary = typeof draft.summary === 'string' ? draft.summary : '';

  const sections = Array.isArray(draft.sections)
    ? draft.sections.map((section, index) => {
        if (!section || typeof section !== 'object') {
          return {
            heading: `Section ${index + 1}`,
            objective: '',
            beats: [],
            text: [],
          };
        }

        const heading = typeof section.heading === 'string'
          ? section.heading
          : typeof section.title === 'string'
            ? section.title
            : `Section ${index + 1}`;

        const objective = typeof section.objective === 'string'
          ? section.objective
          : typeof section.purpose === 'string'
            ? section.purpose
            : '';

        const beatsSource = section.beats || section.keyBeats || [];
        let beats = [];
        if (Array.isArray(beatsSource)) {
          beats = beatsSource
            .map(item => (typeof item === 'string' ? item : String(item || '')).trim())
            .filter(Boolean);
        } else if (typeof beatsSource === 'string' && beatsSource.trim()) {
          beats = [beatsSource.trim()];
        }

        const textSource = section.text || section.draftParagraphs || [];
        let textBlocks = [];
        if (Array.isArray(textSource)) {
          textBlocks = textSource
            .map(item => (typeof item === 'string' ? item : String(item || '')).trim())
            .filter(Boolean);
        } else if (typeof textSource === 'string' && textSource.trim()) {
          textBlocks = [textSource.trim()];
        }

        return {
          heading,
          objective,
          beats,
          text: textBlocks,
        };
      })
    : [];

  let styleNotesRaw = draft.styleNotes ?? draft.notes ?? draft.reminders ?? [];
  if (typeof styleNotesRaw === 'string') {
    styleNotesRaw = styleNotesRaw.trim() ? [styleNotesRaw.trim()] : [];
  }
  const styleNotes = Array.isArray(styleNotesRaw)
    ? styleNotesRaw
        .map(item => (typeof item === 'string' ? item : String(item || '')).trim())
        .filter(Boolean)
    : [];

  return { title, summary, sections, styleNotes };
}

function buildChapterHtml(draft, prompt = '') {
  const parts = [];

  if (draft.summary) {
    parts.push(`<p><strong>Chapter Summary:</strong> ${escapeHtml(draft.summary)}</p>`);
  }

  draft.sections.forEach(section => {
    const segment = [];
    if (section.heading) {
      segment.push(`<h3>${escapeHtml(section.heading)}</h3>`);
    }
    if (section.objective) {
      segment.push(`<p><em>${escapeHtml(section.objective)}</em></p>`);
    }
    if (section.beats && section.beats.length) {
      const beatItems = section.beats.map(item => `<li>${escapeHtml(item)}</li>`).join('');
      segment.push(`<ul>${beatItems}</ul>`);
    }
    if (section.text && section.text.length) {
      section.text.forEach(paragraph => {
        segment.push(`<p>${escapeHtml(paragraph)}</p>`);
      });
    }
    if (segment.length) {
      parts.push(segment.join(''));
    }
  });

  if (draft.styleNotes && draft.styleNotes.length) {
    const noteItems = draft.styleNotes.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    parts.push(`<p><strong>Style Notes</strong></p><ul>${noteItems}</ul>`);
  }

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) {
    parts.push(`<p><strong>Action Prompt:</strong> ${escapeHtml(trimmedPrompt)}</p>`);
  }

  if (!parts.length && draft.summary) {
    return `<p>${escapeHtml(draft.summary)}</p>`;
  }

  return parts.join('');
}

function countDraftWords(draft, prompt = '') {
  const sectionText = Array.isArray(draft.sections)
    ? draft.sections.flatMap(section =>
        Array.isArray(section.text)
          ? section.text
          : typeof section.text === 'string'
            ? [section.text]
            : []
      )
    : [];
  const combined = [draft.summary || '', ...sectionText, prompt || ''].join(' ');
  return combined.split(/\s+/).filter(Boolean).length;
}

function stripChapterForPersistence(chapter) {
  return {
    id: chapter.id,
    title: chapter.title,
    outline: chapter.outline || '',
    content: chapter.content || '',
    wordCount: chapter.wordCount || 0,
    status: chapter.status || 'draft',
    createdAt: chapter.createdAt,
    metadata: normalizeChapterMetadata(chapter.metadata),
  };
}

function escapeHtml(value) {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mapSceneType(rawType) {
  if (!rawType) {
    return 'dialogue';
  }
  const normalized = rawType.toString().toLowerCase();
  if (sceneTypes.some(type => type.value === normalized)) {
    return normalized;
  }

  const aliases = {
    general: 'dialogue',
    conversation: 'dialogue',
    emotional: 'emotional',
    exposition: 'exposition',
    action: 'action',
    setpiece: 'action',
    battle: 'action',
    transition: 'transition',
    climax: 'climax',
  };

  return aliases[normalized] || 'dialogue';
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
