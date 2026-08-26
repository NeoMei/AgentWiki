export type MarkdownRenderMode = 'page' | 'editor-preview' | 'version' | 'embed' | 'static';

export interface MarkdownTaskRef {
  index: number;
  start: number;
  end: number;
  markerOffset: number;
  checked: boolean;
  signature: string;
}

export interface MarkdownTaskToggle {
  task: MarkdownTaskRef;
  nextChecked: boolean;
}
