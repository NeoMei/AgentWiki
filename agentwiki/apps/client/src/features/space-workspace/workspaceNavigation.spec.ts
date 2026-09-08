import { describe, expect, it } from 'vitest';
import {
  folderIdFromSearch,
  isWorkspacePath,
  spaceFolderHref,
  workspaceSectionFromPath,
} from './workspaceNavigation';

describe('workspaceNavigation', () => {
  it('uses the folder query parameter as the directory selection source of truth', () => {
    expect(folderIdFromSearch('?folder=folder%2Ftwo')).toBe('folder/two');
    expect(folderIdFromSearch('?view=list')).toBeNull();
    expect(spaceFolderHref('space/one', 'folder/two')).toBe('/spaces/space%2Fone?folder=folder%2Ftwo');
    expect(spaceFolderHref('space/one', null)).toBe('/spaces/space%2Fone');
  });

  it('classifies only space and page routes as workspace paths', () => {
    expect(isWorkspacePath('/spaces/space-1/settings/page-templates')).toBe(true);
    expect(isWorkspacePath('/pages/page-1/edit')).toBe(true);
    expect(isWorkspacePath('/search')).toBe(false);
    expect(isWorkspacePath('/profile')).toBe(false);
  });

  it('assigns nested collaboration and settings routes to their parent section', () => {
    expect(workspaceSectionFromPath('/spaces/space-1/collaboration/runs/run-1')).toBe('collaboration');
    expect(workspaceSectionFromPath('/spaces/space-1/settings/page-templates')).toBe('settings');
    expect(workspaceSectionFromPath('/pages/page-1/versions')).toBe('pages');
  });
});
