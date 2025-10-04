import React, { createContext, useContext, useEffect, useState } from 'react';
import { storageService } from '../services/storageService';

const ProjectContext = createContext(null);

export const useProject = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return ctx;
};

export const ProjectProvider = ({ children }) => {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      if (!storageService.isBackendEnabled()) {
        setProjects([{ id: 'default', name: 'Local Workspace' }]);
        setActiveProject('default');
        setLoading(false);
        return;
      }

      try {
        const result = await storageService.listProjects();
        if (cancelled) return;
        setProjects(result);
        const saved = localStorage.getItem('lexicraft_active_project');
        const defaultProject = saved && result.some(p => p.id === saved) ? saved : result[0]?.id || 'default';
        setActiveProject(defaultProject);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem('lexicraft_active_project', activeProject);
    }
  }, [activeProject]);

  const createProject = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Project name is required');
    }
    const project = await storageService.createProject(trimmed);
    setError(null);
    setProjects(prev => {
      if (prev.some(p => p.id === project.id)) {
        return prev;
      }
      return [...prev, project];
    });
    setActiveProject(project.id);
    return project;
  };

  const value = {
    projects,
    activeProject,
    setActiveProject,
    createProject,
    loading,
    error,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
};
