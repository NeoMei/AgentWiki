import {
  foldCase,
  validatePortableDirectoryPath,
} from '@neomei/agentwiki-sync-protocol';
import { ContentTreeError } from './content-tree.types';

const encoder = new TextEncoder();

export interface NormalizedFolderName {
  name: string;
  nameKey: string;
  byteLength: number;
}

export function normalizeFolderName(input: string): NormalizedFolderName {
  const name = input.trim().normalize('NFC');
  const codePoints = Array.from(name).length;
  if (codePoints < 1 || codePoints > 200) {
    throw new ContentTreeError('FOLDER_INVALID_NAME', 'Folder names must contain 1 to 200 characters');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new ContentTreeError('FOLDER_INVALID_NAME', 'Folder names cannot contain path separators');
  }

  try {
    validatePortableDirectoryPath(`pages/${name}`);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ContentTreeError('FOLDER_PATH_TOO_LONG', error.message);
    }
    throw new ContentTreeError('FOLDER_INVALID_NAME', error instanceof Error ? error.message : 'Invalid Folder name');
  }

  return {
    name,
    nameKey: foldCase(name),
    byteLength: encoder.encode(name).byteLength,
  };
}
